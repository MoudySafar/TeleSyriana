import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, "../db/migrations");

async function migration(name) {
  return fs.readFile(path.join(migrationsDir, name), "utf8");
}

test("foundation schema contains project-scoped memberships and no plaintext PIN field", async () => {
  const sql = await migration("001_foundation.sql");

  assert.match(sql, /CREATE TABLE IF NOT EXISTS project_memberships/i);
  assert.match(sql, /UNIQUE \(user_id, project_id\)/i);
  assert.match(sql, /role TEXT NOT NULL CHECK \(role IN \('manager', 'supervisor', 'agent'\)\)/i);
  assert.doesNotMatch(sql, /\bpin\b/i);
  assert.doesNotMatch(sql, /password\s+TEXT/i);
});

test("user preferences support English Arabic and Light Dark System", async () => {
  const sql = await migration("001_foundation.sql");

  assert.match(sql, /locale TEXT NOT NULL DEFAULT 'en'/i);
  assert.match(sql, /CHECK \(locale IN \('en', 'ar'\)\)/i);
  assert.match(sql, /CHECK \(theme IN \('light', 'dark', 'system'\)\)/i);
});

test("audit logs are part of the foundation schema", async () => {
  const sql = await migration("001_foundation.sql");

  assert.match(sql, /CREATE TABLE IF NOT EXISTS audit_logs/i);
  assert.match(sql, /metadata JSONB/i);
  assert.match(sql, /actor_user_id/i);
});

test("iPro is seeded as the active default project", async () => {
  const sql = await migration("002_seed_ipro.sql");

  assert.match(sql, /VALUES \('ipro', 'ipro', 'iPro', 'active', TRUE\)/);
});
