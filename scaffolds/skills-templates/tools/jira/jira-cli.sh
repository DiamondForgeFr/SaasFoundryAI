#!/bin/bash

# Jira CLI - Single CLI with subcommands
# Usage: ./jira-cli.sh <command> [args...]

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get command
COMMAND=$1
shift || true

# Load credentials
load_credentials() {
  local CREDENTIALS_DIR="$HOME/.claude/credentials/jira"
  local MANIFEST_PATH=".saasfoundry.json"

  # Check for project-level account configuration
  if [[ -f "$MANIFEST_PATH" ]]; then
    ACCOUNT_NAME=$(python3 -c "
import json
try:
    with open('$MANIFEST_PATH') as f:
        data = json.load(f)
        print(data.get('skillsAccounts', {}).get('jira', ''))
except:
    pass
" 2>/dev/null || echo "")

    if [[ -n "$ACCOUNT_NAME" ]]; then
      CREDENTIALS_FILE="$CREDENTIALS_DIR/$ACCOUNT_NAME.env"
      if [[ -f "$CREDENTIALS_FILE" ]]; then
        source "$CREDENTIALS_FILE"
        echo -e "${BLUE}Using Jira account: $ACCOUNT_NAME${NC}" >&2
        return
      fi
    fi
  fi

  # Fallback to local .env
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if [[ -f "$SCRIPT_DIR/.env" ]]; then
    source "$SCRIPT_DIR/.env"
  else
    echo -e "${RED}Error: No Jira credentials found${NC}" >&2
    echo "Run: sf tools add jira <account-name>" >&2
    exit 1
  fi
}

# Load configuration
load_config() {
  if [ ! -f ".saasfoundry.json" ]; then
    echo -e "${RED}Error: .saasfoundry.json not found${NC}"
    echo "This command must be run from the project root."
    exit 1
  fi

  PROJECT_URL=$(jq -r '.workflow.projectUrl // empty' .saasfoundry.json)
  WORKING_BRANCH=$(jq -r '.workflow.workingBranch // "develop"' .saasfoundry.json)
}

# Make authenticated Jira API request
jira_api() {
  local METHOD=$1
  local ENDPOINT=$2
  local DATA=${3:-""}

  local URL="${JIRA_URL}${ENDPOINT}"
  local AUTH=$(echo -n "${JIRA_EMAIL}:${JIRA_API_TOKEN}" | base64)

  if [ -n "$DATA" ]; then
    curl -s -X "$METHOD" "$URL" \
      -H "Authorization: Basic $AUTH" \
      -H "Content-Type: application/json" \
      -d "$DATA"
  else
    curl -s -X "$METHOD" "$URL" \
      -H "Authorization: Basic $AUTH" \
      -H "Content-Type: application/json"
  fi
}

# Command: create-subtask
cmd_create_subtask() {
  if [ "$#" -lt 2 ]; then
    echo -e "${RED}Error: Missing arguments${NC}"
    echo "Usage: $0 create-subtask <parent-key> <title> [description]"
    echo ""
    echo "Example:"
    echo "  $0 create-subtask PROJ-42 \"Add validation logic\""
    exit 1
  fi

  load_credentials

  PARENT_KEY=$1
  TITLE=$2
  DESCRIPTION=${3:-""}

  echo -e "${YELLOW}Creating subtask for parent issue ${PARENT_KEY}...${NC}"

  # Get parent issue to verify it exists
  PARENT_DATA=$(jira_api GET "/rest/api/3/issue/${PARENT_KEY}")

  if echo "$PARENT_DATA" | jq -e '.errorMessages' > /dev/null 2>&1; then
    echo -e "${RED}Error: Parent issue ${PARENT_KEY} not found${NC}"
    exit 1
  fi

  PROJECT_KEY=$(echo "$PARENT_DATA" | jq -r '.fields.project.key')
  PARENT_ID=$(echo "$PARENT_DATA" | jq -r '.id')

  # Create subtask
  PAYLOAD=$(cat <<EOF
{
  "fields": {
    "project": {
      "key": "$PROJECT_KEY"
    },
    "parent": {
      "key": "$PARENT_KEY"
    },
    "summary": "$TITLE",
    "description": {
      "type": "doc",
      "version": 1,
      "content": [
        {
          "type": "paragraph",
          "content": [
            {
              "type": "text",
              "text": "$DESCRIPTION"
            }
          ]
        }
      ]
    },
    "issuetype": {
      "name": "Sub-task"
    }
  }
}
EOF
)

  RESULT=$(jira_api POST "/rest/api/3/issue" "$PAYLOAD")

  if echo "$RESULT" | jq -e '.key' > /dev/null 2>&1; then
    SUBTASK_KEY=$(echo "$RESULT" | jq -r '.key')
    SUBTASK_URL="${JIRA_URL}/browse/${SUBTASK_KEY}"

    echo -e "${GREEN}✓ Subtask ${SUBTASK_KEY} created and linked to ${PARENT_KEY}${NC}"
    echo "Issue URL: $SUBTASK_URL"
  else
    echo -e "${RED}Error: Failed to create subtask${NC}"
    echo "$RESULT" | jq '.'
    exit 1
  fi
}

# Command: update-status
cmd_update_status() {
  if [ "$#" -lt 2 ]; then
    echo -e "${RED}Error: Missing arguments${NC}"
    echo "Usage: $0 update-status <issue-key> <status-name>"
    exit 1
  fi

  load_credentials

  ISSUE_KEY=$1
  STATUS_NAME=$2

  echo -e "${YELLOW}Updating ${ISSUE_KEY} to status '${STATUS_NAME}'...${NC}"

  # Get available transitions
  TRANSITIONS=$(jira_api GET "/rest/api/3/issue/${ISSUE_KEY}/transitions")

  if echo "$TRANSITIONS" | jq -e '.errorMessages' > /dev/null 2>&1; then
    echo -e "${RED}Error: Issue ${ISSUE_KEY} not found${NC}"
    exit 1
  fi

  # Find transition ID by name
  TRANSITION_ID=$(echo "$TRANSITIONS" | jq -r ".transitions[] | select(.to.name == \"$STATUS_NAME\") | .id")

  if [ -z "$TRANSITION_ID" ]; then
    echo -e "${RED}Error: No transition to status '${STATUS_NAME}' found${NC}"
    echo "Available transitions:"
    echo "$TRANSITIONS" | jq -r '.transitions[] | "  - \(.to.name)"'
    exit 1
  fi

  # Perform transition
  PAYLOAD="{\"transition\": {\"id\": \"$TRANSITION_ID\"}}"
  RESULT=$(jira_api POST "/rest/api/3/issue/${ISSUE_KEY}/transitions" "$PAYLOAD")

  echo -e "${GREEN}✓ Updated ${ISSUE_KEY} to '${STATUS_NAME}'${NC}"
}

# Command: transition
cmd_transition() {
  if [ "$#" -lt 2 ]; then
    echo -e "${RED}Error: Missing arguments${NC}"
    echo "Usage: $0 transition <issue-key> <transition-id>"
    exit 1
  fi

  load_credentials

  ISSUE_KEY=$1
  TRANSITION_ID=$2

  PAYLOAD="{\"transition\": {\"id\": \"$TRANSITION_ID\"}}"
  RESULT=$(jira_api POST "/rest/api/3/issue/${ISSUE_KEY}/transitions" "$PAYLOAD")

  echo -e "${GREEN}✓ Transitioned ${ISSUE_KEY}${NC}"
}

# Command: status
cmd_status() {
  if [ "$#" -lt 1 ]; then
    echo -e "${RED}Error: Missing issue key${NC}"
    echo "Usage: $0 status <issue-key>"
    exit 1
  fi

  load_credentials

  ISSUE_KEY=$1

  ISSUE_DATA=$(jira_api GET "/rest/api/3/issue/${ISSUE_KEY}?fields=summary,status,assignee")

  if echo "$ISSUE_DATA" | jq -e '.errorMessages' > /dev/null 2>&1; then
    echo -e "${RED}Error: Issue ${ISSUE_KEY} not found${NC}"
    exit 1
  fi

  SUMMARY=$(echo "$ISSUE_DATA" | jq -r '.fields.summary')
  STATUS=$(echo "$ISSUE_DATA" | jq -r '.fields.status.name')
  ASSIGNEE=$(echo "$ISSUE_DATA" | jq -r '.fields.assignee.displayName // "Unassigned"')

  echo -e "${BLUE}${ISSUE_KEY}: ${SUMMARY}${NC}"
  echo "Status: $STATUS"
  echo "Assignee: $ASSIGNEE"
}

# Command: list
cmd_list() {
  load_credentials

  STATUS_FILTER=${1:-""}

  if [ -n "$STATUS_FILTER" ]; then
    JQL="project = ${JIRA_PROJECT_KEY} AND status = '${STATUS_FILTER}' ORDER BY created DESC"
  else
    JQL="project = ${JIRA_PROJECT_KEY} ORDER BY created DESC"
  fi

  RESULT=$(jira_api GET "/rest/api/3/search?jql=$(echo "$JQL" | jq -sRr @uri)&maxResults=50")

  echo "$RESULT" | jq -r '.issues[] | "\(.key): \(.fields.summary) [\(.fields.status.name)]"'
}

# Main command router
case "$COMMAND" in
  create-subtask)
    cmd_create_subtask "$@"
    ;;
  update-status)
    cmd_update_status "$@"
    ;;
  transition)
    cmd_transition "$@"
    ;;
  status)
    cmd_status "$@"
    ;;
  list)
    cmd_list "$@"
    ;;
  "")
    echo -e "${RED}Error: No command specified${NC}"
    echo ""
    echo "Usage: $0 <command> [args...]"
    echo ""
    echo "Available commands:"
    echo "  create-subtask <parent-key> <title> [desc]  - Create a sub-task linked to parent"
    echo "  update-status <issue-key> <status>          - Update issue status"
    echo "  transition <issue-key> <transition-id>      - Perform specific transition"
    echo "  status <issue-key>                          - Get current issue status"
    echo "  list [status]                               - List issues (optionally filtered)"
    exit 1
    ;;
  *)
    echo -e "${RED}Error: Unknown command '${COMMAND}'${NC}"
    echo "Available commands: create-subtask, update-status, transition, status, list"
    exit 1
    ;;
esac
