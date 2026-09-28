#!/usr/bin/env bash
set -euo pipefail

# Reads a feedback-request scorecard from stdin, enriches it with the list
# of open module-request issues (via `sf feedback list`), and pipes the
# consolidated payload to plan-feedback-request.js which classifies the
# decision (file-request / route-to-existing / refuse) the skill speaks from.
#
# Usage:
#   cat <<EOF | scripts/plan-feedback-request.sh
#   {
#     "intent": "real-time chat between project members",
#     "name": "chat",
#     "description": "first-party chat module with presence and history",
#     "scorecard": {
#       "scopeFit": "yes",
#       "reusability": "yes",
#       "notAlreadySolvable": "yes",
#       "opinionOwnership": "yes",
#       "maintenanceRealism": "yes"
#     }
#   }
#   EOF
#
# Env overrides (useful for skill orchestration and tests):
#   SF_CLI — command token for the saasfoundry CLI (default: sf)
#            e.g. "sf", "saasfoundryai-cli", or "npx saasfoundryai-cli"
#
# Exit codes:
#   0 — success
#   1 — internal error (node missing, CLI invocation failed hard)
#   2 — invalid input (empty/malformed scorecard)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SF_CLI_CMD="${SF_CLI:-sf}"

if ! command -v node >/dev/null 2>&1; then
  echo "plan-feedback-request.sh: node is required" >&2
  exit 1
fi

if [ -t 0 ]; then
  echo "plan-feedback-request.sh: scorecard must be piped on stdin" >&2
  exit 2
fi

stdin_payload=$(cat)
if [ -z "${stdin_payload}" ]; then
  echo "plan-feedback-request.sh: empty input on stdin" >&2
  exit 2
fi

# Fetch open module-request issues for dedup. If the CLI fails, fall back to
# an empty list so the classifier still emits a decision rather than crashing.
existing_json='[]'
if raw_list=$(${SF_CLI_CMD} feedback list --status open --json --limit 100 2>/dev/null); then
  existing_json=$(printf '%s' "${raw_list}" | node -e "
    let r='';
    process.stdin.on('data', c => r += c);
    process.stdin.on('end', () => {
      try {
        const arr = JSON.parse(r);
        const filtered = Array.isArray(arr)
          ? arr.filter(i => i && i.kind === 'module-request')
          : [];
        process.stdout.write(JSON.stringify(filtered));
      } catch {
        process.stdout.write('[]');
      }
    });
  ")
else
  echo "plan-feedback-request.sh: '${SF_CLI_CMD} feedback list' failed — skipping dedup" >&2
fi

# Merge the user scorecard with existingIssues and pipe to the classifier.
export SF_EXISTING_ISSUES="${existing_json}"
printf '%s' "${stdin_payload}" | node -e "
  let r='';
  process.stdin.on('data', c => r += c);
  process.stdin.on('end', () => {
    let input;
    try { input = JSON.parse(r); }
    catch (err) {
      process.stderr.write('plan-feedback-request.sh: invalid JSON on stdin: ' + err.message + '\n');
      process.exit(2);
    }
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      process.stderr.write('plan-feedback-request.sh: input must be a JSON object\n');
      process.exit(2);
    }
    const existing = JSON.parse(process.env.SF_EXISTING_ISSUES || '[]');
    input.existingIssues = Array.isArray(input.existingIssues) && input.existingIssues.length > 0
      ? input.existingIssues
      : existing;
    process.stdout.write(JSON.stringify(input));
  });
" | node "${SCRIPT_DIR}/plan-feedback-request.js"
