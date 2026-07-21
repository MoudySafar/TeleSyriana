import pg from "pg";

const { Pool } = pg;

function resolveSslMode(value = process.env.DATABASE_SSL) {
  if (value === "disable" || value === "false") return false;
  if (value === "require" || value === "true") return { rejectUnauthorized: false };
  return undefined;
}

export function createPostgresPool({
  connectionString = process.env.DATABASE_URL,
  ssl = resolveSslMode(),
  max = Number(process.env.DATABASE_POOL_MAX || 10),
} = {}) {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for TeleSyriana V2 persistence");
  }

  return new Pool({
    connectionString,
    ssl,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

export async function withTransaction(pool, work) {
  if (!pool || typeof pool.connect !== "function") {
    throw new TypeError("A PostgreSQL pool is required");
  }
  if (typeof work !== "function") {
    throw new TypeError("Transaction work callback is required");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      error.rollbackError = rollbackError;
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function checkDatabaseHealth(db) {
  const result = await db.query("SELECT NOW() AS database_time");
  return {
    ok: true,
    databaseTime: result.rows[0]?.database_time ?? null,
  };
}
