#!/bin/bash

# Notion CLI - Single CLI with subcommands
# Usage: ./notion-cli.sh <command> [args...]

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
  local CREDENTIALS_DIR="$HOME/.claude/credentials/notion"
  local MANIFEST_PATH=".saasfoundry.json"

  # Check for project-level account configuration
  if [[ -f "$MANIFEST_PATH" ]]; then
    ACCOUNT_NAME=$(python3 -c "
import json
try:
    with open('$MANIFEST_PATH') as f:
        data = json.load(f)
        print(data.get('skillsAccounts', {}).get('notion', ''))
except:
    pass
" 2>/dev/null || echo "")

    if [[ -n "$ACCOUNT_NAME" ]]; then
      CREDENTIALS_FILE="$CREDENTIALS_DIR/$ACCOUNT_NAME.env"
      if [[ -f "$CREDENTIALS_FILE" ]]; then
        source "$CREDENTIALS_FILE"
        echo -e "${BLUE}Using Notion account: $ACCOUNT_NAME${NC}" >&2
        return
      fi
    fi
  fi

  # Fallback to local .env
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if [[ -f "$SCRIPT_DIR/.env" ]]; then
    source "$SCRIPT_DIR/.env"
  else
    echo -e "${RED}Error: No Notion credentials found${NC}" >&2
    echo "Run: sf tools add notion <account-name>" >&2
    exit 1
  fi
}

# Make authenticated Notion API request
notion_api() {
  local METHOD=$1
  local ENDPOINT=$2
  local DATA=${3:-""}

  local URL="https://api.notion.com${ENDPOINT}"

  if [ -n "$DATA" ]; then
    curl -s -X "$METHOD" "$URL" \
      -H "Authorization: Bearer $NOTION_API_TOKEN" \
      -H "Content-Type: application/json" \
      -H "Notion-Version: 2022-06-28" \
      -d "$DATA"
  else
    curl -s -X "$METHOD" "$URL" \
      -H "Authorization: Bearer $NOTION_API_TOKEN" \
      -H "Content-Type: application/json" \
      -H "Notion-Version: 2022-06-28"
  fi
}

# Command: create-page
cmd_create_page() {
  if [ "$#" -lt 1 ]; then
    echo -e "${RED}Error: Missing arguments${NC}"
    echo "Usage: $0 create-page <title> [properties-json]"
    echo ""
    echo "Example:"
    echo "  $0 create-page \"Add validation logic\""
    exit 1
  fi

  load_credentials

  TITLE=$1
  PROPERTIES=${2:-"{}"}

  echo -e "${YELLOW}Creating Notion page '${TITLE}'...${NC}"

  # Build page payload
  PAYLOAD=$(cat <<EOF
{
  "parent": {
    "database_id": "$NOTION_DATABASE_ID"
  },
  "properties": {
    "Name": {
      "title": [
        {
          "text": {
            "content": "$TITLE"
          }
        }
      ]
    }
  }
}
EOF
)

  # Merge with additional properties if provided
  if [ "$PROPERTIES" != "{}" ]; then
    PAYLOAD=$(echo "$PAYLOAD" | jq --argjson props "$PROPERTIES" '.properties += $props')
  fi

  RESULT=$(notion_api POST "/v1/pages" "$PAYLOAD")

  if echo "$RESULT" | jq -e '.id' > /dev/null 2>&1; then
    PAGE_ID=$(echo "$RESULT" | jq -r '.id')
    PAGE_URL=$(echo "$RESULT" | jq -r '.url')

    echo -e "${GREEN}✓ Page created${NC}"
    echo "Page ID: $PAGE_ID"
    echo "URL: $PAGE_URL"
  else
    echo -e "${RED}Error: Failed to create page${NC}"
    echo "$RESULT" | jq '.'
    exit 1
  fi
}

# Command: update-property
cmd_update_property() {
  if [ "$#" -lt 3 ]; then
    echo -e "${RED}Error: Missing arguments${NC}"
    echo "Usage: $0 update-property <page-id> <property-name> <value>"
    exit 1
  fi

  load_credentials

  PAGE_ID=$1
  PROPERTY_NAME=$2
  VALUE=$3

  echo -e "${YELLOW}Updating property '${PROPERTY_NAME}' to '${VALUE}'...${NC}"

  # Simple text/status property update
  PAYLOAD=$(cat <<EOF
{
  "properties": {
    "$PROPERTY_NAME": {
      "status": {
        "name": "$VALUE"
      }
    }
  }
}
EOF
)

  RESULT=$(notion_api PATCH "/v1/pages/${PAGE_ID}" "$PAYLOAD")

  if echo "$RESULT" | jq -e '.id' > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Property updated${NC}"
  else
    echo -e "${RED}Error: Failed to update property${NC}"
    echo "$RESULT" | jq '.'
    exit 1
  fi
}

# Command: link-page
cmd_link_page() {
  if [ "$#" -lt 2 ]; then
    echo -e "${RED}Error: Missing arguments${NC}"
    echo "Usage: $0 link-page <parent-id> <child-id>"
    exit 1
  fi

  load_credentials

  PARENT_ID=$1
  CHILD_ID=$2

  echo -e "${YELLOW}Linking pages...${NC}"

  # Update child page to add parent relation
  PAYLOAD=$(cat <<EOF
{
  "properties": {
    "Parent": {
      "relation": [
        {
          "id": "$PARENT_ID"
        }
      ]
    }
  }
}
EOF
)

  RESULT=$(notion_api PATCH "/v1/pages/${CHILD_ID}" "$PAYLOAD")

  if echo "$RESULT" | jq -e '.id' > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Pages linked${NC}"
  else
    echo -e "${RED}Error: Failed to link pages${NC}"
    echo "$RESULT" | jq '.'
    exit 1
  fi
}

# Command: status
cmd_status() {
  if [ "$#" -lt 1 ]; then
    echo -e "${RED}Error: Missing page ID${NC}"
    echo "Usage: $0 status <page-id>"
    exit 1
  fi

  load_credentials

  PAGE_ID=$1

  RESULT=$(notion_api GET "/v1/pages/${PAGE_ID}")

  if echo "$RESULT" | jq -e '.id' > /dev/null 2>&1; then
    TITLE=$(echo "$RESULT" | jq -r '.properties.Name.title[0].text.content // "Untitled"')
    echo -e "${BLUE}Page: ${TITLE}${NC}"
    echo "$RESULT" | jq -r '.properties | to_entries[] | "\(.key): \(.value)"'
  else
    echo -e "${RED}Error: Page not found${NC}"
    echo "$RESULT" | jq '.'
    exit 1
  fi
}

# Command: list
cmd_list() {
  load_credentials

  STATUS_FILTER=${1:-""}

  echo -e "${YELLOW}Listing pages...${NC}"

  if [ -n "$STATUS_FILTER" ]; then
    PAYLOAD=$(cat <<EOF
{
  "filter": {
    "property": "Status",
    "status": {
      "equals": "$STATUS_FILTER"
    }
  }
}
EOF
)
    RESULT=$(notion_api POST "/v1/databases/${NOTION_DATABASE_ID}/query" "$PAYLOAD")
  else
    RESULT=$(notion_api POST "/v1/databases/${NOTION_DATABASE_ID}/query" "{}")
  fi

  echo "$RESULT" | jq -r '.results[] | .properties.Name.title[0].text.content + " [" + (.properties.Status.status.name // "No Status") + "]"'
}

# Main command router
case "$COMMAND" in
  create-page)
    cmd_create_page "$@"
    ;;
  update-property)
    cmd_update_property "$@"
    ;;
  link-page)
    cmd_link_page "$@"
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
    echo "  create-page <title> [properties]           - Create a page in database"
    echo "  update-property <page-id> <name> <value>   - Update page property"
    echo "  link-page <parent-id> <child-id>           - Link pages (relation)"
    echo "  status <page-id>                           - Get page status"
    echo "  list [status]                              - List pages (optionally filtered)"
    exit 1
    ;;
  *)
    echo -e "${RED}Error: Unknown command '${COMMAND}'${NC}"
    echo "Available commands: create-page, update-property, link-page, status, list"
    exit 1
    ;;
esac
