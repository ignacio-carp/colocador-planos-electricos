#!/usr/bin/env bash
# Verification harness del colocador determinístico:
# fixtures sintéticos → pipeline (extract → detect-rooms → place → draw)
# → validadores geométricos → reporte pass/fail. Offline, sin LLM, $0.
#
# Uso: npm run harness [-- --out-dir DIR --report FILE]
# Las rutas se resuelven desde el directorio de invocación (raíz del repo
# cuando se corre vía npm).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKER="$ROOT/services/cad-worker"
PY="$WORKER/.venv/bin/python"
if [ ! -x "$PY" ]; then
  PY="$(command -v python3)"
  export PYTHONPATH="$WORKER/src${PYTHONPATH:+:$PYTHONPATH}"
fi

exec "$PY" -m cad_worker.cli harness "$@"
