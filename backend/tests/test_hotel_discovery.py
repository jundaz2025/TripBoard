# Verify hotel identity/source discovery with mocked providers, without guessing missing policy times.
import asyncio
import httpx
import pytest
from fastapi import HTTPException
from app import hotel_discovery, api
from conftest import signup, create
from test_destination_map import GeocodeCache


def candidate(
    label="Example Hotel", lat=40.71, lon=-74.0, website="https://example-hotel.test/"
):
    return {"names": [label], "lat": lat, "lon": lon, "website": website}


def test_discovery_matches_name_and_coordinates():
    match = candidate()
    foreign = candidate(lat=51.5, lon=-0.1)
    assert (
        hotel_discovery.match_website([match], "Example Hotel, A Brand", 40.71, -74.0)
        == "https://example-hotel.test/"
    )
    assert (
        hotel_discovery.match_website([foreign], "Example Hotel", 40.71, -74.0) is None
    )
    assert (
        hotel_discovery.match_website(
            [candidate("Different Hotel")], "Example Hotel", 40.71, -74.0
        )
        is None
    )
    second = candidate(website="https://different-hotel.test/")
    assert (
        hotel_discovery.match_website([match, second], "Example Hotel", 40.71, -74.0)
        is None
    )


def test_website_discovery_without_a_user_supplied_url(monkeypatch):
    requests = []

    def respond(request):
        requests.append(request)
        assert "around:300,40.71,-74.0" in request.url.params["data"]
        return httpx.Response(
            200,
            json={
                "elements": [
                    {
                        "lat": 40.71,
                        "lon": -74.0,
                        "tags": {
                            "name": "Example Hotel",
                            "website": "https://example-hotel.test/",
                        },
                    }
                ]
            },
        )

    factory = httpx.AsyncClient
    monkeypatch.setattr(
        hotel_discovery.httpx,
        "AsyncClient",
        lambda **kw: factory(transport=httpx.MockTransport(respond), **kw),
    )

    async def lookup(url, name):
        assert url == "https://example-hotel.test/"
        return {
            "check_in_time": "16:00",
            "check_out_time": "11:00",
            "source_url": url + "faq/",
            "checked_at": "2026-09-23T12:00:00+00:00",
        }

    monkeypatch.setattr(hotel_discovery, "lookup", lookup)
    result = asyncio.run(
        hotel_discovery.resolve("Example Hotel, A Brand", 40.71, -74.0)
    )
    assert result["check_in_time"] == "16:00"
    assert result["hotel_website"] == "https://example-hotel.test/"
    assert len(requests) == 1


def test_verified_source_fills_metadata_gap_but_reads_times_live(monkeypatch):
    monkeypatch.setattr(hotel_discovery, "SOURCES", [candidate()])
    calls = []

    async def lookup(url, name):
        calls.append(url)
        return {
            "check_in_time": "17:30",
            "check_out_time": "10:00",
            "source_url": url + "faq",
            "checked_at": "2026-09-23",
        }

    monkeypatch.setattr(hotel_discovery, "lookup", lookup)
    result = asyncio.run(hotel_discovery.resolve("Example Hotel", 40.71, -74.0))
    assert result["check_in_time"] == "17:30"
    assert calls == ["https://example-hotel.test/"]


def test_place_website_avoids_discovery_and_unknown_has_no_guessed_times(monkeypatch):
    async def lookup(url, name):
        return {
            "check_in_time": "15:00",
            "check_out_time": None,
            "source_url": url,
            "checked_at": "2026-09-23",
        }

    async def discover(name, lat, lon):
        return None

    monkeypatch.setattr(hotel_discovery, "lookup", lookup)
    monkeypatch.setattr(hotel_discovery, "discover", discover)
    result = asyncio.run(
        hotel_discovery.resolve("Example Hotel", 40.71, -74.0, "https://hotel.test/")
    )
    assert result["check_out_time"] is None
    with pytest.raises(HTTPException) as error:
        asyncio.run(hotel_discovery.resolve("Unknown Hotel", 40.71, -74.0))
    assert error.value.status_code == 422


def test_automatic_lookup_api_caches_and_keeps_trip_unchanged(client, monkeypatch):
    signup(client)
    trip = create(client)
    monkeypatch.setattr(api, "redis", GeocodeCache())
    calls = []

    async def resolve(name, lat, lon, website):
        calls.append((name, lat, lon, website))
        return {
            "check_in_time": "16:00",
            "check_out_time": "11:00",
            "source_url": "https://hotel.test/faq",
            "checked_at": "2026-09-23",
        }

    monkeypatch.setattr(hotel_discovery, "resolve", resolve)
    path = f"/api/trips/{trip['id']}/hotel-policy"
    data = {"name": "Example Hotel", "lat": 40.71, "lon": -74.0}
    assert client.post(path, json=data).json()["check_in_time"] == "16:00"
    assert client.post(path, json=data).status_code == 200
    assert calls == [("Example Hotel", 40.71, -74.0, "")]
    assert client.post(path, json={"name": "Example Hotel"}).status_code == 422
    assert client.get(f"/api/trips/{trip['id']}").json()["version"] == trip["version"]
