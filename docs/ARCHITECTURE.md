# Implementation map

## Request flow

React calls `/api` through Vite (development) or Nginx (container). FastAPI authenticates the HttpOnly session cookie, authorizes membership, validates data, then uses PostgreSQL to update the trip and append its ordered change record in one transaction. After commit it publishes an invalidation message through Redis. WebSocket clients request `/sync?since=version` to fetch the current authorized snapshot and missed event metadata.

Redis Pub/Sub is deliberately not the durable event store. Each WebSocket also checks the database every two seconds; the frontend retries with backoff and polls every ten seconds. Lost messages or reconnects lead to a fresh snapshot. The event log records actor, kind, version and timestamp; it is an ordered audit/invalidation log, not a full event-sourced undo history.

## Data and concurrency

A `Board` stores itinerary/places/hotels as a PostgreSQL JSONB aggregate, bounded to 100 items per collection. Accounts, memberships, invitations, proposals, attachments, notifications, sessions and change metadata are relational tables. One aggregate lets a multi-operation proposal commit atomically with one compare-and-swap `UPDATE ... WHERE version = expected`. This learning implementation serializes changes at trip level. Even edits of two different activities can conflict; there is no CRDT/automatic merge.

Edits carry `If-Match`. A stale version receives HTTP 409. Editor dialogs preserve unsaved fields and their opening version; they never silently replace edits after a live refresh. Close/reopen against the current version to reconcile. Read-only users cannot create proposals or mutate the itinerary. A single Manager controls membership and whole-trip deletion; the API retains the existing `owner` role value for compatibility.

Management transfer claims the trip version, demotes the current Manager to Editor, promotes an existing member, and records an event in one transaction. Membership writes lock the board first on PostgreSQL. A partial unique index prevents two managers on one board; trip creation and guarded removal maintain the required manager. Existing databases receive the index at startup. Editors and viewers may leave; a Manager must transfer first or explicitly delete the entire trip. Self-leave and access revocation discard the client snapshot and return to the personal workspace.

Time fields are local date + clock + IANA trip zone. UTC conversion is used for due reminders; nonexistent and ambiguous DST times are rejected. Activities cannot span midnight. Current itinerary overlap and hotel/date problems are visible in the UI; AI and route proposals must pass all schedule constraints before application. Changing the trip zone preserves local clock values and may produce warnings; it does not preserve the original UTC instant.

## Files

| File | Responsibility |
| --- | --- |
| backend/main.py | Stable `uvicorn main:app` entry point |
| backend/app/api.py | Auth, HTTP routes, authorization wiring, proposal endpoints and WebSocket transport |
| backend/app/core.py | Environment, engine/session, password hashing, session authentication and membership checks |
| backend/app/models.py | Relational SQLAlchemy models; JSONB board state |
| backend/app/schemas.py | Pydantic API input rules, separate from database models |
| backend/app/service.py | Snapshot generation, optimistic commits, board creation, one-time legacy import |
| backend/app/planning.py | Time conversion, schedule constraints, deterministic proposal application |
| backend/app/optimizer.py | OR-Tools time-window route solver |
| backend/app/providers.py | Travel-time provider and cached geocoding boundary |
| backend/app/ai.py | OpenAI structured proposals, deterministic candidate and output validation |
| backend/app/sync.py | Redis invalidation publication |
| backend/app/worker.py | Durable in-app reminders with per-member deduplication |
| backend/tests/ | Isolated backend regression and constraint tests |
| frontend/src/App.tsx | Workspace, trips, itinerary, places, hotel, team and reminder flows |
| frontend/src/useTrip.ts | Version-aware snapshots, WebSocket retries and polling |
| frontend/src/api.ts | Shared fetch/error handling and display helpers |
| frontend/src/types.ts | TypeScript API contracts |
| frontend/src/components/Editor.tsx | Validated forms; captures starting version |
| frontend/src/components/MapView.tsx | MapLibre, coordinate markers and stop-order line |
| frontend/src/components/AssistantPanel.tsx | AI/route forms, proposal preview and explicit accept |
| frontend/src/components/Modal.tsx | Native dialog focus management and accessible close |
| frontend/src/index.css, App.css | Global tokens, desktop/mobile layouts |
| compose.yaml | PostgreSQL and Redis with persistent volumes |
| compose.full.yaml | Optional API + reminder worker + Nginx/React containers |
| scripts/dev.sh | Starts local dependencies and app processes; only stops its own child processes |

## External failures and limits

No API key means AI remains visibly unavailable; no synthetic response masquerades as a model. OSRM is optional and distinguishes driving road durations from estimated walking. Time matrices are checked before proposing schedules, and the proposal stores the source label. Candidate place hours are user data, not authoritative live facts. Confirmations are private attachments downloaded only after membership checks; they are not sent to the model.

Reminder delivery here is a durable in-app inbox, not email/mobile push. Notifications are deduplicated per user and scheduled occurrence and are caught up for 24 hours after worker downtime. Sessions last seven days; no password recovery/verification flow in this local version. Files use local disk, with a separate Docker volume in container mode. Session rate limiting is per-process, so production needs centralized enforcement.
