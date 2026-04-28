#!/usr/bin/env bash
# Run integration tests with .env.test.local auto-sourced.
#
# Usage:
#   pnpm test:int                    # run all integration tests
#   pnpm test:int <vitest args>      # forward args (e.g. -t "name", --watch)
#
# Expects supabase to be running locally (`supabase start`) and
# .env.test.local to define SUPABASE_TEST_URL + SUPABASE_TEST_SERVICE_KEY.
# See tests/integration/README.md.

set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env.test.local ]; then
  cat >&2 <<'EOF'
.env.test.local missing.

To create it:
  1. Run `supabase start` from the repo root (boots local Postgres + GoTrue + PostgREST in Docker).
  2. Copy the API URL and the "Secret" key from its output.
  3. Write them to .env.test.local:
       SUPABASE_TEST_URL=http://127.0.0.1:54321
       SUPABASE_TEST_SERVICE_KEY=sb_secret_...

See tests/integration/README.md for the full walkthrough.
EOF
  exit 1
fi

# Source the env file, preserving any vars the caller already exported.
set -a
# shellcheck disable=SC1091
source .env.test.local
set +a

exec pnpm exec vitest run --config vitest.integration.config.ts "$@"
