#!/usr/bin/env bash
set -euo pipefail

# Reads a directory that already holds code and emits the evidence a reading is built
# from, plus the deterministic verdict on whether there is enough there to read at all.
#
# Despite the name it is not POC-specific: a user's live project reads exactly the same
# way, and on `--profile harness` the reading is the whole flow — nothing is moved
# afterwards. The name is kept because it is part of an installed skill's contract; the
# distinction is carried by the documentation instead. See #574.
#
# This script NEVER writes, moves or deletes anything. The move is a separate,
# confirmed step — see plan-poc-move.sh and move-poc.sh.
#
# Usage:
#   read-poc.sh [directory]        # default: current directory
#
# Env overrides:
#   SF_POC_DIR — directory to read (overridden by the positional argument)
#
# REPORT SHAPE (stdout, JSON):
#   {
#     root:           absolute path that was read
#     recognisable:   boolean — false means "say so", never "guess a purpose"
#     reason:         why it is not recognisable (null when it is)
#     anchors:        [string]  what makes it readable (manifest / README / source files)
#     stacks:         [string]  node | python | go | rust | php | ruby | jvm | ... | docker
#     manifests:      [string]  manifest filenames found at the root
#     package:        parsed name/description/scripts/dependencies, or null
#     readme:         { present, path, firstParagraph }
#     entryPoints:    [string]  conventional entry files that exist
#     tests:          { present, evidence: [string] }
#     git:            { isRepo, ownRepo, enclosingRoot }
#                     ownRepo:false with isRepo:true means the POC sits INSIDE another
#                     repository — the move planner refuses on this
#     inventory:      { files, directories, sourceFiles, authoredFiles, bytes,
#                       topLevel, generatedPresent, truncated }
#   }
#
# Exit codes:
#   0 — success (recognisable:false is a finding, not an error)
#   1 — internal error (node missing)
#   2 — invalid input (directory missing or unreadable)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
POC_DIR="${1:-${SF_POC_DIR:-.}}"

if ! command -v node >/dev/null 2>&1; then
  echo "read-poc.sh: node is required" >&2
  exit 1
fi

if [ ! -d "${POC_DIR}" ]; then
  echo "read-poc.sh: no such directory: ${POC_DIR}" >&2
  exit 2
fi

exec node "${SCRIPT_DIR}/read-poc.js" "${POC_DIR}"
