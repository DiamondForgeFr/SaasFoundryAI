#!/bin/bash

# Linear CLI - Single CLI with subcommands
# Usage: ./linear-cli.sh <command> [args...]

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
  local CREDENTIALS_DIR="$HOME/.claude/credentials/linear"
  local MANIFEST_PATH=".saasfoundry.json"

  # Check for project-level account configuration
  if [[ -f "$MANIFEST_PATH" ]]; then
    ACCOUNT_NAME=$(python3 -c "
import json
try:
    with open('$MANIFEST_PATH') as f:
        data = json.load(f)
        print(data.get('skillsAccounts', {}).get('linear', ''))
except:
    pass
" 2>/dev/null || echo "")

    if [[ -n "$ACCOUNT_NAME" ]]; then
      CREDENTIALS_FILE="$CREDENTIALS_DIR/$ACCOUNT_NAME.env"
      if [[ -f "$CREDENTIALS_FILE" ]]; then
        source "$CREDENTIALS_FILE"
        echo -e "${BLUE}Using Linear account: $ACCOUNT_NAME${NC}" >&2
        return
      fi
    fi
  fi

  # Fallback to local .env
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if [[ -f "$SCRIPT_DIR/.env" ]]; then
    source "$SCRIPT_DIR/.env"
  else
    echo -e "${RED}Error: No Linear credentials found${NC}" >&2
    echo "Run: sf tools add linear <account-name>" >&2
    exit 1
  fi
}

# Make authenticated Linear GraphQL request
linear_api() {
  local QUERY=$1

  curl -s -X POST https://api.linear.app/graphql \
    -H "Authorization: $LINEAR_API_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"query\": $(echo "$QUERY" | jq -Rs .)}"
}

# Command: create-issue
cmd_create_issue() {
  if [ "$#" -lt 1 ]; then
    echo -e "${RED}Error: Missing arguments${NC}"
    echo "Usage: $0 create-issue <title> [description]"
    echo ""
    echo "Example:"
    echo "  $0 create-issue \"Add validation logic\""
    exit 1
  fi

  load_credentials

  TITLE=$1
  DESCRIPTION=${2:-""}

  echo -e "${YELLOW}Creating Linear issue '${TITLE}'...${NC}"

  QUERY="mutation {
    issueCreate(input: {
      teamId: \"$LINEAR_TEAM_ID\"
      title: \"$TITLE\"
      description: \"$DESCRIPTION\"
    }) {
      success
      issue {
        id
        identifier
        url
        title
      }
    }
  }"

  RESULT=$(linear_api "$QUERY")

  if echo "$RESULT" | jq -e '.data.issueCreate.success' > /dev/null 2>&1; then
    ISSUE_ID=$(echo "$RESULT" | jq -r '.data.issueCreate.issue.identifier')
    ISSUE_URL=$(echo "$RESULT" | jq -r '.data.issueCreate.issue.url')

    echo -e "${GREEN}✓ Issue ${ISSUE_ID} created${NC}"
    echo "URL: $ISSUE_URL"
  else
    echo -e "${RED}Error: Failed to create issue${NC}"
    echo "$RESULT" | jq '.'
    exit 1
  fi
}

# Command: create-sub-issue
cmd_create_sub_issue() {
  if [ "$#" -lt 2 ]; then
    echo -e "${RED}Error: Missing arguments${NC}"
    echo "Usage: $0 create-sub-issue <parent-id> <title>"
    echo ""
    echo "Example:"
    echo "  $0 create-sub-issue ABC-123 \"Backend API\""
    exit 1
  fi

  load_credentials

  PARENT_ID=$1
  TITLE=$2

  echo -e "${YELLOW}Creating sub-issue for ${PARENT_ID}...${NC}"

  # First, get parent issue's internal ID
  PARENT_QUERY="query {
    issue(id: \"$PARENT_ID\") {
      id
    }
  }"

  PARENT_RESULT=$(linear_api "$PARENT_QUERY")
  PARENT_INTERNAL_ID=$(echo "$PARENT_RESULT" | jq -r '.data.issue.id')

  if [ -z "$PARENT_INTERNAL_ID" ] || [ "$PARENT_INTERNAL_ID" = "null" ]; then
    echo -e "${RED}Error: Parent issue ${PARENT_ID} not found${NC}"
    exit 1
  fi

  # Create sub-issue
  QUERY="mutation {
    issueCreate(input: {
      teamId: \"$LINEAR_TEAM_ID\"
      title: \"$TITLE\"
      parentId: \"$PARENT_INTERNAL_ID\"
    }) {
      success
      issue {
        id
        identifier
        url
        title
      }
    }
  }"

  RESULT=$(linear_api "$QUERY")

  if echo "$RESULT" | jq -e '.data.issueCreate.success' > /dev/null 2>&1; then
    ISSUE_ID=$(echo "$RESULT" | jq -r '.data.issueCreate.issue.identifier')
    ISSUE_URL=$(echo "$RESULT" | jq -r '.data.issueCreate.issue.url')

    echo -e "${GREEN}✓ Sub-issue ${ISSUE_ID} created and linked to ${PARENT_ID}${NC}"
    echo "URL: $ISSUE_URL"
  else
    echo -e "${RED}Error: Failed to create sub-issue${NC}"
    echo "$RESULT" | jq '.'
    exit 1
  fi
}

# Command: update-status
cmd_update_status() {
  if [ "$#" -lt 2 ]; then
    echo -e "${RED}Error: Missing arguments${NC}"
    echo "Usage: $0 update-status <issue-id> <status-name>"
    exit 1
  fi

  load_credentials

  ISSUE_ID=$1
  STATUS_NAME=$2

  echo -e "${YELLOW}Updating ${ISSUE_ID} to status '${STATUS_NAME}'...${NC}"

  # Get workflow state ID by name
  STATE_QUERY="query {
    team(id: \"$LINEAR_TEAM_ID\") {
      states {
        nodes {
          id
          name
        }
      }
    }
  }"

  STATE_RESULT=$(linear_api "$STATE_QUERY")
  STATE_ID=$(echo "$STATE_RESULT" | jq -r ".data.team.states.nodes[] | select(.name == \"$STATUS_NAME\") | .id")

  if [ -z "$STATE_ID" ] || [ "$STATE_ID" = "null" ]; then
    echo -e "${RED}Error: Status '${STATUS_NAME}' not found${NC}"
    echo "Available statuses:"
    echo "$STATE_RESULT" | jq -r '.data.team.states.nodes[] | "  - \(.name)"'
    exit 1
  fi

  # Update issue
  QUERY="mutation {
    issueUpdate(id: \"$ISSUE_ID\", input: {
      stateId: \"$STATE_ID\"
    }) {
      success
      issue {
        identifier
        state {
          name
        }
      }
    }
  }"

  RESULT=$(linear_api "$QUERY")

  if echo "$RESULT" | jq -e '.data.issueUpdate.success' > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Updated ${ISSUE_ID} to '${STATUS_NAME}'${NC}"
  else
    echo -e "${RED}Error: Failed to update status${NC}"
    echo "$RESULT" | jq '.'
    exit 1
  fi
}

# Command: status
cmd_status() {
  if [ "$#" -lt 1 ]; then
    echo -e "${RED}Error: Missing issue ID${NC}"
    echo "Usage: $0 status <issue-id>"
    exit 1
  fi

  load_credentials

  ISSUE_ID=$1

  QUERY="query {
    issue(id: \"$ISSUE_ID\") {
      identifier
      title
      state {
        name
      }
      assignee {
        name
      }
      description
    }
  }"

  RESULT=$(linear_api "$QUERY")

  if echo "$RESULT" | jq -e '.data.issue' > /dev/null 2>&1; then
    TITLE=$(echo "$RESULT" | jq -r '.data.issue.title')
    STATUS=$(echo "$RESULT" | jq -r '.data.issue.state.name')
    ASSIGNEE=$(echo "$RESULT" | jq -r '.data.issue.assignee.name // "Unassigned"')

    echo -e "${BLUE}${ISSUE_ID}: ${TITLE}${NC}"
    echo "Status: $STATUS"
    echo "Assignee: $ASSIGNEE"
  else
    echo -e "${RED}Error: Issue ${ISSUE_ID} not found${NC}"
    echo "$RESULT" | jq '.'
    exit 1
  fi
}

# Command: list
cmd_list() {
  load_credentials

  STATUS_FILTER=${1:-""}

  echo -e "${YELLOW}Listing issues...${NC}"

  if [ -n "$STATUS_FILTER" ]; then
    QUERY="query {
      issues(filter: {
        team: { id: { eq: \"$LINEAR_TEAM_ID\" } }
        state: { name: { eq: \"$STATUS_FILTER\" } }
      }) {
        nodes {
          identifier
          title
          state {
            name
          }
        }
      }
    }"
  else
    QUERY="query {
      issues(filter: {
        team: { id: { eq: \"$LINEAR_TEAM_ID\" } }
      }) {
        nodes {
          identifier
          title
          state {
            name
          }
        }
      }
    }"
  fi

  RESULT=$(linear_api "$QUERY")

  echo "$RESULT" | jq -r '.data.issues.nodes[] | "\(.identifier): \(.title) [\(.state.name)]"'
}

# Main command router
case "$COMMAND" in
  create-issue)
    cmd_create_issue "$@"
    ;;
  create-sub-issue)
    cmd_create_sub_issue "$@"
    ;;
  update-status)
    cmd_update_status "$@"
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
    echo "  create-issue <title> [description]      - Create an issue"
    echo "  create-sub-issue <parent-id> <title>    - Create a sub-issue"
    echo "  update-status <issue-id> <status>       - Update issue status"
    echo "  status <issue-id>                       - Get current issue status"
    echo "  list [status]                           - List issues (optionally filtered)"
    exit 1
    ;;
  *)
    echo -e "${RED}Error: Unknown command '${COMMAND}'${NC}"
    echo "Available commands: create-issue, create-sub-issue, update-status, status, list"
    exit 1
    ;;
esac
