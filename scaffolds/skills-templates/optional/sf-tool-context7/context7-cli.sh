#!/usr/bin/env bash
# Context7 CLI wrapper — replaces MCP with direct REST API calls
# Usage: context7-cli.sh <action> [args...]
# No token needed — Context7 is a free public API

set -euo pipefail

BASE="https://context7.com/api/v1"

usage() {
  cat <<'EOF'
Usage: context7-cli.sh <action> [args...]

  search "<LIBRARY_NAME>"               Search for a library (returns IDs and metadata)
  docs <LIBRARY_ID> ["<TOPIC>"]         Get documentation (optional topic filter)

Examples:
  context7-cli.sh search "react"
  context7-cli.sh search "nextjs"
  context7-cli.sh docs reactjs/react.dev "useEffect"
  context7-cli.sh docs vercel/next.js "app router"
  context7-cli.sh docs prisma/prisma "migrations"
EOF
  exit 1
}

[[ $# -lt 1 ]] && usage

ACTION="$1"; shift

case "$ACTION" in
  search)
    [[ $# -lt 1 ]] && echo "Usage: context7-cli.sh search \"<LIBRARY_NAME>\"" && exit 1
    QUERY=$(python3 -c "import urllib.parse;print(urllib.parse.quote('$1'))")
    curl -s "$BASE/search?query=$QUERY" | python3 -c "
import json,sys
d = json.load(sys.stdin)
results = d.get('results',[])
if not results:
    print('No results found.')
    sys.exit(0)
print(f'Found {len(results)} results:\n')
for r in results[:15]:
    lib_id = r.get('id','').lstrip('/')
    title = r.get('title','')
    desc = (r.get('description','') or '')[:80]
    stars = r.get('stars', 0)
    tokens = r.get('totalTokens', 0)
    verified = ' [verified]' if r.get('verified') else ''
    star_str = f'{stars:,}' if stars > 0 else '-'
    print(f'  {lib_id:45s} {title:25s} stars={star_str:>10s}{verified}')
    if desc:
        print(f'    {desc}')
"
    ;;

  docs)
    [[ $# -lt 1 ]] && echo "Usage: context7-cli.sh docs <LIBRARY_ID> [\"<TOPIC>\"]" && exit 1
    LIB_ID="$1"
    # Remove leading slash if present
    LIB_ID="${LIB_ID#/}"
    TOPIC="${2:-}"

    URL="$BASE/$LIB_ID"
    if [[ -n "$TOPIC" ]]; then
      TOPIC_ENCODED=$(python3 -c "import urllib.parse;print(urllib.parse.quote('$TOPIC'))")
      URL="$URL?topic=$TOPIC_ENCODED"
    fi

    # The API returns markdown directly
    curl -s -H "Accept: text/markdown" "$URL"
    ;;

  *) echo "Unknown action: $ACTION"; usage ;;
esac
