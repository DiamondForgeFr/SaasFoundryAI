#!/usr/bin/env bash
set -euo pipefail

# Gathers what the board and the SRS already say, and asks plan-milestone.js whether a
# release scope can be proposed from it. Reads only; creates nothing.
#
# Usage:
#   plan-milestone.sh                     gather from the board, then propose
#   plan-milestone.sh --stdin             take an already-composed payload on stdin
#   plan-milestone.sh --srs-versions <f>  add SRS version pages from a JSON file
#   plan-milestone.sh --version-named <t> the user just named a version out loud, so the
#                                         ticket-count threshold does not apply
#
# PROPOSAL SHAPE (stdout, JSON):
#   {
#     shouldPropose: boolean   whether this is worth interrupting the user for
#     trigger:       why it is (null when it is not)
#     reason:        why it is not (null when it is)
#     candidates:    [{ source, name, rationale, evidence, tickets, openCount, doneCount }]
#                    source   — epic | srs-version | unaffiliated
#                    name     — always null: the script never invents a release number
#                    evidence — what the grouping rests on; a candidate without it is not emitted
#     cap/considered/dropped   the bound, and what did not fit
#     counts, notes
#   }
#
# Exit codes:
#   0 — emitted (shouldPropose:false is a finding, not an error)
#   1 — internal error (node/gh/jq missing, board unreadable)
#   2 — invalid input

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

FROM_STDIN=0
SRS_VERSIONS_FILE=""
VERSION_NAMED=""
while [ $# -gt 0 ]; do
  case "$1" in
    --stdin) FROM_STDIN=1; shift ;;
    --srs-versions) SRS_VERSIONS_FILE="${2:-}"; shift 2 ;;
    --version-named) VERSION_NAMED="${2:-}"; shift 2 ;;
    *) echo "plan-milestone.sh: unknown flag $1" >&2; exit 2 ;;
  esac
done

for tool in node jq; do
  command -v "$tool" >/dev/null 2>&1 || { echo "plan-milestone.sh: $tool is required" >&2; exit 1; }
done

if [ "$FROM_STDIN" -eq 1 ]; then
  exec node "${SCRIPT_DIR}/plan-milestone.js"
fi

command -v gh >/dev/null 2>&1 || { echo "plan-milestone.sh: gh is required to read the board (or pass --stdin)" >&2; exit 1; }
[ -f ".saasfoundry.json" ] || { echo "plan-milestone.sh: .saasfoundry.json not found — run from the project root" >&2; exit 1; }

PROJECT_URL=$(jq -r '.workflow.projectUrl // empty' .saasfoundry.json)
[ -z "$PROJECT_URL" ] && { echo "plan-milestone.sh: no workflow.projectUrl in the manifest" >&2; exit 1; }
PROJECT_OWNER=$(printf '%s' "$PROJECT_URL" | sed -E 's#.*/(orgs|users)/([^/]+)/projects/.*#\2#')
PROJECT_NUMBER=$(printf '%s' "$PROJECT_URL" | sed -E 's#.*/projects/([0-9]+).*#\1#')
REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')

# The board: number, title, status.
#
# The limit is finite, so it has to say when it bites. At 400 this silently dropped 10 of
# this project's 410 items — and with them two children of #482, which made the release
# Epic look like 14 tickets instead of 16. A cap that trims without saying so produces a
# confidently wrong answer, which is worse than an obviously incomplete one.
BOARD_LIMIT=1000
ITEMS=$(gh project item-list "$PROJECT_NUMBER" --owner "$PROJECT_OWNER" --format json --limit "$BOARD_LIMIT" 2>/dev/null || echo '{"items":[]}')
BOARD_COUNT=$(printf '%s' "$ITEMS" | jq '.items | length' 2>/dev/null || echo 0)
BOARD_TRUNCATED=false
[ "$BOARD_COUNT" -ge "$BOARD_LIMIT" ] && BOARD_TRUNCATED=true

MILESTONES=$(gh api "repos/${REPO}/milestones?state=all&per_page=100" 2>/dev/null || echo '[]')

# Which tickets already carry a milestone. One call, not one per ticket.
ASSIGNED=$(gh api "repos/${REPO}/issues?state=all&per_page=100" 2>/dev/null || echo '[]')

# Sub-issue relationships, for open Epics only. That is a handful of queries rather than
# one per ticket, and an Epic is the only grouping the board can vouch for.
EPIC_NUMBERS=$(printf '%s' "$ITEMS" | jq -r '.items[]? | select((.content.title // "") | test("^\\[EPIC\\]")) | select((.status // "") != "Done") | .content.number' 2>/dev/null || true)

PARENTS="[]"
for epic in $EPIC_NUMBERS; do
  children=$(gh api graphql -f query="query{repository(owner:\"${REPO%%/*}\",name:\"${REPO##*/}\"){issue(number:${epic}){subIssues(first:50){nodes{number}}}}}" \
    --jq "[.data.repository.issue.subIssues.nodes[]? | {number: .number, parent: ${epic}}]" 2>/dev/null || echo '[]')
  PARENTS=$(printf '%s\n%s' "$PARENTS" "$children" | jq -s 'add')
done

# The versions the product has already declared.
#
# This used to wait for `--srs-versions <file>`, a flag with no caller anywhere in
# the repository — so the engine always ran with `[]` and reported, truthfully and
# uselessly, that nothing could be grouped by what the product declared. The
# `srs-version` source is ranked FIRST and owns the only trigger that ignores the
# ticket-count threshold, so leaving it empty disabled the best evidence available.
#
# It degrades, it never fails: no SRS module, no network, adapter error — all of
# them mean `[]` and a note saying so, exactly as before. A release proposal must
# not become an error because a remote page was slow.
SRS_VERSIONS='[]'
SRS_UNREACHABLE=false
if [ -n "$SRS_VERSIONS_FILE" ]; then
  [ -f "$SRS_VERSIONS_FILE" ] && SRS_VERSIONS=$(cat "$SRS_VERSIONS_FILE")
else
  SF_BIN=$(command -v sf || true)
  if [ -n "$SF_BIN" ] && [ "$(jq -r '.tools.srs.enabled // false' .saasfoundry.json)" = "true" ]; then
    if versions_json=$("$SF_BIN" srs versions 2>/dev/null); then
      SRS_VERSIONS=$(printf '%s' "$versions_json" | jq -c '.versions // []' 2>/dev/null || echo '[]')
    else
      SRS_UNREACHABLE=true
    fi
  fi
fi

# Composed through files, not --argjson.
#
# A real board blows past ARG_MAX: passing the item list, the issue list and the
# milestones inline fails with "Argument list too long" — on this project's own board, at
# a few hundred items. No fixture is large enough to show that, so it surfaces the first
# time the script meets real data and never before.
WORK_DIR=$(mktemp -d)
cleanup_work_dir() {
  rm -f "${WORK_DIR}"/*.json 2>/dev/null || true
  rmdir "${WORK_DIR}" 2>/dev/null || true
}
trap cleanup_work_dir EXIT

printf '%s' "$ITEMS" > "${WORK_DIR}/items.json"
printf '%s' "$MILESTONES" > "${WORK_DIR}/milestones.json"
printf '%s' "$ASSIGNED" > "${WORK_DIR}/assigned.json"
printf '%s' "$PARENTS" > "${WORK_DIR}/parents.json"
printf '%s' "$SRS_VERSIONS" > "${WORK_DIR}/srs.json"

jq -n \
  --slurpfile items "${WORK_DIR}/items.json" \
  --slurpfile milestones "${WORK_DIR}/milestones.json" \
  --slurpfile assigned "${WORK_DIR}/assigned.json" \
  --slurpfile parents "${WORK_DIR}/parents.json" \
  --slurpfile srs "${WORK_DIR}/srs.json" \
  --arg truncated "$BOARD_TRUNCATED" \
  --arg limit "$BOARD_LIMIT" \
  --arg srsUnreachable "$SRS_UNREACHABLE" \
  --arg versionNamed "$VERSION_NAMED" \
  '
  ($assigned[0] | map(select(.milestone != null) | {key: (.number|tostring), value: .milestone.title}) | from_entries) as $ms
  | ($parents[0] | map({key: (.number|tostring), value: .parent}) | from_entries) as $par
  | {
      tickets: [ $items[0].items[]? | select(.content.number != null) | {
        number: .content.number,
        title: (.content.title // ""),
        status: (.status // ""),
        isEpic: ((.content.title // "") | test("^\\[EPIC\\]")),
        parent: ($par[(.content.number|tostring)] // null),
        milestone: ($ms[(.content.number|tostring)] // null)
      } ],
      milestones: [ $milestones[0][]? | {title: .title, state: .state, description: (.description // "")} ],
      srsVersions: $srs[0],
      srsUnreachable: ($srsUnreachable == "true"),
      versionNamed: (if $versionNamed == "" then null else $versionNamed end),
      boardTruncated: ($truncated == "true"),
      boardLimit: ($limit | tonumber)
    }
  ' | node "${SCRIPT_DIR}/plan-milestone.js"
