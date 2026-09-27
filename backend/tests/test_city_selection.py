# Check city identity, time-zone derivation, cache behavior, namesake rejection, and trip deletion permissions.
import asyncio
import httpx
import pytest
from fastapi import HTTPException
from app import cities, providers, sync
from conftest import signup, create
from test_destination_map import GeocodeCache

CHICAGO = {'id': 4887398, 'name': 'Chicago', 'latitude': 41.85, 'longitude': -87.65, 'timezone': 'America/Chicago', 'country': 'United States', 'country_code': 'US', 'admin1': 'Illinois', 'admin2': 'Cook County', 'feature_code': 'PPLA2'}
PARIS = {**CHICAGO, 'id': 4717560, 'name': 'Paris', 'latitude': 33.66, 'longitude': -95.55, 'admin1': 'Texas', 'admin2': 'Lamar County'}


def test_city_identity_timezone_and_unusable_results():
    row = cities.parse_city(CHICAGO)
    assert row['address'] == 'Chicago, Cook County, Illinois, United States'
    assert row['timezone'] == 'America/Chicago'
    assert row['id'] == 4887398
    assert cities.parse_city({**CHICAGO, 'timezone': 'Invalid/Zone'}) is None
    assert cities.parse_city({**CHICAGO, 'latitude': float('nan')}) is None
    assert cities.parse_city({**CHICAGO, 'feature_code': 'AIRP'}) is None


def test_search_caches_identity_for_immediate_selection(monkeypatch):
    calls = []
    monkeypatch.setattr(sync, 'redis', GeocodeCache())
    def respond(request):
        calls.append(request)
        assert request.url.params['language'] == 'en'
        return httpx.Response(200, json={'results': [CHICAGO]})
    factory = httpx.AsyncClient
    monkeypatch.setattr(cities.httpx, 'AsyncClient', lambda **kw: factory(transport=httpx.MockTransport(respond), **kw))
    async def check():
        matches = await cities.search('Chicago')
        selected = await cities.get(matches[0]['id'])
        assert matches == [selected]
        assert await cities.search('Chicago') == matches
    asyncio.run(check())
    assert len(calls) == 1


def test_search_failure_does_not_guess_timezone(monkeypatch):
    monkeypatch.setattr(sync, 'redis', GeocodeCache())
    factory = httpx.AsyncClient
    monkeypatch.setattr(cities.httpx, 'AsyncClient', lambda **kw: factory(transport=httpx.MockTransport(lambda request: httpx.Response(503)), **kw))
    with pytest.raises(HTTPException) as error:
        asyncio.run(cities.search('Chicago'))
    assert error.value.status_code == 502


def test_trip_creation_revalidates_city_and_timezone(client, monkeypatch):
    assert client.get('/api/cities/search?q=Chicago').status_code == 401
    signup(client)
    async def get(city_id):
        assert city_id == CHICAGO['id']
        return cities.parse_city(CHICAGO)
    monkeypatch.setattr(cities, 'get', get)
    response = client.post('/api/trips', json={'title': 'Chicago trip', 'destination': 'Chicago', 'destination_id': CHICAGO['id'], 'timezone': 'America/New_York', 'start_date': '2026-10-01', 'end_date': '2026-10-03'})
    assert response.status_code == 201, response.text
    trip = response.json()
    assert trip['timezone'] == 'America/Chicago'
    assert trip['destination_location']['id'] == CHICAGO['id']
    assert 'Illinois' in trip['destination']
    fetched = client.get('/api/trips/' + trip['id']).json()
    assert fetched['destination_location']['lat'] == 41.85
    assert client.get('/api/cities/search?q=x').status_code == 422


def test_existing_trip_reselection_and_stale_update(client, monkeypatch):
    signup(client)
    trip = create(client)
    async def get(city_id):
        return cities.parse_city(CHICAGO)
    monkeypatch.setattr(cities, 'get', get)
    body = {'title': trip['title'], 'destination': 'Chicago', 'destination_id': CHICAGO['id'], 'timezone': 'America/New_York', 'start_date': trip['start_date'], 'end_date': trip['end_date']}
    path = '/api/trips/' + trip['id']
    response = client.put(path, json=body, headers={'If-Match': str(trip['version'])})
    assert response.status_code == 200
    assert response.json()['timezone'] == 'America/Chicago'
    assert client.put(path, json=body, headers={'If-Match': str(trip['version'])}).status_code == 409


def test_selected_city_cannot_resolve_to_foreign_namesake(monkeypatch):
    selected = cities.parse_city(PARIS)
    texas = {**selected, 'bounds': [33.5, 33.8, -95.8, -95.3]}
    france = {**texas, 'lat': 48.86, 'lon': 2.35, 'country_code': 'fr'}
    calls = []
    async def search(query, **kwargs):
        calls.append(kwargs)
        return [france, texas] if kwargs.get('city_only') else []
    monkeypatch.setattr(providers, 'search_places', search)
    asyncio.run(providers.search_in_destination('park', selected['address'], selected=selected))
    assert calls[1]['bounds'] == texas['bounds']
    assert calls[1]['country_code'] == 'us'
    async def wrong(query, **kwargs):
        return [france]
    monkeypatch.setattr(providers, 'search_places', wrong)
    with pytest.raises(HTTPException) as error:
        asyncio.run(providers.search_in_destination('park', selected['address'], selected=selected))
    assert error.value.status_code == 422


def test_delete_trip_requires_owner_and_current_version(client):
    signup(client)
    trip = create(client)
    path = '/api/trips/' + trip['id']
    assert client.delete(path, headers={'If-Match': '999'}).status_code == 409
    assert client.get(path).status_code == 200
    client.post('/api/auth/logout')
    signup(client, 'other@example.com')
    assert client.delete(path, headers={'If-Match': str(trip['version'])}).status_code in (403, 404)
    client.post('/api/auth/logout')
    client.post('/api/auth/login', json={'email': 'owner@example.com', 'password': 'Secure-test-password7!'})
    assert client.delete(path, headers={'If-Match': str(trip['version'])}).status_code == 200
    assert client.get(path).status_code == 404
