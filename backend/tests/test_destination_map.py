# Verify destination bounds, city-only cache keys, throttling, and explicit geocoding failures.
import httpx
import pytest
from app import providers, sync
from conftest import signup


class GeocodeCache:
    def __init__(self):
        self.values = {}

    async def get(self, key):
        return self.values.get(key)

    async def set(self, key, value, nx=False, ex=None):
        if nx and key in self.values:
            return False
        self.values[key] = value
        return True


@pytest.mark.parametrize("city_only", [False, True])
def test_geocoding_city_bounds_cache_and_shared_rate_limit(
    client, monkeypatch, city_only
):
    cache = GeocodeCache()
    monkeypatch.setattr(sync, "redis", cache)
    monkeypatch.setenv("NOMINATIM_URL", "https://geocoding.example.test")
    calls = []

    def respond(request):
        calls.append(request)
        assert request.url.host == "geocoding.example.test"
        assert request.url.params["q"] == "New York"
        assert request.url.params.get("featureType") == ("city" if city_only else None)
        return httpx.Response(
            200,
            json=[
                {
                    "display_name": "New York, United States",
                    "namedetails": {"name:en": "New York"},
                    "lat": "40.7127",
                    "lon": "-74.0060",
                    "boundingbox": ["40.4774", "40.9176", "-74.2591", "-73.7003"],
                }
            ],
        )

    factory = httpx.AsyncClient
    monkeypatch.setattr(
        providers.httpx,
        "AsyncClient",
        lambda **kw: factory(
            transport=httpx.MockTransport(respond),
            **kw,
        ),
    )
    params = {"q": "  New   York  ", "city_only": str(city_only).lower()}
    assert client.get("/api/places/search", params=params).status_code == 401
    assert calls == []
    signup(client)
    result = client.get("/api/places/search", params=params)
    assert result.status_code == 200, result.text
    point = result.json()[0]
    assert point["name"] == "New York"
    assert point["lat"] == 40.7127
    if city_only:
        assert point["bounds"] == [40.4774, 40.9176, -74.2591, -73.7003]
    else:
        assert "bounds" not in point
    # A normalized repeat uses the cache even while the shared limiter is busy.
    assert (
        client.get("/api/places/search", params={**params, "q": "new york"}).json()
        == result.json()
    )
    assert len(calls) == 1
    # City and place results cannot be confused through the cache.
    blocked = client.get(
        "/api/places/search", params={**params, "city_only": str(not city_only).lower()}
    )
    assert blocked.status_code == 429
    assert len(calls) == 1


@pytest.mark.parametrize("status, rows, expected", [(200, [], 200), (503, {}, 502)])
def test_destination_no_match_and_provider_failure(
    client, monkeypatch, status, rows, expected
):
    monkeypatch.setattr(sync, "redis", GeocodeCache())
    factory = httpx.AsyncClient
    monkeypatch.setattr(
        providers.httpx,
        "AsyncClient",
        lambda **kw: factory(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(status, json=rows)
            ),
            **kw,
        ),
    )
    signup(client)
    response = client.get(
        "/api/places/search", params={"q": "Unmatched city", "city_only": True}
    )
    assert response.status_code == expected
    if status == 200:
        assert response.json() == []
