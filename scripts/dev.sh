#!/usr/bin/env bash
# Local dev: Supabase CLI login, sync .env to apps, optional link, then API + web.
#
# Usage:
#   ./scripts/dev.sh              # full flow + start servers
#   ./scripts/dev.sh --setup-only # login, sync env, link — no npm dev
#   ./scripts/dev.sh --no-supabase # skip CLI login/link (only sync + dev)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/common.sh
source "$ROOT/scripts/lib/common.sh"

SETUP_ONLY=false
SKIP_SUPABASE=false

for arg in "$@"; do
  case "$arg" in
    --setup-only) SETUP_ONLY=true ;;
    --no-supabase) SKIP_SUPABASE=true ;;
    -h | --help)
      sed -n '2,8p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

ensure_supabase_config() {
  if [[ -f "$ROOT/supabase/config.toml" ]]; then
    return 0
  fi
  echo "Initializing Supabase project config (keeps existing migrations)…"
  require_cmd supabase
  (cd "$ROOT" && supabase init)
}

link_supabase_project() {
  local ref linked_ref_file
  load_root_env
  ref="$(supabase_project_ref_from_url "${SUPABASE_URL:-}")" || {
    echo "Could not parse project ref from SUPABASE_URL in .env" >&2
    return 1
  }

  linked_ref_file="$ROOT/supabase/.temp/project-ref"
  if [[ -f "$linked_ref_file" ]] && [[ "$(tr -d '[:space:]' <"$linked_ref_file")" == "$ref" ]]; then
    echo "Supabase project already linked ($ref)."
    return 0
  fi

  echo "Linking Supabase project $ref…"
  (cd "$ROOT" && supabase link --project-ref "$ref" --yes)
}

start_dev_servers() {
  echo ""
  echo "Starting API (3001) and web (5173). Ctrl+C stops both."
  echo ""

  cleanup() {
    local pids
    pids=$(jobs -p 2>/dev/null || true)
    if [[ -n "$pids" ]]; then
      kill $pids 2>/dev/null || true
    fi
  }
  trap cleanup EXIT INT TERM

  (cd "$ROOT" && npm run dev:api) &
  (cd "$ROOT" && npm run dev:web) &
  wait
}

main() {
  require_cmd node
  require_cmd npm

  if [[ "$SKIP_SUPABASE" == false ]]; then
    require_cmd supabase
    "$ROOT/scripts/supabase-login.sh"
    ensure_supabase_config
    link_supabase_project || echo "Warning: supabase link failed (migrations may still be applied via Dashboard)." >&2
  fi

  "$ROOT/scripts/sync-dev-env.sh"

  if [[ ! -d "$ROOT/node_modules" ]]; then
    echo "Installing npm dependencies…"
    (cd "$ROOT" && npm install)
  fi

  if [[ "$SETUP_ONLY" == true ]]; then
    echo "Setup complete (--setup-only)."
    exit 0
  fi

  start_dev_servers
}

main "$@"
