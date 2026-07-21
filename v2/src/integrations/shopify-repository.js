function mapConnection(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    label: row.label,
    shopDomain: row.shop_domain,
    apiVersion: row.api_version,
    credentialSource: row.credential_source,
    credentialPayload: row.credential_payload,
    status: row.status,
    verificationStatus: row.verification_status,
    verifiedAt: row.verified_at,
    isDefault: row.is_default,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createShopifyRepository(db) {
  if (!db || typeof db.query !== "function") {
    throw new TypeError("A database client with query(sql, params) is required");
  }

  return {
    async listForProject(projectId) {
      const result = await db.query(
        `SELECT * FROM shopify_connections
         WHERE project_id = $1
         ORDER BY is_default DESC, created_at ASC`,
        [projectId],
      );
      return result.rows.map(mapConnection);
    },

    async findById(connectionId) {
      const result = await db.query(
        `SELECT * FROM shopify_connections WHERE id = $1 LIMIT 1`,
        [connectionId],
      );
      return mapConnection(result.rows[0]);
    },

    async findDefaultForProject(projectId) {
      const result = await db.query(
        `SELECT * FROM shopify_connections
         WHERE project_id = $1
           AND is_default = TRUE
           AND status = 'active'
         LIMIT 1`,
        [projectId],
      );
      return mapConnection(result.rows[0]);
    },

    async createPending({
      id,
      projectId,
      label,
      shopDomain,
      apiVersion,
      credentialPayload,
      createdByUserId,
    }) {
      const result = await db.query(
        `INSERT INTO shopify_connections
          (id, project_id, label, shop_domain, api_version, credential_source,
           credential_payload, status, verification_status, is_default, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, 'encrypted_db', $6::jsonb,
                 'pending', 'unverified', FALSE, $7)
         RETURNING *`,
        [
          id,
          projectId,
          label,
          shopDomain,
          apiVersion,
          JSON.stringify(credentialPayload),
          createdByUserId,
        ],
      );
      return mapConnection(result.rows[0]);
    },

    async markVerification({ connectionId, verified, at = new Date() }) {
      const result = await db.query(
        `UPDATE shopify_connections
         SET verification_status = $2,
             verified_at = $3,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [connectionId, verified ? "verified" : "failed", verified ? at : null],
      );
      return mapConnection(result.rows[0]);
    },

    async activateAsDefault({ connectionId, projectId }) {
      await db.query(
        `UPDATE shopify_connections
         SET is_default = FALSE, updated_at = NOW()
         WHERE project_id = $1 AND is_default = TRUE`,
        [projectId],
      );

      const result = await db.query(
        `UPDATE shopify_connections
         SET status = 'active', is_default = TRUE, updated_at = NOW()
         WHERE id = $1
           AND project_id = $2
           AND verification_status = 'verified'
         RETURNING *`,
        [connectionId, projectId],
      );
      return mapConnection(result.rows[0]);
    },

    async disable({ connectionId, projectId }) {
      const result = await db.query(
        `UPDATE shopify_connections
         SET status = 'disabled', is_default = FALSE, updated_at = NOW()
         WHERE id = $1 AND project_id = $2
         RETURNING *`,
        [connectionId, projectId],
      );
      return mapConnection(result.rows[0]);
    },
  };
}
