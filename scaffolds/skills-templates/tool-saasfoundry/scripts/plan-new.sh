#!/usr/bin/env bash
set -euo pipefail

# Thin wrapper around plan-new.js. Accepts the intent JSON on stdin,
# emits the equivalent `sf new --non-interactive ...` command on stdout.
# See plan-new.js for the translation logic and exit codes.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "plan-new.sh: node is required to parse JSON intent" >&2
  exit 1
fi

exec node "${SCRIPT_DIR}/plan-new.js"
