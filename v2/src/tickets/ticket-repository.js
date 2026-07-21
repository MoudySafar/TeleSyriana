function ticketCode(row) {
  if (!row) return null;
  if (row.external_reference) return row.external_reference;
  return `TK-${String(row.ticket_number).padStart(7, "0")}`;
}

function mapTicket(row) {
  if (!row) return null;
  return {
    id: row.id,
    ticketNumber: Number(row.ticket_number),
    ticketCode: ticketCode(row),
    externalReference: row.external_reference,
    projectId: row.project_id,
    orderNumber: row.order_number,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    customerPhone: row.customer_phone,
    trackingNumber: row.tracking_number,
    subject: row.subject,
    type: row.type,
    priority: row.priority,
    status: row.status,
    risk: row.risk,
    internalSummary: row.internal_summary,
    createdByUserId: row.created_by_user_id,
    assignedToUserId: row.assigned_to_user_id,
    assignedTeamId: row.assigned_team_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastActivityAt: row.last_activity_at,
    resolvedAt: row.resolved_at,
    closedAt: row.closed_at,
    version: row.version,
  };
}

function mapComment(row) {
  if (!row) return null;
  const deleted = Boolean(row.deleted_at);
  return {
    id: row.id,
    ticketId: row.ticket_id,
    authorUserId: row.author_user_id,
    body: deleted ? null : row.body,
    deleted,
    createdAt: row.created_at,
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
    deletedByUserId: row.deleted_by_user_id,
  };
}

function mapHistory(row) {
  if (!row) return null;
  return {
    id: row.id,
    ticketId: row.ticket_id,
    projectId: row.project_id,
    actorUserId: row.actor_user_id,
    eventType: row.event_type,
    beforeData: row.before_data,
    afterData: row.after_data,
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}

function numericCandidate(query) {
  const match = String(query || "").trim().match(/^(?:TK-)?0*(\d+)$/i);
  return match ? Number(match[1]) : null;
}

function normalizedOrderCandidate(query) {
  const raw = String(query || "").trim();
  return /^#?\d{2,}$/.test(raw) ? raw.replace(/^#/, "") : raw;
}

export function createTicketRepository(db) {
  if (!db || typeof db.query !== "function") {
    throw new TypeError("A database client with query(sql, params) is required");
  }

  return {
    async create({
      id,
      projectId,
      externalReference = null,
      orderNumber = null,
      customerName = null,
      customerEmail = null,
      customerPhone = null,
      trackingNumber = null,
      subject = null,
      type = "general_question",
      priority = "normal",
      status = "open",
      risk = "low",
      internalSummary = null,
      createdByUserId,
      assignedToUserId = null,
      assignedTeamId = null,
    }) {
      const result = await db.query(
        `INSERT INTO tickets (
          id, external_reference, project_id, order_number, customer_name,
          customer_email, customer_phone, tracking_number, subject, type,
          priority, status, risk, internal_summary, created_by_user_id,
          assigned_to_user_id, assigned_team_id
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15,
          $16, $17
        ) RETURNING *`,
        [
          id,
          externalReference,
          projectId,
          orderNumber,
          customerName,
          customerEmail,
          customerPhone,
          trackingNumber,
          subject,
          type,
          priority,
          status,
          risk,
          internalSummary,
          createdByUserId,
          assignedToUserId,
          assignedTeamId,
        ],
      );
      return mapTicket(result.rows[0]);
    },

    async findById({ projectId, ticketId }) {
      const result = await db.query(
        `SELECT * FROM tickets WHERE project_id = $1 AND id = $2 LIMIT 1`,
        [projectId, ticketId],
      );
      return mapTicket(result.rows[0]);
    },

    async findByCode({ projectId, code }) {
      const number = numericCandidate(code);
      const result = await db.query(
        `SELECT * FROM tickets
         WHERE project_id = $1
           AND (
             external_reference = $2
             OR ($3::bigint IS NOT NULL AND ticket_number = $3::bigint)
           )
         LIMIT 1`,
        [projectId, String(code || "").trim(), number],
      );
      return mapTicket(result.rows[0]);
    },

    /**
     * Project-wide search by design. Authorization is enforced by the ticket
     * service before this repository is called. This intentionally does not
     * filter by assigned agent so old/resolved/other-agent tickets remain findable.
     */
    async searchProject({ projectId, query, limit = 50 }) {
      const raw = String(query || "").trim();
      const lower = raw.toLowerCase();
      const number = numericCandidate(raw);
      const orderCandidate = normalizedOrderCandidate(raw);
      const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 100));

      const result = await db.query(
        `SELECT * FROM tickets
         WHERE project_id = $1
           AND (
             LOWER(COALESCE(external_reference, '')) = $2
             OR ($3::bigint IS NOT NULL AND ticket_number = $3::bigint)
             OR COALESCE(order_number, '') = $4
             OR LOWER(COALESCE(customer_email, '')) = $2
             OR LOWER(COALESCE(tracking_number, '')) = $2
             OR LOWER(COALESCE(customer_phone, '')) = $2
             OR LOWER(COALESCE(customer_name, '')) LIKE $2 || '%'
             OR LOWER(COALESCE(subject, '')) LIKE '%' || $2 || '%'
           )
         ORDER BY updated_at DESC
         LIMIT $5`,
        [projectId, lower, number, orderCandidate, safeLimit],
      );
      return result.rows.map(mapTicket);
    },

    async listMine({ projectId, userId, includeResolved = false, limit = 100 }) {
      const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 200));
      const result = await db.query(
        `SELECT * FROM tickets
         WHERE project_id = $1
           AND (assigned_to_user_id = $2 OR created_by_user_id = $2)
           AND ($3::boolean = TRUE OR status NOT IN ('resolved', 'closed'))
         ORDER BY updated_at DESC
         LIMIT $4`,
        [projectId, userId, Boolean(includeResolved), safeLimit],
      );
      return result.rows.map(mapTicket);
    },

    async listProject({ projectId, includeResolved = false, limit = 100 }) {
      const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 200));
      const result = await db.query(
        `SELECT * FROM tickets
         WHERE project_id = $1
           AND ($2::boolean = TRUE OR status NOT IN ('resolved', 'closed'))
         ORDER BY updated_at DESC
         LIMIT $3`,
        [projectId, Boolean(includeResolved), safeLimit],
      );
      return result.rows.map(mapTicket);
    },

    async setStatus({ projectId, ticketId, status, expectedVersion = null }) {
      const result = await db.query(
        `UPDATE tickets
         SET status = $3,
             resolved_at = CASE WHEN $3 = 'resolved' THEN COALESCE(resolved_at, NOW()) ELSE NULL END,
             closed_at = CASE WHEN $3 = 'closed' THEN COALESCE(closed_at, NOW()) ELSE NULL END,
             updated_at = NOW(),
             last_activity_at = NOW(),
             version = version + 1
         WHERE project_id = $1
           AND id = $2
           AND ($4::integer IS NULL OR version = $4::integer)
         RETURNING *`,
        [projectId, ticketId, status, expectedVersion],
      );
      return mapTicket(result.rows[0]);
    },

    async touch({ projectId, ticketId }) {
      const result = await db.query(
        `UPDATE tickets
         SET updated_at = NOW(), last_activity_at = NOW(), version = version + 1
         WHERE project_id = $1 AND id = $2
         RETURNING *`,
        [projectId, ticketId],
      );
      return mapTicket(result.rows[0]);
    },

    comments: {
      async list(ticketId) {
        const result = await db.query(
          `SELECT * FROM ticket_comments
           WHERE ticket_id = $1
           ORDER BY created_at ASC`,
          [ticketId],
        );
        return result.rows.map(mapComment);
      },

      async find(commentId) {
        const result = await db.query(
          `SELECT * FROM ticket_comments WHERE id = $1 LIMIT 1`,
          [commentId],
        );
        return mapComment(result.rows[0]);
      },

      async create({ id, ticketId, authorUserId, body }) {
        const result = await db.query(
          `INSERT INTO ticket_comments (id, ticket_id, author_user_id, body)
           VALUES ($1, $2, $3, $4)
           RETURNING *`,
          [id, ticketId, authorUserId, body],
        );
        return mapComment(result.rows[0]);
      },

      async edit({ commentId, body }) {
        const result = await db.query(
          `UPDATE ticket_comments
           SET body = $2, edited_at = NOW()
           WHERE id = $1 AND deleted_at IS NULL
           RETURNING *`,
          [commentId, body],
        );
        return mapComment(result.rows[0]);
      },

      async softDelete({ commentId, deletedByUserId }) {
        const result = await db.query(
          `UPDATE ticket_comments
           SET deleted_at = COALESCE(deleted_at, NOW()),
               deleted_by_user_id = COALESCE(deleted_by_user_id, $2)
           WHERE id = $1
           RETURNING *`,
          [commentId, deletedByUserId],
        );
        return mapComment(result.rows[0]);
      },
    },

    history: {
      async append({ ticketId, projectId, actorUserId, eventType, beforeData = null, afterData = null, metadata = {} }) {
        const result = await db.query(
          `INSERT INTO ticket_history (
             ticket_id, project_id, actor_user_id, event_type,
             before_data, after_data, metadata
           ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb)
           RETURNING *`,
          [
            ticketId,
            projectId,
            actorUserId,
            eventType,
            beforeData == null ? null : JSON.stringify(beforeData),
            afterData == null ? null : JSON.stringify(afterData),
            JSON.stringify(metadata),
          ],
        );
        return mapHistory(result.rows[0]);
      },

      async list(ticketId, limit = 200) {
        const safeLimit = Math.max(1, Math.min(Number(limit) || 200, 500));
        const result = await db.query(
          `SELECT * FROM ticket_history
           WHERE ticket_id = $1
           ORDER BY created_at DESC
           LIMIT $2`,
          [ticketId, safeLimit],
        );
        return result.rows.map(mapHistory);
      },
    },
  };
}

export { mapTicket, mapComment, numericCandidate };
