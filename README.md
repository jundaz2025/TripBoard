# TripBoard

TripBoard is a collaborative travel planner for organizing daily activities, saved places, hotels, and outbound/return journeys in one shared workspace.

The application uses **React + TypeScript** on the frontend and **Python + FastAPI** on the backend, with **PostgreSQL**, **Redis**, and **WebSockets**. English is the default interface language; the top-right language button switches between English and Chinese. Important application code includes English comments explaining responsibilities, decisions, and edge cases.

This README describes the implementation reviewed on **September 24, 2026**. The supplied startup configuration is intended for local development.

## Contents

- [Features](#features)
- [Set up a fresh copy](#set-up-a-fresh-copy)
- [Test collaboration](#test-collaboration)
- [Configuration](#configuration)
- [How the application works](#how-the-application-works)
- [Important files](#important-files)
- [Checks and tests](#checks-and-tests)
- [Data and backups](#data-and-backups)
- [Optional container setup](#optional-container-setup)
- [Troubleshooting](#troubleshooting)
- [Current limits](#current-limits)

## Features

| Area | Implemented behavior |
| --- | --- |
| Accounts | Registration and login, password confirmation, show/hide password controls, sign-out confirmation, and account deletion with an impact preview. New passwords must contain 12–128 characters, uppercase and lowercase letters, a number, and a symbol. |
| Trips | Create and edit trips, select an unambiguous city from search results, automatically choose its time zone, and confirm whole-trip deletion. The interface uses friendly zone labels such as Eastern Time and Central Time. |
| Itinerary | Daily activities, notes, duration, fixed appointments, configurable activity reminders, and conflict warnings with dates, event times, and the overlapping interval. |
| Saved places | Search within the selected destination, preview a location on the map, save it, and reuse it in activities. Opening-hour constraints can be supplied manually. |
| Maps | Currently rendered with **MapLibre GL JS + OpenFreeMap**, using OpenStreetMap data. Destination-centered previews, clickable location markers, 12 predefined day colors and generated colors for later days, a day legend, and separate stop-order lines for each day. Other days remain visible as context; lines never connect different days. |
| Travel & stays | One tab for hotels and outbound/return journeys: flights, driving, trains, buses, ferries, and other travel. Journeys retain departure/arrival dates and their separate local time zones. |
| Hotels | Reservation details, booking links, notes, and PDF/PNG/JPEG attachments up to 10 MB each. Hotel selection attempts to discover published check-in/out times automatically and shows its source when available. Times remain editable. |
| Collaboration | Owner/editor/viewer roles, single-use invitations that expire after 24 hours, live updates, reconnection recovery, version-conflict protection, and change history. Clicking the header avatars shows names, emails, roles, and the current-user marker. |
| Planning assistant | Route optimization and optional AI proposals for itinerary edits, a draft plan, or a stop that fits a free time window. Proposals are reviewed before application. |
| Reminders | A persistent in-app inbox for activity and hotel reminders. Hotel reminders use the saved check-in/out times, two hours in advance, in the trip time zone. Missing hotel times do not get guessed defaults. |
| Languages | English/Chinese interface switching, a remembered browser preference, and preserved form drafts when switching languages. User-entered names and notes are left unchanged. |

## Set up a fresh copy

Prerequisites: **Python 3.13**, **Node.js 24 with npm**, and **Docker Desktop with Docker Compose**. These match the project's development/container configuration.

From the project root, run the following only when setting up a new Python environment:

```bash
python3.13 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.txt
npm --prefix frontend ci
```

Create the backend configuration without replacing an existing file:

```bash
if [ ! -f backend/.env ]; then
  cp backend/.env.example backend/.env
fi
bash scripts/dev.sh
```

The example database URL matches the default local Compose credentials. If you customize the database credentials, update both sides consistently. The fallback when `DATABASE_URL` is absent is SQLite; configure PostgreSQL explicitly to use the intended local stack.

In VS Code, select **Python: Select Interpreter → backend/.venv/bin/python**. Activation is optional for the commands above because they use the virtual environment's Python explicitly.

For the recorded exact Python dependency versions, use `backend/requirements.lock.txt` instead of `backend/requirements.txt`. The frontend uses `package-lock.json` with `npm ci`.

Register your own account. If old tutorial tables exist, the first registered account can receive a one-time copy of that legacy data; the original tables are retained. An empty workspace also offers a sample Boston trip.

## Test collaboration

Use two independent browser sessions on the same computer:

1. Sign in as account A in a normal browser window and create a trip.
2. Open **Invite friends / People**, choose **Editor**, and copy an invitation link.
3. Open a different browser or a private window, then open that link and sign in/register as account B.
4. Join the invitation and open the same trip in both sessions.
5. Add or edit an activity in one session and observe the saved change in the other.
6. Click the avatar stack to verify both members and their roles. Try a separate **Viewer** invitation to verify read-only access.

Two ordinary tabs in the same browser share a login cookie and do not represent two accounts. Each new member needs a fresh invitation because invitations are single-use and expire after 24 hours.

If two people save from the same older trip version, the later write is rejected with **HTTP 409**. Review the updated trip and reopen the form before resubmitting your changes. Unsaved drafts are retained for review; edits are not silently merged.

A `localhost` or `127.0.0.1` link only reaches the computer opening it. Friends on another computer need a deployed, reachable instance. The current default binds services to the local computer.

## Configuration

### Backend

Local backend and worker processes load `backend/.env`. Existing shell environment variables take precedence. Restart `bash scripts/dev.sh` after changing environment settings; the reminder worker does not hot-reload its Python code.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | SQLAlchemy database connection; use the PostgreSQL URL in `.env.example` for the local Compose database. |
| `REDIS_URL` | Redis connection for live-update publication, provider caching, and shared provider throttling. |
| `APP_ORIGINS` | Comma-separated allowed browser origins, including scheme and port. The example permits the two local frontend origins on 5176. |
| `COOKIE_SECURE` | `false` for local HTTP; configure `true` for an HTTPS deployment. |
| `UPLOAD_DIR` | Optional attachment directory; local default is `backend/uploads/`. |
| `OPENAI_API_KEY` | Optional server-side key for AI proposals; empty means AI is unavailable. |
| `OPENAI_MODEL` | Model identifier; the current code/example defaults to `gpt-4o-mini`. |
| `OSRM_URL` | Optional OSRM server for driving-time matrices. The example uses a public demo endpoint; leave empty to disable road routing. |
| `NOMINATIM_URL` | Place/address geocoding server. |
| `CITY_GEOCODING_URL` | Optional compatible city lookup endpoint; defaults to Open-Meteo geocoding. |
| `OVERPASS_URL` | Optional Overpass endpoint used to discover hotel website metadata. |

### AI proposals

Set your key in **`backend/.env`**, then restart the stack:

```dotenv
OPENAI_API_KEY=replace_with_your_server_side_key
OPENAI_MODEL=gpt-4o-mini
```

The model name above reflects the existing configuration, not a guarantee of access for every API account. The configured model must be available to your API project and support the structured response requested by `backend/app/ai.py`.

Save candidate places first, then use **Planning assistant**. The backend sends the request, relevant trip/activity information, candidate places, and travel-time data to the OpenAI Responses endpoint with `store=false`. Hotel confirmation files are not included. The model returns a proposal; the server validates it, and a separate user action applies it with a version check.

Keep this key out of frontend files and all `VITE_*` variables. Missing credentials or provider failures leave manual planning available. Configuring a key enables the integration; successful live model access must still be checked with your own account.

### Current map: MapLibre + OpenFreeMap

The current local setup uses **MapLibre GL JS** to render **OpenFreeMap** vector tiles based on **OpenStreetMap** data. No Google Maps API key is configured, so Google Maps is not currently enabled.

Address and place search uses **Nominatim** and is restricted to the selected destination's search area. City selection and automatic time-zone lookup use **Open-Meteo geocoding**. These are separate services from the map renderer.

The existing map supports destination previews, saved-place and hotel markers, day colors, and separate stop-order lines for each day. This setup does not require a Google Maps key.

### Optional future setup: Google Maps

A Google Maps renderer is already implemented and can be enabled later by configuring a valid browser API key. It has not yet been enabled or verified with a configured key in the current local setup.

To enable it later, create **`frontend/.env.local`** using `frontend/.env.example` as a template:

```dotenv
VITE_GOOGLE_MAPS_API_KEY=replace_with_your_restricted_browser_key
VITE_GOOGLE_MAPS_MAP_ID=
```

Use a Google browser key authorized for **Maps JavaScript API** and restricted to the website origins you use, for example `http://127.0.0.1:5176/*` and `http://localhost:5176/*`. Complete the provider's required account/API setup before testing. The optional map ID defaults to `DEMO_MAP_ID` in this project for local testing.

Restart Vite/the stack after changing these variables. For a production bundle, rebuild the frontend: Vite substitutes these values at build time. Browser keys are visible in client code and must have appropriate restrictions.

The provider badge shows **Google Maps** after successful loading. Without a configured key, or if loading/authorization fails, the application falls back to **MapLibre + OpenFreeMap**. The Google base-map loader currently requests English labels independently of the interface language switch.

**Enabling Google Maps changes the map renderer only.** Address/place search still uses Nominatim, city selection uses its separate geocoding provider, and hotel discovery uses public hotel metadata and websites. This implementation does not add Google Places, Google Geocoding, or Google Directions calls.

### Local port overrides

The startup script accepts optional overrides:

```bash
TRIPBOARD_FRONTEND_PORT=5177 TRIPBOARD_BACKEND_PORT=8002 bash scripts/dev.sh
```

The script automatically updates Vite's API proxy target. Add the matching frontend origin to `APP_ORIGINS` and, if applicable, to the Google browser key's allowed website list.

## How the application works

- **Request path:** React sends `/api` requests through Vite in development or Nginx in container mode. FastAPI authenticates the session cookie and checks trip membership and role.
- **Persistence:** SQLAlchemy stores accounts, sessions, memberships, invitations, notifications, attachments, and change records in relational tables. The trip's planning collections live in a versioned PostgreSQL JSONB board.
- **Concurrent writes:** A mutation supplies its expected version in `If-Match`. An atomic database update commits the new board and change record together. Stale versions get HTTP 409.
- **Live updates:** Redis announces changes over WebSockets. Clients fetch an authorized snapshot and missed change metadata. Reconnection and periodic polling recover from missed messages; Redis is not the durable source of trip history.
- **Planning:** OR-Tools proposes an order subject to saved constraints. AI proposals are independently validated before application. Neither applies changes just by generating a preview.
- **Time:** Stored IANA zone identifiers support actual time calculations; friendly names are used for display. Travel supports separate endpoint zones and compares UTC instants. Ambiguous or nonexistent daylight-saving times are rejected.
- **Reminders:** A separate worker creates deduplicated in-app notifications and catches up on reminders due within the previous 24 hours after downtime.

## Important files

Paths below are relative to the project root. English comments in these files explain key logic alongside the implementation.

### Backend

| File | Responsibility |
| --- | --- |
| `backend/main.py` | Small entry point for `uvicorn main:app`. |
| `backend/app/api.py` | HTTP/WebSocket routes, authentication flows, permissions, invitations, uploads, and proposal endpoints. |
| `backend/app/core.py` | Environment loading, database sessions, password hashing, authentication, and role checks. |
| `backend/app/models.py` | SQLAlchemy database models. |
| `backend/app/schemas.py` | Pydantic request validation; these are distinct from database models. |
| `backend/app/service.py` | Trip snapshots, atomic version-checked commits, trip creation, and legacy import. |
| `backend/app/planning.py` | Time conversion, conflict detection, scheduling rules, and proposal application. |
| `backend/app/transport.py` | Journey time validation, UTC comparisons, durations, and presentation data. |
| `backend/app/optimizer.py` | OR-Tools route optimization with time windows and fixed appointments. |
| `backend/app/providers.py` | Geocoding, destination-scoped place search, travel-time providers, caching, and throttling. |
| `backend/app/cities.py` | City selection and server-side destination/time-zone validation. |
| `backend/app/hotel_discovery.py` | Discover a matching hotel's website from place metadata and public sources. |
| `backend/app/hotel_policy.py` | Fetch and parse published hotel check-in/out times. |
| `backend/app/hotel_sources.json` | Small explicit directory of hotel identity/source references; not a universal hotel database. |
| `backend/app/ai.py` | Structured AI requests and independent proposal validation. |
| `backend/app/sync.py` | Redis connection and live-update publication. |
| `backend/app/worker.py` | Scheduled in-app reminder creation and deduplication. |
| `backend/database.py` | Retained tutorial models; the active application uses `app/core.py` and `app/models.py`. |

### Frontend

| File | Responsibility |
| --- | --- |
| `frontend/src/main.tsx` | Mount the React application. |
| `frontend/src/App.tsx` | Workspace navigation, selected trip, main tabs, and top-level dialogs. |
| `frontend/src/api.ts`, `types.ts` | API requests, error/display helpers, and TypeScript contracts. |
| `frontend/src/useTrip.ts` | Version-aware snapshots, WebSocket reconnects, and polling recovery. |
| `frontend/src/components/Auth.tsx`, `PasswordField.tsx`, `AccountSettings.tsx` | Account forms, password visibility, and account deletion. |
| `frontend/src/components/Editor.tsx` | Trip, activity, place, and hotel forms with draft/version handling. |
| `frontend/src/components/TransportEditor.tsx`, `TransportPanel.tsx`, `TransportCard.tsx` | Journey editing and the travel section within Travel & stays. |
| `frontend/src/travel.ts`, `timeZones.ts` | Journey date/display helpers and friendly time-zone labels. |
| `frontend/src/components/CitySearch.tsx`, `TimeZoneSelect.tsx` | City disambiguation and zone selection. |
| `frontend/src/components/LocationSearch.tsx`, `useDestination.ts`, `locations.ts` | Address search results, selected destination, and location contracts. |
| `frontend/src/components/MapView.tsx`, `OpenMap.tsx`, `GoogleMap.tsx` | Shared map UI, the currently used MapLibre renderer, and the optional Google Maps renderer. |
| `frontend/src/mapPlan.ts`, `mapPins.ts`, `components/MapDayLegend.tsx` | Day colors, marker content, and separate route lines per day. |
| `frontend/src/googleMaps.ts` | Load the optional Google Maps browser SDK. |
| `frontend/src/components/HotelPolicyLookup.tsx` | Automatically look up hotel times, show sources, and protect manual edits from late responses. |
| `frontend/src/components/AssistantPanel.tsx`, `ConflictNotice.tsx` | Proposal review/application and dated conflict warnings. |
| `frontend/src/components/TripMembers.tsx` | Clickable avatar preview, live member list, keyboard dismissal, and member-page shortcut. |
| `frontend/src/i18n.ts`, `translations.ts`, `useLanguage.ts`, `components/LanguageSwitch.tsx` | Language preference, translation catalog, subscriptions, and switch button. |
| `frontend/src/index.css`, `App.css` | Global styles, components, and responsive layouts. |

### Configuration and tooling

| Path | Responsibility |
| --- | --- |
| `scripts/dev.sh` | Start the local stack and stop only its own application processes. |
| `scripts/check.sh` | Run backend tests, frontend tests, lint, and the production build. |
| `compose.yaml` | Local PostgreSQL/Redis containers and persistent volumes. |
| `compose.full.yaml` | Optional API, worker, and web containers. |
| `backend/.env.example`, `frontend/.env.example` | Configuration templates without real API keys. |
| `frontend/vite.config.ts` | Development port and REST/WebSocket proxy. |
| `frontend/nginx.conf` | Serve the container frontend and proxy `/api`, including WebSockets. |
| `.vscode/tasks.json` | VS Code startup/check tasks. |
| `.vscode/settings.json` | Workspace-relative Python interpreter and generated-file search exclusions. |
| `frontend/tsconfig*.json` | TypeScript project references and browser/tooling compiler settings. |
| `frontend/.oxlintrc.json` | Frontend lint rules and React checks. |
| `frontend/package.json`, `package-lock.json` | Frontend commands, dependency declarations, and resolved dependency versions. |
| `backend/tests/`, `frontend/tests/` | Backend behavior tests and frontend map/translation tests. |
| `docs/` | Earlier architecture and dated verification notes; use this README for current setup and UI entry points. |

Suggested reading order: `App.tsx` → `api.ts` and `useTrip.ts` → `backend/app/api.py` → `schemas.py` / `models.py` → `service.py`. Then read the map, transport, AI, or reminder modules for the feature you want to study.

## Checks and tests

Run all project checks from the root:

```bash
bash scripts/check.sh
```

Or run a specific check:

```bash
PYTHONPATH=backend backend/.venv/bin/python -m pytest backend/tests -q
npm --prefix frontend test
npm --prefix frontend run lint
npm --prefix frontend run build
```

Backend tests normally use a temporary SQLite database and temporary uploads, with external integrations mocked where needed. Frontend tests cover map-day grouping and translation behavior. Passing these tests does not by itself confirm a live provider's availability or your API credentials.

For PostgreSQL-specific verification, create a **dedicated disposable test database** and set `TRIPBOARD_TEST_DATABASE_URL` before running pytest. Test fixtures drop and recreate application tables: never point that variable at the database containing your trips.

## Data and backups

- PostgreSQL data persists in the Compose `postgres_data` named volume; Redis uses `redis_data`.
- Local attachments are stored in `backend/uploads/` unless `UPLOAD_DIR` is overridden.
- Earlier source/database snapshots and later source backups are under `.backups/`. A source backup alone does not back up current database records or attachments.
- `.env` files, virtual environments, uploads, backups, build output, and `node_modules` are excluded by ignore rules.

To stop the database/cache containers while keeping data:

```bash
docker compose stop
```

Avoid `docker compose down -v` for routine restarts: it deletes named volumes.

Example of a new database and attachment backup, from the project root with PostgreSQL running:

```bash
backup_dir=".backups/$(date +%Y%m%d-%H%M%S)-data"
mkdir -p "$backup_dir"
docker compose exec -T db pg_dump -U tripboard -d tripboard > "$backup_dir/tripboard.sql"
if [ -d backend/uploads ]; then
  cp -R backend/uploads "$backup_dir/uploads"
fi
```

Check that the dump command succeeds. Copy `UPLOAD_DIR` instead if you customized it. Keep source, database, and attachment backups together when moving the project.

## Optional container setup

Stop the locally running app stack first so that two reminder workers are not running against the same data:

```bash
docker compose -f compose.yaml -f compose.full.yaml up --build -d
```

Open **http://127.0.0.1:8080/**. This configuration serves React through Nginx and runs the API and worker in containers. It reuses the database volume but stores attachments in a separate `uploads` volume; local `backend/uploads/` files are not migrated automatically.

Environment handling differs from local mode:

- Local Python processes load `backend/.env`.
- Compose substitutions come from the invoking shell or the project-root `.env`; `compose.full.yaml` explicitly forwards selected variables to its services.
- Additional backend settings must be added to the container `environment` mapping when needed. Merely adding them to `backend/.env` does not configure the containers.
- Frontend `VITE_*` settings are build-time values; rebuild the web image after changing them.

This is a local container setup. Sharing it on the internet requires a reachable host, HTTPS, appropriate origins and secure cookies, and deployment-specific configuration for storage, backups, migrations, monitoring, and provider access.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| An old-looking page appears | Open port 5176, not the earlier tutorial's port 5173. Save files and reload the browser. |
| `Port ... is already in use` | Stop the previous TripBoard terminal with Control+C. The startup script deliberately refuses to start a duplicate stack. |
| Docker/database startup fails | Start Docker Desktop; check `docker compose ps` and `docker compose logs db redis`. Do not delete volumes to troubleshoot a port conflict. |
| Changes to environment settings do not appear | Restart the stack. Rebuild a container frontend for changed `VITE_*` values. |
| `Origin is not allowed` | Match `APP_ORIGINS` to the exact scheme/host/port. Direct Swagger writes from port 8001 also need that origin explicitly allowed for local testing. |
| A trip save returns HTTP 409 | Another write advanced the trip version. Review the new data and reopen the editor before resubmitting. |
| An invitation fails | Confirm it belongs to this running instance, is less than 24 hours old, and has not been used. Create a new link for another member. |
| Search returns no local match | Select the correct city and country in Trip settings. Try a more complete address. Results outside the destination's search bounds are intentionally excluded. |
| Place search is unavailable | Check provider connectivity/throttling and retry later. Saved trip data remains available. Google map rendering does not replace the search provider. |
| Hotel times remain blank | The hotel may lack discoverable website metadata or readable published times. Enter verified times from the booking confirmation. |
| Reminders do not appear | Keep the reminder worker running. Confirm activity reminders or hotel times are saved and check the trip time zone. Delivery is in-app, not email/push. |
| AI is unavailable | Configure the backend key, restart, save candidate places, and verify model access. Inspect the backend error without sharing the key. |
| The map still says OpenStreetMap | Check the frontend key and provider authorization; restart Vite or rebuild. The fallback is intentional when Google loading fails. |
| npm reports cache permission errors | Retry `npm --prefix frontend ci --cache /tmp/tripboard-npm-cache`. |

## Current limits

- Trips support **1–61 days**. Planning collections are bounded to **100 items each**; route optimization supports **2–10 activities on one day**; AI planning supports **up to 30 saved places**.
- Collaboration synchronizes saved changes with trip-level version checks. It does not provide simultaneous character-level editing, automatic conflict merging, offline writes, or history-based undo.
- Saved-place opening hours are user-provided constraints. Hotel lookup has partial coverage and can fail; published hotel policy should be checked against the actual booking.
- The default walking-time matrix is a distance-based estimate. Optional OSRM driving times are road-network estimates without live traffic. Map lines show stop order, not navigation directions; optimization is time-limited and does not promise a globally optimal route.
- Place search is bounded by the selected destination's geographic bounding box/country, which can include neighboring areas. It is not an exact administrative boundary polygon.
- Journeys record user-entered travel plans. There is no live flight-status/fare lookup, ticket purchase, hotel booking/payment, or travel-specific reminder scheduling.
- Reminders are stored in the app's inbox, with up to 24 hours of catch-up after worker downtime. Email/mobile push, email verification, and password recovery are not implemented.
- Interface translation does not translate user content, all external map/place labels, or AI-generated prose. The current AI prompt requests explanations in English.
- Public map/geocoding/routing/hotel-data endpoints can be unavailable or rate-limited. Provider permissions, quotas, and account billing must be reviewed before public deployment.
