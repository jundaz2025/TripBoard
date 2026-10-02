"""Revoking sharing closes existing live sessions and removes all API access while preserving personal trips."""
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from sqlalchemy import select
from app.api import app
from app.core import Session
from app.models import Notification
from conftest import signup, create, add


@pytest.mark.parametrize("role", ["viewer", "editor"])
@pytest.mark.parametrize("self_leave", [False, True])
def test_removed_member_loses_live_and_http_access(client, role, self_leave):
    owner = signup(client)
    shared = create(client)
    shared = add(client, shared, "activities", {"title": "Shared plans", "day": "2026-10-01"})
    path = f"/api/trips/{shared['id']}"
    token = client.post(path + "/invites", json={"role": role}).json()["token"]
    with TestClient(app) as guest:
        member = signup(guest, f"{role}@example.com")
        personal = create(guest)
        assert guest.post("/api/invites/join", json={"token": token}).status_code == 200
        # Only the departing member's reminders should disappear with the membership.
        with Session() as db:
            for user_id, board_id in [(member["id"], shared["id"]), (member["id"], personal["id"]), (owner["id"], shared["id"])]:
                db.add(Notification(user_id=user_id, board_id=board_id, key=board_id, message="Trip reminder"))
            db.commit()
        with guest.websocket_connect(path + "/live", headers={"Origin": "http://localhost:5173"}) as ws:
            assert ws.receive_json()["type"] == "sync"
            version = client.get(path).json()["version"]
            actor = guest if self_leave else client
            removed = actor.delete(path + "/members/" + member["id"], headers={"If-Match": str(version)})
            assert removed.status_code == 200
            # A few version/ping messages may already be queued before the removal commits.
            with pytest.raises(WebSocketDisconnect) as closed:
                for _ in range(4):
                    ws.receive_json()
            assert closed.value.code == 1008
        assert guest.get(path).status_code == 404
        assert guest.get(path + "/sync?since=0").status_code == 404
        assert guest.put(path, headers={"If-Match": str(version)}, json={
            "title": "Unauthorized edit", "destination": "Boston",
            "start_date": "2026-10-01", "end_date": "2026-10-03", "timezone": "America/New_York",
        }).status_code == 404
        assert [row["id"] for row in guest.get("/api/trips").json()] == [personal["id"]]
        assert guest.get("/api/trips/" + personal["id"]).status_code == 200
        assert guest.get("/api/auth/me").json()["id"] == member["id"]
        remaining = client.get(path).json()
        assert remaining["activities"] == shared["activities"]
        assert [m["id"] for m in remaining["members"]] == [owner["id"]]
        changes = client.get(path + f"/sync?since={version}").json()["events"]
        assert changes[-1]["kind"] == ("member.left" if self_leave else "member.removed")
        with Session() as db:
            assert {(n.user_id, n.board_id) for n in db.scalars(select(Notification))} == {
                (member["id"], personal["id"]), (owner["id"], shared["id"]),
            }


@pytest.mark.parametrize("role", ["viewer", "editor"])
def test_self_leave_does_not_grant_permission_to_remove_anyone_else(client, role):
    owner = signup(client)
    shared = create(client)
    path = f"/api/trips/{shared['id']}"
    token = client.post(path + "/invites", json={"role": role}).json()["token"]
    with TestClient(app) as guest:
        signup(guest, f"{role}@example.com")
        guest.post("/api/invites/join", json={"token": token})
        version = client.get(path).json()["version"]
        for target in [owner["id"], "another-member"]:
            assert guest.delete(path + "/members/" + target, headers={"If-Match": str(version)}).status_code == 403
        # An owner cannot leave a trip without an owner, including by calling the API directly.
        assert client.delete(path + "/members/" + owner["id"], headers={"If-Match": str(version)}).status_code == 422
        assert len(client.get(path).json()["members"]) == 2


def test_stale_leave_rolls_back_membership_and_reminders(client):
    signup(client)
    shared = create(client)
    path = f"/api/trips/{shared['id']}"
    token = client.post(path + "/invites", json={"role": "viewer"}).json()["token"]
    with TestClient(app) as guest:
        member = signup(guest, "guest@example.com")
        guest.post("/api/invites/join", json={"token": token})
        with Session() as db:
            db.add(Notification(user_id=member["id"], board_id=shared["id"], key="leave-race", message="Reminder"))
            db.commit()
        member_path = path + "/members/" + member["id"]
        stale = guest.delete(member_path, headers={"If-Match": str(shared["version"])})
        assert stale.status_code == 409
        current = guest.get(path)
        assert current.status_code == 200
        with Session() as db:
            assert db.scalar(select(Notification).where(Notification.user_id == member["id"])) is not None
        assert guest.delete(member_path, headers={"If-Match": str(current.json()["version"])}).status_code == 200
        assert guest.get(path).status_code == 404
