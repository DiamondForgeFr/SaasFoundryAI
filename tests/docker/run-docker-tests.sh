#!/usr/bin/env bash
# ── Docker Build Test Runner ────────────────────────────────────
# Usage:
#   ./tests/docker/run-docker-tests.sh                          # All 18 scenarios
#   ./tests/docker/run-docker-tests.sh --count 4                # Top 4 by priority
#   ./tests/docker/run-docker-tests.sh --scenario multirepo-full  # Single scenario
#
# Priority order (--count picks from top):
#   1. multirepo-minimal    2. monorepo-minimal
#   3. multirepo-full       4. monorepo-full
#   5. update-add-all       6. update-add-email
#   7-9. AI scenarios      10-18. Module variations
#
# Environment variables:
#   DOCKER_BUILD_ARGS  Extra docker build arguments (e.g., --no-cache)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
IMAGE_NAME="sf-build-test"

# ── Parse Arguments ─────────────────────────────────────────────

SCENARIO="all"
COUNT=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --count)
      COUNT="$2"
      shift 2
      ;;
    --scenario)
      SCENARIO="$2"
      shift 2
      ;;
    --list)
      # Single source of truth: the list is rendered from scenarios.ts. It used to be 18
      # hardcoded `echo` lines that silently drifted — the runner executed 19 while --list
      # advertised 18, hiding a whole scenario from anyone reading the CLI (#426).
      npx tsx "$SCRIPT_DIR/list-scenarios.ts"
      exit 0
      ;;
    --help)
      echo "Usage: $0 [--count N] [--scenario <name>] [--list]"
      echo ""
      echo "Options:"
      echo "  --count N            Run the top N scenarios by priority"
      echo "  --scenario <name>    Run a specific scenario (or comma-separated list)"
      echo "  --list               Show all scenarios with priority order"
      echo ""
      echo "Examples:"
      echo "  $0                   # All scenarios"
      echo "  $0 --count 2         # Top 2: multirepo-minimal + monorepo-minimal"
      echo "  $0 --count 6         # Top 6: minimals + fulls + key updates"
      echo "  $0 --scenario monorepo-full"
      echo "  $0 --scenario multirepo-full,update-add-email"
      exit 0
      ;;
    *)
      echo "Unknown option: $1 (use --help for usage)"
      exit 1
      ;;
  esac
done

# ── Build Docker Image ──────────────────────────────────────────

echo "Building Docker test image..."
echo "  Context: $PROJECT_ROOT"

cd "$PROJECT_ROOT"

# Temporarily install .dockerignore for the build context
DOCKERIGNORE_BACKUP=""
if [[ -f ".dockerignore" ]]; then
  DOCKERIGNORE_BACKUP="$(mktemp)"
  cp .dockerignore "$DOCKERIGNORE_BACKUP"
fi
cp .dockerignore.test .dockerignore

cleanup() {
  if [[ -n "$DOCKERIGNORE_BACKUP" && -f "$DOCKERIGNORE_BACKUP" ]]; then
    mv "$DOCKERIGNORE_BACKUP" .dockerignore
  else
    rm -f .dockerignore
  fi
}
trap cleanup EXIT

docker build \
  -f Dockerfile.test \
  -t "$IMAGE_NAME" \
  ${DOCKER_BUILD_ARGS:-} \
  .

# ── Run Tests ───────────────────────────────────────────────────

ENV_ARGS=(-e "TEST_SCENARIO=$SCENARIO")

if [[ -n "$COUNT" ]]; then
  ENV_ARGS+=(-e "TEST_COUNT=$COUNT")
fi

echo ""
if [[ -n "$COUNT" ]]; then
  echo "Running top $COUNT scenario(s) by priority"
elif [[ "$SCENARIO" == "all" ]]; then
  echo "Running all 18 scenarios"
else
  echo "Running scenario: $SCENARIO"
fi
echo ""

docker run --rm "${ENV_ARGS[@]}" "$IMAGE_NAME"

echo ""
echo "Docker build tests completed successfully!"
