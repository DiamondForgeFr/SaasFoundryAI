#!/usr/bin/env bash
set -euo pipefail

# Thin wrapper around plan-poc-move.js. Accepts a read-poc.sh report on stdin and
# emits the move plan on stdout. Touches nothing on disk — the move itself is
# move-poc.sh, and it requires --confirm.
#
# Usage:
#   read-poc.sh ./my-thing | plan-poc-move.sh
#   echo '{"report": <report>, "destination":"POC"}' | plan-poc-move.sh
#
# PLAN SHAPE (stdout, JSON):
#   {
#     root:          absolute path being reorganised
#     destination:   directory the POC moves into (default "POC")
#     refused:       boolean — true means do not proceed
#     refusals:      [string]  why, in full sentences the user can act on
#     warnings:      [string]  things worth saying that do not block
#     moves:         [{ from, to, type }]  top-level entries, dotfiles and .git included
#     keepsGit:      boolean — the repository travels with its files, history intact
#     entriesMoved:  number
#     resultingTree: [string]
#     undo:          how to reverse it
#   }
#
# Exit codes:
#   0 — plan emitted, safe to confirm
#   1 — internal error (node missing, unreadable directory)
#   2 — invalid input, or the move is refused (read `refusals`)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "plan-poc-move.sh: node is required to parse the report" >&2
  exit 1
fi

exec node "${SCRIPT_DIR}/plan-poc-move.js"
