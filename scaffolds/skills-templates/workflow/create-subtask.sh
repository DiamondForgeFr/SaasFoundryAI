#!/bin/bash

# Create a GitHub sub-issue linked to a parent issue
# Usage: ./create-subtask.sh <parent-number> <title> [body]

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check arguments
if [ "$#" -lt 2 ]; then
  echo -e "${RED}Error: Missing arguments${NC}"
  echo "Usage: $0 <parent-number> <title> [body]"
  echo ""
  echo "Example:"
  echo "  $0 9 \"Add validation logic\""
  echo "  $0 9 \"Add validation logic\" \"Implement validation for user input\""
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

# Extract issue number from URL (e.g., https://github.com/owner/repo/issues/123)
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
  echo ""
  echo "Next steps:"
  echo "  1. Move subtask #${CHILD_NUMBER} to 'In Progress' when you start working on it"
  echo "  2. Mark it 'Done' when completed"
else
  echo -e "${RED}Error: Failed to link subtask${NC}"
  echo "$RESULT"
  exit 1
fi
