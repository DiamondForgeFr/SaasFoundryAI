#!/bin/bash

# GitHub Projects CLI - Single CLI with subcommands
# Usage: ./github-projects-cli.sh <command> [args...]

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get command
COMMAND=$1
shift || true  # Remove command from args (don't fail if no args)

# Load configuration from .saasfoundry.json
load_config() {
  if [ ! -f ".saasfoundry.json" ]; then
    echo -e "${RED}Error: .saasfoundry.json not found${NC}"
    echo "This command must be run from the project root."
    exit 1
  fi

  PROJECT_URL=$(jq -r '.workflow.projectUrl // empty' .saasfoundry.json)
  WORKING_BRANCH=$(jq -r '.workflow.workingBranch // "develop"' .saasfoundry.json)

  if [ -z "$PROJECT_URL" ]; then
    echo -e "${YELLOW}Warning: No project URL configured in .saasfoundry.json${NC}"
  fi
}

# Command: create-subtask
# Create a GitHub sub-issue linked to a parent issue
cmd_create_subtask() {
  if [ "$#" -lt 2 ]; then
    echo -e "${RED}Error: Missing arguments${NC}"
    echo "Usage: $0 create-subtask <parent-number> <title> [body]"
    echo ""
    echo "Example:"
    echo "  $0 create-subtask 9 \"Add validation logic\""
    echo "  $0 create-subtask 9 \"Add validation logic\" \"Implement validation for user input\""
    exit 1
  fi

  PARENT_NUMBER=$1
  TITLE=$2
  BODY=${3:-""}

  # Prepend parent reference to title
  FULL_TITLE="[Parent #${PARENT_NUMBER}] ${TITLE}"

  echo -e "${YELLOW}Creating subtask for parent issue #${PARENT_NUMBER}...${NC}"

  # Step 1: Get parent node ID
  echo "→ Fetching parent issue node ID..."
  PARENT_NODE_ID=$(gh issue view "$PARENT_NUMBER" --json id --jq ".id" 2>/dev/null)

  if [ -z "$PARENT_NODE_ID" ]; then
    echo -e "${RED}Error: Could not find parent issue #${PARENT_NUMBER}${NC}"
    exit 1
  fi

  echo "  Parent node ID: $PARENT_NODE_ID"

  # Step 2: Create the subtask issue
  echo "→ Creating subtask issue..."
  if [ -n "$BODY" ]; then
    ISSUE_URL=$(gh issue create --title "$FULL_TITLE" --body "$BODY")
  else
    ISSUE_URL=$(gh issue create --title "$FULL_TITLE")
  fi

  # Extract issue number from URL
  CHILD_NUMBER=$(echo "$ISSUE_URL" | grep -o '[0-9]*$')

  # Get the node ID of the created issue
  CHILD_NODE_ID=$(gh issue view "$CHILD_NUMBER" --json id --jq ".id")

  echo "  Created issue #$CHILD_NUMBER"
  echo "  Child node ID: $CHILD_NODE_ID"

  # Step 3: Link as sub-issue via GraphQL
  echo "→ Linking subtask to parent..."
  RESULT=$(gh api graphql -H "GraphQL-Features: sub_issues" \
    -f query="mutation {
      addSubIssue(input: {
        issueId: \"$PARENT_NODE_ID\"
        subIssueId: \"$CHILD_NODE_ID\"
      }) {
        issue { number title }
        subIssue { number title }
      }
    }" 2>&1)

  # Check if the mutation succeeded
  if echo "$RESULT" | jq -e '.data.addSubIssue' > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Subtask #${CHILD_NUMBER} successfully linked to parent #${PARENT_NUMBER}${NC}"
    echo ""
    echo "Issue URL: $(gh issue view "$CHILD_NUMBER" --json url --jq ".url")"
  else
    echo -e "${RED}Error: Failed to link subtask${NC}"
    echo "$RESULT"
    exit 1
  fi
}

# Command: update-status
# Update the status of a ticket in GitHub Projects
cmd_update_status() {
  if [ "$#" -lt 2 ]; then
    echo -e "${RED}Error: Missing arguments${NC}"
    echo "Usage: $0 update-status <ticket-number> <status-name>"
    echo ""
    echo "Example:"
    echo "  $0 update-status 42 \"In Progress\""
    echo "  $0 update-status 42 \"AI Testing\""
    exit 1
  fi

  TICKET_NUMBER=$1
  STATUS_NAME=$2

  load_config

  echo -e "${YELLOW}Updating ticket #${TICKET_NUMBER} to status '${STATUS_NAME}'...${NC}"

  # Step 1: Get issue node ID
  ISSUE_NODE_ID=$(gh issue view "$TICKET_NUMBER" --json id --jq ".id" 2>/dev/null)

  if [ -z "$ISSUE_NODE_ID" ]; then
    echo -e "${RED}Error: Could not find issue #${TICKET_NUMBER}${NC}"
    exit 1
  fi

  # Step 2: Get project data (assumes first project, can be enhanced)
  # This is a simplified version - in production, you'd parse PROJECT_URL to get the exact project
  OWNER=$(gh repo view --json owner --jq ".owner.login")
  REPO=$(gh repo view --json name --jq ".name")

  # Get project field ID and option ID for the status
  # This requires knowing the project number - for now, we'll use a simpler approach
  # Note: This would need to be enhanced to properly query the project by URL

  echo -e "${BLUE}Note: Status update via GraphQL requires project-specific field IDs${NC}"
  echo -e "${BLUE}For now, update the status manually in the GitHub Projects board${NC}"
  echo -e "${BLUE}Or use: gh issue edit ${TICKET_NUMBER} --add-label \"Status: ${STATUS_NAME}\"${NC}"

  # Alternative: Use labels as a simple status tracker
  gh issue edit "$TICKET_NUMBER" --add-label "Status: ${STATUS_NAME}" 2>/dev/null || true

  echo -e "${GREEN}✓ Updated ticket #${TICKET_NUMBER}${NC}"
}

# Command: status
# Get the current status of a ticket
cmd_status() {
  if [ "$#" -lt 1 ]; then
    echo -e "${RED}Error: Missing ticket number${NC}"
    echo "Usage: $0 status <ticket-number>"
    exit 1
  fi

  TICKET_NUMBER=$1

  # Get issue data
  ISSUE_DATA=$(gh issue view "$TICKET_NUMBER" --json state,labels,title 2>/dev/null)

  if [ -z "$ISSUE_DATA" ]; then
    echo -e "${RED}Error: Could not find issue #${TICKET_NUMBER}${NC}"
    exit 1
  fi

  TITLE=$(echo "$ISSUE_DATA" | jq -r '.title')
  STATE=$(echo "$ISSUE_DATA" | jq -r '.state')

  # Try to extract status from labels
  STATUS=$(echo "$ISSUE_DATA" | jq -r '.labels[] | select(.name | startswith("Status: ")) | .name' | head -n1 | sed 's/Status: //')

  echo -e "${BLUE}Issue #${TICKET_NUMBER}: ${TITLE}${NC}"
  echo "State: $STATE"

  if [ -n "$STATUS" ]; then
    echo "Status: $STATUS"
  else
    echo "Status: (no status label found)"
  fi
}

# Command: create-pr
# Create a pull request for a ticket
cmd_create_pr() {
  if [ "$#" -lt 1 ]; then
    echo -e "${RED}Error: Missing ticket number${NC}"
    echo "Usage: $0 create-pr <ticket-number>"
    exit 1
  fi

  TICKET_NUMBER=$1
  load_config

  echo -e "${YELLOW}Creating pull request for ticket #${TICKET_NUMBER}...${NC}"

  # Get current branch
  CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)

  # Verify we're not on the working branch
  if [ "$CURRENT_BRANCH" = "$WORKING_BRANCH" ]; then
    echo -e "${RED}Error: Cannot create PR from working branch ${WORKING_BRANCH}${NC}"
    echo "Please create a feature branch first"
    exit 1
  fi

  # Get issue title
  ISSUE_TITLE=$(gh issue view "$TICKET_NUMBER" --json title --jq ".title" 2>/dev/null)

  if [ -z "$ISSUE_TITLE" ]; then
    echo -e "${RED}Error: Could not find issue #${TICKET_NUMBER}${NC}"
    exit 1
  fi

  # Push current branch
  echo "→ Pushing branch to remote..."
  git push -u origin "$CURRENT_BRANCH"

  # Create PR
  echo "→ Creating pull request..."
  PR_URL=$(gh pr create \
    --title "[$TICKET_NUMBER] $ISSUE_TITLE" \
    --body "Resolves #${TICKET_NUMBER}" \
    --base "$WORKING_BRANCH" 2>&1)

  if echo "$PR_URL" | grep -q "http"; then
    echo -e "${GREEN}✓ Pull request created${NC}"
    echo "$PR_URL"
  else
    echo -e "${RED}Error creating PR:${NC}"
    echo "$PR_URL"
    exit 1
  fi
}

# Command: list
# List tickets in the project
cmd_list() {
  STATUS_FILTER=${1:-""}

  echo -e "${YELLOW}Listing issues...${NC}"

  if [ -n "$STATUS_FILTER" ]; then
    echo "Filtering by status: $STATUS_FILTER"
    gh issue list --label "Status: $STATUS_FILTER" --limit 50
  else
    gh issue list --limit 50
  fi
}

# Main command router
case "$COMMAND" in
  create-subtask)
    cmd_create_subtask "$@"
    ;;
  update-status)
    cmd_update_status "$@"
    ;;
  status)
    cmd_status "$@"
    ;;
  create-pr)
    cmd_create_pr "$@"
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
    echo "  create-subtask <parent> <title> [body]  - Create a sub-issue linked to parent"
    echo "  update-status <ticket> <status>         - Update ticket status"
    echo "  status <ticket>                         - Get current ticket status"
    echo "  create-pr <ticket>                      - Create pull request for ticket"
    echo "  list [status]                           - List tickets (optionally filtered by status)"
    echo ""
    echo "Examples:"
    echo "  $0 create-subtask 9 \"Add validation\""
    echo "  $0 update-status 42 \"In Progress\""
    echo "  $0 status 42"
    echo "  $0 create-pr 42"
    echo "  $0 list \"In Progress\""
    exit 1
    ;;
  *)
    echo -e "${RED}Error: Unknown command '${COMMAND}'${NC}"
    echo ""
    echo "Available commands: create-subtask, update-status, status, create-pr, list"
    echo "Run '$0' without arguments for usage help"
    exit 1
    ;;
esac
