/**
 * Apply supabase/migrations/*.sql files to the DATABASE_URL in order.
 * Run: pnpm db:migrate
 *
 * This is an intentionally minimal migrator — no history table, no rollback.
 * It's safe because each migration is idempotent-friendly (creates enums/tables
 * that don't already exist). For more, use supabase-cli or the Supabase MCP.
 */
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      "DATABASE_URL not set. Copy .env.local.example → .env.local and fill it in."
    );
    process.exit(1);
  }

  const dir = path.resolve(process.cwd(), "supabase", "migrations");
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const sql = postgres(url, { prepare: false });
  try {
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const contents = fs.readFileSync(fullPath, "utf-8");
      process.stdout.write(`Applying ${file}… `);
      await sql.unsafe(contents);
      process.stdout.write("ok\n");
    }

    const seedPath = path.resolve(process.cwd(), "supabase", "seed.sql");
    if (fs.existsSync(seedPath)) {
      process.stdout.write("Seeding… ");
      await sql.unsafe(fs.readFileSync(seedPath, "utf-8"));
      process.stdout.write("ok\n");
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
