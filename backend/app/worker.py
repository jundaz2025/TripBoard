"""Durable, deduplicated in-app reminders; safe to restart and catch up for 24h."""

import time
from datetime import timedelta
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from .core import Session, now, Base, engine
from .models import Board, Member, Notification
from .planning import instant


def run_once():
    """Materialize due reminders for current members, catching up at most 24 hours and deduplicating in SQL."""
    current = now()
    created = 0
    with Session() as db:
        for board in db.scalars(select(Board)).all():
            state = board.state
            due = []
            for a in state["activities"]:
                if a["reminder_minutes"] is None:
                    continue
                try:
                    at = instant(a["day"], a["start"], state["timezone"])
                except Exception:
                    continue
                due.append(
                    (
                        f"activity:{a['id']}:{at.isoformat()}:{a['reminder_minutes']}",
                        at - timedelta(minutes=a["reminder_minutes"]),
                        f"{a['title']} starts at {a['start']} ({state['timezone']}).",
                    )
                )
            for h in state["hotels"]:
                for kind, day, t in [
                    ("Check-in", h["check_in"], h.get("check_in_time")),
                    ("Check-out", h["check_out"], h.get("check_out_time")),
                ]:
                    if not t:
                        continue
                    try:
                        at = instant(day, t, state["timezone"])
                    except (ValueError, HTTPException):
                        continue
                    due.append(
                        (
                            f"hotel:{h['id']}:{kind}:{at.isoformat()}",
                            at - timedelta(hours=2),
                            f"{kind}: {h['name']} on {day} at {t} ({state['timezone']}).",
                        )
                    )
            for key, at, message in due:
                # Catch up after a short outage without flooding users with arbitrarily old reminders.
                if not current - timedelta(hours=24) <= at <= current:
                    continue
                for member in db.scalars(
                    select(Member).where(Member.board_id == board.id)
                ).all():
                    try:
                        # The unique key survives restarts; a savepoint isolates a duplicate from other deliveries.
                        with db.begin_nested():
                            db.add(
                                Notification(
                                    user_id=member.user_id,
                                    board_id=board.id,
                                    key=board.id + ":" + key,
                                    message=message,
                                )
                            )
                            db.flush()
                        created += 1
                    except IntegrityError:
                        pass
        db.commit()
    return created


if __name__ == "__main__":
    Base.metadata.create_all(engine)
    while True:
        try:
            run_once()
        except Exception as error:
            print(type(error).__name__, flush=True)
        time.sleep(20)
