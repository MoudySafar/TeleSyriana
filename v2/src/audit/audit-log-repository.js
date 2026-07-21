function mapAudit(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    actorUserId: row.actor_user_id,
    actorName: row.actor_name ?? null,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    metadata: row.metadata || {},
    createdAt: row.created_at,
  };
}

export function createAuditLogRepository(db) {
  if (!db || typeof db.query !== "function") {
    throw new TypeError("A database client with query(sql, params) is required");
  }

  return {
    async list({ projectId, actionPrefix = null, limit = 100 }) {
      const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
      const result = await db.query(
        `SELECT
           a.*,
           u.display_name AS actor_name
         FROM audit_logs a
         LEFT JOIN users u ON u.id = a.actor_user_id
         WHERE a.project_id = $1
           AND ($2::text IS NULL OR a.action LIKE ($2 || '%'))
         ORDER BY a.created_at DESC
         LIMIT $3`,
        [projectId, actionPrefix, safeLimit],
      );
      return result.rows.map(mapAudit);
    },
  };
}
