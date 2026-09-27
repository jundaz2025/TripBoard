# Isolate database state and uploads for API tests; fixtures never use the normal local trip database by default.
import os, tempfile
from pathlib import Path

# Set overrides before importing app.core, which creates the engine during import.
TEMP = tempfile.TemporaryDirectory(prefix="tripboard-tests-")
os.environ["DATABASE_URL"] = os.getenv(
    "TRIPBOARD_TEST_DATABASE_URL", "sqlite:///" + str(Path(TEMP.name) / "test.db")
)
os.environ["REDIS_URL"] = ""
os.environ["UPLOAD_DIR"] = str(Path(TEMP.name) / "uploads")
os.environ["OPENAI_API_KEY"] = ""
import pytest
from fastapi.testclient import TestClient
from app.api import app, attempts
from app.core import Base, engine


@pytest.fixture(autouse=True)
def clean():
    # An explicit PostgreSQL test URL must be disposable: every test recreates its application tables.
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    attempts.clear()


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def signup(c, email="owner@example.com"):
    r = c.post(
        "/api/auth/register",
        json={
            "name": email.split("@")[0],
            "email": email,
            "password": "Secure-test-password7!",
            "confirm_password": "Secure-test-password7!",
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


def create(c):
    r = c.post(
        "/api/trips",
        json={
            "title": "A trip",
            "destination": "Boston",
            "start_date": "2026-10-01",
            "end_date": "2026-10-03",
            "timezone": "America/New_York",
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


def add(c, b, kind, data):
    # Use the caller's snapshot version so test writes exercise the same concurrency contract as the UI.
    r = c.post(
        f"/api/trips/{b['id']}/items/{kind}",
        headers={"If-Match": str(b["version"])},
        json=data,
    )
    assert r.status_code == 201, r.text
    return r.json()
