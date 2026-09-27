"""External geocoding and travel-time adapters with bounded requests, shared caching and explicit estimates."""

import math, os, hashlib, json
import httpx
from fastapi import HTTPException


def distance(a, b):
    """Return great-circle distance in kilometers; this is not a road-network travel distance."""
    x1, y1, x2, y2 = map(math.radians, [a["lat"], a["lon"], b["lat"], b["lon"]])
    return (
        6371
        * 2
        * math.asin(
            min(
                1,
                math.sqrt(
                    math.sin((x2 - x1) / 2) ** 2
                    + math.cos(x1) * math.cos(x2) * math.sin((y2 - y1) / 2) ** 2
                ),
            )
        )
    )


async def matrix(points, source="estimate"):
    """Return a minute matrix plus provenance, keeping estimated walking and OSRM driving data distinct."""
    # Estimates stay explicitly labeled; unavailable road routing must not silently become an estimate.
    if source == "estimate":
        return [
            [
                0 if i == j else max(3, math.ceil(distance(a, b) / 4.5 * 60 * 1.25))
                for j, b in enumerate(points)
            ]
            for i, a in enumerate(points)
        ], "Estimated walking times; not live road data"
    url = os.getenv("OSRM_URL", "").rstrip("/")
    if not url:
        raise HTTPException(
            503,
            "Live routing is not configured. Set OSRM_URL or choose estimated walking times.",
        )
    from .sync import redis

    if not redis:
        raise HTTPException(
            503, "Road routing needs Redis for shared caching and rate limits."
        )
    cache_key = (
        "route-matrix:"
        + hashlib.sha256(json.dumps([url, points], sort_keys=True).encode()).hexdigest()
    )
    try:
        cached = await redis.get(cache_key)
        if cached:
            return json.loads(
                cached
            ), "OSRM driving times · OpenStreetMap data (cached)"
        if not await redis.set("osrm:rate", 1, nx=True, ex=2):
            raise HTTPException(
                429, "Wait two seconds before another road-routing request."
            )
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(503, "Start Redis to use road routing.")
    coords = ";".join(f"{p['lon']},{p['lat']}" for p in points)
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.get(
                f"{url}/table/v1/driving/{coords}",
                params={"annotations": "duration"},
                headers={"User-Agent": "TripBoard-local-project/1.0"},
            )
            r.raise_for_status()
            data = r.json()
        if data.get("code") != "Ok" or any(
            v is None for row in data["durations"] for v in row
        ):
            raise ValueError()
        values = [[math.ceil(v / 60) for v in row] for row in data["durations"]]
        await redis.set(cache_key, json.dumps(values), ex=86400)
        return values, "OSRM driving times · OpenStreetMap data"
    except Exception:
        raise HTTPException(
            502, "Routing service unavailable or these places are not connected."
        )


def destination_bounds(location):
    """Reject invalid or nonfinite bounding boxes before constructing a provider query."""
    try:
        south, north, west, east = map(float, location["bounds"])
        if not (
            all(math.isfinite(v) for v in (south, north, west, east))
            and -90 <= south < north <= 90
            and -180 <= west < east <= 180
        ):
            raise ValueError()
        return [south, north, west, east]
    except (KeyError, TypeError, ValueError):
        raise HTTPException(
            422,
            "We couldn't determine this city's search area. Update Destination with a city and country in Trip settings.",
        )


async def search_in_destination(query, destination, selected=None):
    """Match the selected city identity before restricting place results to its area and country."""
    cities = await search_places(destination, city_only=True)
    if not cities:
        raise HTTPException(
            422,
            "We couldn't find your destination. Update Destination with a city and country in Trip settings before searching.",
        )
    if selected:
        cities = [city for city in cities
                  if city.get("country_code") == selected.get("country_code")
                  and distance(city, selected) < 30]
        cities.sort(key=lambda city: distance(city, selected))
        if not cities:
            raise HTTPException(422, "We could not match the selected city to a search area. Try again or choose a more specific destination.")
    city = cities[0]
    return await search_places(
        query,
        bounds=destination_bounds(city),
        country_code=city.get("country_code"),
    )


def place_label(row):
    """Prefer a named place, otherwise combine house number and street rather than showing only a number."""
    names = row.get("namedetails") or {}
    address = row.get("address") or {}
    house_number = address.get("house_number")
    name = names.get("name:en") or names.get("name") or row.get("name")
    if name and name != house_number:
        return name
    street = address.get("road") or address.get("pedestrian") or address.get("footway")
    if house_number and street:
        return f"{house_number} {street}"
    first = row["display_name"].split(",")[0].strip()
    # If street details are missing, keep the full address instead of just a number.
    return row["display_name"] if first == house_number or first.isdecimal() else first


async def search_places(query, *, city_only=False, bounds=None, country_code=None):
    """Query Nominatim with shared rate limits; independently filter results to enforce the destination bounds."""
    from .sync import redis

    if not redis:
        raise HTTPException(
            503, "Place search needs Redis. You can add coordinates manually."
        )
    query = " ".join(query.split())
    endpoint = os.getenv("NOMINATIM_URL", "https://nominatim.openstreetmap.org").rstrip(
        "/"
    )
    key = (
        "geocode:en:v6:"
        + hashlib.sha256(
            json.dumps(
                [endpoint, query.lower(), city_only, bounds, country_code]
            ).encode()
        ).hexdigest()
    )
    try:
        cached = await redis.get(key)
        if cached:
            return json.loads(cached)
        # A shared Redis NX lock applies the provider limit across users and backend processes.
        if not await redis.set("geocode:rate", 1, nx=True, ex=2):
            raise HTTPException(429, "Wait two seconds before another search.")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(503, "Start Redis to use place search.")
    params = {
        "q": query,
        "format": "jsonv2",
        "limit": 5,
        "accept-language": "en",
        "namedetails": 1,
        "addressdetails": 1,
        "extratags": 1,
    }
    if city_only:
        params["featureType"] = "city"
    if bounds is not None:
        south, north, west, east = destination_bounds({"bounds": bounds})
        params.update({"viewbox": f"{west},{north},{east},{south}", "bounded": 1})
    if country_code:
        params["countrycodes"] = country_code
    try:
        async with httpx.AsyncClient(timeout=12) as client:
            r = await client.get(
                endpoint + "/search",
                params=params,
                headers={
                    "User-Agent": "TripBoard-local-project/1.0",
                    "Accept-Language": "en",
                },
            )
            r.raise_for_status()
            rows = r.json()
        if bounds is not None:
            # Enforce the area even if a provider ignores the bounded query.
            rows = [
                r
                for r in rows
                if south <= float(r["lat"]) <= north
                and west <= float(r["lon"]) <= east
                and (
                    not country_code
                    or r.get("address", {}).get("country_code") == country_code
                )
            ]
        results = [
            {
                "name": place_label(r),
                "address": r["display_name"],
                "lat": float(r["lat"]),
                "lon": float(r["lon"]),
                **(
                    {
                        "website": (r.get("extratags") or {}).get("website")
                        or (r.get("extratags") or {}).get("contact:website")
                    }
                    if (
                        (r.get("extratags") or {}).get("website")
                        or (r.get("extratags") or {}).get("contact:website")
                    )
                    else {}
                ),
                **(
                    {"country_code": r["address"]["country_code"]}
                    if city_only and r.get("address", {}).get("country_code")
                    else {}
                ),
                **(
                    {"bounds": [float(v) for v in r["boundingbox"]]}
                    if city_only and len(r.get("boundingbox", [])) == 4
                    else {}
                ),
            }
            for r in rows
        ]
        await redis.set(key, json.dumps(results), ex=86400)
        return results
    except Exception:
        raise HTTPException(
            502, "Place search is unavailable. You can enter coordinates manually."
        )
