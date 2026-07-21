function mapMembership(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    role: row.role,
    status: row.status,
    supervisorUserId: row.supervisor_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createMembershipAdminRepository(db) {
  if (!db || typeof db.query !== "function") {
    throw new TypeError("A database client with query(sql, params) is required");
  }

  return {
    async assign({ id, userId, projectId, role, supervisorUserId = null }) {
      const result = await db.query(
        `INSERT INTO project_memberships (
           id, user_id, project_id, role, status, supervisor_user_id
         ) VALUES ($1, $2, $3, $4, 'active', $5)
         ON CONFLICT (user_id, project_id)
         DO UPDATE SET
           role = EXCLUDED.role,
           status = 'active',
           supervisor_user_id = EXCLUDED.supervisor_user_id,
           updated_at = NOW()
         RETURNING *`,
        [id, userId, projectId, role, supervisorUserId],
      );
      return mapMembership(result.rows[0]);
    },
  };
}
