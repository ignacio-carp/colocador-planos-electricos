#!/usr/bin/env bash
# Run the cad-worker HTTP server locally (FastAPI + uvicorn).
#
# Usage:
#   ./scripts/run-cad-worker.sh              # http://127.0.0.1:8000
#   PORT=9000 ./scripts/run-cad-worker.sh    # custom port
#   ./scripts/run-cad-worker.sh --reload     # auto-reload on code changes
#
# To wire the API to this server, set in apps/api/.env (or root .env synced by dev.sh):
#   CAD_WORKER_URL=http://127.0.0.1:8000
#
# The worker itself has no required secrets; optional env:
#   PORT   — listen port (default 8000)
#   HOST   — bind address (default 127.0.0.1; use 0.0.0.0 for LAN/docker)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CAD_DIR="$ROOT/services/cad-worker"
# shellcheck source=lib/common.sh
source "$ROOT/scripts/lib/common.sh"

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8000}"
RELOAD=false

for arg in "$@"; do
  case "$arg" in
    --reload) RELOAD=true ;;
    -h | --help)
      sed -n '2,15p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

require_cmd python3

VENV="$CAD_DIR/.venv"
if [[ ! -x "$VENV/bin/python" ]]; then
  echo "Creating virtualenv at services/cad-worker/.venv …"
  python3 -m venv "$VENV"
fi

echo "Installing cad-worker dependencies …"
"$VENV/bin/pip" install -q -r "$CAD_DIR/requirements.txt"
"$VENV/bin/pip" install -q -e "$CAD_DIR"

cd "$CAD_DIR"

UVICORN_ARGS=(cad_worker_server:app --host "$HOST" --port "$PORT")
if [[ "$RELOAD" == true ]]; then
  UVICORN_ARGS+=(--reload)
fi

echo ""
echo "cad-worker listening on http://${HOST}:${PORT}"
echo "  GET  /healthz"
echo "  POST /inspect            (multipart: file)"
echo "  POST /extract-geometry   (multipart: file)"
echo "  POST /apply-electrical-layer (multipart: file, placements_json)"
echo ""
echo "API integration: CAD_WORKER_URL=http://${HOST}:${PORT} in apps/api/.env"
echo ""

exec "$VENV/bin/uvicorn" "${UVICORN_ARGS[@]}"
