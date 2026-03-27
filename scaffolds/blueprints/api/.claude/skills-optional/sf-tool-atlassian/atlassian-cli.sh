#!/usr/bin/env bash
# Atlassian CLI wrapper — replaces MCP with direct REST API calls
# Usage: atlassian-cli.sh <service> <action> [args...]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# --- Multi-Account Credentials Support ---
# Load credentials from centralized location if project is configured
load_credentials() {
  local TOOL_NAME="atlassian"
  local CREDENTIALS_DIR="$HOME/.claude/credentials/$TOOL_NAME"
  local MANIFEST_PATH=".saasfoundry.json"

  # Check if we're in a SaaSFoundry project
  if [[ -f "$MANIFEST_PATH" ]]; then
    # Read configured account from manifest
    ACCOUNT_NAME=$(python3 -c "
import json, sys
try:
    with open('$MANIFEST_PATH') as f:
        manifest = json.load(f)
        accounts = manifest.get('skillsAccounts', {})
        print(accounts.get('$TOOL_NAME', ''), end='')
except: pass
" 2>/dev/null)

    # Load centralized credentials if account is configured
    if [[ -n "$ACCOUNT_NAME" ]]; then
      CREDENTIALS_FILE="$CREDENTIALS_DIR/$ACCOUNT_NAME.env"
      if [[ -f "$CREDENTIALS_FILE" ]]; then
        source "$CREDENTIALS_FILE"
        return
      else
        echo "Error: Account '$ACCOUNT_NAME' configured but credentials not found at $CREDENTIALS_FILE" >&2
        echo "Run: sf tools add $TOOL_NAME $ACCOUNT_NAME" >&2
        exit 1
      fi
    fi
  fi

  # Fallback to local .env file
  if [[ -f "$SCRIPT_DIR/.env" ]]; then
    source "$SCRIPT_DIR/.env"
  else
    echo "Error: No credentials found. Either:" >&2
    echo "  1. Run 'sf tools add $TOOL_NAME <account>' and 'sf tools use $TOOL_NAME <account>'" >&2
    echo "  2. Create $SCRIPT_DIR/.env with required credentials" >&2
    exit 1
  fi
}

load_credentials

AUTH="$ATLASSIAN_EMAIL:$ATLASSIAN_API_TOKEN"
JIRA_BASE="https://api.atlassian.com/ex/jira/$ATLASSIAN_CLOUD_ID/rest/api/3"
CONFLUENCE_BASE="https://api.atlassian.com/ex/confluence/$ATLASSIAN_CLOUD_ID/api/v2"

# --- Helpers ---
jira_get()  { curl -s -u "$AUTH" -H "Accept: application/json" "$JIRA_BASE$1"; }
jira_post() { curl -s -u "$AUTH" -H "Content-Type: application/json" -H "Accept: application/json" -X POST -d "$2" "$JIRA_BASE$1"; }
jira_put()  { curl -s -u "$AUTH" -H "Content-Type: application/json" -H "Accept: application/json" -X PUT -d "$2" "$JIRA_BASE$1"; }

confluence_get()  { curl -s -u "$AUTH" -H "Accept: application/json" "$CONFLUENCE_BASE$1"; }
confluence_post() { curl -s -u "$AUTH" -H "Content-Type: application/json" -H "Accept: application/json" -X POST -d "$2" "$CONFLUENCE_BASE$1"; }
confluence_put()  { curl -s -u "$AUTH" -H "Content-Type: application/json" -H "Accept: application/json" -X PUT -d "$2" "$CONFLUENCE_BASE$1"; }

usage() {
  cat <<'EOF'
Usage: atlassian-cli.sh <service> <action> [args...]

JIRA:
  jira projects                          List all projects
  jira issue <KEY>                       Get issue details
  jira search "<JQL>"                    Search issues with JQL
  jira create <PROJECT> <TYPE> "<SUMMARY>" [--desc "<DESC>"]
                                         Create an issue
  jira edit <KEY> "<JSON_FIELDS>"        Edit an issue
  jira transitions <KEY>                 List available transitions
  jira transition <KEY> <TRANSITION_ID>  Transition an issue
  jira comment <KEY> "<BODY>"            Add a comment
  jira worklog <KEY> <TIME_SPENT>        Add worklog (e.g. "2h")

CONFLUENCE:
  confluence spaces                      List all spaces
  confluence pages <SPACE_ID>            List pages in a space
  confluence page <PAGE_ID>              Get page content (markdown)
  confluence search "<CQL>"              Search with CQL
  confluence create <SPACE_ID> "<TITLE>" "<BODY_HTML>"
                                         Create a page
  confluence update <PAGE_ID> <VERSION> "<TITLE>" "<BODY_HTML>"
                                         Update a page
  confluence comments <PAGE_ID>          Get page comments
EOF
  exit 1
}

[[ $# -lt 2 ]] && usage

SERVICE="$1"; shift
ACTION="$1"; shift

case "$SERVICE" in
  jira)
    case "$ACTION" in
      projects)
        jira_get "/project/search?maxResults=50" | python3 -c "
import json,sys; d=json.load(sys.stdin)
for p in d.get('values',[]):
    print(f\"{p['key']:15s} {p['name']:45s} ({p.get('style','')})\")"
        ;;
      issue)
        [[ $# -lt 1 ]] && echo "Usage: jira issue <KEY>" && exit 1
        jira_get "/issue/$1?expand=renderedFields"
        ;;
      search)
        [[ $# -lt 1 ]] && echo "Usage: jira search \"<JQL>\"" && exit 1
        JQL="$1"; MAX="${2:-50}"
        jira_get "/search?jql=$(python3 -c "import urllib.parse;print(urllib.parse.quote('$JQL'))")&maxResults=$MAX"
        ;;
      create)
        [[ $# -lt 3 ]] && echo "Usage: jira create <PROJECT> <TYPE> \"<SUMMARY>\" [--desc \"<DESC>\"]" && exit 1
        PROJECT="$1"; TYPE="$2"; SUMMARY="$3"
        DESC=""
        [[ "${4:-}" == "--desc" ]] && DESC="$5"
        PAYLOAD=$(python3 -c "
import json
d={'fields':{'project':{'key':'$PROJECT'},'issuetype':{'name':'$TYPE'},'summary':'$SUMMARY'}}
desc='$DESC'
if desc:
    d['fields']['description']={'type':'doc','version':1,'content':[{'type':'paragraph','content':[{'type':'text','text':desc}]}]}
print(json.dumps(d))")
        jira_post "/issue" "$PAYLOAD"
        ;;
      edit)
        [[ $# -lt 2 ]] && echo "Usage: jira edit <KEY> '<JSON_FIELDS>'" && exit 1
        jira_put "/issue/$1" "{\"fields\":$2}"
        ;;
      transitions)
        [[ $# -lt 1 ]] && echo "Usage: jira transitions <KEY>" && exit 1
        jira_get "/issue/$1/transitions" | python3 -c "
import json,sys; d=json.load(sys.stdin)
for t in d.get('transitions',[]):
    print(f\"{t['id']:6s} {t['name']}\")"
        ;;
      transition)
        [[ $# -lt 2 ]] && echo "Usage: jira transition <KEY> <TRANSITION_ID>" && exit 1
        jira_post "/issue/$1/transitions" "{\"transition\":{\"id\":\"$2\"}}"
        ;;
      comment)
        [[ $# -lt 2 ]] && echo "Usage: jira comment <KEY> \"<BODY>\"" && exit 1
        BODY_JSON=$(python3 -c "
import json
print(json.dumps({'body':{'type':'doc','version':1,'content':[{'type':'paragraph','content':[{'type':'text','text':'$2'}]}]}}))")
        jira_post "/issue/$1/comment" "$BODY_JSON"
        ;;
      worklog)
        [[ $# -lt 2 ]] && echo "Usage: jira worklog <KEY> <TIME>" && exit 1
        jira_post "/issue/$1/worklog" "{\"timeSpent\":\"$2\"}"
        ;;
      *) echo "Unknown jira action: $ACTION"; usage ;;
    esac
    ;;

  confluence)
    case "$ACTION" in
      spaces)
        confluence_get "/spaces?limit=50" | python3 -c "
import json,sys; d=json.load(sys.stdin)
for s in d.get('results',[]):
    print(f\"{s['id']:12s} {s['key']:10s} {s['name']}\")"
        ;;
      pages)
        [[ $# -lt 1 ]] && echo "Usage: confluence pages <SPACE_ID>" && exit 1
        confluence_get "/spaces/$1/pages?limit=50" | python3 -c "
import json,sys; d=json.load(sys.stdin)
for p in d.get('results',[]):
    print(f\"{p['id']:12s} {p['title']}\")"
        ;;
      page)
        [[ $# -lt 1 ]] && echo "Usage: confluence page <PAGE_ID>" && exit 1
        confluence_get "/pages/$1?body-format=atlas_doc_format"
        ;;
      search)
        [[ $# -lt 1 ]] && echo "Usage: confluence search \"<CQL>\"" && exit 1
        # Use v1 API for CQL search
        curl -s -u "$AUTH" -H "Accept: application/json" \
          "https://api.atlassian.com/ex/confluence/$ATLASSIAN_CLOUD_ID/rest/api/content/search?cql=$(python3 -c "import urllib.parse;print(urllib.parse.quote('$1'))")&limit=25"
        ;;
      create)
        [[ $# -lt 3 ]] && echo "Usage: confluence create <SPACE_ID> \"<TITLE>\" \"<BODY_HTML>\"" && exit 1
        PAYLOAD=$(python3 -c "
import json
print(json.dumps({'spaceId':'$1','title':'$2','body':{'representation':'storage','value':'$3'},'status':'current'}))")
        confluence_post "/pages" "$PAYLOAD"
        ;;
      update)
        [[ $# -lt 4 ]] && echo "Usage: confluence update <PAGE_ID> <VERSION> \"<TITLE>\" \"<BODY_HTML>\"" && exit 1
        PAYLOAD=$(python3 -c "
import json
print(json.dumps({'id':'$1','version':{'number':int('$2')},'title':'$3','body':{'representation':'storage','value':'$4'},'status':'current'}))")
        confluence_put "/pages/$1" "$PAYLOAD"
        ;;
      comments)
        [[ $# -lt 1 ]] && echo "Usage: confluence comments <PAGE_ID>" && exit 1
        confluence_get "/pages/$1/footer-comments?limit=25"
        ;;
      *) echo "Unknown confluence action: $ACTION"; usage ;;
    esac
    ;;

  *) echo "Unknown service: $SERVICE"; usage ;;
esac
