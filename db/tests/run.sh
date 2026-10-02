#!/usr/bin/env bash
# Creates a throwaway database, applies the schemas and runs the invariant tests.
# Usage: DATABASE_ADMIN_URL=postgresql://postgres@localhost:5432/postgres ./db/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

ADMIN_URL="${DATABASE_ADMIN_URL:-postgresql://postgres@localhost:5432/postgres}"
TEST_DB="velynt_services_test_$$"
TEST_URL="${ADMIN_URL%/*}/${TEST_DB}"

psql "$ADMIN_URL" -qc "CREATE DATABASE ${TEST_DB}"
trap 'psql "$ADMIN_URL" -qc "DROP DATABASE IF EXISTS ${TEST_DB}"' EXIT

for f in db/[0-9][0-9]_*.sql; do
  psql "$TEST_URL" -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null
done

psql "$TEST_URL" -v ON_ERROR_STOP=1 -q -f db/tests/invariants_test.sql 2>&1 | grep -E 'ok - |PASSED|ERROR|FAIL'
