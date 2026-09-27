# Acceptance record — 2026-09-23

This records the tested local build, not production reliability or general performance claims.

| Capability | Implementation and verification |
| --- | --- |
| English responsive interface | Auth, trip workspace, itinerary, places, stays, assistant, people and reminder inbox. Browser checked at desktop and 390 px width; no document overflow. |
| Accounts / permissions | Scrypt passwords, HttpOnly cookie sessions, owner/editor/viewer API enforcement, single-use 24-hour invitation, role changes and removal. Automated positive and negative tests. |
| Trips / activities / persistence | Create, view, update, delete with version checks. SQLite and PostgreSQL regression suites pass. Original lesson tables retained; first-account import tested on isolated legacy tables. |
| Real-time collaboration | WebSocket notifications and Redis Pub/Sub, verified across two independent backend processes and two account sessions. |
| Concurrent edits | Two simultaneous writes against one version returned one 200 and one 409. Browser stale-edit test kept typed text and displayed a conflict without overwriting another member. |
| Reconnect recovery | Ordered PostgreSQL change metadata + authorized current snapshot. Missed-version replay tested; client reconnect/backoff and periodic refresh implemented. Redis is not relied on for durable delivery. |
| Time / reservations | Trip IANA zone, daylight-saving validation, manual overlap warnings, fixed-reservation locks in proposals. Tests include ambiguous/nonexistent clock times. |
| Reminders | Separate worker persists per-member in-app reminders and deduplicates them. Restart/catch-up logic and read state tested. Worker must be running; this is not email or OS push. |
| Map / place search | MapLibre map, numbered markers, hotel marker, selection and stop-order line rendered in browser. Nominatim live search returned a result. Search cache and rate limit are configured. |
| Route optimization | OR-Tools, 2–10 mapped activities, opening hours, travel duration, fixed appointments, optional hotel depot. Feasible and infeasible scenarios tested; browser preview/apply tested. Real OSRM matrix + hotel + solver integration succeeded. |
| Travel data | Public OSRM demo configured for low-volume local requests, Redis cache/rate limit and attribution. Walking estimates remain available and distinctly labeled. No real-time traffic; map line is not road navigation. |
| Hotel records | Dates, addresses, map coordinates, external links, private PDF/PNG/JPEG confirmations, member-only downloads, cleanup and reminders. Upload/download/access tests pass. No payment or actual booking. |
| AI natural-language edits | Real OpenAI Responses integration with structured proposals, known IDs, locked-item and travel checks. Mock-provider valid/invalid outputs tested. |
| AI itinerary drafts | Adds from candidate places, selected-day/time validation, preview and atomic apply path. Mock-provider successful and rejected draft tests. |
| AI next stop | Backend filters free-slot candidates and travel feasibility before asking the model; validates returned stop and window. Mock-provider success/no-fit cases tested. |
| Safe suggestion application | User accepts a preview; base version is checked, all operations validate before a single transactional update. Stale, duplicate and invalid/locked proposals rejected with no partial application. |
| Local reproduction | `scripts/dev.sh` actually started API + Vite + worker on isolated test ports; frontend proxy health endpoint succeeded. `bash -n`, Compose config validation, TypeScript build and lint completed. PostgreSQL/Redis containers are healthy. |

## Results

- 20 automated tests passed with temporary SQLite, and 20 with a dedicated PostgreSQL database. These tests do not use the user's live trip data.
- Local two-process Redis smoke measurement: 8 ms from one edit request to observed change notification in one run. This is **not** a latency benchmark or service-level promise.
- Browser route example reduced estimated travel from 121 to 68 minutes while retaining a fixed 13:00 reservation. Those numbers belong to that sample itinerary and walking-estimate mode only.
- npm audit reported zero known vulnerabilities after updating MapLibre. Production frontend build passed. Map code and worker load separately; the WebGL map bundle still triggers Vite's size advisory.
- Lint has zero errors and five `react(set-state-in-effect)` advisories around external session/trip/map synchronization. Python dependencies emitted five deprecation warnings during tests. These advisories are documented, not hidden by turning off checks.

## Still requires user configuration / external access

- **OpenAI Key is absent by agreement.** The UI explicitly disables generation. No real model call, billing/access check or model-quality evaluation has been performed with the user's API account. The adapter and deterministic validators have been tested with controlled responses.
- The public map/search/routing services require network access and may be unavailable or rate limited. The live search and road-duration paths succeeded during this verification; they are not availability guarantees. Production should use an appropriate provider or self-hosted service.
- Full API/worker/web Dockerfiles and Compose override are provided and their Compose configuration validates. A complete container image build/run has not been acceptance-tested; the verified workflow is local Python/Node plus Docker PostgreSQL/Redis.
- No offline writes, CRDT merging, payment processing, real hotel inventory, push notifications, route navigation, password recovery or public deployment are claimed by this build.

## Manual two-person demo

1. Owner creates a trip and saves at least two places; add activities from those places. Make one activity a fixed reservation.
2. In People, create an Editor invitation. Open it in another browser/private window and sign in with a second account.
3. Watch one browser update after an edit in the other. Open an activity editor in both, then save sequentially: the second stale save is rejected.
4. Disconnect/reconnect a client and verify its status and latest itinerary recovery. If Redis is temporarily unavailable, database checks still recover changes.
5. Generate a route, inspect source/times and accept it. Generate another, change the trip elsewhere, and verify the old proposal cannot apply.
6. Save a hotel, upload a confirmation and verify only members can download it. Schedule a reminder a few minutes ahead with the worker running; check the inbox after it is due.
7. After adding a real API Key, exercise edit/draft/next modes with saved places and evaluate factual quality separately from deterministic constraint validity.

## Account and map update — 2026-09-23

- 32 backend tests passed against isolated SQLite and PostgreSQL databases, including password complexity, confirmation, whitespace preservation, old password login, deletion scope/session revocation, deletion version conflicts, and atomic activity/address saves.
- Browser verified the registration show/hide toggle, login, deletion preview, live Nominatim search for Central Park in New York, a red marker on OpenFreeMap, saved-place persistence, and activity address selection/save.
- Mobile viewport 390×844: no horizontal document overflow (clientWidth and scrollWidth both 390).
- Frontend production build and lint completed; existing React effect warnings and MapLibre bundle-size advisory remain.
- Google Maps adapter uses the Maps JavaScript API with Advanced Markers and language=en. No Google browser Key is configured, so valid-key Google rendering remains unverified. No user account or itinerary was deleted during verification.

## Destination map update — 2026-09-23

- Empty trips now resolve their saved Destination and fit the city's bounds. The trip title does not affect map positioning. Changes to Destination refresh the overview; saved places, stays and explicit search previews take priority.
- City lookups use the existing authenticated search endpoint with `city_only=true`, English results, a separate Redis cache key, shared rate limiting, and deduplicated frontend requests. They run after a destination is saved, not on every keystroke. The geocoding base URL can be changed with `NOMINATIM_URL`.
- Browser verified real New York and Chicago city maps, existing Cloud Gate marker priority, an unmatched city message, and manual Central Park search/preview using a temporary UI fixture without changing the user's trips.
- All 37 backend tests passed with isolated SQLite, including city bounds, query normalization, separate city/place cache entries, authentication, rate limiting, empty results and provider failures. Frontend build passed; existing lint and map-bundle advisories remain.
- The Google adapter consumes the same resolved city bounds. It compiles, but a valid-key Google rendering test still requires the user's Google configuration.

## Destination-scoped search update — 2026-09-23

- Map, activity, saved-place and hotel searches now use an authenticated trip endpoint. The server reads the saved destination after checking membership, resolves city bounds, sends `viewbox`, `bounded=1` and the available country code to Nominatim, and filters returned coordinates again. Bounds describe a geographic rectangle, not an exact municipal polygon.
- Global city resolution and bounded place searches have separate cache entries; destination bounds and country are part of the place-search cache key. Changing trips or destinations clears old search results and previews. Empty or unresolved destinations never trigger an unbounded place-search fallback.
- All 42 backend tests passed with isolated SQLite. New cases cover foreign/out-of-bounds results, cache separation between global/New York/London searches, missing/invalid city bounds, empty results, membership, authentication and shared rate limiting. Frontend production build passed; lint has zero errors and the five previously documented effect warnings.
- Live provider verification: `central park` scoped to New York returned only Central Park in New York; `Big Ben, London` scoped to New York returned no matches. Browser verification on an existing Chicago trip showed local-area results in the map search and in the activity form's automatic address lookup. The unsaved test form was cancelled; no user trip data was changed.

## Street-address search fix — 2026-09-23

- Reproduced `55 clark st` returning an application 502 although Nominatim returned HTTP 200. The provider returned `namedetails: null` for street-number addresses; the parser incorrectly treated that as a dictionary. Null name details now use the existing address-label fallback.
- A regression test reproduced the 502 before the fix and passed after it, while retaining the destination filter. All 43 backend tests passed in an isolated staging copy using temporary SQLite; the one-line fix and regression test were then applied to the running project. Live provider verification returned 55 Clark Street in Brooklyn Heights. No user trip data was modified.

## Address label update — 2026-09-23

- Unnamed street addresses use house number plus street for their result title instead of only the first comma-separated address segment. Actual place names take priority; missing street details retain the full address rather than a bare number. Search cache version advanced to v5 so old numeric-only titles are not reused.
- All 10 search-related tests passed, including null name data, address labels, named places, country/bounds filtering and caching. Live search for `343 Gold st` in New York returned the title `343 Gold Street` with the full Brooklyn address below it. Existing saved place titles were not rewritten.

## Hotel policy times — 2026-09-23

- Hotel forms hide coordinate fields while retaining the selected search result's map coordinates. Changing the address requires selecting its location again. Saved-place coordinate inputs remain available.
- Check-in/out times are editable and no longer fixed to 15:00/11:00. Optional hotel website metadata is provided by place search; users can also enter a hotel website/FAQ URL. The lookup reads explicit hotel structured data or English check-in/out text and can follow up to two linked policy/FAQ pages. Results include the source and retrieval time and require `Use these times`; inaccessible, ambiguous or missing data requires manual entry from the booking confirmation.
- Public website requests reject credentials, non-web schemes, unusual ports and private/local addresses. Connections use a validated public IP with the original TLS hostname; redirects are revalidated. Requests are member-authorized and rate limited. This is a bounded website reader, not a universal hotel database or a guarantee that every hotel's policy is available.
- Reminders use each saved time, two hours in advance in the trip time zone. Unknown times are skipped. Hotel cards show the saved times or `Time not set`; the form reminder note is bold red. Existing reservations without time fields need their actual times entered.
- All 56 backend tests passed in isolated SQLite; 13 hotel tests cover extraction, missing/ambiguous times, access, rate limits, public-network validation, saved-time reminder timing and deduplication. Frontend production build and lint passed with the previously recorded five effect warnings and map-bundle size advisory.
- Live and browser checks on The Beekman discovered https://www.thebeekman.com/faq/ from its home page and returned 16:00 check-in and 11:00 check-out. Browser verified explicit application into the fields, source link, absence of hotel coordinate inputs and the red bold reminder. The test form was cancelled without saving a reservation.
- API and frontend hot-reloaded. Restart of the pre-existing worker process was blocked by the local process-control sandbox (`operation not permitted`); the user must stop and restart `bash scripts/dev.sh` before the running reminder worker uses the new logic.

## Automatic hotel website discovery and time filling — 2026-09-23

- Selecting a hotel in the reservation form now starts lookup automatically and fills any available published check-in/out times directly. The website/FAQ URL input and separate acceptance button have been removed. Existing reservations can use `Find hotel times automatically` / `Refresh hotel times`. Source URL and retrieval time remain visible; users may adjust the values to match their booking.
- Discovery uses website metadata from the selected place, then nearby OpenStreetMap hotel POIs through Overpass, with hotel-name and 300 m coordinate matching. Ambiguous matches are rejected. A small, explicit `app/hotel_sources.json` directory fills verified metadata gaps; it currently contains only The Beekman. The directory stores source/identity references, never check-in/out times. The hotel website reader still fetches published times. This is partial-coverage public metadata discovery, not a general web search engine or universal hotel database.
- Unavailable services, missing website metadata, blocked websites, and missing/ambiguous policy text remain visible failures with a manual-time fallback. The public Overpass endpoint is suitable only for low-volume local use; `OVERPASS_URL` can select a suitable production provider or self-hosted instance. No new API key is required for the current path.
- Successful results are cached for 24 hours; the displayed retrieval timestamp reflects the source read. Name, coordinates and any supplied website identify the cache entry. Hotel changes and manual time edits invalidate pending requests, preventing old results from overwriting new input. Saving waits for an active lookup to finish.
- All 61 backend tests passed against isolated temporary SQLite, including source discovery, name/location mismatch, ambiguity, no guessed defaults, API permissions/caching, and the existing reminder-time coverage. Frontend production build passed; lint has no errors and the five previously recorded effect warnings. Existing map bundle size advisory remains.
- Live no-URL lookup for The Beekman returned 16:00 check-in and 11:00 check-out from https://www.thebeekman.com/faq/. This verifies that hotel's actual path, not every hotel's coverage.
- Browser verification used the real Editor and authenticated API in a temporary unsaved hotel fixture: the no-website action filled 16:00 / 11:00, showed the actual FAQ source and retrieval time, and updated the bold red reminder. No hotel coordinate or website input appeared. Save was disabled in the fixture; no user trip data was changed. The fixture and temporary browser tab were removed afterward.

## Trip deletion entry and city selection — 2026-09-23

- Trip owners now have a visible `Delete trip` button in the trip header, opening the existing confirmation dialog with the exact trip name and deletion scope. The People tab uses the same action. Cancellation leaves the trip intact; the backend still enforces ownership and the current trip version.
- New trip and trip settings forms offer a debounced English city search via Open-Meteo / GeoNames, showing county/state/country and time zone to disambiguate names. New or changed destinations must be selected from results. Choosing a city fills its IANA zone instead of using the browser's zone; the backend revalidates the city ID and derives the canonical destination and zone. Search failures do not guess a zone.
- Selected city ID, label, coordinates and zone are persisted in the existing JSON trip state, with no database schema migration. Empty-trip maps use the selected coordinates. Local place search checks the matching country's city result against the selected coordinates before using its bounding box. Legacy destinations remain compatible and can be reselected in Trip settings to update their zone; existing local activity clock times are retained.
- City source responses are cached for 24 hours and uncached calls are rate limited; frontend lookup waits 700 ms after typing and ignores obsolete responses. The public endpoint requires no key for this noncommercial local project. Commercial deployment requires checking Open-Meteo licensing and access requirements. `CITY_GEOCODING_URL` can configure an alternative compatible endpoint.
- All 61 existing backend tests and 7 additional focused tests passed using temporary SQLite. The new cases cover invalid zone/coordinates, cache reuse, provider failure, server-side timezone correction, legacy-trip reselection, concurrent update rejection, foreign city exclusion and owner/version checks for deletion. Frontend production build passed, with existing lint effect warnings and map bundle advisory unchanged.
- Live provider checks: Chicago in Illinois returned America/Chicago; Paris results distinguished France (Europe/Paris), Texas (America/Chicago), and other US locations. Chicago's full selected label also resolved to the correct OpenStreetMap city bounds.
- Browser verified the new header deletion dialog and cancelled it; the existing trip remained present. In the real New trip form, entering Paris produced separate France/Texas/etc. choices, and selecting Paris in Texas immediately populated America/Chicago. The form was cancelled without saving. No user trips were created, changed or deleted for this verification.

## Dated overlap warnings and outbound / return travel — 2026-09-23

- Overlap results now contain each event's start/end instants, the actual overlapping interval, affected trip-local dates and the display time zone. The itinerary shows only warnings relevant to the selected day; hotel warnings with no single date remain visible. Nested overlaps are detected and touching end/start boundaries are allowed.
- A new `Travel` tab separates `Getting there` and `Heading home`. Members with edit access can add/edit/delete flight, driving, train, bus, ferry or other travel legs. Records include endpoint cities and optional airports/stations/addresses, departure/arrival dates and local times, independent IANA time zones, carrier, service number, booking reference/link and notes. City selection reuses automatic zone lookup; return travel can prefill the original home city from saved outbound travel.
- UTC comparisons validate actual arrival after departure, overnight/international-date-line travel and DST ambiguity/nonexistence. Travel duration is calculated from instants. Travel cards retain both endpoint-local dates/zones; matching itinerary days use the trip's zone. Travel outside the trip's day range remains available in the Travel tab.
- Travel is persisted in the existing JSON trip state with legacy trips defaulting to an empty list, using the same membership permissions, version-checked writes, durable change log and WebSocket notifications as activities. Overlaps between travel and activities (or two travel legs) are reported. Existing proposal application validation also rejects activities that overlap saved travel; transport records are not modified by activity proposals.
- This feature records user-entered booked/planned journeys. It does not query live flight status/fares, calculate driving routes or add travel-specific reminders. Existing activity and hotel reminder behavior is unchanged.
- All 83 backend tests passed in isolated temporary SQLite. New cases cover CRUD/duration/reconnect metadata, stale writes, viewer/stranger access, legacy records, overnight/date-line clocks, invalid DST/zone/time values, unsafe links, dated overlap intervals and proposal rejection. Frontend TypeScript/production build passed; lint retains only the five existing effect warnings and the map bundle size advisory.
- Browser verified actual Sep 23 activity warnings include event dates/times, overlap period and America/Chicago, and disappear when switching to Sep 24. Travel tab, outbound/return defaults, Driving mode and Boston city selection (America/New_York) were checked without saving into user trips. A temporary visual fixture checked a Boston–Chicago flight's two local clocks, 2h45m duration and flight/activity conflict; fixture and agent browser tab were removed afterward.
