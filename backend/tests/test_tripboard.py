# Integration coverage for permissions, optimistic writes, proposals, live sync, uploads, and durable reminders.
import asyncio, copy, json
from datetime import datetime, timezone
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from app.api import app
from app.core import Session, UPLOADS, engine
from app.models import Proposal, Board, Notification
from app.planning import instant, apply_operations
from app import ai, worker, optimizer
from conftest import signup, create, add


def activity(**kw):
    return {
        "title": "Museum",
        "day": "2026-10-01",
        "start": "10:00",
        "duration": 60,
        **kw,
    }


def place(**kw):
    return {
        "title": "Museum",
        "lat": 42.35,
        "lon": -71.06,
        "opens": "09:00",
        "closes": "20:00",
        **kw,
    }


def prepared(client):
    signup(client)
    b = create(client)
    b = add(client, b, "places", place())
    b = add(client, b, "places", place(title="Park", lat=42.354, lon=-71.067))
    b = add(
        client,
        b,
        "activities",
        activity(place_id=b["places"][0]["id"], locked=True, start="13:00"),
    )
    b = add(
        client,
        b,
        "activities",
        activity(title="Park", place_id=b["places"][1]["id"], start="16:00"),
    )
    return b


def test_auth_validation_and_cookie(client):
    assert client.get("/api/trips").status_code == 401
    r = client.post(
        "/api/auth/register",
        json={"name": "Test", "email": "test@example.com", "password": "x"},
    )
    assert r.status_code == 422
    signup(client)
    assert (
        "HttpOnly"
        in client.post(
            "/api/auth/login",
            json={"email": "owner@example.com", "password": "Secure-test-password7!"},
        ).headers["set-cookie"]
    )
    assert (
        client.post(
            "/api/auth/login", json={"email": "owner@example.com", "password": "wrong"}
        ).status_code
        == 401
    )
    assert client.post("/api/auth/logout").status_code == 200
    assert client.get("/api/auth/me").status_code == 401


def test_crud_version_and_restart_snapshot(client):
    signup(client)
    b = create(client)
    path = f"/api/trips/{b['id']}"
    a = add(client, b, "activities", activity())
    assert a["version"] == b["version"] + 1
    assert (
        client.post(
            path + "/items/activities",
            json=activity(),
            headers={"If-Match": str(b["version"])},
        ).status_code
        == 409
    )
    assert len(client.get(path).json()["activities"]) == 1
    assert client.post(path + "/items/activities", json=activity()).status_code == 428
    sync = client.get(path + "/sync?since=1").json()
    assert [e["version"] for e in sync["events"]] == [2]
    assert sync["snapshot"]["activities"][0]["title"] == "Museum"
    ident = a["activities"][0]["id"]
    updated = client.put(
        path + "/items/activities/" + ident,
        json=activity(title="Changed"),
        headers={"If-Match": "2"},
    )
    assert updated.status_code == 200, updated.text
    assert (
        client.delete(
            path + "/items/activities/" + ident, headers={"If-Match": "3"}
        ).status_code
        == 200
    )
    assert client.get(path).json()["activities"] == []


def test_roles_invite_single_use_and_revocation(client):
    signup(client)
    b = create(client)
    path = f"/api/trips/{b['id']}"
    token = client.post(path + "/invites", json={"role": "viewer"}).json()["token"]
    with TestClient(app) as guest:
        who = signup(guest, "viewer@example.com")
        assert guest.get(path).status_code == 404
        assert guest.post("/api/invites/join", json={"token": token}).status_code == 200
        latest = client.get(path).json()
        assert guest.get(path).json()["role"] == "viewer"
        assert (
            guest.post(
                path + "/items/activities",
                json=activity(),
                headers={"If-Match": str(latest["version"])},
            ).status_code
            == 403
        )
        assert guest.post(path + "/invites", json={"role": "editor"}).status_code == 403
        assert guest.post("/api/invites/join", json={"token": token}).status_code == 404
        v = latest["version"]
        assert (
            client.put(
                path + "/members/" + who["id"],
                json={"role": "editor"},
                headers={"If-Match": str(v)},
            ).status_code
            == 200
        )
        latest = guest.get(path).json()
        add(guest, latest, "activities", activity())
        latest = client.get(path).json()
        assert (
            client.delete(
                path + "/members/" + who["id"],
                headers={"If-Match": str(latest["version"])},
            ).status_code
            == 200
        )
        assert guest.get(path).status_code == 404


def test_invitation_expires_at_24_hours(client, monkeypatch):
    from datetime import timedelta
    from app import api as api_module

    issued_at = api_module.now()
    monkeypatch.setattr(api_module, "now", lambda: issued_at)
    signup(client)
    b = create(client)
    path = f"/api/trips/{b['id']}/invites"
    first = client.post(path, json={"role": "editor"}).json()
    second = client.post(path, json={"role": "viewer"}).json()
    assert first["expires_in_hours"] == 24
    with TestClient(app) as guest:
        signup(guest, "expiry-check@example.com")
        monkeypatch.setattr(
            api_module, "now", lambda: issued_at + timedelta(hours=24, microseconds=-1)
        )
        assert (
            guest.post("/api/invites/join", json={"token": first["token"]}).status_code
            == 200
        )
        monkeypatch.setattr(api_module, "now", lambda: issued_at + timedelta(hours=24))
        result = guest.post("/api/invites/join", json={"token": second["token"]})
        assert result.status_code == 404
        assert result.json()["detail"] == "Invitation is invalid or expired."


def test_origin_and_cross_trip_access(client):
    signup(client)
    b = create(client)
    assert (
        client.post(
            "/api/trips", headers={"Origin": "https://evil.example"}, json={}
        ).status_code
        == 403
    )
    with TestClient(app) as other:
        signup(other, "other@example.com")
        assert other.get("/api/trips/" + b["id"]).status_code == 404
        assert other.get("/api/trips/" + b["id"] + "/sync").status_code == 404


def test_schedule_validation_and_conflict_warnings(client):
    signup(client)
    b = create(client)
    b = add(client, b, "activities", activity())
    b = add(client, b, "activities", activity(title="Lunch", start="10:30"))
    assert "overlaps" in b["conflicts"][0]["message"]
    r = client.post(
        f"/api/trips/{b['id']}/items/activities",
        json=activity(day="2026-11-01"),
        headers={"If-Match": str(b["version"])},
    )
    assert r.status_code == 422
    assert (
        client.post(
            f"/api/trips/{b['id']}/items/activities",
            json=activity(place_id="unknown"),
            headers={"If-Match": str(b["version"])},
        ).status_code
        == 422
    )


def test_timezone_dst():
    assert instant("2026-10-01", "09:00", "America/New_York").hour == 13
    with pytest.raises(HTTPException, match="does not exist"):
        instant("2026-03-08", "02:30", "America/New_York")
    with pytest.raises(HTTPException, match="ambiguous"):
        instant("2026-11-01", "01:30", "America/New_York")


def test_route_proposal_preserves_reservation_and_stale_rejected(client):
    b = prepared(client)
    path = f"/api/trips/{b['id']}"
    response = client.post(
        path + "/optimize",
        headers={"If-Match": str(b["version"])},
        json={
            "day": "2026-10-01",
            "start": "09:00",
            "end": "18:00",
            "source": "estimate",
        },
    )
    assert response.status_code == 200, response.text
    p = response.json()
    assert "Estimated" in p["metrics"]["source"]
    assert not any(o["id"] == b["activities"][0]["id"] for o in p["operations"])
    assert client.get(path).json()["activities"] == b["activities"]
    applied = client.post(
        path + "/proposals/" + p["id"] + "/apply",
        headers={"If-Match": str(b["version"])},
        json={},
    )
    assert applied.status_code == 200, applied.text
    assert applied.json()["activities"][0]["start"] == "13:00"
    assert applied.json()["version"] == b["version"] + 1
    assert (
        client.post(
            path + "/proposals/" + p["id"] + "/apply",
            headers={"If-Match": str(b["version"])},
            json={},
        ).status_code
        == 409
    )


def test_proposal_atomic_rejection_and_newer_edit(client):
    b = prepared(client)
    path = f"/api/trips/{b['id']}"
    ops = [
        {"kind": "update", "id": b["activities"][1]["id"], "start": "17:00"},
        {"kind": "delete", "id": b["activities"][0]["id"]},
    ]
    with Session() as db:
        p = Proposal(
            board_id=b["id"],
            version=b["version"],
            author="test",
            kind="ai",
            data={"operations": ops},
        )
        db.add(p)
        db.commit()
        pid = p.id
    assert (
        client.post(
            path + "/proposals/" + pid + "/apply",
            headers={"If-Match": str(b["version"])},
            json={},
        ).status_code
        == 422
    )
    assert client.get(path).json()["activities"] == b["activities"]
    latest = add(client, b, "activities", activity(title="Extra", start="18:00"))
    assert (
        client.post(
            path + "/proposals/" + pid + "/apply",
            headers={"If-Match": str(latest["version"])},
            json={},
        ).status_code
        == 409
    )


def test_hotel_upload_download_access_and_deletion(client):
    signup(client)
    b = create(client)
    b = add(
        client,
        b,
        "hotels",
        {
            "name": "Stay",
            "check_in": "2026-10-01",
            "check_out": "2026-10-03",
            "lat": 42.35,
            "lon": -71.06,
        },
    )
    hid = b["hotels"][0]["id"]
    path = f"/api/trips/{b['id']}"
    r = client.post(
        path + "/hotels/" + hid + "/documents",
        files={"file": ("confirmation.pdf", b"%PDF-1.4 test", "application/pdf")},
        headers={"If-Match": str(b["version"])},
    )
    assert r.status_code == 200, r.text
    new = r.json()
    doc = new["documents"][0]
    assert client.get("/api/documents/" + doc["id"]).content.startswith(b"%PDF-")
    with TestClient(app) as stranger:
        signup(stranger, "stranger@example.com")
        assert stranger.get("/api/documents/" + doc["id"]).status_code == 404
    assert (
        client.post(
            path + "/hotels/" + hid + "/documents",
            files={"file": ("bad.html", b"<script>bad()</script>", "text/html")},
            headers={"If-Match": str(new["version"])},
        ).status_code
        == 422
    )
    assert (
        client.delete(
            path + "/items/hotels/" + hid, headers={"If-Match": str(new["version"])}
        ).status_code
        == 200
    )
    assert not (UPLOADS / doc["id"]).exists()


def test_reminders_durable_deduplicated(client, monkeypatch):
    signup(client)
    b = create(client)
    b = add(client, b, "activities", activity(start="10:00", reminder_minutes=30))
    monkeypatch.setattr(
        worker, "now", lambda: datetime(2026, 10, 1, 13, 31, tzinfo=timezone.utc)
    )
    assert worker.run_once() == 1
    assert worker.run_once() == 0
    notices = client.get("/api/notifications").json()
    assert len(notices) == 1
    assert (
        client.post("/api/notifications/" + notices[0]["id"] + "/read").status_code
        == 200
    )
    assert client.get("/api/notifications").json()[0]["read"] is True


def test_ai_unconfigured(client):
    b = prepared(client)
    r = client.post(
        f"/api/trips/{b['id']}/ai",
        headers={"If-Match": str(b["version"])},
        json={"mode": "edit", "prompt": "Relax my day", "day": "2026-10-01"},
    )
    assert r.status_code == 503
    assert "not configured" in r.text


def fake_ai(monkeypatch, result):
    monkeypatch.setenv("OPENAI_API_KEY", "fake-test-key")

    class Response:
        status_code = 200

        def json(self):
            return {
                "output": [
                    {"content": [{"type": "output_text", "text": json.dumps(result)}]}
                ]
            }

    class Client:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def post(self, *args, **kwargs):
            return Response()

    monkeypatch.setattr(ai.httpx, "AsyncClient", Client)


def test_ai_structured_edit_and_invalid_place(client, monkeypatch):
    b = prepared(client)
    path = f"/api/trips/{b['id']}"
    fake_ai(
        monkeypatch,
        {
            "explanation": "More breathing room.",
            "operations": [
                {"kind": "update", "id": b["activities"][1]["id"], "start": "17:00"}
            ],
        },
    )
    r = client.post(
        path + "/ai",
        headers={"If-Match": str(b["version"])},
        json={"mode": "edit", "prompt": "Later park", "day": "2026-10-01"},
    )
    assert r.status_code == 200, r.text
    assert client.get(path).json()["version"] == b["version"]
    fake_ai(
        monkeypatch,
        {
            "explanation": "Bad",
            "operations": [
                {
                    "kind": "add",
                    "place_id": "invented",
                    "title": "Invented",
                    "day": "2026-10-01",
                    "start": "18:00",
                    "duration": 30,
                }
            ],
        },
    )
    r = client.post(
        path + "/ai",
        headers={"If-Match": str(b["version"])},
        json={"mode": "draft", "prompt": "Draft day", "day": "2026-10-01"},
    )
    assert r.status_code == 422, r.text
    assert client.get(path).json()["activities"] == b["activities"]


def test_ai_free_gap_no_candidate(client, monkeypatch):
    b = prepared(client)
    fake_ai(monkeypatch, {})
    r = client.post(
        f"/api/trips/{b['id']}/ai",
        headers={"If-Match": str(b["version"])},
        json={
            "mode": "next",
            "prompt": "Nearby stop",
            "day": "2026-10-01",
            "start": "14:00",
            "end": "14:05",
        },
    )
    assert r.status_code == 422


def test_route_infeasible_window(client):
    b = prepared(client)
    r = client.post(
        f"/api/trips/{b['id']}/optimize",
        headers={"If-Match": str(b["version"])},
        json={"day": "2026-10-01", "start": "09:00", "end": "10:00"},
    )
    assert r.status_code == 422


def test_delete_stale_never_deletes(client):
    signup(client)
    b = create(client)
    latest = add(client, b, "activities", activity())
    assert (
        client.delete(
            "/api/trips/" + b["id"], headers={"If-Match": str(b["version"])}
        ).status_code
        == 409
    )
    assert client.get("/api/trips/" + b["id"]).status_code == 200
    assert (
        client.delete(
            "/api/trips/" + b["id"], headers={"If-Match": str(latest["version"])}
        ).status_code
        == 200
    )
    assert client.get("/api/trips/" + b["id"]).status_code == 404


def test_websocket_and_sync_history(client):
    signup(client)
    b = create(client)
    with client.websocket_connect(
        "/api/trips/" + b["id"] + "/live", headers={"Origin": "http://localhost:5173"}
    ) as ws:
        assert ws.receive_json()["type"] == "sync"
        latest = add(client, b, "activities", activity())
        event = ws.receive_json()
        if event["type"] == "ping":
            event = ws.receive_json()
        assert event["type"] == "changed"
        assert event["version"] == latest["version"]
    assert (
        client.get("/api/trips/" + b["id"] + "/sync?since=0").json()["snapshot"][
            "version"
        ]
        == 2
    )


def test_demo_and_legacy_import(client):
    with engine.begin() as conn:
        conn.execute(
            text(
                "CREATE TABLE IF NOT EXISTS trips (id INTEGER PRIMARY KEY,title TEXT,destination TEXT)"
            )
        )
        conn.execute(text("INSERT INTO trips VALUES (1,'Old trip','Boston')"))
    signup(client)
    assert any(b["title"] == "Old trip" for b in client.get("/api/trips").json())
    with engine.begin() as conn:
        assert conn.execute(text("SELECT count(*) FROM trips")).scalar() == 1
        conn.execute(text("DROP TABLE trips"))
    demo = client.post("/api/demo")
    assert demo.status_code == 201, demo.text
    assert len(demo.json()["places"]) == 5
    assert demo.json()["activities"][2]["locked"]


def test_ai_draft_and_gap_success_are_proposals(client, monkeypatch):
    signup(client)
    b = create(client)
    b = add(client, b, "places", place())
    op = {
        "kind": "add",
        "place_id": b["places"][0]["id"],
        "title": "Museum",
        "day": "2026-10-01",
        "start": "10:00",
        "duration": 60,
        "notes": "Enjoy the collection.",
    }
    fake_ai(monkeypatch, {"explanation": "A relaxed morning.", "operations": [op]})
    for mode in ("draft", "next"):
        r = client.post(
            f"/api/trips/{b['id']}/ai",
            headers={"If-Match": str(b["version"])},
            json={
                "mode": mode,
                "prompt": "Museum visit",
                "day": "2026-10-01",
                "start": "09:00",
                "end": "12:00",
            },
        )
        assert r.status_code == 200, r.text
        assert r.json()["operations"][0]["place_id"] == b["places"][0]["id"]
    assert client.get("/api/trips/" + b["id"]).json()["activities"] == []


def test_ai_draft_rejects_wrong_day_and_locked_edit(client, monkeypatch):
    b = prepared(client)
    fake_ai(
        monkeypatch,
        {
            "explanation": "Wrong day.",
            "operations": [
                {
                    "kind": "add",
                    "place_id": b["places"][0]["id"],
                    "title": "Wrong day",
                    "day": "2026-10-02",
                    "start": "10:00",
                    "duration": 60,
                }
            ],
        },
    )
    r = client.post(
        f"/api/trips/{b['id']}/ai",
        headers={"If-Match": str(b["version"])},
        json={"mode": "draft", "prompt": "Museum visit", "day": "2026-10-01"},
    )
    assert r.status_code == 422, r.text
    fake_ai(
        monkeypatch,
        {
            "explanation": "Move lock.",
            "operations": [
                {"kind": "update", "id": b["activities"][0]["id"], "start": "12:00"}
            ],
        },
    )
    r = client.post(
        f"/api/trips/{b['id']}/ai",
        headers={"If-Match": str(b["version"])},
        json={"mode": "edit", "prompt": "Move the museum", "day": "2026-10-01"},
    )
    assert r.status_code == 422, r.text


def test_ai_window_checks_resolved_default_duration(client, monkeypatch):
    b = prepared(client)
    fake_ai(
        monkeypatch,
        {
            "explanation": "An incomplete suggestion.",
            "operations": [
                {
                    "kind": "add",
                    "place_id": b["places"][0]["id"],
                    "title": "Too long for gap",
                    "day": "2026-10-01",
                    "start": "11:30",
                }
            ],
        },
    )
    r = client.post(
        f"/api/trips/{b['id']}/ai",
        headers={"If-Match": str(b["version"])},
        json={
            "mode": "draft",
            "prompt": "Morning only",
            "day": "2026-10-01",
            "start": "09:00",
            "end": "12:00",
        },
    )
    assert r.status_code == 422, r.text
    assert "selected day or time window" in r.text
