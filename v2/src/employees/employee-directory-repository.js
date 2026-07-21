function mapEmployee(row) {
  if (!row) return null;
  return {
    id: row.id,
    staffCode: row.staff_code,
    displayName: row.display_name,
    email: row.email,
    platformRole: row.platform_role,
    accountStatus: row.account_status,
    locale: row.locale,
    theme: row.theme,
    projectId: row.project_id,
    projectRole: row.project_role,
    membershipStatus: row.membership_status,
    supervisorUserId: row.supervisor_user_id,
    supervisorName: row.supervisor_name,
    teamIds: row.team_ids || [],
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createEmployeeDirectoryRepository(db) {
  if (!db || typeof db.query !== "function") {
    throw new TypeError("A database client with query(sql, params) is required");
  }

  return {
    async listProject({ projectId, supervisorScopeUserId = null }) {
      const result = await db.query(
        `SELECT
           u.id,
           u.staff_code,
           u.display_name,
           u.email,
           u.platform_role,
           u.status AS account_status,
           u.locale,
           u.theme,
           u.created_at,
           u.updated_at,
           pm.project_id,
           pm.role AS project_role,
           pm.status AS membership_status,
           pm.supervisor_user_id,
           supervisor.display_name AS supervisor_name,
           MAX(s.last_seen_at) AS last_login_at,
           COALESCE(
             ARRAY_AGG(DISTINCT tm.team_id) FILTER (WHERE tm.team_id IS NOT NULL AND tm.status = 'active'),
             ARRAY[]::text[]
           ) AS team_ids
         FROM project_memberships pm
         INNER JOIN users u ON u.id = pm.user_id
         LEFT JOIN users supervisor ON supervisor.id = pm.supervisor_user_id
         LEFT JOIN team_members tm ON tm.user_id = u.id
         LEFT JOIN teams member_team
           ON member_team.id = tm.team_id AND member_team.project_id = pm.project_id
         LEFT JOIN user_sessions s
           ON s.user_id = u.id AND s.revoked_at IS NULL
         WHERE pm.project_id = $1
           AND (
             $2::text IS NULL
             OR u.id = $2
             OR pm.supervisor_user_id = $2
             OR EXISTS (
               SELECT 1
               FROM team_members scoped_tm
               INNER JOIN teams scoped_team ON scoped_team.id = scoped_tm.team_id
               WHERE scoped_tm.user_id = u.id
                 AND scoped_tm.status = 'active'
                 AND scoped_team.project_id = pm.project_id
                 AND scoped_team.status = 'active'
                 AND scoped_team.supervisor_user_id = $2
             )
           )
         GROUP BY
           u.id,
           u.staff_code,
           u.display_name,
           u.email,
           u.platform_role,
           u.status,
           u.locale,
           u.theme,
           u.created_at,
           u.updated_at,
           pm.project_id,
           pm.role,
           pm.status,
           pm.supervisor_user_id,
           supervisor.display_name
         ORDER BY u.display_name ASC`,
        [projectId, supervisorScopeUserId],
      );
      return result.rows.map(mapEmployee);
    },

    async listMemberships(userId) {
      const result = await db.query(
        `SELECT
           pm.project_id,
           p.name AS project_name,
           pm.role,
           pm.status,
           pm.supervisor_user_id,
           supervisor.display_name AS supervisor_name
         FROM project_memberships pm
         INNER JOIN projects p ON p.id = pm.project_id
         LEFT JOIN users supervisor ON supervisor.id = pm.supervisor_user_id
         WHERE pm.user_id = $1
         ORDER BY p.is_default DESC, p.name ASC`,
        [userId],
      );
      return result.rows.map((row) => ({
        projectId: row.project_id,
        projectName: row.project_name,
        role: row.role,
        status: row.status,
        supervisorUserId: row.supervisor_user_id,
        supervisorName: row.supervisor_name,
      }));
    },
  };
}
