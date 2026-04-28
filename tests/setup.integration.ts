// Integration-test setup. Verifies the test instance env is present so we fail
// fast instead of accidentally pointing at the dev / prod project.
//
// Provide these in `.env.test.local` (gitignored) or via the shell. Two ways:
//   1. Local: run `supabase init && supabase start` and copy the API URL +
//      service_role key from the printed output.
//   2. Cloud: provision a preview branch (Supabase dashboard or MCP) and use
//      its URL + service-role key.
// See tests/integration/README.md.

const required = ["SUPABASE_TEST_URL", "SUPABASE_TEST_SERVICE_KEY"] as const;

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(
      `Integration tests require ${key}. See tests/integration/README.md.`
    );
  }
}

// Belt-and-braces guard: if someone wires the dev project URL into the test
// env, fail loudly rather than silently mutating real data.
const devUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (devUrl && devUrl === process.env.SUPABASE_TEST_URL) {
  throw new Error(
    "SUPABASE_TEST_URL must NOT match NEXT_PUBLIC_SUPABASE_URL. Point integration tests at a separate instance."
  );
}
