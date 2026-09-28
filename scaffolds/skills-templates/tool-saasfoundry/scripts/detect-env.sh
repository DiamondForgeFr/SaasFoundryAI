#!/usr/bin/env bash
set -euo pipefail

# Emits a JSON object on stdout describing the local environment,
# so the tool-saasfoundry skill can decide whether to bootstrap
# GitHub auth or the `sf` CLI before running user-facing commands.
#
# Shape:
#   {
#     "os": "darwin" | "linux" | "windows" | "unknown",
#     "nodeVersion": "20.19.0" | null,
#     "ghInstalled": true | false,
#     "ghAuthed": true | false,
#     "sfGlobalInstalled": true | false
#   }
#
# Always exits 0 — the skill inspects the payload rather than the exit code.

detect_os() {
  case "$(uname -s 2>/dev/null || echo unknown)" in
    Darwin) echo darwin ;;
    Linux) echo linux ;;
    MINGW*|MSYS*|CYGWIN*) echo windows ;;
    *) echo unknown ;;
  esac
}

node_version() {
  if command -v node >/dev/null 2>&1; then
    node --version 2>/dev/null | sed 's/^v//'
  fi
}

gh_installed() {
  command -v gh >/dev/null 2>&1
}

gh_authed() {
  gh_installed && gh auth status >/dev/null 2>&1
}

sf_global_installed() {
  command -v sf >/dev/null 2>&1
}

json_bool() {
  if "$@"; then echo true; else echo false; fi
}

json_string_or_null() {
  local value="$1"
  if [ -z "$value" ]; then
    echo null
  else
    echo "\"$value\""
  fi
}

os=$(detect_os)
node_ver=$(node_version || true)
gh_inst=$(json_bool gh_installed)
gh_auth=$(json_bool gh_authed)
sf_inst=$(json_bool sf_global_installed)

cat <<EOF
{
  "os": "$os",
  "nodeVersion": $(json_string_or_null "$node_ver"),
  "ghInstalled": $gh_inst,
  "ghAuthed": $gh_auth,
  "sfGlobalInstalled": $sf_inst
}
EOF
