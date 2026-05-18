#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
npm test --workspace=api -- --test-name-pattern='golden pipeline harness'
if command -v python3 >/dev/null 2>&1; then
  cd services/cad-worker
  pip install -q -e ".[dev]" 2>/dev/null || pip install -e ".[dev]"
  pytest -q -k inspect
fi
echo "Golden pipeline harness OK"
