#!/usr/bin/env bash
# Build and run the production images of freshly generated projects (#861).
#
# For a monorepo and a multirepo: generate the project with this checkout's CLI, build the
# API and web images, bring a PostgreSQL schema up to date from the API image
# (`npm run db:update`), start both containers on the project network, then check that
#   - each image's own HEALTHCHECK command passes,
#   - the API answers /api/health and the web image serves the SPA and proxies /api,
#   - the proxy survives an API redeploy on a new address.
#
# Usage: npm run test:docker:images [-- monorepo|multirepo]   (requires `npm run build`)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI="$(cd "$SCRIPT_DIR/../.." && pwd)/bin/sf.js"
if [[ $# -gt 0 ]]; then STRUCTURES=("$@"); else STRUCTURES=(monorepo multirepo); fi
WORK="$(mktemp -d "${TMPDIR:-/tmp}/sf-production-images.XXXXXX")"
RUN_ID="sfimg$$"
DB="$RUN_ID-db"
CONTAINERS=("$DB")
NETWORKS=()
IMAGES=()

export GIT_AUTHOR_NAME=sf GIT_AUTHOR_EMAIL=sf@example.invalid GIT_COMMITTER_NAME=sf GIT_COMMITTER_EMAIL=sf@example.invalid

cleanup() {
  docker rm -f "${CONTAINERS[@]}" >/dev/null 2>&1 || true
  for network in "${NETWORKS[@]}"; do docker network rm "$network" >/dev/null 2>&1 || true; done
  for image in "${IMAGES[@]}"; do docker image rm -f "$image" >/dev/null 2>&1 || true; done
  # Generated projects are large: keep them only when asked to inspect a failure
  if [[ -z "${SF_KEEP_IMAGES_WORKDIR:-}" ]]; then rm -rf "$WORK"; else echo "Generated projects kept in $WORK"; fi
}
trap cleanup EXIT

progress() { echo "[sf-progress] production-images $*"; }
fail() {
  echo "[sf-progress] production-images FAIL — $*" >&2
  exit 1
}

# Status code of a URL, 000 when nothing answers.
http_code() { curl -s -o /dev/null -m 5 -w '%{http_code}' "$1" || true; }

wait_for_200() {
  local url=$1 label=$2
  for _ in $(seq 1 60); do
    [[ "$(http_code "$url")" == 200 ]] && return 0
    sleep 1
  done
  fail "$label did not answer 200 at $url"
}

# Run the image's own HEALTHCHECK command inside the container.
check_healthcheck() {
  local container=$1 test
  test="$(docker inspect -f '{{index .Config.Healthcheck.Test 1}}' "$container")"
  docker exec "$container" sh -c "$test" >/dev/null || fail "HEALTHCHECK of $container failed: $test"
}

free_port() { node -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})'; }

api_env() {
  local secret
  secret="$(node -e 'console.log(require("crypto").randomBytes(24).toString("hex"))')"
  cat <<EOF
PORT=$1
NODE_ENV=production
FRONTEND_URL=http://localhost:3000
DATABASE_URL=$2
DIRECT_URL=$2
API_PREFIX=/api
JWT_AUTH_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
JWT_INVITATION_EXPIRES_IN=7d
JWT_CREATE_ACCOUNT_EXPIRES_IN=24h
JWT_RESET_PASSWORD_EXPIRES_IN=1h
JWT_SECRET_AUTH=a$secret
JWT_SECRET_REFRESH=b$secret
JWT_SECRET_INVITATION=c$secret
JWT_SECRET_CONFIRM_ACCOUNT=d$secret
JWT_SECRET_RESET_PASSWORD=e$secret
LOG_LEVEL=info
EOF
}

check_structure() {
  local structure=$1
  local name="$RUN_ID-$structure" project api_dir web_dir api_context web_context
  project="$WORK/$name"
  progress "$structure — generating $name"
  (cd "$WORK" && node "$CLI" new --non-interactive --project-name "$name" --project-description "Production image check" \
    --structure "$structure" --main-branch main --setup-repo local --profile stack --db-setup manual \
    --email-service none --s3-setup manual --start-apps none --no-analytics >"$WORK/$structure.log" 2>&1) ||
    { tail -40 "$WORK/$structure.log"; fail "$structure — sf new failed"; }

  # A monorepo image builds from the repository root (it copies packages/); a multirepo one from its app
  if [[ "$structure" == monorepo ]]; then
    api_dir="$project/apps/api" web_dir="$project/apps/web" api_context="$project" web_context="$project"
  else
    api_dir="$project/apps/$name-api" web_dir="$project/apps/$name-web" api_context="$api_dir" web_context="$web_dir"
  fi

  local api_image="$name-api:check" web_image="$name-web:check"
  IMAGES+=("$api_image" "$web_image")
  progress "$structure — building the API image"
  docker build -q -f "$api_dir/Dockerfile" -t "$api_image" "$api_context" >/dev/null || fail "$structure — API image build failed"
  progress "$structure — building the web image"
  docker build -q -f "$web_dir/Dockerfile" -t "$web_image" "$web_context" >/dev/null || fail "$structure — web image build failed"

  # The project's own names: nginx proxies to <project>-api on <project>-network
  local network="$name-network" api_container="$name-api" web_container="$name-web" port
  port="$(sed -n 's/^PORT=\"\{0,1\}\([0-9]*\)\"\{0,1\}$/\1/p' "$api_dir/.env")"
  docker network create "$network" >/dev/null
  NETWORKS+=("$network")
  docker network connect "$network" "$DB"
  docker exec "$DB" psql -q -U app -d postgres -c "CREATE DATABASE \"$structure\"" >/dev/null
  api_env "$port" "postgresql://app:app@$DB:5432/$structure" >"$WORK/$structure.env"

  progress "$structure — npm run db:update from the API image"
  docker run --rm --network "$network" --env-file "$WORK/$structure.env" "$api_image" npm run db:update >"$WORK/$structure.db.log" 2>&1 ||
    { tail -30 "$WORK/$structure.db.log"; fail "$structure — db:update failed"; }

  local api_port web_port
  api_port="$(free_port)" web_port="$(free_port)"
  start_api() {
    docker run -d --name "$api_container" --network "$network" --env-file "$WORK/$structure.env" -p "127.0.0.1:$api_port:$port" "$api_image" >/dev/null
  }
  CONTAINERS+=("$api_container" "$web_container" "$name-filler")
  start_api
  wait_for_200 "http://127.0.0.1:$api_port/api/health" "$structure API"
  check_healthcheck "$api_container"
  docker exec "$api_container" sh -c 'ls /app/logs/*.log' >/dev/null || fail "$structure — the API wrote no log file under /app/logs"

  docker run -d --name "$web_container" --network "$network" -p "127.0.0.1:$web_port:8080" "$web_image" >/dev/null
  wait_for_200 "http://127.0.0.1:$web_port/" "$structure web index"
  [[ "$(http_code "http://127.0.0.1:$web_port/login")" == 200 ]] || fail "$structure — the web image does not serve SPA routes"
  [[ "$(http_code "http://127.0.0.1:$web_port/api/health")" == 200 ]] || fail "$structure — the web image does not proxy /api"
  check_healthcheck "$web_container"

  progress "$structure — redeploying the API on a new address"
  docker rm -f "$api_container" >/dev/null
  docker run -d --name "$name-filler" --network "$network" alpine:3.20 sleep 300 >/dev/null
  start_api
  wait_for_200 "http://127.0.0.1:$api_port/api/health" "$structure API (redeployed)"
  local proxied=000
  for _ in $(seq 1 15); do
    proxied="$(http_code "http://127.0.0.1:$web_port/api/health")"
    [[ "$proxied" == 200 ]] && break
    sleep 1
  done
  [[ "$proxied" == 200 ]] || fail "$structure — the web proxy kept the old API address ($proxied)"
  progress "$structure — PASS"
}

docker run -d --name "$DB" -e POSTGRES_USER=app -e POSTGRES_PASSWORD=app -e POSTGRES_DB=app postgres:16-alpine >/dev/null
for _ in $(seq 1 60); do docker exec "$DB" pg_isready -q -U app -d app && break; sleep 1; done

for structure in "${STRUCTURES[@]}"; do
  case "$structure" in
    monorepo | multirepo) check_structure "$structure" ;;
    *) fail "unknown structure: $structure" ;;
  esac
done
progress "PASS (${STRUCTURES[*]})"
