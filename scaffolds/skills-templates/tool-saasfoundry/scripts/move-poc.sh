#!/usr/bin/env bash
set -euo pipefail

# Files an existing POC away into POC/, so a SaaSFoundryAI project can be scaffolded
# alongside it rather than on top of it.
#
# The POC is normally local-only and never pushed: the folder is the only copy of that
# work. So this script is built to be impossible to regret —
#
#   * it refuses to run without --confirm, and prints the plan instead
#   * it never deletes and never overwrites (mv -n throughout)
#   * it verifies the resulting tree against the plan it printed, entry for entry
#   * it tells you how to reverse the move, every time it succeeds
#
# Usage:
#   move-poc.sh <directory> [--destination <name>] [--confirm]
#
# Without --confirm it is a dry run: the plan goes to stdout and nothing moves.
#
# Exit codes:
#   0 — the move completed and the result matches the plan
#   1 — internal error, or the move completed only partially (message says what to do)
#   2 — refused on purpose: no --confirm, or the plan itself refuses (message says why)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

POC_DIR=""
DESTINATION="POC"
CONFIRMED=0

while [ $# -gt 0 ]; do
  case "$1" in
    --confirm) CONFIRMED=1; shift ;;
    --destination) DESTINATION="${2:-}"; shift 2 ;;
    --destination=*) DESTINATION="${1#--destination=}"; shift ;;
    -*) echo "move-poc.sh: unknown flag $1" >&2; exit 2 ;;
    *) POC_DIR="$1"; shift ;;
  esac
done

if ! command -v node >/dev/null 2>&1; then
  echo "move-poc.sh: node is required" >&2
  exit 1
fi

POC_DIR="${POC_DIR:-${SF_POC_DIR:-.}}"
if [ ! -d "${POC_DIR}" ]; then
  echo "move-poc.sh: no such directory: ${POC_DIR}" >&2
  exit 2
fi
if [ -z "${DESTINATION}" ]; then
  echo "move-poc.sh: --destination requires a name" >&2
  exit 2
fi

ROOT="$(cd "${POC_DIR}" && pwd)"

# Build the plan from the same two scripts the skill uses, so what is executed here is
# exactly what was shown to the user — never a second, silently different computation.
REPORT="$(node "${SCRIPT_DIR}/read-poc.js" "${ROOT}")"

PLAN=""
PLAN_STATUS=0
PLAN="$(printf '%s' "{\"report\": ${REPORT}, \"destination\": \"${DESTINATION}\"}" | node "${SCRIPT_DIR}/plan-poc-move.js")" || PLAN_STATUS=$?

# ── render the plan ─────────────────────────────────────────────────────────────────

node -e '
const plan = JSON.parse(process.argv[1])
const out = []
out.push("")
out.push("POC intake plan for " + plan.root)
out.push("")
for (const w of plan.warnings) out.push("  note: " + w)
if (plan.warnings.length) out.push("")
if (plan.refused) {
  out.push("  REFUSED — nothing has been moved:")
  for (const r of plan.refusals) out.push("    - " + r)
  out.push("")
} else {
  out.push("  " + plan.entriesMoved + " top-level entr" + (plan.entriesMoved === 1 ? "y" : "ies") + " move into " + plan.destination + "/ :")
  for (const m of plan.moves) out.push("    " + m.from + (m.type === "dir" ? "/" : "") + "  ->  " + m.to)
  out.push("")
  out.push("  Afterwards this folder holds exactly: " + plan.resultingTree.join(", "))
  out.push("")
}
process.stdout.write(out.join("\n") + "\n")
' "${PLAN}"

if [ "${PLAN_STATUS}" -ne 0 ]; then
  echo "move-poc.sh: the plan refuses this move — nothing was moved." >&2
  exit 2
fi

if [ "${CONFIRMED}" -ne 1 ]; then
  echo "  Nothing has been moved. Re-run with --confirm to carry out this plan." >&2
  exit 2
fi

# ── execute ─────────────────────────────────────────────────────────────────────────

DEST_PATH="${ROOT}/${DESTINATION}"
mkdir "${DEST_PATH}"

MOVE_FAILURES=0
while IFS= read -r -d '' entry; do
  [ -z "${entry}" ] && continue
  # -n never overwrites. The destination was just created empty, so a collision here means
  # something changed under us; failing loudly beats clobbering the only copy.
  if ! mv -n -- "${ROOT}/${entry}" "${DEST_PATH}/" 2>/dev/null; then
    echo "move-poc.sh: could not move '${entry}'" >&2
    MOVE_FAILURES=$((MOVE_FAILURES + 1))
  fi
done < <(node -e '
const plan = JSON.parse(process.argv[1])
// NUL-separated: entry names may contain spaces, and a POC folder is exactly the kind of
// place where "my notes.md" lives.
for (const m of plan.moves) process.stdout.write(m.from + "\0")
' "${PLAN}")

# ── verify ──────────────────────────────────────────────────────────────────────────
#
# A partial move is the dangerous outcome: half the POC in place, half filed away, and an
# exit 0 telling the user it went fine. So the result is compared against the plan rather
# than assumed from the absence of errors.

VERIFY_STATUS=0
node -e '
const fs = require("fs")
const path = require("path")
const plan = JSON.parse(process.argv[1])
const expected = plan.moves.map((m) => m.from).sort()
const rootNow = fs.readdirSync(plan.root).sort()
const destNow = fs.readdirSync(path.join(plan.root, plan.destination)).sort()

const strays = rootNow.filter((e) => e !== plan.destination)
const missing = expected.filter((e) => !destNow.includes(e))

if (strays.length === 0 && missing.length === 0) {
  process.stdout.write("  ✓ moved " + expected.length + " entr" + (expected.length === 1 ? "y" : "ies") + " into " + plan.destination + "/ — the result matches the plan\n")
  process.stdout.write("  To reverse: move everything back out of " + plan.destination + "/ and remove the empty directory.\n\n")
  process.exit(0)
}
process.stderr.write("  ✗ the result does NOT match the plan — the move is incomplete:\n")
if (strays.length) process.stderr.write("      still in place: " + strays.join(", ") + "\n")
if (missing.length) process.stderr.write("      did not arrive:  " + missing.join(", ") + "\n")
process.stderr.write("  Nothing was deleted. Move the entries above by hand, or move everything back out of " + plan.destination + "/ to undo.\n")
process.exit(1)
' "${PLAN}" || VERIFY_STATUS=$?

if [ "${MOVE_FAILURES}" -gt 0 ] || [ "${VERIFY_STATUS}" -ne 0 ]; then
  exit 1
fi

exit 0
