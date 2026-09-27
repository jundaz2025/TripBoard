# Ensure a trip-scoped search never leaks global, foreign-country, or out-of-bounds results.
import httpx
import pytest
from fastapi.testclient import TestClient
from app import providers, sync
from app.api import app
from conftest import signup
from test_destination_map import GeocodeCache


def make_trip(client, destination="New York"):
    response = client.post(
        "/api/trips",
        json={
            "title": "Search test",
            "destination": destination,
            "start_date": "2026-10-01",
            "end_date": "2026-10-03",
            "timezone": "America/New_York",
        },
    )
    assert response.status_code == 201
    return response.json()


def row(name, lat, lon, country="us", **extras):
    return {
        "display_name": name,
        "lat": str(lat),
        "lon": str(lon),
        "address": {"country_code": country},
        **extras,
    }


def mock_search(monkeypatch, responder):
    cache = GeocodeCache()
    monkeypatch.setattr(sync, "redis", cache)
    factory = httpx.AsyncClient
    monkeypatch.setattr(
        providers.httpx,
        "AsyncClient",
        lambda **kw: factory(
            transport=httpx.MockTransport(responder),
            **kw,
        ),
    )
    return cache


def test_scoped_search_filters_foreign_and_outside_results_and_separates_caches(
    client, monkeypatch
):
    signup(client)
    trip = make_trip(client)
    calls = []
    cities = {
        "New York": row(
            "New York", 40.71, -74.00, boundingbox=[40.47, 40.92, -74.26, -73.70]
        ),
        "London": row(
            "London", 51.51, -0.12, "gb", boundingbox=[51.28, 51.70, -0.51, 0.34]
        ),
    }
    matches = [
        row("Central Park, New York", 40.78, -73.96),
        row("Central Park, United Kingdom", 56.10, -3.35, "gb"),
        row("Park, Chicago", 41.88, -87.62),
        row("Park, London", 51.50, -0.10, "gb"),
        row("Incorrect country", 40.78, -73.96, "gb"),
    ]

    def respond(request):
        calls.append(dict(request.url.params))
        if request.url.params.get("featureType") == "city":
            return httpx.Response(200, json=[cities[request.url.params["q"]]])
        return httpx.Response(200, json=matches)

    cache = mock_search(monkeypatch, respond)
    # A previously cached global search must never pollute a scoped result.
    assert (
        len(client.get("/api/places/search", params={"q": "central park"}).json()) == 5
    )
    cache.values.pop("geocode:rate", None)
    path = f"/api/trips/{trip['id']}/places/search"
    # Cold city resolution respects the limiter; the client retries after it.
    assert client.get(path, params={"q": "central park"}).status_code == 429
    cache.values.pop("geocode:rate", None)
    response = client.get(path, params={"q": "central park"})
    assert response.status_code == 200, response.text
    assert [r["name"] for r in response.json()] == ["Central Park"]
    assert response.json()[0]["address"] == "Central Park, New York"
    assert calls[-1]["viewbox"] == "-74.26,40.92,-73.7,40.47"
    assert calls[-1]["bounded"] == "1"
    assert calls[-1]["countrycodes"] == "us"
    count = len(calls)
    assert client.get(path, params={"q": "central park"}).json() == response.json()
    assert len(calls) == count

    # The same trip changing destination must use a different search cache.
    updated = client.put(
        f"/api/trips/{trip['id']}",
        headers={"If-Match": str(trip["version"])},
        json={
            "title": trip["title"],
            "destination": "London",
            "start_date": trip["start_date"],
            "end_date": trip["end_date"],
            "timezone": "Europe/London",
        },
    )
    assert updated.status_code == 200
    cache.values.pop("geocode:rate", None)
    assert client.get(path, params={"q": "central park"}).status_code == 429
    cache.values.pop("geocode:rate", None)
    london = client.get(path, params={"q": "central park"})
    assert [r["address"] for r in london.json()] == ["Park, London"]
    assert calls[-1]["countrycodes"] == "gb"
    with TestClient(app) as stranger:
        assert stranger.get(path, params={"q": "central park"}).status_code == 401
        signup(stranger, "stranger@example.com")
        assert stranger.get(path, params={"q": "central park"}).status_code == 404


@pytest.mark.parametrize(
    "city", [None, {"name": "Unknown"}, {"bounds": [40, 41, -74, float("nan")]}]
)
def test_unresolved_destination_never_falls_back_to_global_search(
    client, monkeypatch, city
):
    signup(client)
    trip = make_trip(client, "Unknown destination")
    calls = []

    async def lookup(query, **kwargs):
        calls.append((query, kwargs))
        return [] if city is None else [city]

    monkeypatch.setattr(providers, "search_places", lookup)
    response = client.get(
        f"/api/trips/{trip['id']}/places/search", params={"q": "central park"}
    )
    assert response.status_code == 422
    assert calls == [("Unknown destination", {"city_only": True})]


def test_no_local_matches_stay_empty(client, monkeypatch):
    signup(client)
    trip = make_trip(client)
    calls = []

    def respond(request):
        calls.append(dict(request.url.params))
        if request.url.params.get("featureType") == "city":
            return httpx.Response(
                200,
                json=[
                    row(
                        "New York",
                        40.71,
                        -74.0,
                        boundingbox=[40.47, 40.92, -74.26, -73.70],
                    )
                ],
            )
        # Simulate a provider ignoring the bounding box. Still never show it.
        return httpx.Response(200, json=[row("Big Ben, London", 51.5, -0.12, "gb")])

    cache = mock_search(monkeypatch, respond)
    path = f"/api/trips/{trip['id']}/places/search"
    assert client.get(path, params={"q": "Big Ben"}).status_code == 429
    cache.values.pop("geocode:rate", None)
    response = client.get(path, params={"q": "Big Ben"})
    assert response.status_code == 200
    assert response.json() == []
    assert len(calls) == 2
    assert calls[-1]["bounded"] == "1"
