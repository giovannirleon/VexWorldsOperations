import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { closePool, pool } from "../src/db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, "../migrations");

async function ensureSchemaMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id BIGSERIAL PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations() {
  const result = await pool.query(
    "SELECT filename FROM schema_migrations ORDER BY filename ASC"
  );

  return new Set(result.rows.map((row) => row.filename));
}

async function getMigrationFiles() {
  const entries = await fs.readdir(migrationsDir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

async function applyMigration(filename) {
  const filePath = path.join(migrationsDir, filename);
  const sql = await fs.readFile(filePath, "utf8");
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query(
      "INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING",
      [filename]
    );
    await client.query("COMMIT");
    console.log(`Applied migration: ${filename}`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function run() {
  try {
    await ensureSchemaMigrationsTable();

    const [files, applied] = await Promise.all([
      getMigrationFiles(),
      getAppliedMigrations(),
    ]);

    const pending = files.filter((filename) => !applied.has(filename));

    if (pending.length === 0) {
      console.log("No pending migrations");
      return;
    }

    for (const filename of pending) {
      await applyMigration(filename);
    }
  } finally {
    await closePool();
  }
}

run().catch((error) => {
  console.error("Migration failed", error);
  process.exit(1);
});
