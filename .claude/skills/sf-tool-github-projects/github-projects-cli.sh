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

  # Parse owner + project number from PROJECT_URL in one pass. Supported shapes:
  #   https://github.com/orgs/{owner}/projects/{number}
  #   https://github.com/users/{owner}/projects/{number}
  # On a non-matching / empty URL both fields stay empty — callers (notably
  # load_project_schema) already guard on that and surface a clear error.
  PROJECT_OWNER=""
  PROJECT_NUMBER=""
  if [ -n "$PROJECT_URL" ]; then
    local parsed
    parsed=$(echo "$PROJECT_URL" | sed -nE 's#^https?://github\.com/(orgs|users)/([^/]+)/projects/([0-9]+).*$#\2/\3#p')
    if [ -n "$parsed" ]; then
      PROJECT_OWNER=${parsed%/*}
      PROJECT_NUMBER=${parsed##*/}
    fi
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
# Skeleton body templates — kept byte-close to the TS renderers in
# src/builders/srs/templates/tickets/*.tpl.ts so a created issue has the same
# section shape regardless of whether it was spawned from a drafted SRS page
# (full renderer) or ad-hoc via --type (bash skeleton).
# ───────────────────────────────────────────────────────────────────────────

render_skeleton_body() {
  local type=$1
  local title=$2
  case "$type" in
    epic)
      cat <<EOF
## Goal

${title}

## Business Value

_Describe the business impact of this Epic._

## Dates

- **Start:** _Set on the board (custom field: Start date)._
- **End:** _Set on the board (custom field: End date)._

## Scope

### Included

_List what is in scope._

### Excluded

_List what is out of scope._

## Specifications

_Link the Epic SRS page here once the spec is published._

_No FR pages linked yet._

## Dependencies

_List upstream tickets or services this Epic depends on._

## Constraints

_List technical or business constraints._

## Assumptions

_List assumptions made while drafting this Epic._

## Definition of Done

_List the exit criteria for this Epic._
EOF
      ;;
    story)
      cat <<EOF
## Objective

Implement ${title}.

## Context (User Requirements)

_No UR references yet._

## Scope (Functional Requirements)

_List the FRs this Story covers._

## Acceptance Criteria

_No acceptance criteria yet._

## Specifications

- FR page: _Link the FR SRS page here once the spec is published._

## Dependencies

_List upstream tickets or services this Story depends on._

## Constraints

_List technical or business constraints._

## Design References

_No design references yet._
EOF
      ;;
    task)
      cat <<EOF
## Objective

Deliver ${title}.

## Context

_Describe the technical motivation or pre-existing state this Task changes._

## Scope

### Included

_List what is in scope._

### Excluded

_List what is out of scope._

## Completion Criteria

_No completion criteria yet._

## Specifications

_Link the SRS pages or external specs this Task implements._

## Dependencies

_List upstream tickets or services this Task depends on._

## Constraints

_List technical or business constraints._
EOF
      ;;
    issue)
      cat <<EOF
## Behavior observed

_Describe the actual buggy behavior._

## Expected Behavior

_Describe what should happen instead._

## Steps to Reproduce / Trigger Conditions

_List the steps or conditions that trigger the bug._

## Environment / Configuration

_List relevant environment details (OS, browser, version, flags…)._

## Impact / Severity

_Describe who/what is affected and how severely._

## Evidence / Data

_Attach logs, screenshots, or stack traces here._
EOF
      ;;
  esac
}

# ───────────────────────────────────────────────────────────────────────────
# Command: create-subtask
# ───────────────────────────────────────────────────────────────────────────

cmd_create_subtask() {
  if [ "$#" -lt 2 ]; then
    echo -e "${RED}Error: Missing arguments${NC}"
    echo "Usage: $0 create-subtask <parent-number> <title> [body] [--type <epic|story|task|issue>] [--bypass-srs <reason>]"
    exit 1
  fi

  # Separate positional args from the --bypass-srs and --type flags. Both
  # flags can appear anywhere in either --flag <value> or --flag=<value> form.
  # --type defaults to story (preserves current Story-shaped bodies).
  # We accept up to three positional args (parent, title, body).
  local -a POSITIONAL=()
  local BYPASS_SRS_REASON=""
  local TICKET_TYPE="story"
  while [ $# -gt 0 ]; do
    case "$1" in
      --bypass-srs=*)
        BYPASS_SRS_REASON="${1#--bypass-srs=}"
        if [ -z "$BYPASS_SRS_REASON" ]; then
          echo -e "${RED}Error: --bypass-srs= requires a reason (e.g. --bypass-srs=\"emergency hotfix\")${NC}" >&2
          exit 1
        fi
        shift
        ;;
      --bypass-srs)
        if [ -z "${2:-}" ] || [[ "${2}" == --* ]]; then
          echo -e "${RED}Error: --bypass-srs requires a reason (e.g. --bypass-srs \"emergency hotfix\")${NC}" >&2
          exit 1
        fi
        BYPASS_SRS_REASON=$2
        shift 2
        ;;
      --type=*)
        TICKET_TYPE="${1#--type=}"
        shift
        ;;
      --type)
        if [ -z "${2:-}" ] || [[ "${2}" == --* ]]; then
          echo -e "${RED}Error: --type requires a value (epic|story|task|issue)${NC}" >&2
          exit 1
        fi
        TICKET_TYPE=$2
        shift 2
        ;;
      *)
        POSITIONAL+=("$1")
        shift
        ;;
    esac
  done

  case "$TICKET_TYPE" in
    epic|story|task|issue) ;;
    *)
      echo -e "${RED}Error: --type must be one of: epic, story, task, issue (got '${TICKET_TYPE}')${NC}" >&2
      exit 1
      ;;
  esac

  if [ "${#POSITIONAL[@]}" -lt 2 ]; then
    echo -e "${RED}Error: Missing arguments${NC}"
    echo "Usage: $0 create-subtask <parent-number> <title> [body] [--type <epic|story|task|issue>] [--bypass-srs <reason>]"
    exit 1
  fi

  PARENT_NUMBER="${POSITIONAL[0]}"
  TITLE="${POSITIONAL[1]}"
  BODY="${POSITIONAL[2]:-}"
  # Native sub-issue linking (addSubIssue mutation below) makes the parent
  # relationship visible in the GitHub UI on its own — no need for a textual
  # `[Parent #N]` title prefix anymore. Native Issue Type chips
  # (sf-epic/sf-story/sf-task/sf-issue) replace the old `[EPIC]`/`[STORY]`
  # markers via assign-type. The `sf-` prefix avoids collisions with vanilla
  # Epic/Story/Task types defined elsewhere in the org and sidesteps the
  # "Issue" reserved-name constraint.
  FULL_TITLE="${TITLE}"

  # If no body was supplied, render a type-specific skeleton so the created
  # issue lands with the right section shape instead of an empty body.
  # Kept inline (no TS dependency) so the CLI stays pure-bash.
  if [ -z "$BODY" ]; then
    BODY=$(render_skeleton_body "$TICKET_TYPE" "$TITLE")
  fi

  # Rule 8 (sf-workflow SKILL.md) — on SRS-enabled projects, subtask creation
  # is supposed to flow through `srs-cli.sh spawn` so tickets inherit an SRS
  # page. Any ad-hoc call must opt out explicitly with --bypass-srs <reason>.
  # The reason is not interpreted — it's an audit-trail hint echoed after the
  # success line so the intent is visible in shell history / PR review.
  if [ -f ".saasfoundry.json" ]; then
    local srs_backend
    srs_backend=$(jq -r '.tools.srs.backend // empty' .saasfoundry.json)
    if [ -n "$srs_backend" ] && [ -z "$BYPASS_SRS_REASON" ]; then
      echo -e "${RED}✗ Rule 8: this project has SRS enabled (tools.srs.backend=${srs_backend}).${NC}" >&2
      echo "  Feature subtasks must be spawned from a drafted SRS page via:" >&2
      echo "    .claude/skills/sf-srs/scripts/srs-cli.sh spawn --ticket <parent> --epic <page-url>" >&2
      echo "" >&2
      echo "  If this subtask is genuinely off-spec (emergency, infra work, meta-ticket, …)," >&2
      echo "  re-run with an explicit bypass + reason:" >&2
      echo "    $0 create-subtask ${PARENT_NUMBER} \"${TITLE}\" --bypass-srs \"<reason>\"" >&2
      echo "" >&2
      echo "  See .claude/skills/sf-workflow/SKILL.md → Critical rule 8." >&2
      exit 2
    fi
  fi

  echo -e "${YELLOW}Creating subtask for parent issue #${PARENT_NUMBER}...${NC}"
  if [ -n "$BYPASS_SRS_REASON" ]; then
    printf '%b  (bypassing rule 8 — reason: %s)%b\n' "${BLUE}" "${BYPASS_SRS_REASON}" "${NC}"
  fi

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

  # Auto-assign the native GitHub Issue Type matching --type. Best-effort: a
  # missing type (org doesn't have it yet) or a missing org-admin scope must
  # not break subtask creation — the chip is cosmetic, the parent link is
  # already in place. Skip silently when workflow.issueTypes isn't declared.
  local declared_types
  declared_types=$(jq -r '(.workflow.issueTypes // []) | length' .saasfoundry.json 2>/dev/null)
  if [ "${declared_types:-0}" != "0" ]; then
    local target_type
    case "$TICKET_TYPE" in
      epic)   target_type="sf-epic" ;;
      story)  target_type="sf-story" ;;
      task)   target_type="sf-task" ;;
      issue)  target_type="sf-issue" ;;  # `sf-` prefix avoids the GitHub-reserved "Issue" name
    esac
    if [ -n "$target_type" ]; then
      "$0" assign-type "$CHILD_NUMBER" "$target_type" 2>/dev/null || \
        echo -e "${YELLOW}  (issue type '${target_type}' not assigned — run 'ensure-issue-types' or assign manually)${NC}"
    fi
  fi
}


# ───────────────────────────────────────────────────────────────────────────
# Command: create-epic — create a top-level Epic (no parent)
#
# An Epic is the top of the hierarchy: it has no parent, so `create-subtask`
# cannot express it. Overloading that command with an optional parent would put
# a "no parent" branch inside a function whose entire job is linking a child to
# one, and leave a name that lies. A distinct verb keeps both honest.
#
# Used by `sf srs spawn` to guarantee the `<feature> - <version>` naming that the
# agent used to have to remember — see #517.
# ───────────────────────────────────────────────────────────────────────────

cmd_create_epic() {
  local TITLE=""
  local BODY=""
  local BYPASS_SRS_REASON=""
  local POSITIONAL=()

  while [ $# -gt 0 ]; do
    case "$1" in
      --bypass-srs)
        if [ -z "${2:-}" ]; then
          echo -e "${RED}Error: --bypass-srs requires a reason${NC}" >&2
          exit 1
        fi
        BYPASS_SRS_REASON="$2"
        shift 2
        ;;
      *)
        POSITIONAL+=("$1")
        shift
        ;;
    esac
  done

  TITLE="${POSITIONAL[0]:-}"
  BODY="${POSITIONAL[1]:-}"

  if [ -z "$TITLE" ]; then
    echo "Usage: $0 create-epic <title> [body] [--bypass-srs <reason>]" >&2
    exit 1
  fi

  # Rule 8 — same contract as create-subtask: on an SRS-enabled project, ticket
  # creation flows from a drafted SRS page unless the caller opts out explicitly.
  if [ -f ".saasfoundry.json" ]; then
    local srs_backend
    srs_backend=$(jq -r '.tools.srs.backend // empty' .saasfoundry.json)
    if [ -n "$srs_backend" ] && [ -z "$BYPASS_SRS_REASON" ]; then
      echo -e "${RED}✗ Rule 8: this project has SRS enabled (tools.srs.backend=${srs_backend}).${NC}" >&2
      echo "  Epics are spawned from a drafted SRS version page via:" >&2
      echo "    sf srs spawn --epic <feature-url> --version <version>" >&2
      echo "" >&2
      echo "  For an Epic that is genuinely off-spec (transverse batch, infra work, …):" >&2
      echo "    $0 create-epic \"${TITLE}\" --bypass-srs \"<reason>\"" >&2
      exit 2
    fi
  fi

  if [ -z "$BODY" ]; then
    BODY=$(render_skeleton_body "epic" "$TITLE")
  fi

  echo -e "${YELLOW}Creating Epic...${NC}"
  if [ -n "$BYPASS_SRS_REASON" ]; then
    printf '%b  (bypassing rule 8 — reason: %s)%b\n' "${BLUE}" "${BYPASS_SRS_REASON}" "${NC}"
  fi

  local ISSUE_URL EPIC_NUMBER
  ISSUE_URL=$(gh issue create --title "$TITLE" --body "$BODY")
  EPIC_NUMBER=$(echo "$ISSUE_URL" | grep -o '[0-9]*$')

  if [ -z "$EPIC_NUMBER" ]; then
    echo -e "${RED}Error: could not determine the created issue number${NC}" >&2
    exit 1
  fi

  echo -e "${GREEN}✓ Epic #${EPIC_NUMBER} created${NC}"
  echo "Issue URL: $ISSUE_URL"

  # Best-effort type chip, same policy as create-subtask: a missing org type must
  # not fail the creation — the issue exists and is usable either way.
  local declared_types
  declared_types=$(jq -r '(.workflow.issueTypes // []) | length' .saasfoundry.json 2>/dev/null)
  if [ "${declared_types:-0}" != "0" ]; then
    "$0" assign-type "$EPIC_NUMBER" "sf-epic" 2>/dev/null || \
      echo -e "${YELLOW}  (issue type 'sf-epic' not assigned — run 'ensure-issue-types' or assign manually)${NC}"
  fi
}

# ───────────────────────────────────────────────────────────────────────────
# Command: status — read status from Projects V2 board
# Flags:
#   --json   Emit machine-parseable JSON: {"ticket","title","state","status","labels"}
#            Used by workflow-cli.sh get_current_status so parsing stays deterministic
#            (no more grep|awk on human-oriented output).
# ───────────────────────────────────────────────────────────────────────────

cmd_status() {
  local ticket=""
  local json_mode=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --json) json_mode=1; shift ;;
      *)
        if [ -z "$ticket" ]; then ticket=$1; fi
        shift
        ;;
    esac
  done
  if [ -z "$ticket" ]; then
    echo "Usage: $0 status <ticket-number> [--json]" >&2
    exit 1
  fi
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
    if [ "$json_mode" = 1 ]; then
      jq -n --argjson t "$ticket" '{ticket:$t, title:"", state:"", status:"", labels:[], error:"not-found"}'
      exit 1
    fi
    echo -e "${RED}Error: Could not find issue #${ticket}${NC}" >&2
    exit 1
  fi

  if [ "$json_mode" = 1 ]; then
    # Labels fetched via gh (separate call — cheap) so the JSON payload carries
    # everything callers need without a second round-trip.
    local labels_json
    labels_json=$(gh issue view "$ticket" --json labels --jq '[.labels[].name]' 2>/dev/null || echo '[]')
    jq -n \
      --argjson t "$ticket" \
      --arg title "$title" \
      --arg state "$state" \
      --arg status "$status" \
      --argjson labels "${labels_json:-[]}" \
      '{ticket:$t, title:$title, state:$state, status:$status, labels:$labels}'
    return 0
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
# Command: get-labels — list every label name on a ticket (one per line)
# Used by workflow-cli.sh to enforce the SRS drafting guard.
# ───────────────────────────────────────────────────────────────────────────

cmd_get_labels() {
  if [ "$#" -lt 1 ]; then
    echo "Usage: $0 get-labels <ticket-number>" >&2
    exit 1
  fi
  local ticket=$1
  # Propagate gh's exit code so callers can distinguish "no labels" (exit 0, empty
  # stdout) from "fetch failed" (non-zero) — the SRS guard relies on this to decide
  # whether to fail-open. Do NOT swallow the exit code with `|| true`.
  gh issue view "$ticket" --json labels --jq '.labels[].name' 2>/dev/null
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

  # `|| status=$?` keeps `set -e` from killing the script mid-assignment — that
  # silently swallowed gh's error message (captured in the substitution, never
  # printed). Success requires exit 0 AND a real PR URL: gh error output often
  # contains URLs (compare/doc links), so a bare `grep http` false-positives (#435).
  PR_CREATE_STATUS=0
  PR_OUTPUT=$(gh pr create \
    --title "[#${TICKET_NUMBER}] $ISSUE_TITLE" \
    --body "Resolves #${TICKET_NUMBER}" \
    --base "$WORKING_BRANCH" 2>&1) || PR_CREATE_STATUS=$?

  PR_URL=$(echo "$PR_OUTPUT" | grep -oE 'https://[^[:space:]]+/pull/[0-9]+' | head -n 1 || true)

  if [ "$PR_CREATE_STATUS" -eq 0 ] && [ -n "$PR_URL" ]; then
    echo -e "${GREEN}✓ Pull request created${NC}"
    echo "$PR_URL"
  else
    echo -e "${RED}Error creating PR (gh exit ${PR_CREATE_STATUS}):${NC}"
    echo "$PR_OUTPUT"
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
# Issue Types — native GitHub typing (replaces textual [EPIC]/[STORY] markers)
#
# GitHub Issue Types (GA 2024) live at the **org level** — types are created
# once on the organisation and then assigned to issues across any of its repos.
# Three commands cover the full lifecycle:
#
#   ensure-issue-types     idempotent: creates each name in workflow.issueTypes
#                          missing from the org (reads .saasfoundry.json)
#   assign-type            attach a type to a single issue
#   delete-issue-type      remove a type from the org (cleanup of legacy types)
#
# All operate via raw GraphQL (`gh api graphql`) — `gh` has no first-class
# Issue Types subcommand yet. Mutations: createIssueType / deleteIssueType /
# updateIssueIssueType. The `_TYPES_CACHE` map is per-process to keep the
# bootstrap script (which assigns hundreds of issues) reasonably snappy.
# ───────────────────────────────────────────────────────────────────────────

# Resolve the org login from .saasfoundry.json's projectUrl. Issue Types are
# always org-scoped — user-projects are unsupported (GitHub limitation).
_get_issue_types_owner() {
  load_config
  if [ -z "$PROJECT_OWNER" ]; then
    echo -e "${RED}Error: workflow.projectUrl is missing or malformed in .saasfoundry.json${NC}" >&2
    exit 1
  fi
  if ! echo "$PROJECT_URL" | grep -q '/orgs/'; then
    echo -e "${RED}Error: Issue Types require an organisation project (URL must contain /orgs/<owner>/projects/<n>)${NC}" >&2
    echo "  Current projectUrl: ${PROJECT_URL}" >&2
    exit 1
  fi
  echo "$PROJECT_OWNER"
}

# Fetch the org node ID — needed as ownerId for createIssueType.
_get_org_node_id() {
  local owner=$1
  gh api graphql -f query='query($o:String!){organization(login:$o){id}}' -F o="$owner" 2>/dev/null \
    | jq -r '.data.organization.id // empty'
}

# Fetch the org's existing issue types as JSON array of {id,name,color,description}.
# Cached per-process — bootstrap workflows can call this dozens of times.
_TYPES_CACHE_OWNER=""
_TYPES_CACHE_JSON=""
_get_org_issue_types() {
  local owner=$1
  if [ "$_TYPES_CACHE_OWNER" = "$owner" ] && [ -n "$_TYPES_CACHE_JSON" ]; then
    echo "$_TYPES_CACHE_JSON"
    return 0
  fi
  local resp
  resp=$(gh api graphql \
    -f query='query($o:String!){organization(login:$o){issueTypes(first:50){nodes{id name description color isEnabled}}}}' \
    -F o="$owner" 2>/dev/null)
  local types
  types=$(echo "$resp" | jq -c '.data.organization.issueTypes.nodes // []')
  _TYPES_CACHE_OWNER="$owner"
  _TYPES_CACHE_JSON="$types"
  echo "$types"
}

# Reset the per-process cache (called after create/delete mutations).
_invalidate_types_cache() {
  _TYPES_CACHE_OWNER=""
  _TYPES_CACHE_JSON=""
}

# Look up a type id by case-insensitive name. Echoes empty if not found.
_find_type_id() {
  local owner=$1 name=$2
  _get_org_issue_types "$owner" | jq -r --arg s "$name" '
    .[] | select((.name | ascii_downcase) == ($s | ascii_downcase)) | .id
  ' | head -n1
}

# Translate "permission denied" GraphQL responses into a single, actionable line.
# Issue Type mutations require org-admin scope — users without that role need
# to ask their org owner (or fall back to manual creation in the org settings UI).
_handle_issue_type_error() {
  local action=$1 detail=$2
  if echo "$detail" | grep -qiE 'INSUFFICIENT_SCOPES|admin:org'; then
    echo -e "${RED}✗ ${action}: gh token is missing the 'admin:org' scope.${NC}" >&2
    echo "  Issue Type mutations are org-admin operations and need this scope." >&2
    echo "  Fix once with:" >&2
    echo "    gh auth refresh --hostname github.com --scopes admin:org" >&2
    echo "  …then re-run this command. Alternative: ask an org owner to run it." >&2
  elif echo "$detail" | grep -qiE 'permission|forbidden|not authorized'; then
    echo -e "${RED}✗ Permission denied: ${action} requires org-admin on this organisation.${NC}" >&2
    echo "  Manual fallback — ask an org owner to:" >&2
    echo "    1. Visit https://github.com/organizations/<org>/settings/issue-types" >&2
    echo "    2. ${action}" >&2
    echo "    3. Re-run this command (the create step will become a no-op)." >&2
  else
    echo -e "${RED}✗ ${action} failed:${NC}" >&2
    echo "  $detail" >&2
  fi
}

cmd_ensure_issue_types() {
  local DRY_RUN=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --dry-run) DRY_RUN=1; shift ;;
      *) shift ;;
    esac
  done

  local owner
  owner=$(_get_issue_types_owner)
  # `exit 1` inside _get_issue_types_owner only kills the $() subshell — the
  # parent script keeps running with $owner empty unless we re-check here.
  [ -z "$owner" ] && exit 1

  local desired_json
  desired_json=$(jq -c '.workflow.issueTypes // []' .saasfoundry.json 2>/dev/null)
  if [ "$desired_json" = "[]" ] || [ -z "$desired_json" ]; then
    echo -e "${YELLOW}No workflow.issueTypes declared in .saasfoundry.json — nothing to ensure.${NC}"
    return 0
  fi

  local existing_json
  existing_json=$(_get_org_issue_types "$owner")

  echo -e "${BLUE}Ensuring issue types on org '${owner}'...${NC}"

  local owner_id=""
  local missing
  missing=$(jq -c --argjson existing "$existing_json" '
    [.[] | . as $d
      | select(($existing | map(.name | ascii_downcase) | index(($d.name | ascii_downcase))) | not)]
  ' <<<"$desired_json")

  local count
  count=$(echo "$missing" | jq 'length')
  if [ "$count" = "0" ]; then
    echo -e "${GREEN}✓ All declared issue types already exist on '${owner}'.${NC}"
    return 0
  fi

  echo "  → ${count} missing type(s) to create"

  local i name desc color
  for ((i=0; i<count; i++)); do
    name=$(echo "$missing" | jq -r ".[$i].name")
    desc=$(echo "$missing" | jq -r ".[$i].description // \"\"")
    color=$(echo "$missing" | jq -r ".[$i].color // \"GRAY\"")

    if [ "$DRY_RUN" = "1" ]; then
      echo "    [dry-run] would create: ${name} (${color})"
      continue
    fi

    if [ -z "$owner_id" ]; then
      owner_id=$(_get_org_node_id "$owner")
      if [ -z "$owner_id" ]; then
        echo -e "${RED}Error: Could not resolve org node id for '${owner}'${NC}" >&2
        exit 1
      fi
    fi

    local resp
    resp=$(gh api graphql \
      -f query='mutation($oid:ID!,$n:String!,$d:String,$c:IssueTypeColor){
        createIssueType(input:{ownerId:$oid,isEnabled:true,name:$n,description:$d,color:$c}){
          issueType{id name color}
        }
      }' \
      -F oid="$owner_id" -F n="$name" -F d="$desc" -F c="$color" 2>&1) || true

    # Treat "data + errors" partial responses as failures — GraphQL allows
    # both to coexist, and we don't want a half-broken type silently logged
    # as ✓ created.
    if echo "$resp" | jq -e '.data.createIssueType.issueType.id and (.errors | not)' > /dev/null 2>&1; then
      echo -e "    ${GREEN}✓ created${NC} ${name} (${color})"
    else
      _handle_issue_type_error "Create issue type '${name}'" "$resp"
      exit 1
    fi
  done

  _invalidate_types_cache
  echo -e "${GREEN}✓ ensure-issue-types complete${NC}"
}

cmd_assign_type() {
  if [ "$#" -lt 2 ]; then
    echo -e "${RED}Error: Missing arguments${NC}" >&2
    echo "Usage: $0 assign-type <issue-number> <type-name>" >&2
    exit 1
  fi
  local issue=$1 type_name=$2

  local owner
  owner=$(_get_issue_types_owner)
  [ -z "$owner" ] && exit 1

  local type_id
  type_id=$(_find_type_id "$owner" "$type_name")
  if [ -z "$type_id" ]; then
    echo -e "${RED}Error: Issue type '${type_name}' not found on org '${owner}'${NC}" >&2
    echo "  Run: $0 ensure-issue-types  (or create it manually in the org settings)" >&2
    exit 1
  fi

  local issue_id
  issue_id=$(gh issue view "$issue" --json id --jq '.id' 2>/dev/null)
  if [ -z "$issue_id" ]; then
    echo -e "${RED}Error: Could not find issue #${issue}${NC}" >&2
    exit 1
  fi

  local resp
  resp=$(gh api graphql \
    -f query='mutation($iid:ID!,$tid:ID!){
      updateIssueIssueType(input:{issueId:$iid,issueTypeId:$tid}){
        issue{number issueType{name}}
      }
    }' \
    -F iid="$issue_id" -F tid="$type_id" 2>&1) || true

  if echo "$resp" | jq -e '.data.updateIssueIssueType.issue.number and (.errors | not)' > /dev/null 2>&1; then
    local applied
    applied=$(echo "$resp" | jq -r '.data.updateIssueIssueType.issue.issueType.name // "?"')
    echo -e "${GREEN}✓ Issue #${issue} → type '${applied}'${NC}"
  else
    _handle_issue_type_error "Assign type '${type_name}' to #${issue}" "$resp"
    exit 1
  fi
}

cmd_delete_issue_type() {
  if [ "$#" -lt 1 ]; then
    echo -e "${RED}Error: Missing arguments${NC}" >&2
    echo "Usage: $0 delete-issue-type <type-name>" >&2
    exit 1
  fi
  local type_name=$1

  local owner
  owner=$(_get_issue_types_owner)
  [ -z "$owner" ] && exit 1

  local type_id
  type_id=$(_find_type_id "$owner" "$type_name")
  if [ -z "$type_id" ]; then
    echo -e "${YELLOW}Type '${type_name}' not present on org '${owner}' — nothing to delete.${NC}"
    return 0
  fi

  local resp
  resp=$(gh api graphql \
    -f query='mutation($tid:ID!){deleteIssueType(input:{issueTypeId:$tid}){clientMutationId}}' \
    -F tid="$type_id" 2>&1) || true

  if echo "$resp" | jq -e '.data.deleteIssueType and (.errors | not)' > /dev/null 2>&1; then
    _invalidate_types_cache
    echo -e "${GREEN}✓ Deleted issue type '${type_name}' from '${owner}'${NC}"
  else
    _handle_issue_type_error "Delete issue type '${type_name}'" "$resp"
    exit 1
  fi
}

# ───────────────────────────────────────────────────────────────────────────
# Command: milestone — the GitHub projection of the neutral release scope
# ───────────────────────────────────────────────────────────────────────────
#
# The concept lives in sf-workflow (#549); this is one projection of it.
# GitHub has native milestones, so the mapping is direct and completion is
# read from the API rather than recomputed here — a locally-derived
# percentage drifts from what the board shows the moment anyone moves an
# issue from the UI, and the board is what people look at.
#
# The version↔release association is carried in the milestone's own
# description, not in .saasfoundry.json. It belongs to the board, and a
# manifest copy would need a migration and would go stale on any UI edit.

MILESTONE_VERSION_MARKER="SRS versions:"

# Resolve a milestone number from its title, searching open and closed.
# Prints the number on stdout, or nothing when there is no such milestone.
milestone_number_by_title() {
  local repo=$1 title=$2
  # gh's --jq takes an expression and nothing else: it has no --arg. Passing one
  # there silently mangles the query, and on a repository with no milestones the
  # broken result is indistinguishable from "not found" — which is how this got
  # written and briefly looked correct. So fetch raw and let real jq bind the title.
  gh api "repos/${repo}/milestones?state=all&per_page=100" 2>/dev/null \
    | jq -r --arg t "$title" '.[] | select(.title == $t) | .number' 2>/dev/null | head -n 1
}

milestone_titles() {
  local repo=$1
  gh api "repos/${repo}/milestones?state=all&per_page=100" --jq '.[].title' 2>/dev/null
}

# Fail with the list of what does exist. "No milestone named X" alone sends
# the caller to the web UI to find out what it should have said.
milestone_not_found() {
  local repo=$1 title=$2
  echo -e "${RED}No milestone named \"${title}\" in ${repo}.${NC}" >&2
  local existing
  existing=$(milestone_titles "$repo" | paste -sd ', ' -)
  if [ -n "$existing" ]; then
    echo "Existing milestones: ${existing}" >&2
  else
    echo "This repository has no milestones yet — create one with: milestone create <name>" >&2
  fi
  exit 1
}

cmd_milestone() {
  local sub=${1:-}
  shift || true

  local repo
  repo=$(get_repo_owner_name)
  if [ -z "$repo" ]; then
    echo -e "${RED}Error: could not resolve the current repository (is this a git checkout with a GitHub remote?)${NC}" >&2
    exit 1
  fi

  case "$sub" in
    create)
      local name=$1; shift || true
      local description="" due="" version=""
      while [ $# -gt 0 ]; do
        case "$1" in
          --description) description=${2:-}; shift 2 ;;
          --due) due=${2:-}; shift 2 ;;
          --version) version=${2:-}; shift 2 ;;
          *) echo -e "${RED}milestone create: unknown flag $1${NC}" >&2; exit 1 ;;
        esac
      done

      # Never silently reuse. Two releases sharing a milestone is a scope
      # nobody can read afterwards, and it is an easy mistake to make twice.
      if [ -n "$(milestone_number_by_title "$repo" "$name")" ]; then
        echo -e "${RED}A milestone named \"${name}\" already exists.${NC}" >&2
        echo "Nothing was created. Use a different name, or edit the existing one." >&2
        exit 2
      fi

      [ -n "$version" ] && description="${description}

${MILESTONE_VERSION_MARKER} ${version}"

      local args=(-f "title=${name}")
      [ -n "$description" ] && args+=(-f "description=${description}")
      # GitHub wants ISO 8601; accept the date a human would type.
      #
      # 08:00Z, not midnight: GitHub normalises due_on into its own timezone handling and
      # midnight UTC lands on the PREVIOUS day — ask for the 31st, get the 30th. Verified
      # against the real API, which is the only place this shows up. 08:00Z is what
      # GitHub's own UI sends for the same reason.
      [ -n "$due" ] && args+=(-f "due_on=${due}T08:00:00Z")

      local created
      created=$(gh api "repos/${repo}/milestones" "${args[@]}" 2>&1) || {
        echo -e "${RED}Failed to create milestone \"${name}\"${NC}" >&2
        echo "$created" >&2
        exit 1
      }
      echo -e "${GREEN}✓ Milestone \"${name}\" created${NC}"
      echo "$created" | jq -r '"  \(.html_url)"' 2>/dev/null || true
      ;;

    list)
      local state="open"
      while [ $# -gt 0 ]; do
        case "$1" in
          --state) state=${2:-open}; shift 2 ;;
          *) echo -e "${RED}milestone list: unknown flag $1${NC}" >&2; exit 1 ;;
        esac
      done
      gh api "repos/${repo}/milestones?state=${state}&per_page=100" --jq \
        '.[] | "\(.title)\t\(.state)\t\(.closed_issues)/\(.open_issues + .closed_issues) closed"' 2>/dev/null
      ;;

    show)
      local name=$1
      local number
      number=$(milestone_number_by_title "$repo" "$name")
      [ -z "$number" ] && milestone_not_found "$repo" "$name"

      gh api "repos/${repo}/milestones/${number}" --jq \
        '"Milestone: \(.title)
State:     \(.state)
Progress:  \(.closed_issues)/\(.open_issues + .closed_issues) closed" +
         (if (.open_issues + .closed_issues) > 0
          then " (\(((.closed_issues * 100) / (.open_issues + .closed_issues)) | floor)%)"
          else " (empty)" end) +
         (if .due_on then "\nDue:       \(.due_on)" else "" end) +
         (if .description and (.description | length) > 0 then "\n\n\(.description)" else "" end)'
      ;;

    scope)
      local name=$1
      local number
      number=$(milestone_number_by_title "$repo" "$name")
      [ -z "$number" ] && milestone_not_found "$repo" "$name"
      # GitHub's issue-list index lags the issue itself by a few seconds: `scope` run
      # immediately after `assign` can come back empty while `show` already counts the
      # ticket. Observed against the real API. Nothing to work around here — but a caller
      # seeing an empty scope right after assigning should look again, not re-assign.
      gh api "repos/${repo}/issues?milestone=${number}&state=all&per_page=100" --jq \
        '.[] | "#\(.number)\t\(.state)\t\(.title)"' 2>/dev/null
      ;;

    assign)
      local ticket=$1 name=$2
      local number
      number=$(milestone_number_by_title "$repo" "$name")
      [ -z "$number" ] && milestone_not_found "$repo" "$name"
      gh api "repos/${repo}/issues/${ticket}" -X PATCH -F "milestone=${number}" >/dev/null 2>&1 || {
        echo -e "${RED}Failed to assign #${ticket} to \"${name}\"${NC}" >&2
        exit 1
      }
      echo -e "${GREEN}✓ #${ticket} → milestone \"${name}\"${NC}"
      ;;

    associate)
      local name=$1 page=$2
      local number
      number=$(milestone_number_by_title "$repo" "$name")
      [ -z "$number" ] && milestone_not_found "$repo" "$name"

      local current
      current=$(gh api "repos/${repo}/milestones/${number}" --jq '.description // ""' 2>/dev/null)

      # Associating the same page twice is a no-op, not a duplicate line.
      if printf '%s' "$current" | grep -qF -- "$page"; then
        echo -e "${YELLOW}\"${name}\" is already associated with ${page}${NC}"
        exit 0
      fi

      local updated
      if printf '%s' "$current" | grep -qF -- "$MILESTONE_VERSION_MARKER"; then
        updated=$(printf '%s' "$current" | sed "s|^\(${MILESTONE_VERSION_MARKER}.*\)$|\1, ${page}|")
      else
        updated="${current}

${MILESTONE_VERSION_MARKER} ${page}"
      fi

      gh api "repos/${repo}/milestones/${number}" -X PATCH -f "description=${updated}" >/dev/null 2>&1 || {
        echo -e "${RED}Failed to associate ${page} with \"${name}\"${NC}" >&2
        exit 1
      }
      echo -e "${GREEN}✓ \"${name}\" now carries ${page}${NC}"
      ;;

    *)
      echo -e "${RED}Unknown milestone subcommand: ${sub}${NC}" >&2
      echo "Expected: create | list | show | scope | assign | associate" >&2
      exit 1
      ;;
  esac
}

# ───────────────────────────────────────────────────────────────────────────
# Router
# ───────────────────────────────────────────────────────────────────────────

case "$COMMAND" in
  create-subtask)     cmd_create_subtask "$@" ;;
  create-epic)        cmd_create_epic "$@" ;;
  update-status)      cmd_update_status "$@" ;;
  status)             cmd_status "$@" ;;
  set-complexity)     cmd_set_complexity "$@" ;;
  get-complexity)     cmd_get_complexity "$@" ;;
  get-labels)         cmd_get_labels "$@" ;;
  get-ticket)         cmd_get_ticket "$@" ;;
  create-pr)          cmd_create_pr "$@" ;;
  list)               cmd_list "$@" ;;
  cache-clear)        cmd_cache_clear "$@" ;;
  ensure-issue-types) cmd_ensure_issue_types "$@" ;;
  assign-type)        cmd_assign_type "$@" ;;
  delete-issue-type)  cmd_delete_issue_type "$@" ;;
  milestone)          cmd_milestone "$@" ;;
  "")
    echo -e "${RED}Error: No command specified${NC}"
    echo ""
    echo "Usage: $0 <command> [args...]"
    echo ""
    echo "Available commands:"
    echo "  create-subtask <parent> <title> [body] [--type <epic|story|task|issue>]"
    echo "  create-epic <title> [body]               Create a top-level Epic (no parent)"
    echo "                                           Create a sub-issue linked to parent (default type: story)"
    echo "  status <ticket>                          Read status from the project board"
    echo "  update-status <ticket> <status-name>     Write status on the project board"
    echo "  set-complexity <ticket> <level>          bug | low | medium | complex"
    echo "  get-complexity <ticket>                  Read current complexity label"
    echo "  get-labels <ticket>                      Print every label name (one per line)"
    echo "  get-ticket <ticket>                      Print title + body (for scripting)"
    echo "  create-pr <ticket>                       Open PR for current branch"
    echo "  list [status]                            List project items (optionally filtered)"
    echo "  milestone <sub> [args]                   create|list|show|scope|assign|associate"
    echo "  cache-clear                              Drop the on-disk schema cache"
    echo "  ensure-issue-types [--dry-run]           Idempotently create missing issue types from .saasfoundry.json"
    echo "  assign-type <issue> <type>               Assign a native GitHub Issue Type (sf-epic|sf-story|sf-task|sf-issue)"
    echo "  delete-issue-type <type>                 Remove an issue type from the org (cleanup)"
    exit 1
    ;;
  *)
    echo -e "${RED}Error: Unknown command '${COMMAND}'${NC}"
    echo "Available: create-subtask, status, update-status, set-complexity, get-complexity, get-labels, get-ticket, create-pr, list, cache-clear, ensure-issue-types, assign-type, delete-issue-type"
    exit 1
    ;;
esac
