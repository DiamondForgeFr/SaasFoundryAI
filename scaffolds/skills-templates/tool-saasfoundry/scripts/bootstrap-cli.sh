#!/usr/bin/env bash
set -euo pipefail

# Resolves which invocation the tool-saasfoundry skill should use to
# run the `sf` CLI. Prints exactly one command token (or tokens) on
# stdout, terminated by a newline. Always exits 0 — the skill always
# has a fallback path via `npx`.
#
# Resolution order:
#   1. `sf` found on PATH            → prints: sf
#   2. `saasfoundry-cli` on PATH     → prints: saasfoundry-cli
#   3. neither available             → prints: npx saasfoundry-cli
#
# Intended usage from the skill:
#     SF_CMD=$(bash scripts/bootstrap-cli.sh)
#     $SF_CMD new --non-interactive ...

if command -v sf >/dev/null 2>&1; then
  echo sf
  exit 0
fi

if command -v saasfoundry-cli >/dev/null 2>&1; then
  echo saasfoundry-cli
  exit 0
fi

echo "npx saasfoundry-cli"
