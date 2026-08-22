#!/usr/bin/env bash
set -euo pipefail

# "Where are we in the zero-to-project flow?" — answered from state, never from the
# conversation. Run it at the start of any resumed session before asking the user anything.
#
# Gathers the local signals, calls `sf status --json` for the preconditions, and hands both
# to recap.js. Reads only; writes nothing.
#
# Usage:
#   recap.sh [directory] [--no-network]
#
# Env overrides:
#   SF_CLI — command token for the CLI (default: resolved via bootstrap-cli.sh)
#
# RECAP SHAPE (stdout, JSON):
#   {
#     current:  { phase, name, state, next }   the first phase not known to be done
#     phases:   [{ phase, name, state, exit, blockedBy }]
#               state — done | pending | unknown | not-applicable
#               blockedBy — the precondition gating it, with its own remediation
#     blockers: the phases at or after the current one whose precondition fails or warns
#     network:  whether the remote phases could be checked at all
#     notes:    what could not be determined, and why
#   }
#
# Exit codes:
#   0 — recap emitted
#   1 — internal error (node missing)
#   2 — invalid input (no such directory)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

WORKSPACE="."
NETWORK=1
while [ $# -gt 0 ]; do
  case "$1" in
    --no-network) NETWORK=0; shift ;;
    -*) echo "recap.sh: unknown flag $1" >&2; exit 2 ;;
    *) WORKSPACE="$1"; shift ;;
  esac
done

if ! command -v node >/dev/null 2>&1; then
  echo "recap.sh: node is required" >&2
  exit 1
fi
if [ ! -d "${WORKSPACE}" ]; then
  echo "recap.sh: no such directory: ${WORKSPACE}" >&2
  exit 2
fi

ROOT="$(cd "${WORKSPACE}" && pwd)"
SF_CMD="${SF_CLI:-$(bash "${SCRIPT_DIR}/bootstrap-cli.sh")}"

# ── local signals ───────────────────────────────────────────────────────────────────
#
# The flow is walked from a workspace folder that ends up holding POC/ and the project
# side by side, so the manifest is looked for in the current directory AND one level down.
# A user who resumes from inside the project is as likely as one who resumes from beside it.

POC_FILED=false
[ -d "${ROOT}/POC" ] && POC_FILED=true

INTAKE_ENTRIES=null
if [ -f "${ROOT}/intake.json" ]; then
  INTAKE_ENTRIES=$(node -e '
    const fs = require("fs")
    try {
      const record = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
      process.stdout.write(String(Array.isArray(record.entries) ? record.entries.length : 0))
    } catch {
      process.stdout.write("0")   // an unreadable record is not a completed challenge
    }
  ' "${ROOT}/intake.json")
fi

MANIFEST_PATH=null
if [ -f "${ROOT}/.saasfoundry.json" ]; then
  MANIFEST_PATH="\"${ROOT}/.saasfoundry.json\""
else
  for candidate in "${ROOT}"/*/.saasfoundry.json; do
    if [ -f "${candidate}" ]; then
      MANIFEST_PATH="\"${candidate}\""
      break
    fi
  done
fi

# ── preconditions, from the CLI rather than re-derived here ─────────────────────────

STATUS_JSON=null
STATUS_DIR="${ROOT}"
if [ "${MANIFEST_PATH}" != "null" ]; then
  STATUS_DIR="$(dirname "$(printf '%s' "${MANIFEST_PATH}" | tr -d '"')")"
fi
if [ -d "${STATUS_DIR}" ]; then
  NETWORK_FLAG=""
  [ "${NETWORK}" -eq 0 ] && NETWORK_FLAG="--no-network"
  # `sf status --json` exits 1 as soon as any precondition FAILS — and that is the case
  # this recap most needs, since a missing manifest is what routes the user to the install
  # path. So the exit code is deliberately ignored and the payload is judged on whether it
  # parses. A CLI that is absent or truly broken degrades the recap; it never aborts it,
  # because "I could not check" is a useful answer and "command failed" is not.
  candidate_status=$(cd "${STATUS_DIR}" && ${SF_CMD} status --json ${NETWORK_FLAG} 2>/dev/null) || true
  if [ -n "${candidate_status}" ] && printf '%s' "${candidate_status}" | node -e 'JSON.parse(require("fs").readFileSync(0,"utf8"))' >/dev/null 2>&1; then
    STATUS_JSON="${candidate_status}"
  fi
fi

# srsPages and boardTickets are left null for now: reading them means talking to the
# backend and the board, which the skill does through their own CLIs. null means "not
# checked", which recap.js reports as unknown rather than as undone.
printf '%s' "{
  \"status\": ${STATUS_JSON},
  \"network\": $([ "${NETWORK}" -eq 1 ] && echo true || echo false),
  \"signals\": {
    \"pocFiled\": ${POC_FILED},
    \"intakeEntries\": ${INTAKE_ENTRIES},
    \"manifestPath\": ${MANIFEST_PATH},
    \"srsPages\": null,
    \"boardTickets\": null
  }
}" | node "${SCRIPT_DIR}/recap.js"
