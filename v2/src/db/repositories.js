function assertDb(db) {
  if (!db || typeof db.query !== "function") {
    throw new TypeError("A database client with query(sql, params) is required");
  }
}

function mapProject(row) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    isDefault: row.is_default,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    staffCode: row.staff_code,
    displayName: row.display_name,
    email: row.email,
    authSubject: row.auth_subject,
    platformRole: row.platform_role,
    status: row.account_status,
    locale: row.locale,
    theme: row.theme,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    disabledAt: row.disabled_at,
  };
}

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

function mapAudit(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    actorUserId: row.actor_user_id,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}

export function createRepositories(db) {
  assertDb(db);

  return {
    projects: {
      async listActive() {
        const result = await db.query(
          `SELECT * FROM projects WHERE status = 'active' ORDER BY is_default DESC, name ASC`,
        );
        return result.rows.map(mapProject);
      },

      async findById(projectId) {
        const result = await db.query(`SELECT * FROM projects WHERE id = $1 LIMIT 1`, [projectId]);
        return mapProject(result.rows[0]);
      },

      async findDefault() {
        const result = await db.query(
          `SELECT * FROM projects WHERE is_default = TRUE AND status = 'active' LIMIT 1`,
        );
        return mapProject(result.rows[0]);
      },

      async create({ id, slug, name, isDefault = false }) {
        const result = await db.query(
          `INSERT INTO projects (id, slug, name, is_default)
           VALUES ($1, $2, $3, $4)
           RETURNING *`,
          [id, slug, name, isDefault],
        );
        return mapProject(result.rows[0]);
      },
    },

    users: {
      async findById(userId) {
        const result = await db.query(`SELECT * FROM users WHERE id = $1 LIMIT 1`, [userId]);
        return mapUser(result.rows[0]);
      },

      async findByStaffCode(staffCode) {
        const result = await db.query(`SELECT * FROM users WHERE staff_code = $1 LIMIT 1`, [staffCode]);
        return mapUser(result.rows[0]);
      },

      async create({
        id,
        staffCode,
        displayName,
        email = null,
        authSubject = null,
        platformRole = "member",
        locale = "en",
        theme = "system",
      }) {
        const result = await db.query(
          `INSERT INTO users
            (id, staff_code, display_name, email, auth_subject, platform_role, locale, theme)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING *`,
          [id, staffCode, displayName, email, authSubject, platformRole, locale, theme],
        );
        return mapUser(result.rows[0]);
      },

      async setStatus({ userId, status }) {
        const disabledAt = status === "disabled" ? new Date() : null;
        const result = await db.query(
          `UPDATE users
           SET account_status = $2,
               disabled_at = $3,
               updated_at = NOW()
           WHERE id = $1
           RETURNING *`,
          [userId, status, disabledAt],
        );
        return mapUser(result.rows[0]);
      },

      async updatePreferences({ userId, locale, theme }) {
        const result = await db.query(
          `UPDATE users
           SET locale = COALESCE($2, locale),
               theme = COALESCE($3, theme),
               updated_at = NOW()
           WHERE id = $1
           RETURNING *`,
          [userId, locale ?? null, theme ?? null],
        );
        return mapUser(result.rows[0]);
      },
    },

    memberships: {
      async listForUser(userId) {
        const result = await db.query(
          `SELECT * FROM project_memberships WHERE user_id = $1 ORDER BY created_at ASC`,
          [userId],
        );
        return result.rows.map(mapMembership);
      },

      async listForProject(projectId) {
        const result = await db.query(
          `SELECT * FROM project_memberships WHERE project_id = $1 ORDER BY created_at ASC`,
          [projectId],
        );
        return result.rows.map(mapMembership);
      },

      async find({ userId, projectId }) {
        const result = await db.query(
          `SELECT * FROM project_memberships
           WHERE user_id = $1 AND project_id = $2
           LIMIT 1`,
          [userId, projectId],
        );
        return mapMembership(result.rows[0]);
      },

      async create({ id, userId, projectId, role, supervisorUserId = null }) {
        const result = await db.query(
          `INSERT INTO project_memberships
            (id, user_id, project_id, role, supervisor_user_id)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [id, userId, projectId, role, supervisorUserId],
        );
        return mapMembership(result.rows[0]);
      },

      async setRole({ userId, projectId, role }) {
        const result = await db.query(
          `UPDATE project_memberships
           SET role = $3, updated_at = NOW()
           WHERE user_id = $1 AND project_id = $2
           RETURNING *`,
          [userId, projectId, role],
        );
        return mapMembership(result.rows[0]);
      },

      async setStatus({ userId, projectId, status }) {
        const result = await db.query(
          `UPDATE project_memberships
           SET status = $3, updated_at = NOW()
           WHERE user_id = $1 AND project_id = $2
           RETURNING *`,
          [userId, projectId, status],
        );
        return mapMembership(result.rows[0]);
      },

      async assignSupervisor({ userId, projectId, supervisorUserId }) {
        const result = await db.query(
          `UPDATE project_memberships
           SET supervisor_user_id = $3, updated_at = NOW()
           WHERE user_id = $1 AND project_id = $2
           RETURNING *`,
          [userId, projectId, supervisorUserId],
        );
        return mapMembership(result.rows[0]);
      },
    },

    teams: {
      async listForProject(projectId) {
        const result = await db.query(
          `SELECT * FROM teams WHERE project_id = $1 AND status = 'active' ORDER BY name ASC`,
          [projectId],
        );
        return result.rows.map(mapTeam);
      },

      async create({ id, projectId, name, supervisorUserId = null }) {
        const result = await db.query(
          `INSERT INTO teams (id, project_id, name, supervisor_user_id)
           VALUES ($1, $2, $3, $4)
           RETURNING *`,
          [id, projectId, name, supervisorUserId],
        );
        return mapTeam(result.rows[0]);
      },

      async addMember({ teamId, userId }) {
        const result = await db.query(
          `INSERT INTO team_members (team_id, user_id)
           VALUES ($1, $2)
           ON CONFLICT (team_id, user_id)
           DO UPDATE SET status = 'active', updated_at = NOW()
           RETURNING *`,
          [teamId, userId],
        );
        return result.rows[0] ?? null;
      },

      async disableMember({ teamId, userId }) {
        const result = await db.query(
          `UPDATE team_members
           SET status = 'disabled', updated_at = NOW()
           WHERE team_id = $1 AND user_id = $2
           RETURNING *`,
          [teamId, userId],
        );
        return result.rows[0] ?? null;
      },
    },

    audit: {
      async append({ projectId = null, actorUserId = null, action, targetType, targetId = null, metadata = {} }) {
        const result = await db.query(
          `INSERT INTO audit_logs
            (project_id, actor_user_id, action, target_type, target_id, metadata)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb)
           RETURNING *`,
          [projectId, actorUserId, action, targetType, targetId, JSON.stringify(metadata)],
        );
        return mapAudit(result.rows[0]);
      },

      async listForProject({ projectId, limit = 100 }) {
        const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
        const result = await db.query(
          `SELECT * FROM audit_logs
           WHERE project_id = $1
           ORDER BY created_at DESC
           LIMIT $2`,
          [projectId, safeLimit],
        );
        return result.rows.map(mapAudit);
      },
    },
  };
}
