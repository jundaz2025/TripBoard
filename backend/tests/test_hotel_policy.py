# Cover website time extraction, unsafe URL rejection, caching, and reminders based on saved hotel times.
import socket
from datetime import datetime, timezone
import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from app import api, hotel_policy, worker
from app.api import app
from conftest import signup, create, add
from test_destination_map import GeocodeCache
from test_scoped_search import mock_search, row


def parse(html):
    page = hotel_policy.PolicyPage()
    page.feed(html)
    return hotel_policy.extract_times(page)


def test_explicit_website_times_and_early_late_not_confused():
    assert parse(
        "<p>Check into your room beginning at 4PM. Please check out by 11AM.</p>"
    ) == {"check_in_time": "16:00", "check_out_time": "11:00"}
    assert parse("<p>Check-in: 3:30 PM; Check-out: 11:00 AM.</p>") == {
        "check_in_time": "15:30",
        "check_out_time": "11:00",
    }
    assert parse("<p>Early check-in from 10AM. Late check-out at 2PM.</p>") == {
        "check_in_time": None,
        "check_out_time": None,
    }
    assert parse("<p>Breakfast starts at 7AM. Reception closes at 11PM.</p>") == {
        "check_in_time": None,
        "check_out_time": None,
    }
    assert parse("<p>Check-in: 3PM.</p><p>Check-in: 4PM.</p>")["check_in_time"] is None


def test_hotel_structured_data_not_restaurant_hours():
    assert parse("""<script type="application/ld+json">{"@graph":[
        {"@type":"Restaurant","checkinTime":"09:00"},
        {"@type":"Hotel","checkinTime":"16:00:00","checkoutTime":"11:30"}
    ]}</script>""") == {"check_in_time": "16:00", "check_out_time": "11:30"}


def test_policy_discovers_faq_and_returns_source_without_default_times(monkeypatch):
    calls = []

    def fetch(url):
        calls.append(url)
        return url, (
            '<h1>Example Hotel</h1><a href="/faq/">FAQ</a><a href="https://other.test/faq">Other</a>'
            if url.endswith(".test/")
            else "<h1>Example Hotel</h1><p>Check-in from 4PM.</p>"
        )

    monkeypatch.setattr(hotel_policy, "fetch_page", fetch)
    result = hotel_policy.lookup_pages("https://hotel.test/", "Example Hotel")
    assert result["check_in_time"] == "16:00"
    assert result["check_out_time"] is None
    assert result["source_url"] == "https://hotel.test/faq/"
    assert calls == ["https://hotel.test/", "https://hotel.test/faq/"]
    with pytest.raises(HTTPException) as error:
        hotel_policy.lookup_pages("https://hotel.test/", "Different Hotel")
    assert error.value.status_code == 422


@pytest.mark.parametrize("ip", ["127.0.0.1", "10.0.0.2", "169.254.169.254", "::1"])
def test_policy_blocks_private_targets(monkeypatch, ip):
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda *a, **k: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, 443))],
    )
    with pytest.raises(ValueError, match="private"):
        hotel_policy.public_target("https://hotel.test/faq")


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "https://user:password@example.com",
        "https://example.com:8001",
    ],
)
def test_policy_rejects_credentials_and_non_web_urls(url):
    with pytest.raises(ValueError):
        hotel_policy.public_target(url)


def test_hotel_lookup_membership_rate_limit_and_does_not_save(client, monkeypatch):
    signup(client)
    trip = create(client)
    monkeypatch.setattr(api, "redis", GeocodeCache())
    calls = []

    async def lookup(url, name):
        calls.append((url, name))
        return {
            "check_in_time": "16:00",
            "check_out_time": "11:00",
            "source_url": url,
            "checked_at": "2026-09-23T12:00:00+00:00",
        }

    monkeypatch.setattr(hotel_policy, "lookup", lookup)
    path = f"/api/trips/{trip['id']}/hotel-policy"
    data = {"name": "Example Hotel", "website": "https://hotel.test/faq"}
    with TestClient(app) as stranger:
        assert stranger.post(path, json=data).status_code == 401
        signup(stranger, "other@example.com")
        assert stranger.post(path, json=data).status_code == 404
    assert client.post(path, json=data).json()["check_in_time"] == "16:00"
    assert client.post(path, json=data).json()["check_in_time"] == "16:00"
    assert client.post(path, json={**data, "name": "Another Hotel"}).status_code == 429
    assert len(calls) == 1
    current = client.get(f"/api/trips/{trip['id']}").json()
    assert current["version"] == trip["version"]
    assert current["hotels"] == []


def test_hotel_saved_times_control_reminders_and_missing_times_do_not_guess(
    client, monkeypatch
):
    signup(client)
    trip = create(client)
    trip = add(
        client,
        trip,
        "hotels",
        {
            "name": "Example Hotel",
            "check_in": "2026-10-01",
            "check_out": "2026-10-03",
            "check_in_time": "16:00",
            "check_out_time": "10:30",
            "lat": 42.35,
            "lon": -71.06,
        },
    )
    trip = add(
        client,
        trip,
        "hotels",
        {
            "name": "Unknown hours",
            "check_in": "2026-10-01",
            "check_out": "2026-10-03",
            "lat": 42.35,
            "lon": -71.06,
        },
    )
    monkeypatch.setattr(
        worker, "now", lambda: datetime(2026, 10, 1, 17, 59, tzinfo=timezone.utc)
    )
    assert worker.run_once() == 0
    monkeypatch.setattr(
        worker, "now", lambda: datetime(2026, 10, 1, 18, 0, tzinfo=timezone.utc)
    )
    assert worker.run_once() == 1
    assert worker.run_once() == 0
    assert "16:00" in client.get("/api/notifications").json()[0]["message"]
    monkeypatch.setattr(
        worker, "now", lambda: datetime(2026, 10, 3, 12, 30, tzinfo=timezone.utc)
    )
    assert worker.run_once() == 1
    assert any("10:30" in n["message"] for n in client.get("/api/notifications").json())
    response = client.post(
        f"/api/trips/{trip['id']}/items/hotels",
        headers={"If-Match": str(trip["version"])},
        json={
            "name": "Bad time",
            "check_in": "2026-10-01",
            "check_out": "2026-10-03",
            "check_in_time": "25:00",
            "lat": 42.35,
            "lon": -71.06,
        },
    )
    assert response.status_code == 422


def test_place_search_exposes_hotel_website(client, monkeypatch):
    signup(client)

    def respond(request):
        assert request.url.params["extratags"] == "1"
        return httpx.Response(
            200,
            json=[
                row(
                    "Example Hotel, Boston",
                    42.35,
                    -71.06,
                    extratags={"website": "https://hotel.test/"},
                )
            ],
        )

    mock_search(monkeypatch, respond)
    result = client.get("/api/places/search", params={"q": "Example Hotel"}).json()
    assert result[0]["website"] == "https://hotel.test/"
