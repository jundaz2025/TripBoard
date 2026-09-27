# Verify password rules, version-checked account deletion, and atomic activity/place writes.
import copy
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from app.api import app
from app.core import Session, UPLOADS, password_hash
from app.models import User, Board, Member, Login, Document, Proposal
from conftest import signup, create, add

PASSWORD = "A-strong-password8!"


@pytest.mark.parametrize(
    "password",
    [
        "shortA1!",
        "alllowercase12!",
        "ALLUPPERCASE12!",
        "NoNumberHere!!",
        "NoSymbolHere123",
        "NoSymbolHere12 ",
        "A1!" + "x" * 126,
    ],
)
def test_registration_rejects_weak_passwords(client, password):
    r = client.post(
        "/api/auth/register",
        json={
            "name": "Test",
            "email": "test@example.com",
            "password": password,
            "confirm_password": password,
        },
    )
    assert r.status_code == 422
    assert client.get("/api/auth/me").status_code == 401


def test_confirmation_and_exact_password_roundtrip(client):
    data = {
        "name": " Test ",
        "email": " TEST@example.com ",
        "password": " " + PASSWORD + " ",
        "confirm_password": PASSWORD,
    }
    assert client.post("/api/auth/register", json=data).status_code == 422
    data["confirm_password"] = data["password"]
    r = client.post("/api/auth/register", json=data)
    assert r.status_code == 201
    assert r.json()["name"] == "Test"
    client.post("/api/auth/logout")
    assert (
        client.post(
            "/api/auth/login", json={"email": "test@example.com", "password": PASSWORD}
        ).status_code
        == 401
    )
    assert (
        client.post(
            "/api/auth/login",
            json={"email": "test@example.com", "password": data["password"]},
        ).status_code
        == 200
    )
    with Session() as db:
        assert db.scalar(select(User)).password != data["password"]


def test_existing_password_still_logs_in(client):
    with Session() as db:
        db.add(
            User(
                name="Existing",
                email="old@example.com",
                password=password_hash("previous-password"),
            )
        )
        db.commit()
    assert (
        client.post(
            "/api/auth/login",
            json={"email": "old@example.com", "password": "previous-password"},
        ).status_code
        == 200
    )


def deletion_body(client):
    return {
        "password": "Secure-test-password7!",
        "confirmation": "DELETE",
        "trip_versions": client.get("/api/auth/deletion-preview").json()[
            "trip_versions"
        ],
    }


def test_delete_account_checks_identity_password_and_versions(client):
    user = signup(client)
    b = create(client)
    body = deletion_body(client)
    assert (
        client.request(
            "DELETE", "/api/auth/me", json={**body, "password": "wrong"}
        ).status_code
        == 401
    )
    assert (
        client.request(
            "DELETE", "/api/auth/me", json={**body, "confirmation": "delete"}
        ).status_code
        == 422
    )
    assert (
        client.request(
            "DELETE", "/api/auth/me", json={**body, "user_id": "another-user"}
        ).status_code
        == 422
    )
    add(client, b, "places", {"title": "Park", "lat": 42, "lon": -71})
    assert client.request("DELETE", "/api/auth/me", json=body).status_code == 409
    assert client.get("/api/auth/me").json()["id"] == user["id"]
    assert client.get(f"/api/trips/{b['id']}").status_code == 200


def test_account_delete_cascades_owned_trips_and_preserves_others(client):
    user = signup(client)
    own = create(client)
    with TestClient(app) as other:
        survivor = signup(other, "survivor@example.com")
        shared = create(other)
        token = other.post(
            f"/api/trips/{shared['id']}/invites", json={"role": "editor"}
        ).json()["token"]
        client.post("/api/invites/join", json={"token": token})
        token = client.post(
            f"/api/trips/{own['id']}/invites", json={"role": "viewer"}
        ).json()["token"]
        other.post("/api/invites/join", json={"token": token})
        with Session() as db:
            doc = Document(
                board_id=own["id"],
                hotel_id="test-hotel",
                name="test.pdf",
                mime="application/pdf",
            )
            db.add(doc)
            db.add(
                Proposal(
                    board_id=shared["id"],
                    version=1,
                    author=user["id"],
                    kind="ai",
                    data={},
                )
            )
            db.commit()
            doc_id = doc.id
        UPLOADS.mkdir(exist_ok=True, parents=True)
        (UPLOADS / doc_id).write_bytes(b"%PDF-test")
        old_cookie = client.cookies.get("tb_session")
        before = other.get(f"/api/trips/{shared['id']}").json()
        preview = client.get("/api/auth/deletion-preview").json()
        assert [t["id"] for t in preview["owned_trips"]] == [own["id"]]
        assert preview["joined_trips"] == 1
        r = client.request("DELETE", "/api/auth/me", json=deletion_body(client))
        assert r.status_code == 200, r.text
        assert client.get("/api/auth/me").status_code == 401
        client.cookies.set("tb_session", old_cookie)
        assert client.get("/api/trips").status_code == 401
        after = other.get(f"/api/trips/{shared['id']}").json()
        assert after["version"] == before["version"] + 1
        assert [m["id"] for m in after["members"]] == [survivor["id"]]
        assert other.get(f"/api/trips/{own['id']}").status_code == 404
        assert not (UPLOADS / doc_id).exists()
        with Session() as db:
            assert db.get(User, user["id"]) is None
            assert db.get(Board, own["id"]) is None
            assert not db.scalars(
                select(Login).where(Login.user_id == user["id"])
            ).all()
            assert not db.scalars(
                select(Member).where(Member.user_id == user["id"])
            ).all()
            assert not db.scalars(
                select(Proposal).where(Proposal.author == user["id"])
            ).all()


def test_activity_address_is_atomic_reusable_and_version_checked(client):
    signup(client)
    b = create(client)
    place = {
        "title": "Boston Common",
        "location": "Boston Common, Boston, Massachusetts",
        "lat": 42.355,
        "lon": -71.066,
        "hours_confirmed": False,
    }
    activity = {
        "title": "Morning walk",
        "day": "2026-10-01",
        "start": "07:00",
        "new_place": place,
    }
    saved = add(client, b, "activities", activity)
    assert len(saved["places"]) == 1
    assert saved["activities"][0]["place_id"] == saved["places"][0]["id"]
    assert saved["activities"][0]["location"] == place["location"]
    assert "new_place" not in saved["activities"][0]
    assert saved["version"] == b["version"] + 1
    assert (
        client.post(
            f"/api/trips/{b['id']}/items/activities",
            headers={"If-Match": str(b["version"])},
            json={**activity, "new_place": {**place, "location": "different"}},
        ).status_code
        == 409
    )
    assert len(client.get(f"/api/trips/{b['id']}").json()["places"]) == 1
    reused = add(client, saved, "activities", {**activity, "start": "12:00"})
    assert len(reused["places"]) == 1
    invalid = copy.deepcopy(activity)
    invalid["new_place"]["lat"] = 100
    assert (
        client.post(
            f"/api/trips/{b['id']}/items/activities",
            headers={"If-Match": str(reused["version"])},
            json=invalid,
        ).status_code
        == 422
    )
    # Existing unlocated activities can be given an address without adding an activity.
    plain = add(
        client,
        reused,
        "activities",
        {"title": "Dinner", "day": "2026-10-01", "start": "18:00"},
    )
    row = plain["activities"][-1]
    response = client.put(
        f"/api/trips/{b['id']}/items/activities/{row['id']}",
        headers={"If-Match": str(plain["version"])},
        json={k: v for k, v in {**row, "new_place": place}.items() if k != "id"},
    )
    assert response.status_code == 200
    assert response.json()["activities"][-1]["place_id"] == saved["places"][0]["id"]
