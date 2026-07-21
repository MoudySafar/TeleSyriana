function mapRow(row) {
  return {
    id: row.id,
    staffCode: row.staff_code,
    displayName: row.display_name,
    email: row.email,
    platformRole: row.platform_role,
    status: row.status,
    locale: row.locale,
    theme: row.theme,
    disabledAt: row.disabled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    memberships: Array.isArray(row.memberships) ? row.memberships : [],
  };
}

export function createGlobalEmployeeRepository(db) {
  if (!db || typeof db.query !== "function") {
    throw new TypeError("A database client with query(sql, params) is required");
  }

  return {
    async list({ query = null, limit = 100 }) {
      const normalized = String(query || "").trim();
      const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
      const like = normalized ? `%${normalized}%` : null;

      const result = await db.query(
        `SELECT
           u.id,
           u.staff_code,
           u.display_name,
           u.email,
           u.platform_role,
           u.status,
           u.locale,
           u.theme,
           u.disabled_at,
           u.created_at,
           u.updated_at,
           COALESCE(
             jsonb_agg(
               DISTINCT jsonb_build_object(
                 'projectId', pm.project_id,
                 'projectName', p.name,
                 'role', pm.role,
                 'status', pm.status,
                 'supervisorUserId', pm.supervisor_user_id
               )
             ) FILTER (WHERE pm.project_id IS NOT NULL),
             '[]'::jsonb
           ) AS memberships
         FROM users u
         LEFT JOIN project_memberships pm ON pm.user_id = u.id
         LEFT JOIN projects p ON p.id = pm.project_id
         WHERE (
           $1::text IS NULL
           OR u.staff_code ILIKE $1
           OR u.display_name ILIKE $1
           OR COALESCE(u.email, '') ILIKE $1
         )
         GROUP BY u.id
         ORDER BY u.display_name ASC
         LIMIT $2`,
        [like, safeLimit],
      );

      return result.rows.map(mapRow);
    },
  };
}
