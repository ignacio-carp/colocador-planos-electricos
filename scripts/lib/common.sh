#!/usr/bin/env bash
# Shared helpers for repo scripts. Source from other scripts, do not execute directly.

set -euo pipefail

repo_root() {
  local dir
  dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  printf '%s' "$dir"
}

load_root_env() {
  local root env_file
  root="$(repo_root)"
  env_file="$root/.env"
  if [[ ! -f "$env_file" ]]; then
    echo "Missing $env_file — copy from .env.example and fill Supabase keys." >&2
    return 1
  fi
  set -a
  # shellcheck disable=SC1090
  source "$env_file"
  set +a
}

supabase_project_ref_from_url() {
  local url="$1"
  if [[ "$url" =~ https://([a-z0-9]+)\.supabase\.co ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
    return 0
  fi
  return 1
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Required command not found: $cmd" >&2
    return 1
  fi
}
