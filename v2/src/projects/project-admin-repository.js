function mapProject(row) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    isDefault: row.is_default,
    timezone: row.timezone || "UTC",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createProjectAdminRepository(db) {
  if (!db || typeof db.query !== "function") {
    throw new TypeError("A database client with query(sql, params) is required");
  }

  return {
    async create({ id, slug, name, timezone = "UTC" }) {
      const result = await db.query(
        `INSERT INTO projects (id, slug, name, status, is_default, timezone)
         VALUES ($1, $2, $3, 'active', FALSE, $4)
         RETURNING *`,
        [id, slug, name, timezone],
      );
      return mapProject(result.rows[0]);
    },

    async findById(projectId) {
      const result = await db.query(`SELECT * FROM projects WHERE id = $1 LIMIT 1`, [projectId]);
      return mapProject(result.rows[0]);
    },

    async update({ projectId, name = null, timezone = null, status = null }) {
      const result = await db.query(
        `UPDATE projects
         SET name = COALESCE($2, name),
             timezone = COALESCE($3, timezone),
             status = COALESCE($4, status),
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [projectId, name, timezone, status],
      );
      return mapProject(result.rows[0]);
    },
  };
}
