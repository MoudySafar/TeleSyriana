function mapTeam(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    supervisorUserId: row.supervisor_user_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMember(row) {
  if (!row) return null;
  return {
    teamId: row.team_id,
    userId: row.user_id,
    status: row.status,
    displayName: row.display_name ?? null,
    staffCode: row.staff_code ?? null,
    projectRole: row.project_role ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createTeamRepository(db) {
  if (!db || typeof db.query !== "function") {
    throw new TypeError("A database client with query(sql, params) is required");
  }

  return {
    async listForProject(projectId) {
      const result = await db.query(
        `SELECT * FROM teams
         WHERE project_id = $1 AND status = 'active'
         ORDER BY name ASC`,
        [projectId],
      );
      return result.rows.map(mapTeam);
    },

    async find({ projectId, teamId }) {
      const result = await db.query(
        `SELECT * FROM teams
         WHERE project_id = $1 AND id = $2 AND status = 'active'
         LIMIT 1`,
        [projectId, teamId],
      );
      return mapTeam(result.rows[0]);
    },

    async create({ id, projectId, name, supervisorUserId = null }) {
      const result = await db.query(
        `INSERT INTO teams (
           id, project_id, name, supervisor_user_id, status
         ) VALUES ($1, $2, $3, $4, 'active')
         RETURNING *`,
        [id, projectId, name, supervisorUserId],
      );
      return mapTeam(result.rows[0]);
    },

    async setSupervisor({ projectId, teamId, supervisorUserId }) {
      const result = await db.query(
        `UPDATE teams
         SET supervisor_user_id = $3, updated_at = NOW()
         WHERE project_id = $1 AND id = $2 AND status = 'active'
         RETURNING *`,
        [projectId, teamId, supervisorUserId],
      );
      return mapTeam(result.rows[0]);
    },

    async listMembers({ projectId, teamId }) {
      const result = await db.query(
        `SELECT
           tm.*,
           u.display_name,
           u.staff_code,
           pm.role AS project_role
         FROM team_members tm
         INNER JOIN teams t ON t.id = tm.team_id
         INNER JOIN users u ON u.id = tm.user_id
         INNER JOIN project_memberships pm
           ON pm.user_id = tm.user_id AND pm.project_id = t.project_id
         WHERE t.project_id = $1
           AND tm.team_id = $2
           AND tm.status = 'active'
           AND pm.status = 'active'
         ORDER BY u.display_name ASC`,
        [projectId, teamId],
      );
      return result.rows.map(mapMember);
    },

    async listUserTeamIds({ projectId, userId }) {
      const result = await db.query(
        `SELECT tm.team_id
         FROM team_members tm
         INNER JOIN teams t ON t.id = tm.team_id
         WHERE t.project_id = $1
           AND tm.user_id = $2
           AND t.status = 'active'
           AND tm.status = 'active'`,
        [projectId, userId],
      );
      return result.rows.map((row) => row.team_id);
    },

    async addMember({ teamId, userId }) {
      const result = await db.query(
        `INSERT INTO team_members (team_id, user_id, status)
         VALUES ($1, $2, 'active')
         ON CONFLICT (team_id, user_id)
         DO UPDATE SET status = 'active', updated_at = NOW()
         RETURNING *`,
        [teamId, userId],
      );
      return mapMember(result.rows[0]);
    },

    async removeMember({ teamId, userId }) {
      const result = await db.query(
        `DELETE FROM team_members
         WHERE team_id = $1 AND user_id = $2
         RETURNING *`,
        [teamId, userId],
      );
      return mapMember(result.rows[0]);
    },

    async createTeamChatChannel({ id, projectId, teamId, name, createdByUserId }) {
      const result = await db.query(
        `INSERT INTO chat_channels (
           id, project_id, name, channel_type, team_id, status, created_by_user_id
         ) VALUES ($1, $2, $3, 'team', $4, 'active', $5)
         ON CONFLICT (id) DO NOTHING
         RETURNING id`,
        [id, projectId, name, teamId, createdByUserId],
      );
      return result.rows[0] ?? null;
    },
  };
}
