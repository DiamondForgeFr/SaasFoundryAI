#!/usr/bin/env bash
set -euo pipefail

# Validates the challenge conversation and writes the intake record the SRS step reads.
#
# Usage:
#   echo '{"seeds":[...],"answers":[...]}' | record-intake.sh [--out <path>]
#
# --out defaults to ./intake.json — the workspace folder, beside POC/, where the project
# will appear as a sibling. Nothing is overwritten: an existing file is refused.
#
# Exit codes:
#   0 — record written
#   1 — internal error (node missing, unwritable path)
#   2 — invalid input, an answer that references no seed, or the output file exists

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="./intake.json"

while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="${2:-}"; shift 2 ;;
    --out=*) OUT="${1#--out=}"; shift ;;
    -*) echo "record-intake.sh: unknown flag $1" >&2; exit 2 ;;
    *) echo "record-intake.sh: unexpected argument $1" >&2; exit 2 ;;
  esac
done

if ! command -v node >/dev/null 2>&1; then
  echo "record-intake.sh: node is required" >&2
  exit 1
fi

if [ -z "${OUT}" ]; then
  echo "record-intake.sh: --out requires a path" >&2
  exit 2
fi

# The intake record is the only written trace of a conversation that will not be had
# twice. Overwriting one silently would lose it.
if [ -e "${OUT}" ]; then
  echo "record-intake.sh: ${OUT} already exists — refusing to overwrite an intake record." >&2
  echo "record-intake.sh: pass --out <path> to write elsewhere, or move the existing file first." >&2
  exit 2
fi

RECORD="$(node "${SCRIPT_DIR}/record-intake.js")"

printf '%s\n' "${RECORD}" > "${OUT}"

node -e '
const record = JSON.parse(process.argv[1])
const out = []
out.push("")
out.push("  intake record written to " + process.argv[2])
out.push("    " + record.entries.length + " answer(s) recorded, each traced to an observation")
if (record.unanswered.length) out.push("    not answered: " + record.unanswered.join(", "))
for (const n of record.notes) out.push("    note: " + n)
out.push("")
process.stdout.write(out.join("\n") + "\n")
' "${RECORD}" "${OUT}"
