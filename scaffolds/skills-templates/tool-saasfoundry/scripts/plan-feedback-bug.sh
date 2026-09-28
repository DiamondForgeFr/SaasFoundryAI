#!/usr/bin/env bash
set -euo pipefail

# Reads a detection event from stdin (or crafts one from a user-initiated
# intent) and pipes it to plan-feedback-bug.js which classifies the label
# (cli-bug vs scaffold-bug), redacts credentials from any stderr excerpt, and
# emits the `sf feedback bug` command the skill can speak from.
#
# Usage:
#   cat <<EOF | scripts/plan-feedback-bug.sh
#   {
#     "source": "cli-invocation",
#     "title": "sf new crashes on empty project name",
#     "description": "Reproducing the failure for triage.",
#     "command": "sf new --non-interactive --name=\"\"",
#     "exitCode": 1,
#     "stderr": "Error: project name required\nat ... token=ghp_abc",
#     "userConfirmed": true
#   }
#   EOF
#
# Env overrides (useful for skill orchestration and tests):
#   SF_CLI — command token for the saasfoundry CLI (default: sf)
#            Not used by this script directly — kept for parity with sibling
#            plan-*.sh dispatchers, and reserved for future surface checks.
#
# Exit codes:
#   0 — success
#   1 — internal error (node missing)
#   2 — invalid input (empty/malformed stdin, unknown source, missing title)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "plan-feedback-bug.sh: node is required" >&2
  exit 1
fi

if [ -t 0 ]; then
  echo "plan-feedback-bug.sh: detection event must be piped on stdin" >&2
  exit 2
fi

stdin_payload=$(cat)
if [ -z "${stdin_payload}" ]; then
  echo "plan-feedback-bug.sh: empty input on stdin" >&2
  exit 2
fi

printf '%s' "${stdin_payload}" | node "${SCRIPT_DIR}/plan-feedback-bug.js"
