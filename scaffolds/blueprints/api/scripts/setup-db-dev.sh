#!/bin/bash

# Migration-free DEV database setup.
#
# The RBAC database is the project's BASE SETUP, not a migration history: the Prisma schema
# (prisma/schema) + the SQL under prisma/sql/{functions,triggers,datasets} ARE the source of truth.
# This script (re)builds the dev database from them — the same flow init-test-db uses for the test DB.
#
# ⚠️  DESTRUCTIVE: `prisma db push --force-reset` drops and recreates the public schema, so ALL data
#     in the dev database is lost. Use it for the initial setup or a clean reset of the dev DB.
#     For a plain schema sync during development (no re-seed), run `npx prisma db push` directly.

# 1. Configuration constants
readonly ENV_DEV_FILE=".env"
readonly SQL_FUNCTIONS_DIR="prisma/sql/functions"
readonly SQL_TRIGGERS_DIR="prisma/sql/triggers"
readonly SQL_DATASETS_DIR="prisma/sql/datasets"

# 2. Task-specific functions
load_env_variables() {
    echo "• Loading dev environment variables..."
    if [ -f "${ENV_DEV_FILE}" ]; then
        export $(grep -v '^#' "${ENV_DEV_FILE}" | xargs)
        echo "  ↳ Environment loaded from ${ENV_DEV_FILE}"
    else
        echo "❌ Error: ${ENV_DEV_FILE} file not found"
        exit 1
    fi
}

wait_for_database() {
    echo "• Waiting for database connection..."
    local retries=0
    local max_retries=15
    while [ $retries -lt $max_retries ]; do
        if psql "$DATABASE_URL" -c "SELECT 1" > /dev/null 2>&1; then
            echo "  ✓ Database is accepting connections"
            return 0
        fi
        retries=$((retries + 1))
        echo "  ↳ Attempt $retries/$max_retries - waiting..."
        sleep 1
    done
    echo "  ❌ Database not ready after $max_retries attempts"
    exit 1
}

clean_database() {
    echo "• Cleaning database objects..."
    echo "  ↳ Dropping triggers and functions"
    psql "$DATABASE_URL" << EOF > /dev/null 2>&1
DO \$\$
DECLARE
    _sql text;
BEGIN
    FOR _sql IN
        SELECT 'DROP TRIGGER IF EXISTS ' || trigger_name || ' ON ' || event_object_table || ' CASCADE;'
        FROM information_schema.triggers
        WHERE trigger_schema = 'public'
    LOOP
        EXECUTE _sql;
    END LOOP;

    FOR _sql IN
        SELECT 'DROP FUNCTION IF EXISTS ' || ns.nspname || '.' || p.proname || '(' || pg_get_function_arguments(p.oid) || ') CASCADE;'
        FROM pg_proc p
        INNER JOIN pg_namespace ns ON p.pronamespace = ns.oid
        WHERE ns.nspname = 'public'
    LOOP
        EXECUTE _sql;
    END LOOP;
END \$\$;
EOF
    echo "  ✓ Database cleaned"
}

apply_schema() {
    echo "• Applying database schema..."
    echo "  ↳ Resetting database (db push --force-reset)"
    PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="yes" npx prisma db push --force-reset --accept-data-loss > /dev/null 2>&1
    echo "  ✓ Schema applied"

    echo "  ↳ Generating Prisma Client"
    npx prisma generate > /dev/null 2>&1
    echo "  ✓ Client generated"
}

apply_sql_files() {
    local dir=$1
    local type=$2

    if [ -d "$dir" ] && [ "$(ls -A $dir)" ]; then
        echo "• Applying SQL ${type}..."
        for file in "$dir"/*.sql; do
            if [ -f "$file" ]; then
                filename=$(basename "$file")
                echo "  ↳ Processing: $filename"
                if psql "$DATABASE_URL" -f "$file" > /dev/null 2>&1; then
                    echo "    ✓ Applied successfully"
                else
                    echo "    ❌ Failed to apply"
                    exit 1
                fi
            fi
        done
    fi
}

# 3. Error handling
handle_error() {
    echo ""
    echo "❌ Error occurred in script at line $1"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    exit 1
}

set -e
trap 'handle_error $LINENO' ERR

# 4. Main
main() {
    echo ""
    echo "📦 Setting up DEV Database (migration-free, DESTRUCTIVE)"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    load_env_variables
    wait_for_database
    clean_database
    apply_schema
    apply_sql_files "${SQL_FUNCTIONS_DIR}" "functions"
    apply_sql_files "${SQL_TRIGGERS_DIR}" "triggers"
    apply_sql_files "${SQL_DATASETS_DIR}" "datasets"

    echo ""
    echo "✨ Dev database set up successfully!"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
}

main
