#!/usr/bin/env bash
set -euo pipefail

# Ensures the GitHub CLI is installed and authenticated before the
# tool-saasfoundry skill runs any `gh`-dependent command (feedback,
# voting, issue listing).
#
# Exit codes:
#   0 — gh is installed and authenticated (silent, idempotent)
#   1 — gh is missing OR not authenticated; guidance printed on stderr
#
# The message goes to stderr so stdout stays reserved for structured
# output when the skill pipes this into other helpers.

if ! command -v gh >/dev/null 2>&1; then
  cat >&2 <<'EOF'
GitHub CLI (`gh`) is not installed.

Install it first, then retry:
  macOS:   brew install gh
  Linux:   https://github.com/cli/cli/blob/trunk/docs/install_linux.md
  Windows: winget install --id GitHub.cli

Once installed, authenticate with:
  gh auth login
EOF
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  cat >&2 <<'EOF'
GitHub CLI is installed but not authenticated.

Run the interactive login, then retry:
  gh auth login

Choose "GitHub.com" → "HTTPS" → "Login with a web browser"
when prompted.
EOF
  exit 1
fi

exit 0
