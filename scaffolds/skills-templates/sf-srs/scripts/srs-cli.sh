#!/usr/bin/env bash
# sf-srs orchestrator — single entrypoint for every skill that hands off to SRS work.
# Body is filled by SUB-14.3 ; this stub exists so the directory map is complete
# and skills can reference the path (`.claude/skills/sf-srs/scripts/srs-cli.sh`) today.

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: srs-cli.sh <action> [args...]

Actions (populated by sibling SUBs under #174):
  help        Print this message
  validate    Smoke-test the configured backend                    (SUB-14.3)
  draft       Run a drafter matching the configured backend        (SUB-6, 13)
  spawn       Spawn GitHub tickets from a published SRS            (SUB-9)
  eval        Score SRS freshness against the codebase             (SUB-10)

Dispatch reads `tools.srs.backend` from `.saasfoundry.json` and routes through
the matching SrsAdapter. See .claude/skills/sf-srs/SKILL.md for the contract.
EOF
}

ACTION="${1:-help}"

case "$ACTION" in
  help|-h|--help) usage ;;
  validate|draft|spawn|eval)
    echo "sf-srs: action '$ACTION' not implemented yet — owned by a sibling SUB under #174." >&2
    exit 2
    ;;
  *)
    echo "sf-srs: unknown action '$ACTION'" >&2
    usage
    exit 1
    ;;
esac
