import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createPostgresPool } from "../src/db/postgres.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, "../db/migrations");

async function ensureMigrationsTable(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function appliedMigrations(db) {
  const result = await db.query(`SELECT filename FROM schema_migrations ORDER BY filename ASC`);
  return new Set(result.rows.map((row) => row.filename));
}

async function run() {
  const pool = createPostgresPool();

  try {
    await ensureMigrationsTable(pool);
    const alreadyApplied = await appliedMigrations(pool);
    const files = (await fs.readdir(migrationsDir))
      .filter((file) => file.endsWith(".sql"))
      .sort();

    for (const filename of files) {
      if (alreadyApplied.has(filename)) {
        console.log(`skip ${filename}`);
        continue;
      }

      const sql = await fs.readFile(path.join(migrationsDir, filename), "utf8");
      console.log(`apply ${filename}`);
      await pool.query(sql);
      await pool.query(
        `INSERT INTO schema_migrations (filename) VALUES ($1)`,
        [filename],
      );
    }

    console.log("TeleSyriana V2 database migrations are up to date.");
  } finally {
    await pool.end();
  }
}

run().catch((error) => {
  console.error("Database migration failed:", error);
  process.exitCode = 1;
});
