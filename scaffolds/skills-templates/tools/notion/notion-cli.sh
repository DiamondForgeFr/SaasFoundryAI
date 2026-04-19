#!/usr/bin/env bash
# Notion CLI wrapper — direct REST API calls, no MCP required.
# Usage: notion-cli.sh <action> [args...]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# --- Multi-Account Credentials Support ---
# Resolution order:
#   1. ~/.claude/credentials/notion/<account>.env   (account comes from .saasfoundry.json)
#   2. <skill-folder>/.env                          (dev-only fallback)
load_credentials() {
  local TOOL_NAME="notion"
  local CREDENTIALS_DIR="$HOME/.claude/credentials/$TOOL_NAME"
  local MANIFEST_PATH=".saasfoundry.json"

  if [[ -f "$MANIFEST_PATH" ]]; then
    ACCOUNT_NAME=$(python3 -c "
import json, sys
try:
    with open('$MANIFEST_PATH') as f:
        manifest = json.load(f)
        accounts = manifest.get('skillsAccounts', {})
        print(accounts.get('$TOOL_NAME', ''), end='')
except: pass
" 2>/dev/null)

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

  if [[ -f "$SCRIPT_DIR/.env" ]]; then
    source "$SCRIPT_DIR/.env"
  else
    echo "Error: No Notion credentials found. Either:" >&2
    echo "  1. Run 'sf tools add $TOOL_NAME <account>' and 'sf tools use $TOOL_NAME <account>'" >&2
    echo "  2. Create $SCRIPT_DIR/.env with NOTION_API_TOKEN + NOTION_API_VERSION" >&2
    exit 1
  fi
}

load_credentials

: "${NOTION_API_VERSION:=2022-06-28}"
BASE="https://api.notion.com/v1"

notion_get()   { curl -s -H "Authorization: Bearer $NOTION_API_TOKEN" -H "Notion-Version: $NOTION_API_VERSION" "$BASE$1"; }
notion_post()  { curl -s -H "Authorization: Bearer $NOTION_API_TOKEN" -H "Notion-Version: $NOTION_API_VERSION" -H "Content-Type: application/json" -X POST  -d "$2" "$BASE$1"; }
notion_patch() { curl -s -H "Authorization: Bearer $NOTION_API_TOKEN" -H "Notion-Version: $NOTION_API_VERSION" -H "Content-Type: application/json" -X PATCH -d "$2" "$BASE$1"; }

usage() {
  cat <<'EOF'
Usage: notion-cli.sh <action> [args...]

PAGES & BLOCKS:
  search "<QUERY>"                       Search pages and databases
  page <PAGE_ID>                         Get page properties
  page-content <PAGE_ID>                 Get page block children (content)
  create-page <PARENT_ID> "<TITLE>" ["<CONTENT_MD>"]
                                         Create a page (parent = page or DB)
  update-page <PAGE_ID> '<PROPERTIES_JSON>'
                                         Update page properties
  archive-page <PAGE_ID>                 Archive (delete) a page

DATABASES:
  database <DB_ID>                       Get database schema
  query-database <DB_ID> ['<FILTER_JSON>']
                                         Query a database (optional filter)
  create-database <PARENT_ID> "<TITLE>" '<SCHEMA_JSON>'
                                         Create a database

COMMENTS:
  comments <PAGE_ID>                     Get comments on a page
  add-comment <PAGE_ID> "<TEXT>"         Add a comment to a page

USERS:
  users                                  List all users
  me                                     Get bot user info (smoke-test the token)
EOF
  exit 1
}

# Parse page ID from URL or raw ID
parse_id() {
  local input="$1"
  if [[ "$input" == *"notion.so"* ]] || [[ "$input" == *"notion.site"* ]]; then
    local hex
    hex=$(echo "$input" | grep -oE '[0-9a-f]{32}' | tail -1)
    if [[ -n "$hex" ]]; then
      echo "${hex:0:8}-${hex:8:4}-${hex:12:4}-${hex:16:4}-${hex:20:12}"
      return
    fi
  fi
  echo "$input"
}

[[ $# -lt 1 ]] && usage

ACTION="$1"; shift

case "$ACTION" in
  search)
    [[ $# -lt 1 ]] && echo "Usage: notion-cli.sh search \"<QUERY>\"" && exit 1
    notion_post "/search" "{\"query\":\"$1\",\"page_size\":20}" | python3 -c "
import json,sys; d=json.load(sys.stdin)
for r in d.get('results',[]):
    obj_type = r.get('object','')
    obj_id = r.get('id','')
    title = ''
    if obj_type == 'page':
        props = r.get('properties',{})
        for k,v in props.items():
            if v.get('type') == 'title':
                title_arr = v.get('title',[])
                title = ''.join([t.get('plain_text','') for t in title_arr])
                break
        if not title:
            title = '(untitled)'
    elif obj_type == 'database':
        title_arr = r.get('title',[])
        title = ''.join([t.get('plain_text','') for t in title_arr])
    print(f'{obj_type:10s} {obj_id}  {title}')
"
    ;;

  page)
    [[ $# -lt 1 ]] && echo "Usage: notion-cli.sh page <PAGE_ID>" && exit 1
    PAGE_ID=$(parse_id "$1")
    notion_get "/pages/$PAGE_ID"
    ;;

  page-content)
    [[ $# -lt 1 ]] && echo "Usage: notion-cli.sh page-content <PAGE_ID>" && exit 1
    PAGE_ID=$(parse_id "$1")
    notion_get "/blocks/$PAGE_ID/children?page_size=100"
    ;;

  create-page)
    [[ $# -lt 2 ]] && echo "Usage: notion-cli.sh create-page <PARENT_ID> \"<TITLE>\" [\"<CONTENT>\"]" && exit 1
    PARENT_ID=$(parse_id "$1"); TITLE="$2"; CONTENT="${3:-}"
    PAYLOAD=$(python3 -c "
import json
payload = {
    'parent': {'page_id': '$PARENT_ID'},
    'properties': {
        'title': [{'text': {'content': '$TITLE'}}]
    }
}
content = '''$CONTENT'''
if content:
    payload['children'] = [{
        'object': 'block',
        'type': 'paragraph',
        'paragraph': {
            'rich_text': [{'type': 'text', 'text': {'content': content}}]
        }
    }]
print(json.dumps(payload))
")
    notion_post "/pages" "$PAYLOAD"
    ;;

  update-page)
    [[ $# -lt 2 ]] && echo "Usage: notion-cli.sh update-page <PAGE_ID> '<PROPERTIES_JSON>'" && exit 1
    PAGE_ID=$(parse_id "$1")
    notion_patch "/pages/$PAGE_ID" "{\"properties\":$2}"
    ;;

  archive-page)
    [[ $# -lt 1 ]] && echo "Usage: notion-cli.sh archive-page <PAGE_ID>" && exit 1
    PAGE_ID=$(parse_id "$1")
    notion_patch "/pages/$PAGE_ID" '{"archived":true}'
    ;;

  database)
    [[ $# -lt 1 ]] && echo "Usage: notion-cli.sh database <DB_ID>" && exit 1
    DB_ID=$(parse_id "$1")
    notion_get "/databases/$DB_ID"
    ;;

  query-database)
    [[ $# -lt 1 ]] && echo "Usage: notion-cli.sh query-database <DB_ID> ['<FILTER_JSON>']" && exit 1
    DB_ID=$(parse_id "$1"); FILTER="${2:-{\}}"
    notion_post "/databases/$DB_ID/query" "$FILTER"
    ;;

  create-database)
    [[ $# -lt 3 ]] && echo "Usage: notion-cli.sh create-database <PARENT_ID> \"<TITLE>\" '<SCHEMA_JSON>'" && exit 1
    PARENT_ID=$(parse_id "$1")
    PAYLOAD=$(python3 -c "
import json
schema = json.loads('$3')
payload = {
    'parent': {'page_id': '$PARENT_ID'},
    'title': [{'text': {'content': '$2'}}],
    'properties': schema
}
print(json.dumps(payload))
")
    notion_post "/databases" "$PAYLOAD"
    ;;

  comments)
    [[ $# -lt 1 ]] && echo "Usage: notion-cli.sh comments <PAGE_ID>" && exit 1
    PAGE_ID=$(parse_id "$1")
    notion_get "/comments?block_id=$PAGE_ID"
    ;;

  add-comment)
    [[ $# -lt 2 ]] && echo "Usage: notion-cli.sh add-comment <PAGE_ID> \"<TEXT>\"" && exit 1
    PAGE_ID=$(parse_id "$1")
    notion_post "/comments" "{\"parent\":{\"page_id\":\"$PAGE_ID\"},\"rich_text\":[{\"text\":{\"content\":\"$2\"}}]}"
    ;;

  users)
    notion_get "/users?page_size=100" | python3 -c "
import json,sys; d=json.load(sys.stdin)
for u in d.get('results',[]):
    print(f\"{u.get('type',''):8s} {u.get('id',''):36s} {u.get('name','')}\")
"
    ;;

  me)
    notion_get "/users/me"
    ;;

  *) echo "Unknown action: $ACTION"; usage ;;
esac
