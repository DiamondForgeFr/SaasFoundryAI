#!/bin/bash

# GitHub Projects CLI - Single CLI with subcommands
# Usage: ./github-projects-cli.sh <command> [args...]
#
# Backend: GitHub Projects V2 (via `gh project` CLI). Status lives on the board,
# complexity lives as a label on the issue (convention: `complexity: <level>`).

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

COMMAND=$1
shift || true

# ───────────────────────────────────────────────────────────────────────────
# Configuration
# ───────────────────────────────────────────────────────────────────────────

load_config() {
  if [ ! -f ".saasfoundry.json" ]; then
    echo -e "${RED}Error: .saasfoundry.json not found${NC}" >&2
    echo "This command must be run from the project root." >&2
    exit 1
  fi

  PROJECT_URL=$(jq -r '.workflow.projectUrl // empty' .saasfoundry.json)
  WORKING_BRANCH=$(jq -r '.workflow.workingBranch // "develop"' .saasfoundry.json)

  # Parse owner and project number from URL
  # Formats supported:
  #   https://github.com/orgs/{owner}/projects/{number}
  #   https://github.com/users/{owner}/projects/{number}
  PROJECT_OWNER=""
  PROJECT_NUMBER=""
  if [ -n "$PROJECT_URL" ]; then
    PROJECT_OWNER=$(echo "$PROJECT_URL" | sed -nE 's#https?://github.com/(orgs|users)/([^/]+)/projects/[0-9]+.*#\2#p')
    PROJECT_NUMBER=$(echo "$PROJECT_URL" | sed -nE 's#.*/projects/([0-9]+).*#\1#p')
  fi
}

# Schema cache — project id, status field id, and option ids rarely change
# (board-owner edits only) so they're safe to persist across script runs. Item
# states mutate constantly in a multi-dev board and MUST NEVER be cached here.
# On-disk shape:
#   { "projectId":"...", "statusFieldId":"...", "statusOptions":[{id,name},...] }
_SF_CACHE_DIR="${SF_CACHE_DIR:-/tmp/sf-workflow-cache-${USER:-anon}}"
_SF_CACHE_TTL="${SF_CACHE_TTL:-3600}"

_cache_path() {
  mkdir -p "$_SF_CACHE_DIR" 2>/dev/null || true
  echo "$_SF_CACHE_DIR/project-${PROJECT_OWNER}-${PROJECT_NUMBER}.json"
}

_cache_fresh() {
  local path=$1
  [ -f "$path" ] || return 1
  local mtime now
  # `stat -f %m` is BSD/macOS; on GNU/Linux `-f` formats the filesystem and
  # returns the mountpoint, which would crash the arithmetic below under set -e.
  # Branch on OSTYPE so each platform gets the right flag.
  if [[ "$OSTYPE" == "darwin"* ]] || [[ "$OSTYPE" == "freebsd"* ]] || [[ "$OSTYPE" == "openbsd"* ]]; then
    mtime=$(stat -f %m "$path" 2>/dev/null)
  else
    mtime=$(stat -c %Y "$path" 2>/dev/null)
  fi
  [[ "$mtime" =~ ^[0-9]+$ ]] || return 1
  now=$(date +%s)
  [ "$((now - mtime))" -lt "$_SF_CACHE_TTL" ]
}

# Populate PROJECT_ID, STATUS_FIELD_ID, STATUS_OPTIONS_JSON. Hits the cache
# when fresh (~0 API calls), otherwise refetches from the board and persists.
# Callers who previously used require_project + load_status_field should call
# this single entry point instead — it covers both.
load_project_schema() {
  load_config
  if [ -z "$PROJECT_OWNER" ] || [ -z "$PROJECT_NUMBER" ]; then
    echo -e "${RED}Error: workflow.projectUrl is missing or malformed in .saasfoundry.json${NC}" >&2
    echo "Expected: https://github.com/orgs/<owner>/projects/<number>" >&2
    exit 1
  fi

  local path
  path=$(_cache_path)
  if [ -z "${SF_CACHE_BUST:-}" ] && _cache_fresh "$path"; then
    PROJECT_ID=$(jq -r '.projectId // empty' "$path" 2>/dev/null)
    STATUS_FIELD_ID=$(jq -r '.statusFieldId // empty' "$path" 2>/dev/null)
    STATUS_OPTIONS_JSON=$(jq -c '.statusOptions // empty' "$path" 2>/dev/null)
    if [ -n "$PROJECT_ID" ] && [ -n "$STATUS_FIELD_ID" ] && [ -n "$STATUS_OPTIONS_JSON" ] && [ "$STATUS_OPTIONS_JSON" != "null" ]; then
      return 0
    fi
  fi

  PROJECT_ID=$(gh project view "$PROJECT_NUMBER" --owner "$PROJECT_OWNER" --format json 2>/dev/null | jq -r '.id // empty')
  if [ -z "$PROJECT_ID" ]; then
    echo -e "${RED}Error: Could not load project $PROJECT_NUMBER for owner $PROJECT_OWNER${NC}" >&2
    echo "Check that 'gh auth status' shows the 'project' scope." >&2
    exit 1
  fi

  local payload
  payload=$(gh project field-list "$PROJECT_NUMBER" --owner "$PROJECT_OWNER" --format json 2>/dev/null)
  STATUS_FIELD_ID=$(echo "$payload" | jq -r '.fields[] | select(.name == "Status") | .id')
  STATUS_OPTIONS_JSON=$(echo "$payload" | jq -c '.fields[] | select(.name == "Status") | .options')
  if [ -z "$STATUS_FIELD_ID" ] || [ "$STATUS_FIELD_ID" = "null" ]; then
    echo -e "${RED}Error: Project has no 'Status' field${NC}" >&2
    exit 1
  fi

  jq -n \
    --arg pid "$PROJECT_ID" \
    --arg fid "$STATUS_FIELD_ID" \
    --argjson opts "$STATUS_OPTIONS_JSON" \
    '{projectId:$pid, statusFieldId:$fid, statusOptions:$opts}' > "$path" 2>/dev/null || true
}

# Back-compat aliases so callers (and tests) don't have to rename everything.
# Both resolve through the cached schema loader.
require_project() { load_project_schema; }
load_status_field() { load_project_schema; }

# Return option id for a status name (case-insensitive).
# Usage: find_status_option_id "In progress"
find_status_option_id() {
  local name=$1
  echo "$STATUS_OPTIONS_JSON" | jq -r --arg s "$name" '
    .[] | select((.name | ascii_downcase) == ($s | ascii_downcase)) | .id
  ' | head -n1
}

# Resolve the current repo as "owner/name". Cached in-process to avoid repeat
# `gh repo view` calls within a single script invocation.
_GH_REPO_CACHE=""
get_repo_owner_name() {
  if [ -z "$_GH_REPO_CACHE" ]; then
    _GH_REPO_CACHE=$(gh repo view --json nameWithOwner --jq '.nameWithOwner' 2>/dev/null)
  fi
  echo "$_GH_REPO_CACHE"
}

# Single targeted GraphQL query that returns everything the skill needs about a
# ticket's relationship with the current project board. O(1) in board size — it
# traverses from the issue down to its projectItems rather than scanning the
# whole board. Emits a compact JSON object on stdout:
#   { "title": "...", "state": "OPEN"|"CLOSED", "itemId": "..." | null, "status": "In progress" | null }
# The itemId and status are null if the issue is not on the configured project
# board (identified by PROJECT_NUMBER).
query_project_item() {
  local ticket=$1
  local repo owner name
  repo=$(get_repo_owner_name)
  if [ -z "$repo" ]; then
    echo '{"title":"","state":"","itemId":null,"status":null}'
    return 1
  fi
  owner="${repo%/*}"
  name="${repo#*/}"

  local resp
  resp=$(gh api graphql \
    -f query='query($o:String!,$r:String!,$n:Int!){
      repository(owner:$o,name:$r){
        issue(number:$n){
          title
          state
          projectItems(first:10){
            nodes{
              id
              project{number}
              fieldValueByName(name:"Status"){
                ... on ProjectV2ItemFieldSingleSelectValue{ name }
              }
            }
          }
        }
      }
    }' \
    -F o="$owner" -F r="$name" -F "n=${ticket}" 2>/dev/null)

  if [ -z "$resp" ]; then
    echo '{"title":"","state":"","itemId":null,"status":null}'
    return 1
  fi

  echo "$resp" | jq -c --arg p "$PROJECT_NUMBER" '
    (.data.repository.issue // null) as $issue
    | if $issue == null then
        {title:"", state:"", itemId:null, status:null}
      else
        ([$issue.projectItems.nodes[]? | select(.project.number == ($p | tonumber))] | .[0] // null) as $pi
        | {
            title: ($issue.title // ""),
            state: ($issue.state // ""),
            itemId: ($pi.id // null),
            status: ($pi.fieldValueByName.name // null)
          }
      end
  '
}

# Return the Projects V2 item id for a ticket number, empty if not in project.
get_project_item_id() {
  local ticket=$1
  query_project_item "$ticket" | jq -r '.itemId // ""'
}

# Return the Status text for a ticket number, empty if not on the board.
get_ticket_status() {
  local ticket=$1
  query_project_item "$ticket" | jq -r '.status // ""'
}

# ───────────────────────────────────────────────────────────────────────────
# Command: create-subtask
# ───────────────────────────────────────────────────────────────────────────

cmd_create_subtask() {
  if [ "$#" -lt 2 ]; then
    echo -e "${RED}Error: Missing arguments${NC}"
    echo "Usage: $0 create-subtask <parent-number> <title> [body]"
    exit 1
  fi

  PARENT_NUMBER=$1
  TITLE=$2
  BODY=${3:-""}
  FULL_TITLE="[Parent #${PARENT_NUMBER}] ${TITLE}"

  echo -e "${YELLOW}Creating subtask for parent issue #${PARENT_NUMBER}...${NC}"

  PARENT_NODE_ID=$(gh issue view "$PARENT_NUMBER" --json id --jq ".id" 2>/dev/null)
  if [ -z "$PARENT_NODE_ID" ]; then
    echo -e "${RED}Error: Could not find parent issue #${PARENT_NUMBER}${NC}"
    exit 1
  fi

  if [ -n "$BODY" ]; then
    ISSUE_URL=$(gh issue create --title "$FULL_TITLE" --body "$BODY")
  else
    ISSUE_URL=$(gh issue create --title "$FULL_TITLE")
  fi
  CHILD_NUMBER=$(echo "$ISSUE_URL" | grep -o '[0-9]*$')
  CHILD_NODE_ID=$(gh issue view "$CHILD_NUMBER" --json id --jq ".id")

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

  if echo "$RESULT" | jq -e '.data.addSubIssue' > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Subtask #${CHILD_NUMBER} linked to parent #${PARENT_NUMBER}${NC}"
    echo "Issue URL: $(gh issue view "$CHILD_NUMBER" --json url --jq ".url")"
  else
    echo -e "${RED}Error: Failed to link subtask${NC}"
    echo "$RESULT"
    exit 1
  fi
}

# ───────────────────────────────────────────────────────────────────────────
# Command: status — read status from Projects V2 board
# ───────────────────────────────────────────────────────────────────────────

cmd_status() {
  if [ "$#" -lt 1 ]; then
    echo "Usage: $0 status <ticket-number>" >&2
    exit 1
  fi
  local ticket=$1
  load_config
  if [ -z "$PROJECT_OWNER" ] || [ -z "$PROJECT_NUMBER" ]; then
    echo -e "${RED}Error: workflow.projectUrl is missing or malformed in .saasfoundry.json${NC}" >&2
    echo "Expected: https://github.com/orgs/<owner>/projects/<number>" >&2
    exit 1
  fi

  local info title state status
  info=$(query_project_item "$ticket")
  title=$(echo "$info" | jq -r '.title // ""')
  state=$(echo "$info" | jq -r '.state // ""')
  status=$(echo "$info" | jq -r '.status // ""')

  if [ -z "$title" ]; then
    echo -e "${RED}Error: Could not find issue #${ticket}${NC}" >&2
    exit 1
  fi

  echo -e "${BLUE}Issue #${ticket}: ${title}${NC}"
  echo "State: $state"
  if [ -n "$status" ]; then
    echo "Status: $status"
  else
    echo "Status: (not in project board)"
  fi
}

# ───────────────────────────────────────────────────────────────────────────
# Command: update-status — write status on Projects V2 board
# ───────────────────────────────────────────────────────────────────────────

cmd_update_status() {
  if [ "$#" -lt 2 ]; then
    echo "Usage: $0 update-status <ticket-number> <status-name>" >&2
    exit 1
  fi
  local ticket=$1
  local status_name=$2
  load_project_schema

  local item_id option_id
  item_id=$(get_project_item_id "$ticket")
  if [ -z "$item_id" ]; then
    echo -e "${RED}Error: Ticket #${ticket} is not on project board ${PROJECT_NUMBER}${NC}" >&2
    exit 1
  fi

  option_id=$(find_status_option_id "$status_name")
  if [ -z "$option_id" ]; then
    echo -e "${RED}Error: Unknown status '${status_name}'${NC}" >&2
    echo "Available statuses:" >&2
    echo "$STATUS_OPTIONS_JSON" | jq -r '.[].name' | sed 's/^/  - /' >&2
    exit 1
  fi

  gh project item-edit \
    --id "$item_id" \
    --project-id "$PROJECT_ID" \
    --field-id "$STATUS_FIELD_ID" \
    --single-select-option-id "$option_id" >/dev/null

  echo -e "${GREEN}✓ Ticket #${ticket} → ${status_name}${NC}"
}

# ───────────────────────────────────────────────────────────────────────────
# Command: set-complexity — bug | low | medium | complex (via label)
# ───────────────────────────────────────────────────────────────────────────

cmd_set_complexity() {
  if [ "$#" -lt 2 ]; then
    echo "Usage: $0 set-complexity <ticket-number> <bug|low|medium|complex>" >&2
    exit 1
  fi
  local ticket=$1
  local level=$2

  case "$level" in
    bug|low|medium|complex) ;;
    *)
      echo -e "${RED}Error: complexity must be one of: bug, low, medium, complex${NC}" >&2
      exit 1
      ;;
  esac

  # Remove any existing complexity label
  local existing
  existing=$(gh issue view "$ticket" --json labels --jq '.labels[].name' 2>/dev/null | grep -E '^complexity: ' || true)
  if [ -n "$existing" ]; then
    while IFS= read -r lbl; do
      [ -n "$lbl" ] && gh issue edit "$ticket" --remove-label "$lbl" >/dev/null 2>&1 || true
    done <<< "$existing"
  fi

  gh issue edit "$ticket" --add-label "complexity: ${level}" >/dev/null
  echo -e "${GREEN}✓ Ticket #${ticket} complexity → ${level}${NC}"
}

# ───────────────────────────────────────────────────────────────────────────
# Command: get-complexity — read current complexity label
# ───────────────────────────────────────────────────────────────────────────

cmd_get_complexity() {
  if [ "$#" -lt 1 ]; then
    echo "Usage: $0 get-complexity <ticket-number>" >&2
    exit 1
  fi
  local ticket=$1
  local lbl
  lbl=$(gh issue view "$ticket" --json labels --jq '.labels[].name' 2>/dev/null | grep -E '^complexity: ' | head -n1 | sed 's/^complexity: //')
  if [ -n "$lbl" ]; then
    echo "$lbl"
  else
    echo "(none)"
  fi
}

# ───────────────────────────────────────────────────────────────────────────
# Command: get-ticket — used by detect-complexity.sh
# ───────────────────────────────────────────────────────────────────────────

cmd_get_ticket() {
  if [ "$#" -lt 1 ]; then
    echo "Usage: $0 get-ticket <ticket-number>" >&2
    exit 1
  fi
  local ticket=$1
  local data
  data=$(gh issue view "$ticket" --json title,body 2>/dev/null)
  if [ -z "$data" ]; then
    echo -e "${RED}Error: Could not find issue #${ticket}${NC}" >&2
    exit 1
  fi
  echo "Title: $(echo "$data" | jq -r '.title')"
  echo "Description:"
  echo "$data" | jq -r '.body'
}

# ───────────────────────────────────────────────────────────────────────────
# Command: create-pr
# ───────────────────────────────────────────────────────────────────────────

cmd_create_pr() {
  if [ "$#" -lt 1 ]; then
    echo "Usage: $0 create-pr <ticket-number>" >&2
    exit 1
  fi
  TICKET_NUMBER=$1
  load_config

  echo -e "${YELLOW}Creating pull request for ticket #${TICKET_NUMBER}...${NC}"

  CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
  if [ "$CURRENT_BRANCH" = "$WORKING_BRANCH" ]; then
    echo -e "${RED}Error: Cannot create PR from working branch ${WORKING_BRANCH}${NC}"
    exit 1
  fi

  ISSUE_TITLE=$(gh issue view "$TICKET_NUMBER" --json title --jq ".title" 2>/dev/null)
  if [ -z "$ISSUE_TITLE" ]; then
    echo -e "${RED}Error: Could not find issue #${TICKET_NUMBER}${NC}"
    exit 1
  fi

  git push -u origin "$CURRENT_BRANCH"

  PR_URL=$(gh pr create \
    --title "[#${TICKET_NUMBER}] $ISSUE_TITLE" \
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

# ───────────────────────────────────────────────────────────────────────────
# Command: list — list items on the project board, optionally filtered by status
# ───────────────────────────────────────────────────────────────────────────

cmd_list() {
  require_project
  local status_filter=${1:-""}
  if [ -n "$status_filter" ]; then
    gh project item-list "$PROJECT_NUMBER" --owner "$PROJECT_OWNER" --format json --limit 200 \
      | jq -r --arg s "$status_filter" '
        .items[] | select((.status // "") | ascii_downcase == ($s | ascii_downcase))
        | "#\(.content.number // "?") [\(.status // "?")] \(.content.title // "?")"
      '
  else
    gh project item-list "$PROJECT_NUMBER" --owner "$PROJECT_OWNER" --format json --limit 200 \
      | jq -r '.items[] | "#\(.content.number // "?") [\(.status // "no status")] \(.content.title // "?")"'
  fi
}

# ───────────────────────────────────────────────────────────────────────────
# Command: cache-clear — wipe the on-disk schema cache (escape hatch for when
# the board owner renames Status options mid-hour)
# ───────────────────────────────────────────────────────────────────────────

cmd_cache_clear() {
  if [ -d "$_SF_CACHE_DIR" ]; then
    rm -rf "$_SF_CACHE_DIR"
    echo -e "${GREEN}✓ Cache cleared: ${_SF_CACHE_DIR}${NC}"
  else
    echo "(no cache dir at ${_SF_CACHE_DIR})"
  fi
}

# ───────────────────────────────────────────────────────────────────────────
# Router
# ───────────────────────────────────────────────────────────────────────────

case "$COMMAND" in
  create-subtask)  cmd_create_subtask "$@" ;;
  update-status)   cmd_update_status "$@" ;;
  status)          cmd_status "$@" ;;
  set-complexity)  cmd_set_complexity "$@" ;;
  get-complexity)  cmd_get_complexity "$@" ;;
  get-ticket)      cmd_get_ticket "$@" ;;
  create-pr)       cmd_create_pr "$@" ;;
  list)            cmd_list "$@" ;;
  cache-clear)     cmd_cache_clear "$@" ;;
  "")
    echo -e "${RED}Error: No command specified${NC}"
    echo ""
    echo "Usage: $0 <command> [args...]"
    echo ""
    echo "Available commands:"
    echo "  create-subtask <parent> <title> [body]   Create a sub-issue linked to parent"
    echo "  status <ticket>                          Read status from the project board"
    echo "  update-status <ticket> <status-name>     Write status on the project board"
    echo "  set-complexity <ticket> <level>          bug | low | medium | complex"
    echo "  get-complexity <ticket>                  Read current complexity label"
    echo "  get-ticket <ticket>                      Print title + body (for scripting)"
    echo "  create-pr <ticket>                       Open PR for current branch"
    echo "  list [status]                            List project items (optionally filtered)"
    echo "  cache-clear                              Drop the on-disk schema cache"
    exit 1
    ;;
  *)
    echo -e "${RED}Error: Unknown command '${COMMAND}'${NC}"
    echo "Available: create-subtask, status, update-status, set-complexity, get-complexity, get-ticket, create-pr, list, cache-clear"
    exit 1
    ;;
esac
