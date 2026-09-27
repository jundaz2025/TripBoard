"""City identities and IANA time zones from Open-Meteo / GeoNames."""
import hashlib
import json
import math
import os
from zoneinfo import ZoneInfo

import httpx
from fastapi import HTTPException


def parse_city(row):
    """Accept populated-place results with valid coordinates, an IANA zone and a disambiguating region label."""
    try:
        if not row.get('feature_code', '').startswith('PPL'):
            return None
        lat, lon = float(row['latitude']), float(row['longitude'])
        if not (math.isfinite(lat) and math.isfinite(lon) and -90 <= lat <= 90 and -180 <= lon <= 180):
            return None
        ZoneInfo(row['timezone'])
        parts = list(dict.fromkeys(p for p in [row['name'], row.get('admin2'), row.get('admin1'), row.get('country')] if p))
        label = ', '.join(parts)
        if len(label) > 200:
            return None
        return {'id': int(row['id']), 'name': row['name'], 'address': label, 'lat': lat, 'lon': lon,
                'timezone': row['timezone'], 'country_code': row['country_code'].lower()}
    except (KeyError, ValueError, TypeError):
        return None


async def request(path, params):
    """Cache provider responses and enforce a shared rate limit before external city requests."""
    from .sync import redis
    if not redis:
        raise HTTPException(503, 'Start Redis to search for cities.')
    base = os.getenv('CITY_GEOCODING_URL', 'https://geocoding-api.open-meteo.com/v1').rstrip('/')
    key = 'cities:en:v1:' + hashlib.sha256(json.dumps([base, path, params], sort_keys=True).encode()).hexdigest()
    try:
        cached = await redis.get(key)
        if cached:
            return json.loads(cached)
        if not await redis.set('cities:rate', 1, nx=True, ex=1):
            raise HTTPException(429, 'Wait a moment before searching again.')
        async with httpx.AsyncClient(timeout=12) as client:
            response = await client.get(base + path, params={**params, 'language': 'en'}, headers={'User-Agent': 'TripBoard-local-project/1.0'})
            response.raise_for_status()
            result = response.json()
        if result.get('error'):
            raise ValueError()
        await redis.set(key, json.dumps(result), ex=86400)
        # Selection can be validated immediately without a second provider call.
        if path == '/search':
            for row in result.get('results', []):
                if parse_city(row):
                    selected_key = 'cities:en:v1:' + hashlib.sha256(json.dumps([base, '/get', {'id': row['id']}], sort_keys=True).encode()).hexdigest()
                    await redis.set(selected_key, json.dumps(row), ex=86400)
        return result
    except HTTPException:
        raise
    except (httpx.HTTPError, ValueError, TypeError):
        raise HTTPException(502, 'City search is unavailable. Please try again shortly.')
    except Exception:
        raise HTTPException(503, 'City search is temporarily unavailable.')


async def search(query):
    """Return normalized city candidates for an explicit user selection."""
    result = await request('/search', {'name': ' '.join(query.split()), 'count': 10})
    return [city for row in result.get('results', []) if (city := parse_city(row))]


async def get(city_id):
    """Resolve a selected provider ID again so client-supplied city/time-zone fields are not authoritative."""
    result = parse_city(await request('/get', {'id': city_id}))
    if result is None:
        raise HTTPException(422, 'Choose a valid city from the destination results.')
    return result


async def trip_fields(data):
    """Replace destination coordinates and zone with the selected city's verified provider fields."""
    fields = data.model_dump()
    if data.destination_id is not None:
        city = await get(data.destination_id)
        fields.update(destination=city['address'], timezone=city['timezone'], destination_location=city)
    else:
        fields['destination_location'] = None
    return fields
