"""HTTP and WebSocket entry points. Authorize every request and persist changes before notifying collaborators."""

from . import cities, transport
import os, copy, asyncio, secrets, json, time
from datetime import timedelta, datetime
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import (
    FastAPI,
    Depends,
    HTTPException,
    Response,
    Request,
    Header,
    UploadFile,
    File,
    WebSocket,
    BackgroundTasks,
)
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy import select, delete, update
from sqlalchemy.exc import IntegrityError
from .core import (
    Base,
    engine,
    Session,
    db_session,
    current_user,
    permit,
    uid,
    now,
    digest,
    password_hash,
    verify,
    ORIGINS,
    UPLOADS,
)
from .models import (
    User,
    Login,
    Board,
    Member,
    Change,
    Invite,
    Proposal,
    Document,
    Notification,
    Setting,
    manager_index,
)
from .schemas import (
    Register,
    DeleteAccount,
    ActivityWrite,
    Credentials,
    TripInput,
    TripUpdate,
    RescheduleActivities,
    TransportInput,
    ActivityInput,
    MapLocation,
    PlaceInput,
    HotelInput,
    HotelPolicyInput,
    InviteInput,
    JoinInput,
    TransferManagerInput,
    AIInput,
    RouteInput,
)
from .planning import validate_activity, apply_operations, conflicts, instant
from .service import snapshot, commit_change, new_board, import_legacy
from .trip_dates import change_dates, reschedule
from .sync import publish, redis
from . import ai, optimizer, providers, hotel_policy, hotel_discovery


@asynccontextmanager
async def lifespan(app):
    """Initialize missing local-development tables and uploads without dropping existing data."""
    Base.metadata.create_all(engine)
    # create_all skips indexes on existing tables; install this additive guard on older databases too.
    manager_index.create(engine, checkfirst=True)
    UPLOADS.mkdir(parents=True, exist_ok=True)
    with Session() as db:
        if not db.get(Setting, "legacy_claimed"):
            db.add(Setting(key="legacy_claimed", value="no"))
            db.commit()
    yield


app = FastAPI(title="TripBoard API", version="2.0", lifespan=lifespan)


@app.middleware("http")
async def same_origin(request, call_next):
    """Reject mutating browser requests from untrusted origins and add basic response hardening headers."""
    if (
        request.method not in ("GET", "HEAD", "OPTIONS")
        and request.headers.get("origin")
        and request.headers["origin"] not in ORIGINS
    ):
        return JSONResponse({"detail": "Origin is not allowed."}, 403)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    return response


def version(if_match: str | None = Header(default=None)):
    """Require the client version for writes so missing concurrency checks cannot silently overwrite data."""
    if not if_match or not if_match.isdigit():
        raise HTTPException(428, "Send the current trip version in If-Match.")
    return int(if_match)


def public(user):
    """Expose account identity only, never password hashes or session secrets."""
    return {"id": user.id, "name": user.name, "email": user.email}


def login_cookie(db, user, response):
    """Commit a hashed session token and send its raw bearer value only in an HttpOnly cookie."""
    token = secrets.token_urlsafe(40)
    db.add(
        Login(
            token=digest(token),
            user_id=user.id,
            expires=(now() + timedelta(days=7)).isoformat(),
        )
    )
    db.commit()
    response.set_cookie(
        "tb_session",
        token,
        httponly=True,
        samesite="lax",
        secure=os.getenv("COOKIE_SECURE", "false") == "true",
        max_age=604800,
        path="/",
    )


# Small local rate limiter. Deployment should add a reverse-proxy limiter.
attempts = {}


def throttle(request):
    """Limit authentication attempts per process; production deployments also need a shared edge limiter."""
    key = request.client.host if request.client else "local"
    current = time.monotonic()
    attempts[key] = [t for t in attempts.get(key, []) if current - t < 60]
    if len(attempts[key]) >= 20:
        raise HTTPException(429, "Too many attempts. Try again in one minute.")
    attempts[key].append(current)


@app.post("/api/auth/register", status_code=201)
def register(
    data: Register, response: Response, request: Request, db=Depends(db_session)
):
    """Validate identity, hash the password and atomically claim legacy data for the first local account."""
    throttle(request)
    user = User(name=data.name, email=data.email, password=password_hash(data.password))
    db.add(user)
    try:
        db.flush()
        import_legacy(db, user)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "This email is already registered.")
    login_cookie(db, user, response)
    return public(user)


@app.post("/api/auth/login")
def login(
    data: Credentials, response: Response, request: Request, db=Depends(db_session)
):
    """Use the same public error for unknown accounts and incorrect passwords."""
    throttle(request)
    user = db.scalar(select(User).where(User.email == data.email.lower()))
    if not user or not verify(data.password, user.password):
        raise HTTPException(401, "Email or password is incorrect.")
    login_cookie(db, user, response)
    return public(user)


@app.post("/api/auth/logout")
def logout(request: Request, response: Response, db=Depends(db_session)):
    """Revoke the server-side session as well as clearing the browser cookie."""
    db.execute(
        delete(Login).where(
            Login.token == digest(request.cookies.get("tb_session", ""))
        )
    )
    db.commit()
    response.delete_cookie("tb_session", path="/")
    return {"ok": True}


@app.get("/api/auth/me")
def me(user=Depends(current_user)):
    """Return the identity of the authenticated session."""
    return public(user)


@app.get("/api/auth/deletion-preview")
def deletion_preview(user=Depends(current_user), db=Depends(db_session)):
    """Capture all affected trip versions so deletion is authorized against a reviewable snapshot."""
    rows = db.execute(
        select(Board, Member)
        .join(Member, Member.board_id == Board.id)
        .where(Member.user_id == user.id)
    ).all()
    return {
        "owned_trips": [
            {"id": b.id, "title": b.state["title"]}
            for b, m in rows
            if m.role == "owner"
        ],
        "joined_trips": sum(m.role != "owner" for _, m in rows),
        "trip_versions": {b.id: b.version for b, _ in rows},
    }


@app.delete("/api/auth/me")
def delete_account(
    data: DeleteAccount,
    response: Response,
    request: Request,
    tasks: BackgroundTasks,
    user=Depends(current_user),
    db=Depends(db_session),
):
    """Recheck the password and preview versions, then delete owned trips and leave shared ones atomically."""
    throttle(request)
    if not verify(data.password, user.password):
        raise HTTPException(401, "Your current password is incorrect.")
    rows = db.execute(
        select(Board, Member)
        .join(Member, Member.board_id == Board.id)
        .where(Member.user_id == user.id)
        .order_by(Board.id)
    ).all()
    if {b.id: b.version for b, _ in rows} != data.trip_versions:
        raise HTTPException(
            409,
            "Your trips changed. Review the updated deletion summary and try again.",
        )
    files = []
    for b, m in rows:
        changed = db.execute(
            update(Board)
            .where(Board.id == b.id, Board.version == b.version)
            .values(version=b.version + 1)
            .execution_options(synchronize_session=False)
        )
        if changed.rowcount != 1:
            db.rollback()
            raise HTTPException(
                409,
                "Your trips changed. Review the updated deletion summary and try again.",
            )
        if m.role == "owner":
            files.extend(
                db.scalars(select(Document.id).where(Document.board_id == b.id)).all()
            )
            for table in (Notification, Document, Proposal, Invite, Change, Member):
                db.execute(delete(table).where(table.board_id == b.id))
            db.execute(delete(Board).where(Board.id == b.id))
        else:
            db.delete(m)
            db.add(
                Change(
                    board_id=b.id,
                    version=b.version + 1,
                    actor="Deleted member",
                    kind="member.left",
                )
            )
        tasks.add_task(publish, b.id)
    db.execute(delete(Proposal).where(Proposal.author == user.id))
    db.execute(delete(Notification).where(Notification.user_id == user.id))
    db.execute(delete(Login).where(Login.user_id == user.id))
    db.delete(user)
    db.commit()
    for file_id in files:
        (UPLOADS / file_id).unlink(missing_ok=True)
    response.delete_cookie("tb_session", path="/")
    return {"ok": True}


@app.get("/api/config")
async def config(user=Depends(current_user)):
    """Expose capability flags and model name, never provider keys or private connection URLs."""
    connected = False
    if redis:
        try:
            connected = bool(await redis.ping())
        except Exception:
            pass
    return {
        "ai_enabled": bool(os.getenv("OPENAI_API_KEY")),
        "ai_model": os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
        "live_routes": bool(os.getenv("OSRM_URL")),
        "redis": connected,
    }


@app.get("/api/health")
def health():
    """Provide a lightweight process-readiness response for the local development launcher."""
    return {"status": "ok", "version": "2.0"}


@app.get("/api/trips")
def trips(user=Depends(current_user), db=Depends(db_session)):
    """List only boards joined by the current user, excluding heavy itinerary collections."""
    return [
        {
            "id": b.id,
            "version": b.version,
            "role": m.role,
            **{
                k: v
                for k, v in b.state.items()
                if k not in ("activities", "places", "hotels", "transports")
            },
        }
        for b, m in db.execute(
            select(Board, Member)
            .join(Member, Member.board_id == Board.id)
            .where(Member.user_id == user.id)
            .order_by(Board.created_at.desc())
        )
    ]


@app.post("/api/trips", status_code=201)
async def create_trip(data: TripInput, user=Depends(current_user), db=Depends(db_session)):
    """Resolve the chosen city server-side and create the owner membership in the same transaction."""
    b, m = new_board(db, user, await cities.trip_fields(data))
    db.commit()
    return snapshot(db, b, m)


@app.get("/api/trips/{trip_id}")
def get_trip(trip_id: str, user=Depends(current_user), db=Depends(db_session)):
    """Authorize membership before returning a complete current snapshot."""
    b, m = permit(db, user, trip_id)
    return snapshot(db, b, m)


@app.get("/api/trips/{trip_id}/sync")
def sync(
    trip_id: str, since: int = 0, user=Depends(current_user), db=Depends(db_session)
):
    """Return a current snapshot plus later change events bounded by that snapshot's version."""
    b, m = permit(db, user, trip_id)
    events = db.scalars(
        select(Change)
        .where(
            Change.board_id == trip_id,
            Change.version > since,
            Change.version <= b.version,
        )
        .order_by(Change.version)
    ).all()
    return {
        "snapshot": snapshot(db, b, m),
        "events": [
            {
                "version": e.version,
                "actor": e.actor,
                "kind": e.kind,
                "created_at": e.created_at,
            }
            for e in events
        ],
    }


@app.put("/api/trips/{trip_id}")
async def edit_trip(
    trip_id: str,
    data: TripUpdate,
    tasks: BackgroundTasks,
    v=Depends(version),
    user=Depends(current_user),
    db=Depends(db_session),
):
    """Apply an explicitly reviewed date policy atomically with trip settings."""
    b, m = permit(db, user, trip_id, edit=True)
    # The policy is a command, never a persisted trip field or city-provider input.
    fields = await cities.trip_fields(TripInput.model_validate(data.model_dump(exclude={"activity_date_mode"})))
    state = change_dates(b.state, fields, data.activity_date_mode)
    commit_change(db, b, v, state, user, "trip.updated")
    tasks.add_task(publish, trip_id)
    return snapshot(db, b, m)


@app.post("/api/trips/{trip_id}/reschedule-activities")
def reschedule_activities(
    trip_id: str,
    data: RescheduleActivities,
    tasks: BackgroundTasks,
    v=Depends(version),
    user=Depends(current_user),
    db=Depends(db_session),
):
    """Recover selected old activities without shifting reservations or newer activities."""
    b, m = permit(db, user, trip_id, edit=True)
    state = reschedule(b.state, data.activity_ids, data.first_day)
    commit_change(db, b, v, state, user, "activities.rescheduled")
    tasks.add_task(publish, trip_id)
    return snapshot(db, b, m)


@app.delete("/api/trips/{trip_id}")
def remove_trip(
    trip_id: str,
    tasks: BackgroundTasks,
    v=Depends(version),
    user=Depends(current_user),
    db=Depends(db_session),
):
    """Delete only an owner-reviewed version; remove database references before attachment files."""
    b, _ = permit(db, user, trip_id, owner=True)
    # CAS before cascade deletion prevents deleting a newer plan.
    result = db.execute(
        update(Board)
        .where(Board.id == trip_id, Board.version == v)
        .values(version=v + 1)
        .execution_options(synchronize_session=False)
    )
    if result.rowcount != 1:
        db.rollback()
        raise HTTPException(409, "The trip changed. Refresh before deleting it.")
    docs = db.scalars(select(Document).where(Document.board_id == trip_id)).all()
    for table in (Notification, Document, Proposal, Invite, Change, Member):
        db.execute(delete(table).where(table.board_id == trip_id))
    db.delete(b)
    db.commit()
    tasks.add_task(publish, trip_id)
    for d in docs:
        (UPLOADS / d.id).unlink(missing_ok=True)
    return {"ok": True}


SCHEMAS = {"activities": ActivityWrite, "places": PlaceInput, "hotels": HotelInput, "transports": TransportInput}


def bind_activity_place(item, state):
    """Keep activity coordinates even when the user chooses not to save a reusable place."""
    if item.new_place:
        if item.place_id:
            raise HTTPException(422, "Choose a saved place or a new address, not both.")
        p = item.new_place.model_dump()
        existing = next(
            (
                r
                for r in state["places"]
                if r["location"] == p["location"]
                and r["lat"] == p["lat"]
                and r["lon"] == p["lon"]
            ),
            None,
        )
        if existing:
            item.place_id = existing["id"]
        else:
            if len(state["places"]) >= 100:
                raise HTTPException(422, "A trip can contain up to 100 saved places.")
            item.place_id = uid()
            state["places"].append({"id": item.place_id, **p})
        item.location = p["location"]
    validate_activity(item, state)
    if item.place_id:
        place = next(p for p in state["places"] if p["id"] == item.place_id)
        item.map_location = MapLocation(lat=place["lat"], lon=place["lon"])


def parse_item(kind, data):
    """Select a strict request schema by collection; never pass a Pydantic class to SQLAlchemy lookups."""
    if kind not in SCHEMAS:
        raise HTTPException(404, "Collection not found.")
    try:
        return SCHEMAS[kind].model_validate(data)
    except Exception as e:
        raise HTTPException(
            422, "Invalid " + kind + " details: " + str(e).split("\n")[0]
        )


@app.post("/api/trips/{trip_id}/items/{kind}", status_code=201)
def add_item(
    trip_id: str,
    kind: str,
    data: dict,
    tasks: BackgroundTasks,
    v=Depends(version),
    user=Depends(current_user),
    db=Depends(db_session),
):
    """Validate collection-specific rules before committing a new item and publishing a wake-up."""
    b, m = permit(db, user, trip_id, edit=True)
    item = parse_item(kind, data)
    if kind == "transports":
        transport.validate(item.model_dump())
    if kind == "hotels":
        for day, clock in (
            (item.check_in, item.check_in_time),
            (item.check_out, item.check_out_time),
        ):
            if clock:
                instant(day, clock, b.state["timezone"])
    state = copy.deepcopy(b.state)
    state.setdefault("transports", [])
    if kind == "activities":
        bind_activity_place(item, state)
    if len(state[kind]) >= 100:
        raise HTTPException(422, "This collection is limited to 100 items per trip.")
    state[kind].append({"id": uid(), **item.model_dump(exclude={"new_place"})})
    commit_change(db, b, v, state, user, kind + ".created")
    tasks.add_task(publish, trip_id)
    return snapshot(db, b, m)


@app.put("/api/trips/{trip_id}/items/{kind}/{item_id}")
def edit_item(
    trip_id: str,
    kind: str,
    item_id: str,
    data: dict,
    tasks: BackgroundTasks,
    v=Depends(version),
    user=Depends(current_user),
    db=Depends(db_session),
):
    """Update an existing item inside a detached board copy using the editor's original version."""
    b, m = permit(db, user, trip_id, edit=True)
    item = parse_item(kind, data)
    if kind == "transports":
        transport.validate(item.model_dump())
    if kind == "hotels":
        for day, clock in (
            (item.check_in, item.check_in_time),
            (item.check_out, item.check_out_time),
        ):
            if clock:
                instant(day, clock, b.state["timezone"])
    state = copy.deepcopy(b.state)
    state.setdefault("transports", [])
    if kind == "activities":
        bind_activity_place(item, state)
    row = next((r for r in state[kind] if r["id"] == item_id), None)
    if not row:
        raise HTTPException(404, "Item not found.")
    row.update(item.model_dump(exclude={"new_place"}))
    commit_change(db, b, v, state, user, kind + ".updated")
    tasks.add_task(publish, trip_id)
    return snapshot(db, b, m)


@app.delete("/api/trips/{trip_id}/items/{kind}/{item_id}")
def delete_item(
    trip_id: str,
    kind: str,
    item_id: str,
    tasks: BackgroundTasks,
    v=Depends(version),
    user=Depends(current_user),
    db=Depends(db_session),
):
    """Detach deleted places from activities and remove hotel files after the versioned commit."""
    b, m = permit(db, user, trip_id, edit=True)
    if kind not in SCHEMAS:
        raise HTTPException(404, "Collection not found.")
    state = copy.deepcopy(b.state)
    state.setdefault("transports", [])
    if not any(r["id"] == item_id for r in state[kind]):
        raise HTTPException(404, "Item not found.")
    if kind == "places":
        # Removing a saved place must not delete the user's scheduled activities or leave dangling IDs.
        place = next(p for p in state["places"] if p["id"] == item_id)
        for activity in state["activities"]:
            if activity.get("place_id") == item_id:
                activity["map_location"] = {"lat": place["lat"], "lon": place["lon"]}
                activity["place_id"] = None
    state[kind] = [r for r in state[kind] if r["id"] != item_id]
    removed_docs = (
        db.scalars(
            select(Document).where(
                Document.board_id == trip_id, Document.hotel_id == item_id
            )
        ).all()
        if kind == "hotels"
        else []
    )
    for doc in removed_docs:
        db.delete(doc)
    commit_change(db, b, v, state, user, kind + ".deleted")
    for doc in removed_docs:
        (UPLOADS / doc.id).unlink(missing_ok=True)
    tasks.add_task(publish, trip_id)
    return snapshot(db, b, m)


@app.post("/api/trips/{trip_id}/invites")
def invite(
    trip_id: str, data: InviteInput, user=Depends(current_user), db=Depends(db_session)
):
    """Issue a 24-hour single-use invitation with an owner-selected editor or viewer role."""
    permit(db, user, trip_id, owner=True)
    token = secrets.token_urlsafe(32)
    db.add(
        Invite(
            token=digest(token),
            board_id=trip_id,
            role=data.role,
            expires=(now() + timedelta(hours=24)).isoformat(),
        )
    )
    db.commit()
    return {"token": token, "expires_in_hours": 24}


@app.post("/api/invites/join")
def join(
    data: JoinInput,
    tasks: BackgroundTasks,
    user=Depends(current_user),
    db=Depends(db_session),
):
    """Lock the invitation while consuming it, making membership creation and token use atomic."""
    # PostgreSQL locks the invitation until commit so simultaneous join attempts cannot both consume it.
    inv = db.get(Invite, digest(data.token), with_for_update=True)
    if not inv or inv.used or datetime.fromisoformat(inv.expires) <= now():
        raise HTTPException(404, "Invitation is invalid or expired.")
    if db.get(Member, (inv.board_id, user.id)):
        return {"id": inv.board_id}
    b = db.get(Board, inv.board_id)
    db.add(Member(board_id=b.id, user_id=user.id, role=inv.role))
    inv.used = True
    commit_change(db, b, b.version, b.state, user, "member.joined")
    tasks.add_task(publish, b.id)
    return {"id": b.id}


@app.put("/api/trips/{trip_id}/members/{user_id}")
def member_role(
    trip_id: str,
    user_id: str,
    data: InviteInput,
    tasks: BackgroundTasks,
    v=Depends(version),
    user=Depends(current_user),
    db=Depends(db_session),
):
    """Allow only the owner to change nonowner roles and record the change under a new trip version."""
    b, _ = permit(db, user, trip_id, owner=True, lock=True)
    m = db.get(Member, (trip_id, user_id))
    if not m or m.role == "owner":
        raise HTTPException(422, "Use Transfer manager to change the trip manager.")
    m.role = data.role
    commit_change(db, b, v, b.state, user, "member.role_changed")
    tasks.add_task(publish, trip_id)
    return {"ok": True}


@app.post("/api/trips/{trip_id}/transfer-manager")
def transfer_manager(
    trip_id: str,
    data: TransferManagerInput,
    tasks: BackgroundTasks,
    v=Depends(version),
    user=Depends(current_user),
    db=Depends(db_session),
):
    """Swap the sole manager atomically, then keep the former manager as an editor."""
    b, current = permit(db, user, trip_id, owner=True, lock=True)
    successor = db.get(Member, (trip_id, data.user_id))
    if not successor or successor.user_id == user.id:
        raise HTTPException(422, "Choose another current trip member as manager.")
    if v != b.version:
        raise HTTPException(409, "The trip changed. Reopen Transfer manager and try again.")
    # Claim the version before touching memberships, including on SQLite where row locks are unavailable.
    claimed = db.execute(
        update(Board).where(Board.id == trip_id, Board.version == v)
        .values(version=v + 1).execution_options(synchronize_session=False)
    )
    if claimed.rowcount != 1:
        db.rollback()
        raise HTTPException(409, "The trip changed. Reopen Transfer manager and try again.")
    current.role = "editor"
    # Flush the demotion first for the unique index. No other session sees this intermediate state.
    db.flush()
    successor.role = "owner"
    db.add(Change(board_id=trip_id, version=v + 1, actor=user.name, kind="manager.transferred"))
    db.commit()
    db.refresh(b)
    tasks.add_task(publish, trip_id)
    return snapshot(db, b, current)


@app.delete("/api/trips/{trip_id}/members/{user_id}")
def remove_member(
    trip_id: str,
    user_id: str,
    tasks: BackgroundTasks,
    v=Depends(version),
    user=Depends(current_user),
    db=Depends(db_session),
):
    """Let guests leave voluntarily; only owners may remove another member."""
    leaving = user_id == user.id
    b, _ = permit(db, user, trip_id, owner=not leaving, lock=True)
    m = db.get(Member, (trip_id, user_id))
    if not m or m.role == "owner":
        raise HTTPException(422, "Transfer management to another member before leaving the trip.")
    db.delete(m)
    db.execute(
        delete(Notification).where(
            Notification.board_id == trip_id, Notification.user_id == user_id
        )
    )
    # Membership and reminders are removed atomically; shared plans belong to the trip.
    commit_change(db, b, v, b.state, user, "member.left" if leaving else "member.removed")
    tasks.add_task(publish, trip_id)
    return {"ok": True}


@app.get("/api/cities/search")
async def search_cities(q: str, user=Depends(current_user)):
    """Bound authenticated autocomplete queries before delegating to the city provider."""
    if not 2 <= len(q.strip()) <= 200:
        raise HTTPException(422, "Enter a city name with 2–200 characters.")
    return await cities.search(q)


@app.get("/api/places/search")
async def geocode(q: str, city_only: bool = False, user=Depends(current_user)):
    """Provide authenticated destination lookup for maps of older trips without saved city coordinates."""
    if not 3 <= len(q) <= 200:
        raise HTTPException(422, "Enter a search query with 3–200 characters.")
    return await providers.search_places(q, city_only=city_only)


@app.get("/api/trips/{trip_id}/places/search")
async def search_trip_places(
    trip_id: str,
    q: str,
    user=Depends(current_user),
    db=Depends(db_session),
):
    """Authorize the trip and restrict address searches to its resolved destination."""
    board, _ = permit(db, user, trip_id)
    if not 3 <= len(q.strip()) <= 300:
        raise HTTPException(422, "Enter a search query with 3–300 characters.")
    if board.state.get("destination_location"):
        return await providers.search_in_destination(
            q, board.state["destination"], selected=board.state["destination_location"]
        )
    return await providers.search_in_destination(q, board.state["destination"])


@app.post("/api/trips/{trip_id}/optimize")
async def optimize(
    trip_id: str,
    data: RouteInput,
    v=Depends(version),
    user=Depends(current_user),
    db=Depends(db_session),
):
    """Store a validated route proposal without changing the itinerary until the user accepts it."""
    b, _ = permit(db, user, trip_id, edit=True)
    if b.version != v:
        raise HTTPException(409, "Reload the trip before generating a route.")
    result = await optimizer.optimize(copy.deepcopy(b.state), **data.model_dump())
    apply_operations(b.state, result["operations"])
    p = Proposal(board_id=b.id, version=v, author=user.id, kind="route", data=result)
    db.add(p)
    db.commit()
    return {"id": p.id, "base_version": v, "kind": "route", **result}


@app.post("/api/trips/{trip_id}/ai")
async def ai_proposal(
    trip_id: str,
    data: AIInput,
    v=Depends(version),
    user=Depends(current_user),
    db=Depends(db_session),
):
    """Generate against a copied, versioned snapshot and store the suggestion for later review."""
    b, _ = permit(db, user, trip_id, edit=True)
    if b.version != v:
        raise HTTPException(409, "Reload the trip before asking AI.")
    result = await ai.propose(copy.deepcopy(b.state), **data.model_dump())
    p = Proposal(board_id=b.id, version=v, author=user.id, kind="ai", data=result)
    db.add(p)
    db.commit()
    return {"id": p.id, "base_version": v, "kind": "ai", **result}


@app.post("/api/trips/{trip_id}/proposals/{proposal_id}/apply")
def apply_proposal(
    trip_id: str,
    proposal_id: str,
    tasks: BackgroundTasks,
    v=Depends(version),
    user=Depends(current_user),
    db=Depends(db_session),
):
    """Revalidate a proposal and commit only if both it and the client still match the board version."""
    b, m = permit(db, user, trip_id, edit=True)
    p = db.get(Proposal, proposal_id)
    if not p or p.board_id != trip_id:
        raise HTTPException(404, "Proposal not found.")
    if p.version != v or b.version != v:
        raise HTTPException(409, "This proposal is stale. Generate a new suggestion.")
    # Revalidate on acceptance, not only generation; all operations succeed or fail as one board write.
    activities = apply_operations(b.state, p.data["operations"])
    for a in activities:
        if a["id"].startswith("new-"):
            a["id"] = uid()
    state = {**b.state, "activities": activities}
    commit_change(db, b, v, state, user, p.kind + ".applied")
    tasks.add_task(publish, trip_id)
    return snapshot(db, b, m)


@app.post("/api/trips/{trip_id}/hotel-policy")
async def hotel_times(
    trip_id: str,
    data: HotelPolicyInput,
    user=Depends(current_user),
    db=Depends(db_session),
):
    """Cache successful published-time lookups and rate-limit discovery per authenticated user."""
    permit(db, user, trip_id, edit=True)
    if not redis:
        raise HTTPException(503, "Start Redis before looking up hotel policies.")
    cache_key = "hotel-policy:v2:" + digest(
        json.dumps(data.model_dump(), sort_keys=True)
    )
    try:
        cached = await redis.get(cache_key)
        if cached:
            return json.loads(cached)
        if not await redis.set(f"hotel-policy:rate:{user.id}", 1, nx=True, ex=3):
            raise HTTPException(
                429, "Wait three seconds before another hotel policy lookup."
            )
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(503, "Hotel policy lookup is temporarily unavailable.")
    if data.lat is not None and data.lon is not None:
        result = await hotel_discovery.resolve(
            data.name, data.lat, data.lon, data.website
        )
    else:
        result = await hotel_policy.lookup(data.website, data.name)
    try:
        await redis.set(cache_key, json.dumps(result), ex=86400)
    except Exception:
        pass
    return result


@app.post("/api/trips/{trip_id}/hotels/{hotel_id}/documents")
async def upload(
    trip_id: str,
    hotel_id: str,
    tasks: BackgroundTasks,
    file: UploadFile = File(...),
    v=Depends(version),
    user=Depends(current_user),
    db=Depends(db_session),
):
    """Validate size and file signature, then coordinate attachment metadata with a versioned trip write."""
    b, m = permit(db, user, trip_id, edit=True)
    if not any(h["id"] == hotel_id for h in b.state["hotels"]):
        raise HTTPException(404, "Hotel not found.")
    content = await file.read(10 * 1024 * 1024 + 1)
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(413, "Maximum file size is 10 MB.")
    # Inspect file signatures instead of trusting an extension or browser-provided MIME type.
    mime = (
        "application/pdf"
        if content.startswith(b"%PDF-")
        else "image/png"
        if content.startswith(b"\x89PNG\r\n\x1a\n")
        else "image/jpeg"
        if content.startswith(b"\xff\xd8\xff")
        else None
    )
    if not mime:
        raise HTTPException(422, "Upload a PDF, PNG or JPEG confirmation.")
    d = Document(
        id=uid(),
        board_id=b.id,
        hotel_id=hotel_id,
        name=Path(file.filename or "confirmation").name[:150],
        mime=mime,
    )
    UPLOADS.mkdir(parents=True, exist_ok=True)
    (UPLOADS / d.id).write_bytes(content)
    try:
        db.add(d)
        commit_change(db, b, v, b.state, user, "hotel.document_added")
    except Exception:
        db.rollback()
        # File storage is outside SQL; compensate if committing metadata fails.
        (UPLOADS / d.id).unlink(missing_ok=True)
        raise
    tasks.add_task(publish, trip_id)
    return snapshot(db, b, m)


@app.get("/api/documents/{document_id}")
def document(document_id: str, user=Depends(current_user), db=Depends(db_session)):
    """Check current membership on each download and serve the file as an attachment."""
    d = db.get(Document, document_id)
    if not d:
        raise HTTPException(404, "Document not found.")
    permit(db, user, d.board_id)
    return FileResponse(
        UPLOADS / d.id,
        filename=d.name,
        media_type=d.mime,
        content_disposition_type="attachment",
    )


@app.get("/api/notifications")
def notices(user=Depends(current_user), db=Depends(db_session)):
    """Return only the current user's most recent persisted reminders."""
    return [
        {
            "id": n.id,
            "trip_id": n.board_id,
            "message": n.message,
            "read": n.read,
            "created_at": n.created_at,
        }
        for n in db.scalars(
            select(Notification)
            .where(Notification.user_id == user.id)
            .order_by(Notification.created_at.desc())
            .limit(100)
        )
    ]


@app.post("/api/notifications/{notice_id}/read")
def read_notice(notice_id: str, user=Depends(current_user), db=Depends(db_session)):
    """Require notification ownership before marking a reminder read."""
    n = db.get(Notification, notice_id)
    if not n or n.user_id != user.id:
        raise HTTPException(404, "Notification not found.")
    n.read = True
    db.commit()
    return {"ok": True}


@app.websocket("/api/trips/{trip_id}/live")
async def live(ws: WebSocket, trip_id: str):
    """Authenticate the socket, recheck access continuously and signal clients to fetch newer snapshots."""
    if ws.headers.get("origin") not in ORIGINS:
        await ws.close(code=1008)
        return
    token = ws.cookies.get("tb_session", "")
    with Session() as db:
        login = db.get(Login, digest(token))
        if (
            not login
            or datetime.fromisoformat(login.expires) < now()
            or not db.get(Member, (trip_id, login.user_id))
        ):
            await ws.close(code=1008)
            return
        user_id = login.user_id
    await ws.accept()
    subscription = None
    try:
        if redis:
            try:
                subscription = redis.pubsub()
                await subscription.subscribe("tripboard:" + trip_id)
            except Exception:
                subscription = None
        await ws.send_json({"type": "sync"})
        last = None
        last_ping = 0
        while True:
            if subscription:
                try:
                    await subscription.get_message(
                        ignore_subscribe_messages=True, timeout=2
                    )
                except Exception:
                    subscription = None
            else:
                await asyncio.sleep(2)
            # Each loop sees fresh permissions and expiry, so revocation closes existing sockets too.
            with Session() as db:
                login = db.get(Login, digest(token))
                b = db.get(Board, trip_id)
                m = db.get(Member, (trip_id, user_id))
                if (
                    not b
                    or not m
                    or not login
                    or datetime.fromisoformat(login.expires) < now()
                ):
                    await ws.close(code=1008)
                    break
                # Send a wake-up/version only; clients fetch authorized snapshots and missed history over HTTP.
                if b.version != last:
                    await ws.send_json({"type": "changed", "version": b.version})
                    last = b.version
                if time.monotonic() - last_ping > 15:
                    await ws.send_json({"type": "ping"})
                    last_ping = time.monotonic()
    except Exception:
        pass
    finally:
        if subscription:
            try:
                await subscription.aclose()
            except Exception:
                pass


@app.post("/api/demo", status_code=201)
def demo(user=Depends(current_user), db=Depends(db_session)):
    """Create an isolated sample trip owned by the requesting user."""
    from datetime import date

    start = date.today() + timedelta(days=7)
    end = start + timedelta(days=1)
    b, m = new_board(
        db,
        user,
        {
            "title": "A weekend in Boston",
            "destination": "Boston, Massachusetts",
            "start_date": start.isoformat(),
            "end_date": end.isoformat(),
            "timezone": "America/New_York",
        },
    )
    sample = [
        (
            "Boston Public Garden",
            "4 Charles St, Boston",
            42.3544,
            -71.0707,
            "sight",
            60,
            "09:00",
        ),
        (
            "Tatte Bakery & Café",
            "70 Charles St, Boston",
            42.3584,
            -71.0700,
            "food",
            45,
            "10:15",
        ),
        (
            "Museum of Fine Arts",
            "465 Huntington Ave, Boston",
            42.3394,
            -71.0940,
            "sight",
            90,
            "13:00",
        ),
        (
            "Isabella Stewart Gardner Museum",
            "25 Evans Way, Boston",
            42.3382,
            -71.0990,
            "sight",
            60,
            "15:00",
        ),
        (
            "Boston Common",
            "139 Tremont St, Boston",
            42.3550,
            -71.0656,
            "sight",
            45,
            "17:00",
        ),
    ]
    places = []
    activities = []
    for i, (title, location, lat, lon, category, duration, time_) in enumerate(sample):
        p = {
            "id": uid(),
            "title": title,
            "location": location,
            "lat": lat,
            "lon": lon,
            "category": category,
            "duration": duration,
            "opens": "09:00",
            "closes": "20:00",
            "notes": "Sample planning hours — verify current hours before visiting.",
        }
        places.append(p)
        if i < 4:
            activities.append(
                {
                    "id": uid(),
                    "title": title,
                    "location": location,
                    "notes": [
                        "A slow morning among the gardens.",
                        "Coffee, something sweet, and a little people-watching.",
                        "An afternoon with the art. This is a sample fixed reservation.",
                        "Leave time for the courtyard.",
                    ][i],
                    "day": start.isoformat(),
                    "start": time_,
                    "duration": duration,
                    "locked": i == 2,
                    "place_id": p["id"],
                    "reminder_minutes": 30,
                }
            )
    hotel = {
        "id": uid(),
        "name": "The Bostonian — sample reservation",
        "address": "26 North Street, Boston",
        "check_in": start.isoformat(),
        "check_out": end.isoformat(),
        "lat": 42.3603,
        "lon": -71.0557,
        "link": "",
        "notes": "Demo information only. This is not a real booking.",
    }
    b.state = {**b.state, "places": places, "activities": activities, "hotels": [hotel]}
    db.commit()
    return snapshot(db, b, m)
