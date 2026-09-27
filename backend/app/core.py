"""Shared configuration, database sessions and server-side authentication/authorization."""

import os, secrets, hashlib, hmac
from pathlib import Path
from datetime import datetime, timezone
from dotenv import load_dotenv
from sqlalchemy import create_engine, JSON, event
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from fastapi import Cookie, Depends, HTTPException

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")
URL = os.getenv("DATABASE_URL", "sqlite:///./tripboard.db")
REDIS_URL = os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0")
ORIGINS = set(
    os.getenv(
        "APP_ORIGINS",
        "http://localhost:5176,http://127.0.0.1:5176,http://localhost:5173,http://127.0.0.1:5173,http://localhost:8080,http://127.0.0.1:8080",
    ).split(",")
)
UPLOADS = Path(os.getenv("UPLOAD_DIR", str(ROOT / "uploads")))
JSON = JSON().with_variant(JSONB, "postgresql")


class Base(DeclarativeBase):
    pass


def uid():
    """Create an opaque identifier independently of user names or sequential database IDs."""
    return secrets.token_hex(16)


def now():
    """Use aware UTC timestamps for expiry checks and persistent event times."""
    return datetime.now(timezone.utc)


def digest(s):
    """Store a one-way digest of high-entropy session/invitation tokens, not their bearer values."""
    return hashlib.sha256(s.encode()).hexdigest()


engine = create_engine(
    URL,
    pool_pre_ping=True,
    connect_args={"check_same_thread": False} if URL.startswith("sqlite") else {},
)
if URL.startswith("sqlite"):

    @event.listens_for(engine, "connect")
    def fk(conn, _):
        conn.execute("PRAGMA foreign_keys=ON")


Session = sessionmaker(engine, expire_on_commit=False)


def db_session():
    """Give one request its own session; closing it rolls back any unfinished transaction."""
    with Session() as db:
        yield db


def password_hash(value, salt=None):
    """Use a fresh salt and memory-hard scrypt; retain the salt alongside the derived hash."""
    salt = salt or secrets.token_hex(16)
    return (
        salt
        + ":"
        + hashlib.scrypt(
            value.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1
        ).hex()
    )


def verify(value, encoded):
    """Recompute using the stored salt and compare hashes without a content-dependent early exit."""
    return hmac.compare_digest(password_hash(value, encoded.split(":")[0]), encoded)


def current_user(tb_session: str | None = Cookie(default=None), db=Depends(db_session)):
    """Resolve an unexpired cookie session before returning its current user record."""
    from .models import Login, User

    login = db.get(Login, digest(tb_session)) if tb_session else None
    if not login or datetime.fromisoformat(login.expires) < now():
        raise HTTPException(401, "Please sign in.")
    user = db.get(User, login.user_id)
    if not user:
        raise HTTPException(401, "Please sign in.")
    return user


def permit(db, user, board_id, edit=False, owner=False):
    """Hide nonmember trips and enforce viewer/editor/owner permissions on the server."""
    from .models import Board, Member

    board = db.get(Board, board_id)
    member = db.get(Member, (board_id, user.id))
    if not board or not member:
        raise HTTPException(404, "Trip not found.")
    if (edit and member.role == "viewer") or (owner and member.role != "owner"):
        raise HTTPException(403, "You do not have permission to make this change.")
    return board, member
