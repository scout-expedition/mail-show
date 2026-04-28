#!/usr/bin/env bash
# Run Playwright E2E tests with .env.test.local auto-sourced.
#
# Usage:
#   pnpm test:e2e                      # run everything
#   pnpm test:e2e <playwright args>    # forward args (e.g. -g "name", --headed)
#
# Requires: supabase running locally (`supabase start`), .env.test.local with
# SUPABASE_TEST_URL / SUPABASE_TEST_ANON_KEY / SUPABASE_TEST_SERVICE_KEY,
# Playwright + Chromium installed (`pnpm exec playwright install chromium`).

set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env.test.local ]; then
  echo ".env.test.local missing — see tests/integration/README.md" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env.test.local
set +a

exec pnpm exec playwright test "$@"
