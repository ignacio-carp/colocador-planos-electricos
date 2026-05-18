#!/usr/bin/env bash
# Authenticate Supabase CLI using a personal access token (never commit the token file).
#
# Setup once:
#   cp .supabase/access-token.example .supabase/access-token
#   # paste token from https://supabase.com/dashboard/account/tokens
#
# Or: SUPABASE_ACCESS_TOKEN=sbp_... ./scripts/supabase-login.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOKEN_FILE="$ROOT/.supabase/access-token"

require_supabase() {
  if ! command -v supabase >/dev/null 2>&1; then
    echo "Install Supabase CLI: https://supabase.com/docs/guides/cli/getting-started" >&2
    exit 1
  fi
}

read_token() {
  if [[ -n "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
    printf '%s' "$SUPABASE_ACCESS_TOKEN"
    return 0
  fi
  if [[ -f "$TOKEN_FILE" ]]; then
    tr -d '[:space:]' <"$TOKEN_FILE"
    return 0
  fi
  echo "No Supabase access token found." >&2
  echo "  Create $TOKEN_FILE (see .supabase/access-token.example)" >&2
  echo "  Or export SUPABASE_ACCESS_TOKEN and run again." >&2
  exit 1
}

main() {
  require_supabase
  local token
  token="$(read_token)"
  if [[ -z "$token" ]]; then
    echo "Token file is empty: $TOKEN_FILE" >&2
    exit 1
  fi

  echo "Logging in to Supabase CLI (profile: supabase)…"
  supabase login --no-browser --token "$token"
  echo "OK — run: supabase projects list"
}

main "$@"
