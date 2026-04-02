#!/bin/bash

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load configuration
if [[ -f "$SKILL_DIR/.env" ]]; then
  source "$SKILL_DIR/.env"
else
  echo "Error: .env file not found. Please configure your workflow settings." >&2
  exit 1
fi

# Function to get current status of a ticket
get_current_status() {
  local ticket=$1
  local status=""

  case "$WORKFLOW_TOOL" in
    github-projects)
      # Query GitHub Projects API to get ticket status
      status=$(gh issue view "$ticket" --json projectItems --jq '.projectItems[0].status.name' 2>/dev/null)
      ;;
    jira)
      # Query Jira API (requires jira CLI or API calls)
      echo "Jira integration not yet implemented" >&2
      return 1
      ;;
    notion)
      # Query Notion API
      echo "Notion integration not yet implemented" >&2
      return 1
      ;;
    linear)
      # Query Linear API
      echo "Linear integration not yet implemented" >&2
      return 1
      ;;
    *)
      echo "Unknown workflow tool: $WORKFLOW_TOOL" >&2
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
case "$1" in
  status)
    TICKET=$2
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
    TICKET=$2
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
    TICKET=$2
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

  *)
    echo "Usage: workflow-cli.sh {status|next|validate|help} [ticket-number]" >&2
    echo ""
    echo "Commands:"
    echo "  status <ticket>    Display current status and its description"
    echo "  next <ticket>      Show next status"
    echo "  validate <ticket>  Validate exit conditions (not yet implemented)"
    echo "  help               Display skill documentation"
    exit 1
    ;;
esac
