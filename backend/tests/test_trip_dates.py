"""Exercise date recovery through the real API with isolated state and versioned writes."""
import copy
import pytest
from fastapi.testclient import TestClient
from app.api import app
from app.trip_dates import change_dates
from fastapi import HTTPException
from conftest import signup, create, add


def settings(board, **changes):
    return {key: changes.get(key, board[key]) for key in ("title", "destination", "start_date", "end_date", "timezone")}


def edit(client, board, payload):
    return client.put(f"/api/trips/{board['id']}", json=payload, headers={"If-Match": str(board['version'])})


def prepared(client):
    signup(client)
    board = create(client)
    for title, day, locked in [("First", "2026-10-01", False), ("Third", "2026-10-03", False), ("Booked", "2026-10-02", True)]:
        board = add(client, board, "activities", {"title": title, "day": day, "start": "10:00", "locked": locked})
    return board


def test_date_shift_requires_choice_preserves_gaps_fixed_and_overflow(client):
    board = prepared(client)
    fields = settings(board, start_date="2026-10-09", end_date="2026-10-10")
    assert edit(client, board, fields).status_code == 422
    changed = edit(client, board, {**fields, "activity_date_mode": "shift"})
    assert changed.status_code == 200, changed.text
    state = changed.json()
    assert [a["day"] for a in state["activities"]] == ["2026-10-09", "2026-10-11", "2026-10-02"]
    assert [a["start"] for a in state["activities"]] == ["10:00"] * 3
    assert [a["id"] for a in state["activities"]] == [a["id"] for a in board["activities"]]
    assert "activity_date_mode" not in state
    assert edit(client, board, {**fields, "activity_date_mode": "keep"}).status_code == 409
    assert any("outside" in c["message"] for c in state["conflicts"])


def test_keep_and_recover_only_reviewed_activities(client):
    board = prepared(client)
    changed = edit(client, board, {**settings(board, start_date="2026-11-01", end_date="2026-11-03"), "activity_date_mode": "keep"}).json()
    assert changed["activities"] == board["activities"]
    changed = add(client, changed, "activities", {"title": "Already new", "day": "2026-11-02", "start": "12:00"})
    ids = [a["id"] for a in changed["activities"] if a["title"] in ("First", "Third")]
    path = f"/api/trips/{board['id']}/reschedule-activities"
    payload = {"activity_ids": ids, "first_day": "2026-11-01"}
    r = client.post(path, json=payload, headers={"If-Match": str(changed["version"])})
    assert r.status_code == 200, r.text
    assert [a["day"] for a in r.json()["activities"]] == ["2026-11-01", "2026-11-03", "2026-10-02", "2026-11-02"]
    assert client.post(path, json=payload, headers={"If-Match": str(changed["version"])}).status_code == 409


def test_recovery_permissions_fixed_missing_and_invalid_date(client):
    board = prepared(client)
    path = f"/api/trips/{board['id']}"
    def attempt(ids, day="2026-10-01"):
        return client.post(path + "/reschedule-activities", json={"activity_ids": ids, "first_day": day}, headers={"If-Match": str(board['version'])})
    assert attempt([board["activities"][2]["id"]]).status_code == 422
    assert attempt(["missing"]).status_code == 404
    assert attempt([board["activities"][0]["id"]], "2027-01-01").status_code == 422
    assert attempt([]).status_code == 422
    token = client.post(path + "/invites", json={"role": "viewer"}).json()["token"]
    with TestClient(app) as guest:
        signup(guest, "guest@example.com")
        assert guest.post("/api/invites/join", json={"token": token}).status_code == 200
        r = guest.post(path + "/reschedule-activities", json={"activity_ids": [board['activities'][0]['id']], "first_day": "2026-10-02"}, headers={"If-Match": str(board['version'])})
        assert r.status_code == 403


def test_date_shift_keeps_bookings_and_rejects_dst_without_mutation():
    state = {"start_date": "2026-03-07", "end_date": "2026-03-07", "timezone": "America/New_York", "activities": [{"id": "a", "day": "2026-03-07", "start": "02:30", "locked": False}], "hotels": [{"check_in": "2026-03-07", "check_out": "2026-03-09"}], "transports": [{"departure_date": "2026-03-07"}]}
    original = copy.deepcopy(state)
    with pytest.raises(HTTPException, match="daylight saving"):
        change_dates(state, {"start_date": "2026-03-08", "end_date": "2026-03-08", "timezone": state["timezone"]}, "shift")
    assert state == original
    result = change_dates(state, {"start_date": "2026-03-09", "end_date": "2026-03-09", "timezone": state["timezone"]}, "shift")
    assert result["hotels"] == state["hotels"] and result["transports"] == state["transports"]
    assert result["activities"][0]["day"] == "2026-03-09"
