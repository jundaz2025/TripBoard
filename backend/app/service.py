"""Build client snapshots and commit whole-trip changes with optimistic concurrency control."""

import copy
from datetime import date, timedelta
from sqlalchemy import select, update, text, inspect
from fastapi import HTTPException
from .core import uid, now
from .models import Board, Member, Change, User, Setting, Document
from .planning import conflicts
from .transport import present


def snapshot(db, board, member):
    """Return a detached itinerary with derived conflicts, travel instants and current membership metadata."""
    return {
        "id": board.id,
        "version": board.version,
        "role": member.role,
        **copy.deepcopy(board.state),
        "transports": [present(leg) for leg in board.state.get("transports", [])],
        "conflicts": conflicts(board.state),
        "members": [
            {"id": u.id, "name": u.name, "email": u.email, "role": m.role}
            for m, u in db.execute(
                select(Member, User)
                .join(User, User.id == Member.user_id)
                .where(Member.board_id == board.id)
            )
        ],
        "documents": [
            {"id": d.id, "hotel_id": d.hotel_id, "name": d.name}
            for d in db.scalars(select(Document).where(Document.board_id == board.id))
        ],
    }


def commit_change(db, board, expected, state, user, kind):
    """Atomically compare-and-swap the board version and persist its matching change event."""
    if expected != board.version:
        raise HTTPException(
            409,
            "Another member changed this trip. Reload and review your unsaved edits.",
        )
    # The SQL predicate closes the race between reading the version and writing.
    # The preliminary Python check alone would allow two editors to overwrite each other.
    result = db.execute(
        update(Board)
        .where(Board.id == board.id, Board.version == expected)
        .values(version=expected + 1, state=state)
        .execution_options(synchronize_session=False)
    )
    if result.rowcount != 1:
        db.rollback()
        raise HTTPException(
            409,
            "Another member changed this trip. Reload and review your unsaved edits.",
        )
    # State and its ordered event commit together; a failed write never produces a phantom event.
    db.add(Change(board_id=board.id, version=expected + 1, actor=user.name, kind=kind))
    db.commit()
    db.refresh(board)


def new_board(db, user, data):
    """Stage the initial board, owner membership and first event in the caller's transaction."""
    board = Board(
        state={**data, "activities": [], "places": [], "hotels": [], "transports": []}, version=1
    )
    db.add(board)
    db.flush()
    member = Member(board_id=board.id, user_id=user.id, role="owner")
    db.add(member)
    db.add(Change(board_id=board.id, version=1, actor=user.name, kind="trip.created"))
    return board, member


def import_legacy(db, user):
    # First registered local user claims lesson data; originals remain untouched.
    """Claim earlier tutorial data once, leaving the original tables intact for recovery."""
    marker = db.get(Setting, "legacy_claimed", with_for_update=True)
    if marker and marker.value == "yes":
        return
    if not marker:
        marker = Setting(key="legacy_claimed", value="no")
        db.add(marker)
        db.flush()
    tables = inspect(db.bind).get_table_names()
    if "trips" in tables:
        for old in (
            db.execute(text("SELECT id,title,destination FROM trips")).mappings().all()
        ):
            today = date.today().isoformat()
            board, _ = new_board(
                db,
                user,
                {
                    "title": old["title"],
                    "destination": old["destination"],
                    "start_date": today,
                    "end_date": today,
                    "timezone": "America/New_York",
                },
            )
            activities = []
            if "activities" in tables:
                for a in (
                    db.execute(
                        text(
                            "SELECT id,title,location,notes FROM activities WHERE trip_id=:id"
                        ),
                        {"id": old["id"]},
                    )
                    .mappings()
                    .all()
                ):
                    activities.append(
                        {
                            "id": uid(),
                            "title": a["title"],
                            "location": a["location"],
                            "notes": a["notes"],
                            "day": today,
                            "start": "09:00",
                            "duration": 60,
                            "locked": False,
                            "place_id": None,
                            "reminder_minutes": None,
                        }
                    )
            board.state = {**board.state, "activities": activities}
    marker.value = "yes"
