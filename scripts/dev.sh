#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
backend_port="${TRIPBOARD_BACKEND_PORT:-8001}"
frontend_port="${TRIPBOARD_FRONTEND_PORT:-5176}"
# Refuse to start a second stack on the same ports, which can make the browser show stale code.
for port in "$backend_port" "$frontend_port"; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $port is already in use. Stop the existing TripBoard backend/frontend terminals with Ctrl+C, then run this script again."
    exit 1
  fi
done
# Wait for healthy shared services; named Docker volumes retain data between restarts.
docker compose up -d --wait db redis
if [ ! -x backend/.venv/bin/python ]; then
  echo 'Create backend/.venv and install backend/requirements.txt first. See README.md.'
  exit 1
fi
# Track only children started here. Ctrl+C must not terminate unrelated processes.
pids=()
cleanup() { for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
(cd backend && exec .venv/bin/python -m uvicorn main:app --reload --port "$backend_port") &
pids+=("$!")
# Start the reminder worker and frontend only after the API is listening.
ready=0
for attempt in {1..40}; do
  if curl --fail --silent --max-time 1 "http://127.0.0.1:$backend_port/api/health" >/dev/null; then ready=1; break; fi
  if ! kill -0 "${pids[0]}" 2>/dev/null; then echo "Backend stopped during startup."; exit 1; fi
  sleep 0.5
done
if [ "$ready" != 1 ]; then echo "Backend did not become ready. Check the log above."; exit 1; fi
(cd backend && exec .venv/bin/python -m app.worker) &
pids+=("$!")
(cd frontend && export TRIPBOARD_API_TARGET="http://127.0.0.1:$backend_port"; exec node node_modules/vite/bin/vite.js --host 127.0.0.1 --port "$frontend_port" --strictPort) &
pids+=("$!")
echo "TripBoard: http://127.0.0.1:$frontend_port | API docs: http://127.0.0.1:$backend_port/docs"
echo 'Ctrl+C stops this script’s app processes. PostgreSQL and Redis data remain in Docker volumes.'
# Fail visibly if one app process dies instead of leaving a partially working stack.
while true; do
  for pid in "${pids[@]}"; do
    if ! kill -0 "$pid" 2>/dev/null; then echo 'A TripBoard process stopped. Check the log above.'; exit 1; fi
  done
  sleep 2
done
