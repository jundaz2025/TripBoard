"""Legacy lesson models retained for importing earlier data. The active application uses app/core.py and app/models.py."""

import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import ForeignKey, String, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

# Load the legacy database configuration from the adjacent .env file.
load_dotenv(Path(__file__).with_name(".env"))

# Create an engine that checks pooled connections before reuse.
engine = create_engine(
    os.environ["DATABASE_URL"],
    pool_pre_ping=True,
)


# Base class for the earlier tutorial tables, separate from the current schema.
class Base(DeclarativeBase):
    pass


# Map the original trips table for legacy data compatibility.
class TripRecord(Base):
    __tablename__ = "trips"

    # The database allocates the integer primary key.
    id: Mapped[int] = mapped_column(primary_key=True)

    title: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )

    destination: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )

# Each legacy activity belongs to one legacy trip.
class ActivityRecord(Base):
    __tablename__ = "activities"

    id: Mapped[int] = mapped_column(primary_key=True)

    # Deleting a legacy trip cascades to its activities through this foreign key.
    trip_id: Mapped[int] = mapped_column(
        ForeignKey("trips.id", ondelete="CASCADE"),
        index=True,
    )

    title: Mapped[str] = mapped_column(String(100))
    location: Mapped[str] = mapped_column(String(200))
    notes: Mapped[str] = mapped_column(String(1000), default="")