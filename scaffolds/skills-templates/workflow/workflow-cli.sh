#!/bin/bash

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Load configuration from .saasfoundry.json (single source of truth)
load_config() {
  if [[ ! -f ".saasfoundry.json" ]]; then
    echo -e "${RED}Error: .saasfoundry.json not found${NC}" >&2
    echo "This command must be run from the project root." >&2
    exit 1
  fi

  WORKFLOW_TOOL=$(jq -r '.workflow.tool // empty' .saasfoundry.json)
  WORKING_BRANCH=$(jq -r '.workflow.workingBranch // "develop"' .saasfoundry.json)

  if [[ -z "$WORKFLOW_TOOL" ]]; then
    echo -e "${RED}Error: No workflow tool configured in .saasfoundry.json${NC}" >&2
    exit 1
  fi
}

# Get tool skill CLI path
get_tool_cli() {
  local tool=$1
  local project_root="."

  # Determine if monorepo or multirepo
  if [[ -d "apps" ]]; then
    # Monorepo - skills at root
    echo "${project_root}/.claude/skills/sf-tool-${tool}/${tool}-cli.sh"
  else
    # Multirepo - skills in current app directory
    echo "${project_root}/.claude/skills/sf-tool-${tool}/${tool}-cli.sh"
  fi
}

# Route command to appropriate tool CLI
route_to_tool() {
  local tool=$1
  shift

  local tool_cli=$(get_tool_cli "$tool")

  if [[ ! -f "$tool_cli" ]]; then
    # Fallback to installed tool skill
    tool_cli="$HOME/.claude/skills/tool-${tool}/${tool}-cli.sh"
    if [[ ! -f "$tool_cli" ]]; then
      echo -e "${RED}Error: Tool skill for '${tool}' not found${NC}" >&2
      echo "Expected: $(get_tool_cli $tool)" >&2
      exit 1
    fi
  fi

  # Make tool CLI executable
  chmod +x "$tool_cli" 2>/dev/null || true

  # Execute tool CLI
  "$tool_cli" "$@"
}

# Function to get current status of a ticket
get_current_status() {
  local ticket=$1
  local status=""

  load_config

  case "$WORKFLOW_TOOL" in
    github-projects)
      # Delegate to GitHub Projects tool CLI
      status=$(route_to_tool github-projects status "$ticket" 2>&1 | grep "^Status:" | awk -F': ' '{print $2}')
      ;;
    jira)
      # Delegate to Jira tool CLI
      status=$(route_to_tool jira status "$ticket" 2>&1 | grep "^Status:" | awk -F': ' '{print $2}')
      ;;
    notion)
      # Delegate to Notion tool CLI
      status=$(route_to_tool notion status "$ticket" 2>&1 | grep "^Status:" | awk -F': ' '{print $2}')
      ;;
    linear)
      # Delegate to Linear tool CLI
      status=$(route_to_tool linear status "$ticket" 2>&1 | grep "^Status:" | awk -F': ' '{print $2}')
      ;;
    *)
      echo -e "${RED}Unknown workflow tool: $WORKFLOW_TOOL${NC}" >&2
      return 1
      ;;
  esac

  echo "$status"
}

# Function to display status description
show_status_description() {
  local status=$1
  local status_file=""

  # Map status names to files
  case "$status" in
    "Backlog") status_file="1-backlog.md" ;;
    "Ready") status_file="2-ready.md" ;;
    "In Progress"|"In progress") status_file="3-in-progress.md" ;;
    "AI Testing"|"AI testing") status_file="4-ai-testing.md" ;;
    "Human Testing"|"Human testing") status_file="5-human-testing.md" ;;
    "In Review"|"In review") status_file="6-in-review.md" ;;
    "Done") status_file="7-done.md" ;;
    *)
      echo "Unknown status: $status" >&2
      echo "Available statuses: Backlog, Ready, In Progress, AI Testing, Human Testing, In Review, Done"
      return 1
      ;;
  esac

  local file_path="$SKILL_DIR/statuses/$status_file"
  if [[ -f "$file_path" ]]; then
    cat "$file_path"
  else
    echo "Error: Status description file not found: $status_file" >&2
    return 1
  fi
}

# ───────────────────────────────────────────────────────────────────────────
# SRS drafting guard
# ───────────────────────────────────────────────────────────────────────────
#
# A ticket tagged with any srs:drafting|srs:update|srs:new label is on the
# *drafting lifecycle*, not the code-path lifecycle. It must flow through
# `transition-drafting`, not through the code-path statuses.
#
# Block code-path targets (AI testing, Human testing, In review). Allow every
# other target (Backlog, Ready, In progress, Done). The `transition-drafting`
# command sets SF_WORKFLOW_BYPASS_SRS_GUARD=1 before routing to `update-status`
# so its own "→ Done" transition doesn't get rejected.
SRS_DRAFTING_LABELS_REGEX='^srs:(drafting|update|new)$'

is_srs_blocked_target() {
  # Fold case AND trim leading/trailing whitespace so " AI testing " is still caught
  # (copy-paste from boards often sneaks in whitespace).
  local target=$1
  local normalized
  normalized=$(echo "$target" | tr '[:upper:]' '[:lower:]' | awk '{$1=$1;print}')
  case "$normalized" in
    "ai testing"|"human testing"|"in review") return 0 ;;
  esac
  return 1
}

get_ticket_srs_label() {
  # Prints the first srs:* label on the ticket, or empty string if none.
  # Returns 0 on clean fetch (even if no label), 1 if the label fetch failed.
  local ticket=$1
  local raw
  raw=$(route_to_tool "$WORKFLOW_TOOL" get-labels "$ticket" 2>/dev/null) || return 1
  echo "$raw" | grep -E "$SRS_DRAFTING_LABELS_REGEX" | head -n1
}

check_srs_guard() {
  # Returns 0 if the caller may proceed, 1 if blocked (message already printed).
  local ticket=$1
  local target=$2

  [[ "${SF_WORKFLOW_BYPASS_SRS_GUARD:-}" == "1" ]] && return 0
  is_srs_blocked_target "$target" || return 0

  local label
  label=$(get_ticket_srs_label "$ticket") || return 0   # fail-open on fetch error — don't punish offline/auth issues

  if [[ -n "$label" ]]; then
    echo -e "${RED}✗ Ticket #${ticket} carries '${label}' — the code-path transition to '${target}' is blocked.${NC}" >&2
    echo "" >&2
    echo "  SRS tickets flow through the drafting lifecycle, not the code-path lifecycle." >&2
    echo "  Use instead:" >&2
    echo "    .claude/skills/sf-workflow/workflow-cli.sh transition-drafting ${ticket} <phase>" >&2
    echo "  Phases: ai-draft → human-review → spawning → done" >&2
    echo "  See .claude/skills/sf-workflow/statuses/3a-ai-drafting.md" >&2
    return 1
  fi
  return 0
}

# ───────────────────────────────────────────────────────────────────────────
# Complexity guard
# ───────────────────────────────────────────────────────────────────────────
#
# Every ticket must carry a `complexity: <bug|low|medium|complex>` label before
# it leaves Backlog. Without it, the adaptive workflow (analyze / plan / examine
# depth) has nothing to key off and the board ends up full of untagged tickets
# — the exact failure mode the developer flagged.
#
# The guard fires on any `update-status` whose target is NOT 'Backlog'. It
# fails open on fetch errors (same philosophy as check_srs_guard) so an offline
# gh or auth hiccup never wedges the workflow. Escape hatch:
# SF_WORKFLOW_BYPASS_COMPLEXITY_GUARD=1.

is_backlog_target() {
  local target=$1
  local normalized
  normalized=$(echo "$target" | tr '[:upper:]' '[:lower:]' | awk '{$1=$1;print}')
  [[ "$normalized" == "backlog" ]]
}

get_ticket_complexity_label() {
  # Prints the complexity level (bug|low|medium|complex) or empty if none.
  # Returns 0 on clean fetch, 1 on fetch error.
  local ticket=$1
  local raw
  raw=$(route_to_tool "$WORKFLOW_TOOL" get-labels "$ticket" 2>/dev/null) || return 1
  echo "$raw" | grep -E '^complexity: ' | head -n1 | sed 's/^complexity: //'
}

check_complexity_guard() {
  # Returns 0 if the caller may proceed, 1 if blocked (message already printed).
  local ticket=$1
  local target=$2

  [[ "${SF_WORKFLOW_BYPASS_COMPLEXITY_GUARD:-}" == "1" ]] && return 0
  is_backlog_target "$target" && return 0   # moving back to Backlog is always allowed

  local level
  level=$(get_ticket_complexity_label "$ticket") || return 0   # fail-open on fetch error

  if [[ -z "$level" ]]; then
    echo -e "${RED}✗ Ticket #${ticket} has no complexity label — cannot transition to '${target}'.${NC}" >&2
    echo "" >&2
    echo "  Every ticket must be tagged with one of: bug | low | medium | complex" >&2
    echo "  before it leaves Backlog. The adaptive workflow keys off this label." >&2
    echo "" >&2
    echo "  Fix:" >&2
    echo "    .claude/skills/sf-workflow/workflow-cli.sh detect-complexity ${ticket}" >&2
    echo "    .claude/skills/sf-workflow/workflow-cli.sh retag ${ticket} <level>" >&2
    echo "" >&2
    echo "  See .claude/skills/sf-workflow/complexity/README.md for level guidance." >&2
    echo "  Escape hatch (rare): SF_WORKFLOW_BYPASS_COMPLEXITY_GUARD=1" >&2
    return 1
  fi
  return 0
}

# Function to show next status
show_next_status() {
  local current_status=$1

  case "$current_status" in
    "Backlog") echo "Next: Ready" ;;
    "Ready") echo "Next: In Progress" ;;
    "In Progress"|"In progress") echo "Next: AI Testing" ;;
    "AI Testing"|"AI testing") echo "Next: Human Testing" ;;
    "Human Testing"|"Human testing") echo "Next: In Review" ;;
    "In Review"|"In review") echo "Next: Done" ;;
    "Done") echo "Workflow complete - no next status" ;;
    *) echo "Unknown status: $current_status" ;;
  esac
}

# Main command dispatcher
COMMAND=$1
shift || true

case "$COMMAND" in
  # Workflow status commands
  status)
    TICKET=$1
    if [[ -z "$TICKET" ]]; then
      echo "Usage: workflow-cli.sh status <ticket-number>" >&2
      exit 1
    fi

    STATUS=$(get_current_status "$TICKET")
    if [[ $? -ne 0 ]]; then
      exit 1
    fi

    echo "═══════════════════════════════════════════════════════════════"
    echo "Ticket #$TICKET is currently in status: $STATUS"
    echo "═══════════════════════════════════════════════════════════════"
    echo ""
    show_status_description "$STATUS"
    ;;

  next)
    TICKET=$1
    if [[ -z "$TICKET" ]]; then
      echo "Usage: workflow-cli.sh next <ticket-number>" >&2
      exit 1
    fi

    STATUS=$(get_current_status "$TICKET")
    if [[ $? -ne 0 ]]; then
      exit 1
    fi

    echo "Current status: $STATUS"
    show_next_status "$STATUS"
    ;;

  validate)
    TICKET=$1
    if [[ -z "$TICKET" ]]; then
      echo "Usage: workflow-cli.sh validate <ticket-number>" >&2
      exit 1
    fi

    echo "Validation feature not yet implemented"
    echo "Please manually verify exit conditions in the status description"
    ;;

  help)
    cat "$SKILL_DIR/SKILL.md"
    ;;

  # Complexity commands
  detect-complexity)
    TICKET=$1
    if [[ -z "$TICKET" ]]; then
      echo "Usage: workflow-cli.sh detect-complexity <ticket-number>" >&2
      exit 1
    fi
    "$SKILL_DIR/scripts/detect-complexity.sh" "$TICKET"
    ;;

  retag)
    TICKET=$1
    NEW_COMPLEXITY=$2
    if [[ -z "$TICKET" ]] || [[ -z "$NEW_COMPLEXITY" ]]; then
      echo "Usage: workflow-cli.sh retag <ticket-number> <new-complexity>" >&2
      echo "Complexity: bug | low | medium | complex" >&2
      exit 1
    fi
    echo -e "${YELLOW}Retagging ticket #${TICKET} to complexity: ${NEW_COMPLEXITY}${NC}"
    echo ""
    echo "This will adjust remaining workflow steps to match the new complexity level."
    echo ""
    # Note: Actual retagging logic depends on the tool (GitHub/Jira/Notion/Linear)
    # This command updates the complexity metadata on the ticket
    load_config
    route_to_tool "$WORKFLOW_TOOL" "set-complexity" "$TICKET" "$NEW_COMPLEXITY"
    ;;

  # Workflow phase commands (adaptive based on complexity)
  prepare)
    TICKET=$1
    COMPLEXITY=$2
    if [[ -z "$TICKET" ]] || [[ -z "$COMPLEXITY" ]]; then
      echo "Usage: workflow-cli.sh prepare <ticket-number> <complexity>" >&2
      echo "Complexity: bug | low | medium | complex" >&2
      exit 1
    fi
    echo -e "${BLUE}PREPARE PHASE: Backlog → Ready${NC}"
    echo ""
    echo "Running adaptive analyze + plan for complexity: ${COMPLEXITY}"
    echo ""
    "$SKILL_DIR/scripts/analyze.sh" "$TICKET" "$COMPLEXITY"
    echo ""
    "$SKILL_DIR/scripts/plan.sh" "$TICKET" "$COMPLEXITY"
    ;;

  test)
    TICKET=$1
    COMPLEXITY=$2
    if [[ -z "$TICKET" ]]; then
      echo "Usage: workflow-cli.sh test <ticket-number> [complexity]" >&2
      exit 1
    fi
    echo -e "${BLUE}AI TESTING PHASE: In Progress → AI Testing → Human Testing${NC}"
    echo ""
    if [[ "$COMPLEXITY" == "complex" ]]; then
      echo "Running adversarial review (complex ticket)..."
      echo ""
      "$SKILL_DIR/scripts/examine.sh" "$TICKET"
    else
      echo "Skipping adversarial review (not complex)"
    fi
    ;;

  # Tool delegation commands - route to appropriate tool CLI
  update-status)
    load_config
    TICKET=$1
    TARGET=$2
    if [[ -z "$TICKET" || -z "$TARGET" ]]; then
      echo "Usage: workflow-cli.sh update-status <ticket> <status-name>" >&2
      exit 1
    fi
    if ! check_srs_guard "$TICKET" "$TARGET"; then
      exit 2
    fi
    if ! check_complexity_guard "$TICKET" "$TARGET"; then
      exit 2
    fi
    route_to_tool "$WORKFLOW_TOOL" update-status "$@"
    ;;

  create-subtask|create-pr|list|get-labels)
    load_config
    route_to_tool "$WORKFLOW_TOOL" "$COMMAND" "$@"
    ;;

  # ───────────────────────────────────────────────────────────────────
  # transition-drafting — drive a ticket through the SRS drafting arc
  #   Phases: ai-draft → human-review → spawning → done
  # ───────────────────────────────────────────────────────────────────
  transition-drafting)
    TICKET=$1
    PHASE=$2
    if [[ -z "$TICKET" || -z "$PHASE" ]]; then
      echo "Usage: workflow-cli.sh transition-drafting <ticket> <phase>" >&2
      echo "Phases: ai-draft | human-review | spawning | done" >&2
      exit 1
    fi

    load_config

    # Validate ticket is in the drafting lifecycle (has a srs:* label).
    SRS_LABEL=$(get_ticket_srs_label "$TICKET" || true)
    if [[ -z "$SRS_LABEL" ]]; then
      echo -e "${RED}✗ Ticket #${TICKET} has no srs:* label — transition-drafting does not apply.${NC}" >&2
      echo "  Apply 'srs:drafting' (or srs:update / srs:new) before running this command." >&2
      exit 2
    fi

    # Validate board state:
    #   - ai-draft / human-review / spawning require 'In progress'
    #   - done accepts 'In progress' (normal exit) or 'Done' (idempotent re-run)
    #     but rejects Backlog / Ready / … so we flag operator mistakes instead
    #     of silently short-circuiting the drafting arc.
    BOARD_STATUS=$(get_current_status "$TICKET" 2>/dev/null || true)
    BOARD_STATUS_NORMALIZED=$(echo "$BOARD_STATUS" | tr '[:upper:]' '[:lower:]')
    case "$PHASE" in
      done)
        if [[ "$BOARD_STATUS_NORMALIZED" != "in progress" && "$BOARD_STATUS_NORMALIZED" != "done" ]]; then
          echo -e "${RED}✗ Ticket #${TICKET} must be in 'In progress' (or already 'Done') before running transition-drafting done (current: ${BOARD_STATUS:-unknown}).${NC}" >&2
          exit 2
        fi
        ;;
      *)
        if [[ "$BOARD_STATUS_NORMALIZED" != "in progress" ]]; then
          echo -e "${RED}✗ Ticket #${TICKET} must be in 'In progress' before running transition-drafting ${PHASE} (current: ${BOARD_STATUS:-unknown}).${NC}" >&2
          exit 2
        fi
        ;;
    esac

    SRS_CLI=".claude/skills/sf-srs/scripts/srs-cli.sh"
    case "$PHASE" in
      ai-draft)
        echo -e "${BLUE}→ AI drafting phase for #${TICKET} (label: ${SRS_LABEL})${NC}"
        if [[ ! -x "$SRS_CLI" ]]; then
          echo -e "${RED}✗ Expected ${SRS_CLI} to be executable. Run the SRS skill install first.${NC}" >&2
          exit 2
        fi
        "$SRS_CLI" draft --ticket "$TICKET"
        ;;
      human-review)
        echo -e "${BLUE}→ Human review phase for #${TICKET}${NC}"
        echo "  Post a review checklist comment on the ticket and wait for the owner's approval."
        echo "  The Notion page URL should already be in the ticket (posted by the AI draft phase)."
        echo "  No automated action — this phase is driven by the human reviewer."
        ;;
      spawning)
        echo -e "${BLUE}→ Spawning phase for #${TICKET}${NC}"
        if [[ ! -x "$SRS_CLI" ]]; then
          echo -e "${RED}✗ Expected ${SRS_CLI} to be executable. Run the SRS skill install first.${NC}" >&2
          exit 2
        fi
        "$SRS_CLI" spawn --ticket "$TICKET"
        ;;
      done)
        echo -e "${BLUE}→ Closing drafting ticket #${TICKET}${NC}"
        SF_WORKFLOW_BYPASS_SRS_GUARD=1 route_to_tool "$WORKFLOW_TOOL" update-status "$TICKET" "Done"
        ;;
      *)
        echo -e "${RED}✗ Unknown phase '${PHASE}'${NC}" >&2
        echo "  Phases: ai-draft | human-review | spawning | done" >&2
        exit 1
        ;;
    esac
    ;;

  "")
    echo -e "${RED}Error: No command specified${NC}"
    echo ""
    echo "Usage: workflow-cli.sh <command> [args...]"
    echo ""
    echo "Workflow status commands:"
    echo "  status <ticket>              Display current status and its description"
    echo "  next <ticket>                Show next status"
    echo "  validate <ticket>            Validate exit conditions"
    echo "  help                         Display skill documentation"
    echo ""
    echo "Complexity commands:"
    echo "  detect-complexity <ticket>   Auto-suggest complexity level"
    echo "  retag <ticket> <complexity>  Change ticket complexity"
    echo ""
    echo "Workflow phase commands (complexity-adaptive):"
    echo "  prepare <ticket> <complexity>    Run analyze + plan (Backlog → Ready)"
    echo "  test <ticket> [complexity]       Run validation + examine (→ AI Testing)"
    echo ""
    echo "SRS drafting lifecycle (for tickets tagged srs:drafting|srs:update|srs:new):"
    echo "  transition-drafting <ticket> <phase>"
    echo "    phase: ai-draft | human-review | spawning | done"
    echo "    Dispatches to .claude/skills/sf-srs/scripts/srs-cli.sh for draft/spawn."
    echo ""
    echo "Tool commands (delegated to tool-specific CLI):"
    echo "  create-subtask ...           Create a sub-issue/task"
    echo "  update-status ...            Update ticket status (SRS-label guarded)"
    echo "  create-pr ...                Create pull request"
    echo "  list ...                     List tickets"
    echo "  get-labels <ticket>          List every label on a ticket"
    exit 1
    ;;

  *)
    echo -e "${RED}Error: Unknown command '${COMMAND}'${NC}"
    echo ""
    echo "Available commands: status, next, validate, help, detect-complexity, retag, prepare, test, create-subtask, update-status, create-pr, list, get-labels, transition-drafting"
    echo "Run 'workflow-cli.sh help' for usage details"
    exit 1
    ;;
esac
