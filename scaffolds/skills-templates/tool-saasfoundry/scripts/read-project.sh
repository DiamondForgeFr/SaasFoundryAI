#!/usr/bin/env bash
set -euo pipefail

# Reads the canonical capability classification from `sf status --json`, then
# combines it with .saasfoundry.json and `sf modules list --json` in one
# read-only report via read-project.js.
#
# Env overrides (useful for skill orchestration and tests):
#   SF_MANIFEST_PATH — path to .saasfoundry.json (default: ./.saasfoundry.json)
#   SF_CLI           — command token for the saasfoundry CLI (default: sf)
#                      e.g. "sf", "saasfoundryai-cli", or "npx saasfoundryai-cli"
#
# Exit codes:
#   0 — success
#   1 — internal error (CLI invocation failed)
#   2 — invalid input (manifest missing / invalid)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST_PATH="${SF_MANIFEST_PATH:-./.saasfoundry.json}"
SF_CLI_CMD="${SF_CLI:-sf}"

if ! command -v node >/dev/null 2>&1; then
  echo "read-project.sh: node is required" >&2
  exit 1
fi

if [ ! -f "${MANIFEST_PATH}" ]; then
  echo "read-project.sh: manifest not found at ${MANIFEST_PATH} — is this a SaaSFoundryAI project?" >&2
  exit 2
fi

manifest_json=$(cat "${MANIFEST_PATH}")

# Resolve the catalogue: run `<sf> modules list --json`. Fall back to an empty
# array with a visible warning on stderr so the script still emits a useful
# report (installed modules + upToDate based on version only).
catalogue_json="[]"
if ! catalogue_json=$(${SF_CLI_CMD} modules list --json 2>/dev/null); then
  echo "read-project.sh: '${SF_CLI_CMD} modules list --json' failed — reporting with empty catalogue" >&2
  catalogue_json="[]"
fi

# Status owns capability classification. Preserve valid JSON even when status
# exits non-zero because an unrelated project precondition failed.
status_json="null"
if ! status_json=$(${SF_CLI_CMD} status --json --no-network 2>/dev/null); then
  if [ -z "${status_json}" ]; then
    echo "read-project.sh: '${SF_CLI_CMD} status --json --no-network' produced no report — capabilities unavailable" >&2
    status_json="null"
  fi
fi

node "${SCRIPT_DIR}/read-project.js" <<EOF
{
  "manifest": ${manifest_json},
  "catalogue": ${catalogue_json},
  "status": ${status_json}
}
EOF
