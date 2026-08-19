#!/usr/bin/env bash
set -euo pipefail

# Reads a user intent (either as $1 or from stdin JSON {"intent": "..."}),
# invokes `sf modules match "<intent>" --json`, and pipes a consolidated
# payload to check-catalogue.js which classifies the match into a tier
# (HIGH / MEDIUM / LOW / NONE) the skill can speak from.
#
# Usage:
#   echo '{"intent":"send transactional emails"}' | scripts/check-catalogue.sh
#   scripts/check-catalogue.sh "send transactional emails"
#
# Env overrides (useful for skill orchestration and tests):
#   SF_CLI — command token for the saasfoundry CLI (default: sf)
#            e.g. "sf", "saasfoundryai-cli", or "npx saasfoundryai-cli"
#
# Exit codes:
#   0 — success
#   1 — internal error (node missing, CLI invocation failed)
#   2 — invalid input (empty/malformed intent)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SF_CLI_CMD="${SF_CLI:-sf}"

if ! command -v node >/dev/null 2>&1; then
  echo "check-catalogue.sh: node is required" >&2
  exit 1
fi

# Resolve the intent: positional arg takes precedence over stdin.
intent=""
if [ "$#" -gt 0 ] && [ -n "$1" ]; then
  intent="$1"
elif [ ! -t 0 ]; then
  stdin_json=$(cat)
  if [ -n "${stdin_json}" ]; then
    intent=$(printf '%s' "${stdin_json}" | node -e "
      let raw='';
      process.stdin.on('data', c => raw += c);
      process.stdin.on('end', () => {
        try {
          const o = JSON.parse(raw);
          if (typeof o.intent === 'string' && o.intent.trim()) process.stdout.write(o.intent);
        } catch {}
      });
    ")
  fi
fi

if [ -z "${intent}" ]; then
  echo "check-catalogue.sh: intent is required (pass as arg or stdin JSON {\"intent\":\"...\"})" >&2
  exit 2
fi

# Call the CLI. If it fails, fall back to an empty results array so the
# script still classifies (as NONE) rather than hard-crashing the skill.
match_json='{"cliVersion":"unknown","intent":"","results":[]}'
if ! match_json=$(${SF_CLI_CMD} modules match "${intent}" --json 2>/dev/null); then
  echo "check-catalogue.sh: '${SF_CLI_CMD} modules match' failed — classifying as NONE" >&2
  match_json='{"cliVersion":"unknown","intent":"'"${intent}"'","results":[]}'
fi

node "${SCRIPT_DIR}/check-catalogue.js" <<EOF
{
  "intent": $(printf '%s' "${intent}" | node -e "let r='';process.stdin.on('data',c=>r+=c);process.stdin.on('end',()=>process.stdout.write(JSON.stringify(r)))"),
  "match": ${match_json}
}
EOF
