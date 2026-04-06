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
  create-subtask|update-status|create-pr|list)
    load_config
    route_to_tool "$WORKFLOW_TOOL" "$COMMAND" "$@"
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
    echo "Tool commands (delegated to tool-specific CLI):"
    echo "  create-subtask ...           Create a sub-issue/task"
    echo "  update-status ...            Update ticket status"
    echo "  create-pr ...                Create pull request"
    echo "  list ...                     List tickets"
    exit 1
    ;;

  *)
    echo -e "${RED}Error: Unknown command '${COMMAND}'${NC}"
    echo ""
    echo "Available commands: status, next, validate, help, detect-complexity, retag, prepare, test, create-subtask, update-status, create-pr, list"
    echo "Run 'workflow-cli.sh help' for usage details"
    exit 1
    ;;
esac
