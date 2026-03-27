#!/usr/bin/env bash
# Figma CLI wrapper — replaces MCP with direct REST API calls
# Usage: figma-cli.sh <action> [args...]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# --- Multi-Account Credentials Support ---
# Load credentials from centralized location if project is configured
load_credentials() {
  local TOOL_NAME="figma"
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

BASE="https://api.figma.com/v1"

figma_get() { curl -s -H "X-Figma-Token: $FIGMA_API_TOKEN" "$BASE$1"; }

usage() {
  cat <<'EOF'
Usage: figma-cli.sh <action> [args...]

FILES & METADATA:
  me                                     Get current user info
  file <FILE_KEY>                        Get file metadata and document tree
  file-nodes <FILE_KEY> <NODE_IDS>       Get specific nodes (comma-separated IDs like "1:2,3:4")
  images <FILE_KEY> <NODE_IDS> [FORMAT]  Export nodes as images (format: png|jpg|svg|pdf, default: png)
  image-fills <FILE_KEY>                 Get image fill URLs

COMPONENTS & STYLES:
  components <FILE_KEY>                  List components in a file
  component-sets <FILE_KEY>              List component sets in a file
  styles <FILE_KEY>                      List styles in a file
  team-components <TEAM_ID>              List team library components
  team-styles <TEAM_ID>                  List team library styles

PROJECTS:
  team-projects <TEAM_ID>               List projects in a team
  project-files <PROJECT_ID>            List files in a project

COMMENTS:
  comments <FILE_KEY>                    List comments on a file
  add-comment <FILE_KEY> "<MESSAGE>"     Add a comment to a file

VARIABLES:
  variables <FILE_KEY>                   List local variables
  variable-collections <FILE_KEY>        List variable collections

VERSIONS:
  versions <FILE_KEY>                    List version history

PARSE URL:
  parse-url "<FIGMA_URL>"               Extract fileKey and nodeId from a Figma URL
EOF
  exit 1
}

# Parse Figma URL to extract fileKey and nodeId
parse_figma_url() {
  local url="$1"
  local file_key=""
  local node_id=""

  # figma.com/design/:fileKey/:fileName?node-id=X-Y
  if [[ "$url" =~ figma\.com/design/([^/]+) ]]; then
    file_key="${BASH_REMATCH[1]}"
  # figma.com/file/:fileKey
  elif [[ "$url" =~ figma\.com/file/([^/]+) ]]; then
    file_key="${BASH_REMATCH[1]}"
  # figma.com/board/:fileKey (FigJam)
  elif [[ "$url" =~ figma\.com/board/([^/]+) ]]; then
    file_key="${BASH_REMATCH[1]}"
  fi

  # Check for branch: /branch/:branchKey/
  if [[ "$url" =~ /branch/([^/]+)/ ]]; then
    file_key="${BASH_REMATCH[1]}"
  fi

  # Extract node-id parameter (convert - to :)
  if [[ "$url" =~ node-id=([0-9]+-[0-9]+) ]]; then
    node_id="${BASH_REMATCH[1]//-/:}"
  fi

  echo "{\"fileKey\":\"$file_key\",\"nodeId\":\"$node_id\"}"
}

[[ $# -lt 1 ]] && usage

ACTION="$1"; shift

case "$ACTION" in
  me)
    figma_get "/me"
    ;;

  file)
    [[ $# -lt 1 ]] && echo "Usage: figma-cli.sh file <FILE_KEY>" && exit 1
    figma_get "/files/$1?depth=2"
    ;;

  file-nodes)
    [[ $# -lt 2 ]] && echo "Usage: figma-cli.sh file-nodes <FILE_KEY> <NODE_IDS>" && exit 1
    figma_get "/files/$1/nodes?ids=$(python3 -c "import urllib.parse;print(urllib.parse.quote('$2'))")"
    ;;

  images)
    [[ $# -lt 2 ]] && echo "Usage: figma-cli.sh images <FILE_KEY> <NODE_IDS> [FORMAT]" && exit 1
    FORMAT="${3:-png}"
    SCALE="${4:-2}"
    figma_get "/images/$1?ids=$(python3 -c "import urllib.parse;print(urllib.parse.quote('$2'))")&format=$FORMAT&scale=$SCALE"
    ;;

  image-fills)
    [[ $# -lt 1 ]] && echo "Usage: figma-cli.sh image-fills <FILE_KEY>" && exit 1
    figma_get "/files/$1/images"
    ;;

  components)
    [[ $# -lt 1 ]] && echo "Usage: figma-cli.sh components <FILE_KEY>" && exit 1
    figma_get "/files/$1/components" | python3 -c "
import json,sys; d=json.load(sys.stdin)
for c in d.get('meta',{}).get('components',[]):
    print(f\"{c.get('node_id',''):10s} {c.get('name','')}\")
"
    ;;

  component-sets)
    [[ $# -lt 1 ]] && echo "Usage: figma-cli.sh component-sets <FILE_KEY>" && exit 1
    figma_get "/files/$1/component_sets" | python3 -c "
import json,sys; d=json.load(sys.stdin)
for c in d.get('meta',{}).get('component_sets',[]):
    print(f\"{c.get('node_id',''):10s} {c.get('name','')}\")
"
    ;;

  styles)
    [[ $# -lt 1 ]] && echo "Usage: figma-cli.sh styles <FILE_KEY>" && exit 1
    figma_get "/files/$1/styles" | python3 -c "
import json,sys; d=json.load(sys.stdin)
for s in d.get('meta',{}).get('styles',[]):
    print(f\"{s.get('node_id',''):10s} {s.get('style_type',''):10s} {s.get('name','')}\")
"
    ;;

  team-components)
    [[ $# -lt 1 ]] && echo "Usage: figma-cli.sh team-components <TEAM_ID>" && exit 1
    figma_get "/teams/$1/components"
    ;;

  team-styles)
    [[ $# -lt 1 ]] && echo "Usage: figma-cli.sh team-styles <TEAM_ID>" && exit 1
    figma_get "/teams/$1/styles"
    ;;

  team-projects)
    [[ $# -lt 1 ]] && echo "Usage: figma-cli.sh team-projects <TEAM_ID>" && exit 1
    figma_get "/teams/$1/projects" | python3 -c "
import json,sys; d=json.load(sys.stdin)
for p in d.get('projects',[]):
    print(f\"{p.get('id',''):12s} {p.get('name','')}\")
"
    ;;

  project-files)
    [[ $# -lt 1 ]] && echo "Usage: figma-cli.sh project-files <PROJECT_ID>" && exit 1
    figma_get "/projects/$1/files" | python3 -c "
import json,sys; d=json.load(sys.stdin)
for f in d.get('files',[]):
    print(f\"{f.get('key',''):22s} {f.get('name',''):40s} {f.get('last_modified','')}\")
"
    ;;

  comments)
    [[ $# -lt 1 ]] && echo "Usage: figma-cli.sh comments <FILE_KEY>" && exit 1
    figma_get "/files/$1/comments" | python3 -c "
import json,sys; d=json.load(sys.stdin)
for c in d.get('comments',[]):
    user = c.get('user',{}).get('handle','')
    msg = c.get('message','')[:80]
    print(f\"{user:20s} {msg}\")
"
    ;;

  add-comment)
    [[ $# -lt 2 ]] && echo "Usage: figma-cli.sh add-comment <FILE_KEY> \"<MESSAGE>\"" && exit 1
    curl -s -H "X-Figma-Token: $FIGMA_API_TOKEN" -H "Content-Type: application/json" \
      -X POST -d "{\"message\":\"$2\"}" "$BASE/files/$1/comments"
    ;;

  variables)
    [[ $# -lt 1 ]] && echo "Usage: figma-cli.sh variables <FILE_KEY>" && exit 1
    figma_get "/files/$1/variables/local"
    ;;

  variable-collections)
    [[ $# -lt 1 ]] && echo "Usage: figma-cli.sh variable-collections <FILE_KEY>" && exit 1
    figma_get "/files/$1/variables/local" | python3 -c "
import json,sys; d=json.load(sys.stdin)
meta = d.get('meta',{})
for cid,c in meta.get('variableCollections',{}).items():
    print(f\"{cid:40s} {c.get('name','')}\")
"
    ;;

  versions)
    [[ $# -lt 1 ]] && echo "Usage: figma-cli.sh versions <FILE_KEY>" && exit 1
    figma_get "/files/$1/versions" | python3 -c "
import json,sys; d=json.load(sys.stdin)
for v in d.get('versions',[])[:20]:
    user = v.get('user',{}).get('handle','')
    label = v.get('label','') or '(auto)'
    print(f\"{v.get('created_at',''):25s} {user:20s} {label}\")
"
    ;;

  parse-url)
    [[ $# -lt 1 ]] && echo "Usage: figma-cli.sh parse-url \"<FIGMA_URL>\"" && exit 1
    parse_figma_url "$1"
    ;;

  *) echo "Unknown action: $ACTION"; usage ;;
esac
