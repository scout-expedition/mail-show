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

# Source .env.test.local for local dev — but only when SUPABASE_TEST_URL is
# not already set, so an exported environment (CI) always wins over a
# possibly-stale local file rather than being silently overridden by it.
if [ -z "${SUPABASE_TEST_URL:-}" ] && [ -f .env.test.local ]; then
  set -a
  # shellcheck disable=SC1091
  source .env.test.local
  set +a
fi

if [ -z "${SUPABASE_TEST_URL:-}" ] || [ -z "${SUPABASE_TEST_SERVICE_KEY:-}" ] || [ -z "${SUPABASE_TEST_ANON_KEY:-}" ]; then
  echo "E2E tests need SUPABASE_TEST_URL + SUPABASE_TEST_SERVICE_KEY + SUPABASE_TEST_ANON_KEY" >&2
  echo "(in .env.test.local for local dev, or exported in the environment for CI)." >&2
  echo "See tests/integration/README.md." >&2
  exit 1
fi

exec pnpm exec playwright test "$@"
