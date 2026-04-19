#!/usr/bin/env bash
# sf-srs orchestrator — single entrypoint for every skill that hands off to SRS work.
# Body grows as sibling SUBs under #174 land ; this revision implements `help` + `validate`.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat <<'EOF'
Usage: srs-cli.sh <action> [args...]

Actions:
  help                 Print this message
  validate [manifest]  Run createSrsAdapter(manifest).init() to smoke-test the backend.
                       Manifest path defaults to ./.saasfoundry.json.

Actions populated by sibling SUBs under #174 :
  draft                Run a drafter matching the configured backend              (SUB-6, 13)
  spawn                Spawn GitHub tickets from a published SRS                   (SUB-9)
  eval                 Score SRS freshness against the codebase                    (SUB-10)

Dispatch reads `tools.srs.backend` from `.saasfoundry.json` and routes through
the matching SrsAdapter. See .claude/skills/sf-srs/SKILL.md for the contract.
EOF
}

# Locate the SaaSFoundry project root (where src/srs/ lives).
# In the dogfood repo, the root is the nearest ancestor with a `src/srs` dir.
# In a generated project consuming sf-srs from a pre-built distribution, the
# dispatch library ships under node_modules/saasfoundry-cli/dist/srs — SUB-14.4
# will bind that path ; for now we walk up from SCRIPT_DIR.
find_project_root() {
  local dir="$SCRIPT_DIR"
  while [[ "$dir" != "/" ]]; do
    if [[ -d "$dir/src/srs" || -f "$dir/dist/srs/index.js" ]]; then
      echo "$dir"
      return 0
    fi
    dir="$(dirname "$dir")"
  done
  # Fallback : current working directory
  echo "$PWD"
}

run_validate() {
  local manifest="${1:-.saasfoundry.json}"
  local project_root
  project_root="$(find_project_root)"

  if [[ -f "$project_root/dist/srs/bin/validate.js" ]]; then
    node "$project_root/dist/srs/bin/validate.js" "$manifest"
  elif [[ -f "$project_root/src/srs/bin/validate.ts" ]]; then
    if ! command -v npx >/dev/null 2>&1; then
      echo "sf-srs validate: `node` / `npx` must be on PATH to run the TS entrypoint." >&2
      exit 1
    fi
    (cd "$project_root" && npx --no-install tsx src/srs/bin/validate.ts "$manifest")
  else
    echo "sf-srs validate: neither dist/srs/bin/validate.js nor src/srs/bin/validate.ts found under $project_root." >&2
    echo "Run `npm run build` in the SaaSFoundry checkout, or install sf-srs via `sf skill install sf-srs` (SUB-14.4)." >&2
    exit 1
  fi
}

ACTION="${1:-help}"
shift || true

case "$ACTION" in
  help|-h|--help) usage ;;
  validate) run_validate "$@" ;;
  draft|spawn|eval)
    echo "sf-srs: action '$ACTION' not implemented yet — owned by a sibling SUB under #174." >&2
    exit 2
    ;;
  *)
    echo "sf-srs: unknown action '$ACTION'" >&2
    usage
    exit 1
    ;;
esac
