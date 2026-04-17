#!/usr/bin/env bash
set -euo pipefail

# Reads .saasfoundry.json from the current directory and `sf modules list --json`
# from the resolved CLI invocation, then emits a consolidated read-only report
# via read-project.js.
#
# Env overrides (useful for skill orchestration and tests):
#   SF_MANIFEST_PATH — path to .saasfoundry.json (default: ./.saasfoundry.json)
#   SF_CLI           — command token for the saasfoundry CLI (default: sf)
#                      e.g. "sf", "saasfoundry-cli", or "npx saasfoundry-cli"
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
  echo "read-project.sh: manifest not found at ${MANIFEST_PATH} — is this a SaaSFoundry project?" >&2
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

node "${SCRIPT_DIR}/read-project.js" <<EOF
{
  "manifest": ${manifest_json},
  "catalogue": ${catalogue_json}
}
EOF
