"""Persistent records. A versioned JSON board holds the itinerary; related tables hold access, history and delivery state."""

from sqlalchemy import String, Integer, ForeignKey, UniqueConstraint, Boolean, Index
from sqlalchemy.orm import Mapped, mapped_column
from .core import Base, JSON, uid, now


def stamp():
    return now().isoformat()


class User(Base):
    """Account identity with a salted password hash; passwords are never returned to clients."""
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    email: Mapped[str] = mapped_column(String, unique=True, index=True)
    name: Mapped[str] = mapped_column(String)
    password: Mapped[str] = mapped_column(String)


class Login(Base):
    """A hashed bearer session with a fixed expiry and cascading account cleanup."""
    __tablename__ = "logins"
    token: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    expires: Mapped[str] = mapped_column(String)


class Board(Base):
    """The complete itinerary aggregate and its concurrency version; replace state rather than mutating nested JSON in place."""
    __tablename__ = "boards"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    version: Mapped[int] = mapped_column(Integer, default=0)
    state: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[str] = mapped_column(String, default=stamp)


class Member(Base):
    """One role per user per board, enforced by the composite primary key."""
    __tablename__ = "members"
    board_id: Mapped[str] = mapped_column(
        ForeignKey("boards.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    role: Mapped[str] = mapped_column(String)


# Keep the stored role name compatible with existing trips; the UI calls this role Manager.
# The transfer transaction preserves the required manager; this index rejects a second one.
manager_index = Index(
    "uq_members_one_manager", Member.board_id, unique=True,
    postgresql_where=Member.role == "owner", sqlite_where=Member.role == "owner",
)


class Change(Base):
    """A durable ordered change notification, unique per board version; snapshots supply the actual state."""
    __tablename__ = "changes"
    __table_args__ = (UniqueConstraint("board_id", "version"),)
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    board_id: Mapped[str] = mapped_column(
        ForeignKey("boards.id", ondelete="CASCADE"), index=True
    )
    version: Mapped[int] = mapped_column(Integer)
    actor: Mapped[str] = mapped_column(String)
    kind: Mapped[str] = mapped_column(String)
    created_at: Mapped[str] = mapped_column(String, default=stamp)


class Invite(Base):
    """A hashed single-use invitation token with role and expiry, separate from account sessions."""
    __tablename__ = "invites"
    token: Mapped[str] = mapped_column(String, primary_key=True)
    board_id: Mapped[str] = mapped_column(ForeignKey("boards.id", ondelete="CASCADE"))
    role: Mapped[str] = mapped_column(String)
    expires: Mapped[str] = mapped_column(String)
    used: Mapped[bool] = mapped_column(Boolean, default=False)


class Proposal(Base):
    """An unapplied AI/route suggestion bound to the exact board version it was generated from."""
    __tablename__ = "proposals"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    board_id: Mapped[str] = mapped_column(ForeignKey("boards.id", ondelete="CASCADE"))
    version: Mapped[int] = mapped_column(Integer)
    author: Mapped[str] = mapped_column(String)
    kind: Mapped[str] = mapped_column(String)
    data: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[str] = mapped_column(String, default=stamp)


class Document(Base):
    """Authorized attachment metadata; file bytes are stored under the opaque ID outside the database."""
    __tablename__ = "documents"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    board_id: Mapped[str] = mapped_column(ForeignKey("boards.id", ondelete="CASCADE"))
    hotel_id: Mapped[str] = mapped_column(String)
    name: Mapped[str] = mapped_column(String)
    mime: Mapped[str] = mapped_column(String)


class Notification(Base):
    """Durable per-user reminders; a unique delivery key prevents duplicates across worker runs."""
    __tablename__ = "notifications"
    __table_args__ = (UniqueConstraint("user_id", "key"),)
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    board_id: Mapped[str] = mapped_column(ForeignKey("boards.id", ondelete="CASCADE"))
    key: Mapped[str] = mapped_column(String)
    message: Mapped[str] = mapped_column(String)
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[str] = mapped_column(String, default=stamp)


class Setting(Base):
    """Small persistent migration markers shared by application instances."""
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[str] = mapped_column(String)
