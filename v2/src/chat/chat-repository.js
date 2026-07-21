function mapChannel(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    channelType: row.channel_type,
    teamId: row.team_id,
    status: row.status,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMessage(row) {
  if (!row) return null;
  const deleted = Boolean(row.deleted_at);
  return {
    id: row.id,
    sequenceNumber: Number(row.sequence_number),
    channelId: row.channel_id,
    authorUserId: row.author_user_id,
    authorName: row.author_name ?? null,
    body: deleted ? null : row.body,
    deleted,
    createdAt: row.created_at,
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
    deletedByUserId: row.deleted_by_user_id,
  };
}

function mapReaction(row) {
  return {
    messageId: row.message_id,
    userId: row.user_id,
    emoji: row.emoji,
    createdAt: row.created_at,
  };
}

function mapReadState(row) {
  if (!row) return null;
  return {
    channelId: row.channel_id,
    userId: row.user_id,
    lastReadSequence: Number(row.last_read_sequence),
    lastReadAt: row.last_read_at,
  };
}

export function createChatRepository(db) {
  if (!db || typeof db.query !== "function") {
    throw new TypeError("A database client with query(sql, params) is required");
  }

  return {
    async listChannels(projectId) {
      const result = await db.query(
        `SELECT * FROM chat_channels
         WHERE project_id = $1 AND status = 'active'
         ORDER BY channel_type ASC, name ASC`,
        [projectId],
      );
      return result.rows.map(mapChannel);
    },

    async findChannel({ projectId, channelId }) {
      const result = await db.query(
        `SELECT * FROM chat_channels
         WHERE project_id = $1 AND id = $2 AND status = 'active'
         LIMIT 1`,
        [projectId, channelId],
      );
      return mapChannel(result.rows[0]);
    },

    async listUserTeamIds({ projectId, userId }) {
      const result = await db.query(
        `SELECT tm.team_id
         FROM team_members tm
         INNER JOIN teams t ON t.id = tm.team_id
         WHERE tm.user_id = $1
           AND tm.status = 'active'
           AND t.project_id = $2
           AND t.status = 'active'`,
        [userId, projectId],
      );
      return result.rows.map((row) => row.team_id);
    },

    async listMessages({ channelId, afterSequence = 0, limit = 100 }) {
      const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 200));
      const after = Math.max(0, Number(afterSequence) || 0);
      const result = await db.query(
        `SELECT * FROM (
           SELECT
             m.*,
             u.display_name AS author_name
           FROM chat_messages m
           LEFT JOIN users u ON u.id = m.author_user_id
           WHERE m.channel_id = $1
             AND m.sequence_number > $2
           ORDER BY m.sequence_number DESC
           LIMIT $3
         ) recent
         ORDER BY sequence_number ASC`,
        [channelId, after, safeLimit],
      );
      return result.rows.map(mapMessage);
    },

    async findMessage(messageId) {
      const result = await db.query(
        `SELECT m.*, u.display_name AS author_name
         FROM chat_messages m
         LEFT JOIN users u ON u.id = m.author_user_id
         WHERE m.id = $1
         LIMIT 1`,
        [messageId],
      );
      return mapMessage(result.rows[0]);
    },

    async createMessage({ id, channelId, authorUserId, body }) {
      const result = await db.query(
        `WITH inserted AS (
           INSERT INTO chat_messages (id, channel_id, author_user_id, body)
           VALUES ($1, $2, $3, $4)
           RETURNING *
         )
         SELECT inserted.*, u.display_name AS author_name
         FROM inserted
         LEFT JOIN users u ON u.id = inserted.author_user_id`,
        [id, channelId, authorUserId, body],
      );
      return mapMessage(result.rows[0]);
    },

    async editMessage({ messageId, body }) {
      const result = await db.query(
        `WITH updated AS (
           UPDATE chat_messages
           SET body = $2, edited_at = NOW()
           WHERE id = $1 AND deleted_at IS NULL
           RETURNING *
         )
         SELECT updated.*, u.display_name AS author_name
         FROM updated
         LEFT JOIN users u ON u.id = updated.author_user_id`,
        [messageId, body],
      );
      return mapMessage(result.rows[0]);
    },

    async softDeleteMessage({ messageId, deletedByUserId }) {
      const result = await db.query(
        `WITH updated AS (
           UPDATE chat_messages
           SET deleted_at = COALESCE(deleted_at, NOW()),
               deleted_by_user_id = COALESCE(deleted_by_user_id, $2)
           WHERE id = $1
           RETURNING *
         )
         SELECT updated.*, u.display_name AS author_name
         FROM updated
         LEFT JOIN users u ON u.id = updated.author_user_id`,
        [messageId, deletedByUserId],
      );
      return mapMessage(result.rows[0]);
    },

    async listReactions(messageIds) {
      if (!messageIds.length) return [];
      const result = await db.query(
        `SELECT * FROM chat_reactions
         WHERE message_id = ANY($1::text[])
         ORDER BY created_at ASC`,
        [messageIds],
      );
      return result.rows.map(mapReaction);
    },

    async addReaction({ messageId, userId, emoji }) {
      const result = await db.query(
        `INSERT INTO chat_reactions (message_id, user_id, emoji)
         VALUES ($1, $2, $3)
         ON CONFLICT (message_id, user_id, emoji) DO NOTHING
         RETURNING *`,
        [messageId, userId, emoji],
      );
      return result.rows[0] ? mapReaction(result.rows[0]) : null;
    },

    async removeReaction({ messageId, userId, emoji }) {
      const result = await db.query(
        `DELETE FROM chat_reactions
         WHERE message_id = $1 AND user_id = $2 AND emoji = $3
         RETURNING *`,
        [messageId, userId, emoji],
      );
      return result.rows[0] ? mapReaction(result.rows[0]) : null;
    },

    async getReadState({ channelId, userId }) {
      const result = await db.query(
        `SELECT * FROM chat_read_states
         WHERE channel_id = $1 AND user_id = $2
         LIMIT 1`,
        [channelId, userId],
      );
      return mapReadState(result.rows[0]);
    },

    async markRead({ channelId, userId, sequenceNumber }) {
      const result = await db.query(
        `INSERT INTO chat_read_states (
           channel_id, user_id, last_read_sequence, last_read_at
         ) VALUES ($1, $2, $3, NOW())
         ON CONFLICT (channel_id, user_id)
         DO UPDATE SET
           last_read_sequence = GREATEST(chat_read_states.last_read_sequence, EXCLUDED.last_read_sequence),
           last_read_at = NOW()
         RETURNING *`,
        [channelId, userId, sequenceNumber],
      );
      return mapReadState(result.rows[0]);
    },

    async countUnread({ channelId, userId }) {
      const result = await db.query(
        `SELECT COUNT(*)::integer AS unread_count
         FROM chat_messages m
         LEFT JOIN chat_read_states r
           ON r.channel_id = m.channel_id AND r.user_id = $2
         WHERE m.channel_id = $1
           AND m.deleted_at IS NULL
           AND m.author_user_id IS DISTINCT FROM $2
           AND m.sequence_number > COALESCE(r.last_read_sequence, 0)`,
        [channelId, userId],
      );
      return Number(result.rows[0]?.unread_count || 0);
    },
  };
}
