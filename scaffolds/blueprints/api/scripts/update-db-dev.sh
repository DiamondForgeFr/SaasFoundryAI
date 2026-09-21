#!/bin/bash

# Forward-only DEV database update. Unlike db:setup:dev, this path never resets
# the database. Versioned pre-schema SQL may stage legacy data before Prisma
# changes tables; matching post-schema SQL validates and completes the backfill.

set -euo pipefail
trap 'echo "Database update failed at line $LINENO" >&2' ERR

readonly ENV_DEV_FILE=".env"
readonly PRE_SCHEMA_DIR="prisma/sql/migrations/pre-schema"
readonly POST_SCHEMA_DIR="prisma/sql/migrations/post-schema"
readonly SQL_FUNCTIONS_DIR="prisma/sql/functions"
readonly SQL_TRIGGERS_DIR="prisma/sql/triggers"
readonly SQL_DATASETS_DIR="prisma/sql/datasets"

load_env_variables() {
  if [ ! -f "${ENV_DEV_FILE}" ]; then
    echo "Missing ${ENV_DEV_FILE}" >&2
    exit 1
  fi
  set -a
  # shellcheck disable=SC1090
  source "${ENV_DEV_FILE}"
  set +a
  : "${DATABASE_URL:?DATABASE_URL must be configured}"
}

apply_sql_files() {
  local directory=$1
  local label=$2
  if [ ! -d "${directory}" ]; then
    return
  fi
  local file
  for file in "${directory}"/*.sql; do
    [ -f "${file}" ] || continue
    echo "Applying ${label}: $(basename "${file}")"
    psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -f "${file}"
  done
}

main() {
  load_env_variables
  psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -c "SELECT 1" >/dev/null

  apply_sql_files "${PRE_SCHEMA_DIR}" "pre-schema migration"
  npx prisma db push
  npx prisma generate
  apply_sql_files "${SQL_FUNCTIONS_DIR}" "function"
  apply_sql_files "${SQL_TRIGGERS_DIR}" "trigger"
  apply_sql_files "${SQL_DATASETS_DIR}" "dataset"
  apply_sql_files "${POST_SCHEMA_DIR}" "post-schema migration"
}

main
