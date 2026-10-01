#!/bin/bash

# Forward-only DEV database update. Unlike db:setup:dev, this path never resets
# the database: it loads DATABASE_URL from .env, runs the update every
# environment shares (scripts/update-db.sh), then regenerates the Prisma client.

set -euo pipefail
trap 'echo "Database update failed at line $LINENO" >&2' ERR

readonly ENV_DEV_FILE=".env"

load_env_variables() {
  if [ ! -f "${ENV_DEV_FILE}" ]; then
    echo "Missing ${ENV_DEV_FILE}" >&2
    exit 1
  fi
  DATABASE_URL="$(node --input-type=module -e '
    import { readFileSync } from "node:fs";
    import dotenv from "dotenv";
    const parsed = dotenv.parse(readFileSync(process.argv[1]));
    if (!parsed.DATABASE_URL) process.exit(1);
    process.stdout.write(parsed.DATABASE_URL);
  ' "${ENV_DEV_FILE}")"
  export DATABASE_URL
  : "${DATABASE_URL:?DATABASE_URL must be configured}"
}

main() {
  load_env_variables
  "$(dirname "$0")/update-db.sh"
  npx prisma generate
}

main
