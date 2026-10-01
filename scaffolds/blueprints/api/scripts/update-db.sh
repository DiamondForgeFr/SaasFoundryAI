#!/bin/sh

# Forward-only database update for every environment: it never resets the
# database. Versioned pre-schema SQL may stage legacy data before Prisma
# changes tables; matching post-schema SQL validates and completes the backfill.
#
# DATABASE_URL comes from the environment. The production image ships this
# script with prisma/ and runs it as `npm run db:update`; db:update:dev loads
# .env first. POSIX sh on purpose: the alpine runner has no bash.

set -eu

readonly PRE_SCHEMA_DIR="prisma/sql/migrations/pre-schema"
readonly POST_SCHEMA_DIR="prisma/sql/migrations/post-schema"
readonly SQL_FUNCTIONS_DIR="prisma/sql/functions"
readonly SQL_TRIGGERS_DIR="prisma/sql/triggers"
readonly SQL_DATASETS_DIR="prisma/sql/datasets"

apply_sql_files() {
  directory=$1
  label=$2
  if [ ! -d "${directory}" ]; then
    return
  fi
  for file in "${directory}"/*.sql; do
    [ -f "${file}" ] || continue
    echo "Applying ${label}: $(basename "${file}")"
    psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -f "${file}"
  done
}

main() {
  : "${DATABASE_URL:?DATABASE_URL must be set}"
  psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -c "SELECT 1" >/dev/null

  apply_sql_files "${PRE_SCHEMA_DIR}" "pre-schema migration"
  npx prisma db push
  apply_sql_files "${SQL_FUNCTIONS_DIR}" "function"
  apply_sql_files "${SQL_TRIGGERS_DIR}" "trigger"
  apply_sql_files "${SQL_DATASETS_DIR}" "dataset"
  apply_sql_files "${POST_SCHEMA_DIR}" "post-schema migration"
}

# Called bare: `set -e` does not apply inside a function used as an `if` condition.
main
