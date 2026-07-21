import { mapTicket } from "./ticket-repository.js";

export function createTicketAssignmentRepository(db) {
  if (!db || typeof db.query !== "function") {
    throw new TypeError("A database client with query(sql, params) is required");
  }

  return {
    async assign({
      projectId,
      ticketCode,
      assignedToUserId = null,
      assignedTeamId = null,
      expectedVersion = null,
    }) {
      const result = await db.query(
        `UPDATE tickets
         SET assigned_to_user_id = $3,
             assigned_team_id = $4,
             updated_at = NOW(),
             version = version + 1
         WHERE project_id = $1
           AND ticket_code = $2
           AND ($5::integer IS NULL OR version = $5)
         RETURNING *`,
        [projectId, ticketCode, assignedToUserId, assignedTeamId, expectedVersion],
      );
      return mapTicket(result.rows[0]);
    },

    async appendHistory({ ticketId, actorUserId, eventType, metadata = {} }) {
      const result = await db.query(
        `INSERT INTO ticket_history (
           ticket_id, actor_user_id, event_type, metadata
         ) VALUES ($1, $2, $3, $4::jsonb)
         RETURNING *`,
        [ticketId, actorUserId, eventType, JSON.stringify(metadata)],
      );
      return result.rows[0] ?? null;
    },
  };
}
