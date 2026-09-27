# TripBoard frontend

React 19 + TypeScript + Vite frontend for TripBoard. See the [project README](../README.md) for features, full local setup, optional integrations, collaboration, and the file guide.

## Development

From the project root, run `bash scripts/dev.sh` to start the frontend together with the API, reminder worker, PostgreSQL, and Redis. Open http://127.0.0.1:5176/.

If the backend and other required services are already running separately, start only the frontend from this directory:

```bash
npm ci
npm run dev
```

The Vite configuration proxies `/api` and WebSockets to `http://127.0.0.1:8001` by default. Set `TRIPBOARD_API_TARGET` to change that target. Starting another frontend while port 5176 is occupied fails deliberately.

## Checks

```bash
npm test
npm run lint
npm run build
```

Build output is written to `dist/`. The optional container serves it with Nginx and an API proxy. `npm run preview` previews the built frontend; it does not start the backend, worker, or databases. The container API/WebSocket proxy is defined in `nginx.conf`.

## Current map

The current local setup uses **MapLibre GL JS + OpenFreeMap**, with OpenStreetMap data. Address/place search uses **Nominatim**. Google Maps is not currently enabled because no browser API key is configured.

## Optional future setup: Google Maps

The Google Maps renderer is already implemented and can be enabled later with a valid browser API key. This changes map rendering; address/place search continues to use Nominatim.

Copy `.env.example` to `.env.local` without overwriting existing configuration and set a restricted browser key. Restart Vite after changes; rebuild the frontend for a production deployment. The project README describes the fallback and provider boundaries. Never put an OpenAI server key in a frontend environment variable.

## Code orientation

Start with `src/App.tsx`, `src/api.ts`, and `src/useTrip.ts`. Feature components are in `src/components/`; map planning is in `src/mapPlan.ts`; language switching is handled by `src/i18n.ts`, `src/translations.ts`, and `src/useLanguage.ts`. Important logic has English comments.
