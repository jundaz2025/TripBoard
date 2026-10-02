"""Date changes retain all records and preserve local clock times and relative day gaps."""
import copy
from datetime import date
from fastapi import HTTPException
from .planning import instant


def move(rows, delta, timezone):
    """Reject invalid DST times before a versioned write; locked reservations never move."""
    for row in rows:
        if row.get("locked"):
            continue
        target = date.fromisoformat(row["day"]) + delta
        instant(target.isoformat(), row["start"], timezone)
        row["day"] = target.isoformat()


def change_dates(previous, fields, mode):
    """Keep shortened-trip overflow visible for review instead of silently deleting it."""
    changed = any(fields[key] != previous[key] for key in ("start_date", "end_date"))
    if changed and previous["activities"] and mode is None:
        raise HTTPException(422, "Choose whether to move activities or keep their dates.")
    state = {**copy.deepcopy(previous), **fields}
    if changed and mode == "shift":
        delta = date.fromisoformat(fields["start_date"]) - date.fromisoformat(previous["start_date"])
        move(state["activities"], delta, state["timezone"])
    return state


def reschedule(previous, activity_ids, first_day):
    """Only explicitly selected flexible activities move; all other collections stay intact."""
    state = copy.deepcopy(previous)
    ids = set(activity_ids)
    rows = [row for row in state["activities"] if row["id"] in ids]
    if len(rows) != len(ids):
        raise HTTPException(404, "An activity no longer exists. Reopen the date review.")
    if any(row.get("locked") for row in rows):
        raise HTTPException(422, "Edit fixed reservations individually to change their dates.")
    if not state["start_date"] <= first_day.isoformat() <= state["end_date"]:
        raise HTTPException(422, "Choose a first day within the trip dates.")
    delta = first_day - min(date.fromisoformat(row["day"]) for row in rows)
    move(rows, delta, state["timezone"])
    return state
