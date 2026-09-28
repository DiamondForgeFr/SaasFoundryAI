#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
IMAGE_NAME="${SF_DOCKER_IMAGE_NAME:-sf-build-test}"
ARTIFACTS_DIR="${SF_DOCKER_ARTIFACTS_DIR:-$PROJECT_ROOT/.tmp/docker-artifacts}"
SCENARIO=""
DEPTH="full"
LANE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --lane) LANE="${2:-}"; shift 2 ;;
    --scenario) SCENARIO="${2:-}"; shift 2 ;;
    --depth) DEPTH="${2:-}"; shift 2 ;;
    --list) npx tsx "$SCRIPT_DIR/list-scenarios.ts" "${@:2}"; exit 0 ;;
    --help)
      echo "Usage: $0 [--lane normal|full] [--scenario <name> --depth smoke|full] [--list]"
      exit 0
      ;;
    *) echo "Unknown option: $1 (use --help for usage)" >&2; exit 1 ;;
  esac
done

if [[ -n "$LANE" && -n "$SCENARIO" ]]; then
  echo "--lane and --scenario are mutually exclusive" >&2
  exit 1
fi
if [[ -z "$LANE" && -z "$SCENARIO" ]]; then
  LANE="full"
fi
if [[ -n "$LANE" && "$LANE" != "normal" && "$LANE" != "full" ]]; then
  echo "Unknown lane: $LANE" >&2
  exit 1
fi
if [[ "$DEPTH" != "smoke" && "$DEPTH" != "full" ]]; then
  echo "Unknown browser depth: $DEPTH" >&2
  exit 1
fi

cd "$PROJECT_ROOT"
mkdir -p "$ARTIFACTS_DIR"
ARTIFACTS_DIR="$(cd "$ARTIFACTS_DIR" && pwd)"
RUN_ARTIFACTS_DIR="$ARTIFACTS_DIR/run-$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir -p "$RUN_ARTIFACTS_DIR"

echo "Building Docker lifecycle image once..."
docker build -f Dockerfile.test -t "$IMAGE_NAME" ${DOCKER_BUILD_ARGS:-} .

run_scenario() {
  local scenario="$1"
  local depth="$2"
  local check="$3"
  local output="$RUN_ARTIFACTS_DIR/$check"
  local status=0
  mkdir -p "$output"
  echo "[sf-progress] lifecycle $check — started ($scenario, $depth)"
  set +e
  docker run --rm --init --ipc=host \
    -e "TEST_SCENARIO=$scenario" \
    -e "TEST_LIVE_DEPTH=$depth" \
    -e "SF_TEST_ARTIFACTS_DIR=/artifacts" \
    --mount "type=bind,source=$output,target=/artifacts" \
    "$IMAGE_NAME"
  status=$?
  set -e
  docker run --rm --entrypoint chown \
    --mount "type=bind,source=$output,target=/artifacts" \
    "$IMAGE_NAME" -R "$(id -u):$(id -g)" /artifacts
  if [[ "$status" -ne 0 ]]; then
    echo "[sf-progress] lifecycle $check — failed (artifacts: $output)" >&2
    return "$status"
  fi
  echo "[sf-progress] lifecycle $check — passed"
}

if [[ -n "$LANE" ]]; then
  while IFS=$'\t' read -r check scenario depth; do
    run_scenario "$scenario" "$depth" "$check"
  done < <(npx tsx "$SCRIPT_DIR/list-scenarios.ts" --tsv --lane "$LANE")
else
  run_scenario "$SCENARIO" "$DEPTH" "$SCENARIO-$DEPTH"
fi

echo "Lifecycle Docker tests completed successfully. Artifacts: $RUN_ARTIFACTS_DIR"
