#!/usr/bin/env bash
# Detects drift between the committed `packages/api-client/src/generated/` tree
# and what `npm run codegen` produces from the current `apps/api/docs/openapi.json`.
#
# Usage:
#   scripts/check-codegen-drift.sh         # fails on drift (CI / pre-commit)
#   scripts/check-codegen-drift.sh --fix   # writes the regen, leaves it staged
#
# The check is skipped (exit 0) when:
#   - openapi.json is missing (api hasn't been booted yet)
#   - the generated dir already has unstaged changes (don't clobber WIP)

set -e

GENERATED_DIR="packages/api-client/src/generated"
OPENAPI_SNAPSHOT="apps/api/docs/openapi.json"
MODE="${1:-check}"

if [ ! -f "$OPENAPI_SNAPSHOT" ]; then
  echo "⚠ codegen drift check skipped — $OPENAPI_SNAPSHOT not found (boot apps/api once to emit it)."
  exit 0
fi

if ! git diff --quiet -- "$GENERATED_DIR" 2>/dev/null; then
  echo "⚠ codegen drift check skipped — $GENERATED_DIR has unstaged changes; commit or stash before checking drift."
  exit 0
fi

echo "▶ Running codegen to compare against committed $GENERATED_DIR …"
npm run codegen --silent >/dev/null

if git diff --quiet -- "$GENERATED_DIR" 2>/dev/null; then
  echo "✓ api-client generated tree is in sync with $OPENAPI_SNAPSHOT."
  exit 0
fi

if [ "$MODE" = "--fix" ]; then
  echo "✓ Drift detected — kept the regen on disk. Stage it with: git add $GENERATED_DIR"
  exit 0
fi

echo ""
echo "✗ Codegen drift detected in $GENERATED_DIR." >&2
echo "  The committed generated client does not match what orval emits from the current $OPENAPI_SNAPSHOT." >&2
echo "" >&2
echo "  To fix:" >&2
echo "    1. npm run dev:api          # boots the API so openapi.json refreshes" >&2
echo "    2. npm run codegen          # regenerates the client" >&2
echo "    3. git add $GENERATED_DIR" >&2
echo "    4. Re-commit" >&2
echo "" >&2
echo "  Or run: scripts/check-codegen-drift.sh --fix  (writes the regen, leaves it staged)" >&2
echo "" >&2
echo "  Diff preview:" >&2
git --no-pager diff --stat -- "$GENERATED_DIR" >&2
git checkout -- "$GENERATED_DIR" 2>/dev/null || true
exit 1
