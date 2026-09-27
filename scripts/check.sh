#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Backend fixtures use an isolated test database, keeping local trips untouched.
PYTHONPATH=backend backend/.venv/bin/python -m pytest backend/tests -q
# Pure frontend tests cover map grouping and translations; lint and build check the complete source tree.
npm --prefix frontend test
npm --prefix frontend run lint
npm --prefix frontend run build
