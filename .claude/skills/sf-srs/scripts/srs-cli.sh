#!/usr/bin/env bash
# sf-srs orchestrator — single entrypoint for every skill that hands off to SRS work.
# Body grows as sibling SUBs under #174 land ; this revision implements
# `help`, `validate`, `browse`, `draft`, `write`, `spawn`.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat <<'EOF'
Usage: srs-cli.sh <action> [args...]

Actions:
  help                              Print this message
  validate [manifest]               Smoke-test the configured backend via adapter.init()
  browse --parent <id> [--manifest] List direct children of a parent page (JSON)
  draft --from notion-pages --ids <id1,id2,...> [--manifest]
                                    Fetch pages from the backend as RawContent (JSON).
                                    The skill then drafts Epic/FR specs conversationally
                                    and hands them back via `write`.
  draft --from codebase [--path <dir>] [--manifest]
                                    Scan the local codebase and emit structured
                                    findings (JSON). The skill then drafts Epic/FR
                                    specs conversationally from the findings and
                                    hands them back via `write`. Scanners plug in
                                    via sibling SUBs under #173 (13.2 + 13.3).
  write  --spec <path> [--manifest] [--no-clear-pending]
                                    Apply a DraftCandidate[] spec file : creates Epic /
                                    FR pages through the adapter and clears the
                                    `tools.srs.pendingIngestion` flag on success.
  spawn  --ticket <n> --epic <page-url-or-id> [--dry-run] [--manifest] [--bypass-reason <text>]
                                    Enumerate FR page children of a drafted Epic and
                                    create a Story sub-ticket per FR under the parent
                                    ticket. Each child is created as a GitHub
                                    sub-issue tagged `srs:new`; board placement
                                    follows the project's default automation.
                                    `--dry-run` previews without writing.
  apply-update [--patch <path>] [--manifest]
                                    Apply a conversational eval-hook patch
                                    (ADD-only : new UR / new FR / new DS / new TC)
                                    to the configured backend. Reads patch JSON
                                    from stdin when --patch is omitted. Used by
                                    the `sf-srs` eval hook after user accepts
                                    the proposed diff — see SKILL.md.
  eval  [--path <dir>] [--root-page <id>] [--threshold <pct>] [--json] [--manifest]
                                    Score SRS freshness vs. codebase (batch).
                                    Lists FR pages under the configured root,
                                    runs the scanners, and reports drift
                                    findings (FR pages with no matching code,
                                    code areas with no FR, untested FRs).
                                    Exit 0 when overall score >= threshold,
                                    1 otherwise. --json emits the structured
                                    report for CI consumption.

Common options :
  --manifest <path>                 Manifest file to read (default: .saasfoundry.json)

Exit codes (shared contract) :
  0 success · 2 bad input · 3 missing backend · 4 unknown backend · 5 runtime ·
  6 write partial (rollbackHint) · 7 write ok but pendingIngestion clear failed

Dispatch reads `tools.srs.backend` from `.saasfoundry.json` and routes through
the matching SrsAdapter. See .claude/skills/sf-srs/SKILL.md for the contract.
EOF
}

# Locate the SaaSFoundryAI project root (where src/srs/ lives).
# In the dogfood repo, the root is the nearest ancestor with a `src/srs` dir.
# In a generated project consuming sf-srs from a pre-built distribution, the
# dispatch library ships under node_modules/saasfoundryai-cli/dist/srs — SUB-14.4
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

# Run a TS entrypoint via the dist / src fallback pattern.
# $1 = bin script basename (without extension), $2+ = args forwarded.
run_bin() {
  local bin="$1"
  shift
  local project_root
  project_root="$(find_project_root)"

  if [[ -f "$project_root/dist/srs/bin/$bin.js" ]]; then
    node "$project_root/dist/srs/bin/$bin.js" "$@"
  elif [[ -f "$project_root/src/srs/bin/$bin.ts" ]]; then
    if ! command -v npx >/dev/null 2>&1; then
      echo "sf-srs $bin: `node` / `npx` must be on PATH to run the TS entrypoint." >&2
      exit 1
    fi
    if ! (cd "$project_root" && npx --no-install tsx --version >/dev/null 2>&1); then
      echo "sf-srs $bin: tsx is not installed in $project_root — run 'npm install' there or 'npm run build' to use the dist/ entrypoint." >&2
      exit 1
    fi
    (cd "$project_root" && npx --no-install tsx "src/srs/bin/$bin.ts" "$@")
  else
    echo "sf-srs $bin: neither dist/srs/bin/$bin.js nor src/srs/bin/$bin.ts found under $project_root." >&2
    echo "Run `npm run build` in the SaaSFoundryAI checkout, or install sf-srs via `sf skill install sf-srs` (SUB-14.4)." >&2
    exit 1
  fi
}

run_validate() { run_bin validate "${1:-.saasfoundry.json}"; }

run_browse() { run_bin browse-tree "$@"; }

run_write() { run_bin write-srs "$@"; }

run_spawn() { run_bin spawn "$@"; }

run_apply_update() { run_bin apply-srs-update "$@"; }

run_eval() { run_bin eval-srs "$@"; }

run_draft() {
  # `--from <source>` selects which drafter to invoke ; default = notion-pages.
  local source="notion-pages"
  local forwarded=()
  while (( "$#" )); do
    case "$1" in
      --from) source="${2:?--from requires a value}"; shift 2 ;;
      --from=*) source="${1#--from=}"; shift ;;
      *) forwarded+=("$1"); shift ;;
    esac
  done
  case "$source" in
    notion-pages) run_bin draft-from-notion-pages ${forwarded[@]+"${forwarded[@]}"} ;;
    codebase) run_bin draft-from-codebase ${forwarded[@]+"${forwarded[@]}"} ;;
    *)
      echo "sf-srs draft: unknown --from value '$source' (expected: notion-pages | codebase)." >&2
      exit 1
      ;;
  esac
}

ACTION="${1:-help}"
shift || true

case "$ACTION" in
  help|-h|--help) usage ;;
  validate) run_validate "$@" ;;
  browse) run_browse "$@" ;;
  draft) run_draft "$@" ;;
  write) run_write "$@" ;;
  spawn) run_spawn "$@" ;;
  apply-update) run_apply_update "$@" ;;
  eval) run_eval "$@" ;;
  *)
    echo "sf-srs: unknown action '$ACTION'" >&2
    usage
    exit 1
    ;;
esac
