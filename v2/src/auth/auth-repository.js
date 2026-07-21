function mapCredential(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    secretHash: row.secret_hash,
    secretSalt: row.secret_salt,
    mustReset: row.must_reset,
    failedAttempts: row.failed_attempts,
    lockedUntil: row.locked_until,
    changedAt: row.changed_at,
  };
}

function mapSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}

export function createAuthRepository(db) {
  if (!db || typeof db.query !== "function") {
    throw new TypeError("A database client with query(sql, params) is required");
  }

  return {
    async findCredential(userId) {
      const result = await db.query(
        `SELECT * FROM auth_credentials WHERE user_id = $1 LIMIT 1`,
        [userId],
      );
      return mapCredential(result.rows[0]);
    },

    async upsertCredential({ userId, secretHash, secretSalt, mustReset = true }) {
      const result = await db.query(
        `INSERT INTO auth_credentials
          (user_id, secret_hash, secret_salt, must_reset, failed_attempts, locked_until, changed_at)
         VALUES ($1, $2, $3, $4, 0, NULL, NOW())
         ON CONFLICT (user_id)
         DO UPDATE SET
           secret_hash = EXCLUDED.secret_hash,
           secret_salt = EXCLUDED.secret_salt,
           must_reset = EXCLUDED.must_reset,
           failed_attempts = 0,
           locked_until = NULL,
           changed_at = NOW()
         RETURNING *`,
        [userId, secretHash, secretSalt, mustReset],
      );
      return mapCredential(result.rows[0]);
    },

    async recordFailedAttempt({ userId, maxAttempts, lockUntil }) {
      const result = await db.query(
        `UPDATE auth_credentials
         SET failed_attempts = failed_attempts + 1,
             locked_until = CASE
               WHEN failed_attempts + 1 >= $2 THEN $3
               ELSE locked_until
             END
         WHERE user_id = $1
         RETURNING *`,
        [userId, maxAttempts, lockUntil],
      );
      return mapCredential(result.rows[0]);
    },

    async resetFailures(userId) {
      const result = await db.query(
        `UPDATE auth_credentials
         SET failed_attempts = 0, locked_until = NULL
         WHERE user_id = $1
         RETURNING *`,
        [userId],
      );
      return mapCredential(result.rows[0]);
    },

    async clearMustReset(userId) {
      const result = await db.query(
        `UPDATE auth_credentials
         SET must_reset = FALSE, changed_at = NOW()
         WHERE user_id = $1
         RETURNING *`,
        [userId],
      );
      return mapCredential(result.rows[0]);
    },

    async createSession({ id, userId, tokenHash, expiresAt }) {
      const result = await db.query(
        `INSERT INTO auth_sessions (id, user_id, token_hash, expires_at)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [id, userId, tokenHash, expiresAt],
      );
      return mapSession(result.rows[0]);
    },

    async findActiveSessionByTokenHash(tokenHash) {
      const result = await db.query(
        `SELECT * FROM auth_sessions
         WHERE token_hash = $1
           AND revoked_at IS NULL
           AND expires_at > NOW()
         LIMIT 1`,
        [tokenHash],
      );
      return mapSession(result.rows[0]);
    },

    async touchSession(sessionId) {
      const result = await db.query(
        `UPDATE auth_sessions
         SET last_seen_at = NOW()
         WHERE id = $1 AND revoked_at IS NULL
         RETURNING *`,
        [sessionId],
      );
      return mapSession(result.rows[0]);
    },

    async revokeSessionByTokenHash(tokenHash) {
      const result = await db.query(
        `UPDATE auth_sessions
         SET revoked_at = COALESCE(revoked_at, NOW())
         WHERE token_hash = $1
         RETURNING *`,
        [tokenHash],
      );
      return mapSession(result.rows[0]);
    },

    async revokeAllUserSessions(userId) {
      const result = await db.query(
        `UPDATE auth_sessions
         SET revoked_at = COALESCE(revoked_at, NOW())
         WHERE user_id = $1 AND revoked_at IS NULL
         RETURNING *`,
        [userId],
      );
      return result.rows.map(mapSession);
    },
  };
}
