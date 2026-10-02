"""Management handoffs preserve one manager, shared plans, and versioned access under concurrent writes."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api import app
from app.core import Session
from app.models import Member
from conftest import signup, create, add


def join(owner, guest, path, email="guest@example.com", role="editor"):
    person = signup(guest, email)
    token = owner.post(path + "/invites", json={"role": role}).json()["token"]
    assert guest.post("/api/invites/join", json={"token": token}).status_code == 200
    return person


def managers(trip):
    return [m["id"] for m in trip["members"] if m["role"] == "owner"]


@pytest.mark.parametrize("role", ["editor", "viewer"])
def test_transfer_then_leave_preserves_trip_and_gives_successor_all_management_rights(client, role):
    owner = signup(client)
    trip = add(client, create(client), "activities", {"title": "Keep our plans", "day": "2026-10-01"})
    path = f"/api/trips/{trip['id']}"
    with TestClient(app) as guest:
        successor = join(client, guest, path, role=role)
        before = client.get(path).json()
        result = client.post(path + "/transfer-manager", json={"user_id": successor["id"]}, headers={"If-Match": str(before["version"])})
        assert result.status_code == 200, result.text
        after = result.json()
        assert after["role"] == "editor"
        assert managers(after) == [successor["id"]]
        assert after["activities"] == before["activities"]
        assert after["version"] == before["version"] + 1
        assert guest.get(path).json()["role"] == "owner"
        changes = guest.get(path + f"/sync?since={before['version']}").json()
        assert changes["events"][0]["kind"] == "manager.transferred"
        assert managers(changes["snapshot"]) == [successor["id"]]
        headers = {"If-Match": str(after["version"])}
        assert client.post(path + "/invites", json={"role": "editor"}).status_code == 403
        assert client.delete(path, headers=headers).status_code == 403
        assert client.put(path + "/members/" + successor["id"], json={"role": "viewer"}, headers=headers).status_code == 403
        assert guest.post(path + "/invites", json={"role": "editor"}).status_code == 200
        assert guest.delete(path + "/members/" + successor["id"], headers=headers).status_code == 422
        assert client.delete(path + "/members/" + owner["id"], headers=headers).status_code == 200
        assert client.get(path).status_code == 404
        remaining = guest.get(path).json()
        assert managers(remaining) == [successor["id"]]
        assert remaining["activities"] == before["activities"]


@pytest.mark.parametrize("role", ["editor", "viewer"])
def test_only_current_manager_can_transfer_and_invites_cannot_create_another(client, role):
    owner = signup(client)
    trip = create(client)
    path = f"/api/trips/{trip['id']}"
    with TestClient(app) as guest:
        successor = join(client, guest, path, role=role)
        version = client.get(path).json()["version"]
        headers = {"If-Match": str(version)}
        assert guest.post(path + "/transfer-manager", json={"user_id": successor["id"]}, headers=headers).status_code == 403
        assert client.post(path + "/transfer-manager", json={"user_id": owner["id"]}, headers=headers).status_code == 422
        assert client.post(path + "/transfer-manager", json={"user_id": "not-a-member"}, headers=headers).status_code == 422
        assert client.post(path + "/transfer-manager", json={"user_id": successor["id"]}).status_code == 428
        assert client.post(path + "/invites", json={"role": "owner"}).status_code == 422
        assert client.put(path + "/members/" + successor["id"], json={"role": "owner"}, headers=headers).status_code == 422
        assert client.put(path + "/members/" + owner["id"], json={"role": "editor"}, headers=headers).status_code == 422
        assert managers(client.get(path).json()) == [owner["id"]]


def test_stale_transfer_does_not_change_either_role(client):
    owner = signup(client)
    trip = create(client)
    path = f"/api/trips/{trip['id']}"
    with TestClient(app) as guest:
        successor = join(client, guest, path)
        result = client.post(path + "/transfer-manager", json={"user_id": successor["id"]}, headers={"If-Match": str(trip["version"])})
        assert result.status_code == 409
        assert managers(client.get(path).json()) == [owner["id"]]
        assert guest.get(path).json()["role"] == "editor"


def test_database_rejects_a_second_manager(client):
    owner = signup(client)
    trip = create(client)
    path = f"/api/trips/{trip['id']}"
    with TestClient(app) as guest:
        person = join(client, guest, path)
        with Session() as db:
            db.get(Member, (trip["id"], person["id"])).role = "owner"
            with pytest.raises(IntegrityError):
                db.commit()
            db.rollback()
        assert managers(client.get(path).json()) == [owner["id"]]


def test_concurrent_transfers_cannot_create_two_managers(client):
    signup(client)
    trip = create(client)
    path = f"/api/trips/{trip['id']}"
    with TestClient(app) as first, TestClient(app) as second:
        targets = [join(client, first, path, "first@example.com"), join(client, second, path, "second@example.com")]
        version = client.get(path).json()["version"]
        start = Barrier(2)
        def transfer(target):
            start.wait(timeout=5)
            return client.post(path + "/transfer-manager", json={"user_id": target["id"]}, headers={"If-Match": str(version)})
        with ThreadPoolExecutor(2) as pool:
            results = list(pool.map(transfer, targets))
        assert sum(r.status_code == 200 for r in results) == 1
        assert all(r.status_code in (200, 403, 409) for r in results)
        final = client.get(path).json()
        assert len(managers(final)) == 1
        assert final["version"] == version + 1


def test_transfer_racing_successor_leave_preserves_one_manager(client):
    owner = signup(client)
    trip = create(client)
    path = f"/api/trips/{trip['id']}"
    with TestClient(app) as guest:
        person = join(client, guest, path)
        headers = {"If-Match": str(client.get(path).json()["version"])}
        start = Barrier(2)
        def transfer():
            start.wait(timeout=5)
            return client.post(path + "/transfer-manager", json={"user_id": person["id"]}, headers=headers)
        def leave():
            start.wait(timeout=5)
            return guest.delete(path + "/members/" + person["id"], headers=headers)
        with ThreadPoolExecutor(2) as pool:
            a, b = pool.submit(transfer), pool.submit(leave)
            results = [a.result(), b.result()]
        assert sum(r.status_code == 200 for r in results) == 1
        assert all(r.status_code in (200, 409, 422) for r in results)
        final = client.get(path).json()
        assert len(managers(final)) == 1
        assert managers(final) == [person["id"] if results[0].status_code == 200 else owner["id"]]


def test_former_manager_deleting_account_does_not_delete_transferred_trip(client):
    signup(client)
    trip = create(client)
    path = f"/api/trips/{trip['id']}"
    with TestClient(app) as guest:
        person = join(client, guest, path)
        version = client.get(path).json()["version"]
        assert client.post(path + "/transfer-manager", json={"user_id": person["id"]}, headers={"If-Match": str(version)}).status_code == 200
        preview = client.get("/api/auth/deletion-preview").json()
        assert preview["owned_trips"] == []
        assert client.request("DELETE", "/api/auth/me", json={"password": "Secure-test-password7!", "confirmation": "DELETE", "trip_versions": preview["trip_versions"]}).status_code == 200
        assert managers(guest.get(path).json()) == [person["id"]]
        with Session() as db:
            assert list(db.scalars(select(Member).where(Member.board_id == trip["id"])))
