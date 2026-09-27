"""Pure itinerary rules shared by manual editing, AI proposals and route optimization."""

import copy
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from fastapi import HTTPException
from .schemas import ActivityInput


def minutes(value):
    """Validate an HH:MM local clock and convert it to minutes after midnight."""
    try:
        h, m = map(int, value.split(":"))
        if not 0 <= h < 24 or not 0 <= m < 60:
            raise ValueError()
        return h * 60 + m
    except Exception:
        raise HTTPException(422, "Use HH:MM time.")


def clock(value):
    """Render solver minute values as a local HH:MM clock."""
    return f"{int(value) // 60:02d}:{int(value) % 60:02d}"


def instant(day, start, tz):
    """Resolve a local date/clock to UTC, rejecting missing or repeated daylight-saving times."""
    naive = datetime.fromisoformat(day + "T" + start)
    zone = ZoneInfo(tz)
    a = naive.replace(tzinfo=zone, fold=0)
    b = naive.replace(tzinfo=zone, fold=1)
    # Round-tripping detects a clock time skipped by the spring DST transition.
    if a.astimezone(timezone.utc).astimezone(zone).replace(tzinfo=None) != naive:
        raise HTTPException(
            422, "This time does not exist because of daylight saving time."
        )
    # Different folds mean the autumn transition repeats this wall-clock time.
    if a.utcoffset() != b.utcoffset():
        raise HTTPException(
            422, "This time is ambiguous because of daylight saving time."
        )
    return a.astimezone(timezone.utc)


def opening_window(place):
    """Only confirmed opening hours constrain planning; unverified provider defaults do not."""
    if not place.get("hours_confirmed", True):
        return 0, 1440
    return minutes(place["opens"]), minutes(place["closes"])


def validate_activity(a, s):
    """Check trip dates, local-time validity, place membership and confirmed opening hours."""
    if not s["start_date"] <= a.day <= s["end_date"]:
        raise HTTPException(422, "Activity date is outside the trip.")
    instant(a.day, a.start, s["timezone"])
    if minutes(a.start) + a.duration > 1440:
        raise HTTPException(422, "Split overnight activities across two days.")
    place = next((p for p in s["places"] if p["id"] == a.place_id), None)
    if a.place_id and not place:
        raise HTTPException(422, "Choose a saved place from this trip.")
    if place and (
        minutes(a.start) < opening_window(place)[0]
        or minutes(a.start) + a.duration > opening_window(place)[1]
    ):
        raise HTTPException(422, "Activity is outside the saved place opening hours.")


def covered_days(start, end, zone):
    """List local dates touched by a half-open interval, excluding an exact-midnight end."""
    first = start.astimezone(zone).date()
    last = (end - timedelta(microseconds=1)).astimezone(zone).date()
    return [(first + timedelta(days=i)).isoformat() for i in range((last - first).days + 1)]


def conflicts(s):
    """Compare activity and travel intervals in UTC, then attach local dates and precise overlap bounds."""
    from .transport import interval
    result, events = [], []
    zone = ZoneInfo(s["timezone"])
    for a in s["activities"]:
        if not s["start_date"] <= a["day"] <= s["end_date"]:
            result.append({"days": [a["day"]], "message": f"{a['day']} at {a['start']}: {a['title']} is outside the trip dates."})
        place = next((p for p in s["places"] if p["id"] == a["place_id"]), None)
        if place and (minutes(a["start"]) < opening_window(place)[0]
                      or minutes(a["start"]) + a["duration"] > opening_window(place)[1]):
            result.append({"days": [a["day"]], "message": f"{a['day']} at {a['start']}: {a['title']} is outside the saved opening hours."})
        try:
            start = instant(a["day"], a["start"], s["timezone"])
            events.append({"id": a["id"], "kind": "activity", "title": a["title"], "start": start, "end": start + timedelta(minutes=a["duration"])})
        except HTTPException as e:
            result.append({"days": [a["day"]], "message": f"{a['day']} at {a['start']}: {a['title']}: {e.detail}"})
    for leg in s.get("transports", []):
        start, end = interval(leg)
        events.append({"id": leg["id"], "kind": "transport", "title": leg["title"], "start": start, "end": end})
    events.sort(key=lambda event: event["start"])
    for i, a in enumerate(events):
        for b in events[i + 1:]:
            if b["start"] >= a["end"]:
                break
            start, end = max(a["start"], b["start"]), min(a["end"], b["end"])
            def stamp(value):
                return value.astimezone(zone).strftime("%Y-%m-%d %H:%M")
            result.append({
                "kind": "overlap", "days": covered_days(start, end, zone), "timezone": s["timezone"],
                "overlap_start": start.isoformat(), "overlap_end": end.isoformat(),
                "items": [{**event, "start": event["start"].isoformat(), "end": event["end"].isoformat()} for event in (a, b)],
                "message": f"{a['title']} ({stamp(a['start'])}–{stamp(a['end'])}) overlaps {b['title']} ({stamp(b['start'])}–{stamp(b['end'])}). Overlap: {stamp(start)}–{stamp(end)} ({s['timezone']}).",
            })
    for h in s["hotels"]:
        if h["check_in"] < s["start_date"] or h["check_out"] > (datetime.fromisoformat(s["end_date"]) + timedelta(days=1)).date().isoformat():
            result.append({"message": f"{h['name']}: {h['check_in']}–{h['check_out']} extends beyond the trip dates."})
    return result


def apply_operations(s, operations):
    """Validate a proposal against a copy of the itinerary and return projected activities without writing data."""
    if not operations or len(operations) > 30:
        raise HTTPException(422, "A proposal must have between 1 and 30 changes.")
    # A proposal is untrusted input. Validate on copies before any persistent mutation.
    records = {a["id"]: copy.deepcopy(a) for a in s["activities"]}
    seen = set()
    for i, op in enumerate(operations):
        kind = op.get("kind")
        ident = op.get("id")
        if kind not in ("add", "update", "delete"):
            raise HTTPException(422, "Invalid proposal operation.")
        if kind != "add":
            if ident not in records or ident in seen:
                raise HTTPException(
                    422, "Proposal refers to a missing or repeated activity."
                )
            if records[ident]["locked"]:
                raise HTTPException(422, "Proposals cannot change locked reservations.")
            seen.add(ident)
        if kind == "delete":
            del records[ident]
            continue
        raw = {k: v for k, v in op.items() if k in ActivityInput.model_fields}
        if kind == "update":
            raw = {
                **{
                    k: v
                    for k, v in records[ident].items()
                    if k in ActivityInput.model_fields
                },
                **raw,
            }
        else:
            p = next((p for p in s["places"] if p["id"] == raw.get("place_id")), None)
            if not p:
                raise HTTPException(422, "Suggested stops must come from saved places.")
            raw = {
                "title": p["title"],
                "location": p["location"],
                "duration": p["duration"],
                "locked": False,
                **raw,
            }
        try:
            data = ActivityInput(**raw)
        except Exception:
            raise HTTPException(422, "Invalid activity details in proposal.")
        if data.locked:
            raise HTTPException(422, "Proposals cannot create reservation locks.")
        validate_activity(data, s)
        ident = ident if kind == "update" else "new-" + str(i)
        records[ident] = {"id": ident, **data.model_dump()}
    projected = list(records.values())
    # Check the complete projected plan, including unaffected activities and travel legs.
    problems = conflicts({**s, "activities": projected})
    if problems:
        raise HTTPException(
            422, "Proposal violates constraints: " + problems[0]["message"]
        )
    return projected
