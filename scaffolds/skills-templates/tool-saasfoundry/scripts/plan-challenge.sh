#!/usr/bin/env bash
set -euo pipefail

# Thin wrapper around plan-challenge.js. Accepts a read-poc.sh report on stdin and emits
# grounded seeds for the challenge conversation. Writes nothing.
#
# Usage:
#   read-poc.sh ./POC | plan-challenge.sh
#
# SEED SHAPE (stdout, JSON):
#   {
#     root:       the POC that was read
#     revealing:  boolean — false means say so and ask directly instead
#     reason:     why it reveals too little (null when it does)
#     seeds:      [{ dimension, observation, evidence, probe }]
#                 observation — a fact quoted from the report
#                 evidence    — the report field it came from
#                 probe       — the opening; the model writes the actual question
#     cap:        maximum seeds emitted — this is a conversation, not an interrogation
#     considered: how many probes matched before the cap
#     dropped:    how many matched but did not fit (never silently zero)
#     notes:      what could not be probed, and why
#   }
#
# Exit codes:
#   0 — seeds emitted (revealing:false is a finding, not an error)
#   1 — internal error (node missing)
#   2 — invalid input

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "plan-challenge.sh: node is required" >&2
  exit 1
fi

exec node "${SCRIPT_DIR}/plan-challenge.js"
