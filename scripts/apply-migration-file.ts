/**
 * Apply a SINGLE supabase/migrations/*.sql file to the DATABASE_URL.
 * Run: pnpm tsx --env-file=.env.local scripts/apply-migration-file.ts <file.sql>
 *
 * Companion to `pnpm db:migrate` (which re-runs every migration in order and
 * is not safe against an already-populated DB). Use this to apply one new
 * migration incrementally. The file's own statements must be idempotent.
 */
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL not set (expected in .env.local).");
    process.exit(1);
  }

  const arg = process.argv[2];
  if (!arg) {
    console.error(
      "Usage: tsx scripts/apply-migration-file.ts <file.sql>\n" +
        "  <file.sql> is a name in supabase/migrations/ or a path to one."
    );
    process.exit(1);
  }

  const dir = path.resolve(process.cwd(), "supabase", "migrations");
  const fullPath = path.isAbsolute(arg)
    ? arg
    : fs.existsSync(arg)
      ? path.resolve(process.cwd(), arg)
      : path.join(dir, arg);
  if (!fs.existsSync(fullPath)) {
    console.error(`Migration file not found: ${fullPath}`);
    process.exit(1);
  }

  const contents = fs.readFileSync(fullPath, "utf-8");
  const sql = postgres(url, { prepare: false });
  try {
    process.stdout.write(`Applying ${path.basename(fullPath)}… `);
    await sql.unsafe(contents);
    process.stdout.write("ok\n");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("\n" + (err?.message ?? err));
  process.exit(1);
});
