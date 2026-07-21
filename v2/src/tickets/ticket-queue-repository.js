import { mapTicket } from "./ticket-repository.js";

export const TICKET_QUEUE_SCOPES = Object.freeze(["own", "team", "project"]);
export const TICKET_STATUS_FILTERS = Object.freeze(["active", "resolved", "all"]);
export const TICKET_ACTIVITY_WINDOWS = Object.freeze([
  "all",
  "today",
  "yesterday",
  "last_7_days",
  "last_30_days",
]);

export function createTicketQueueRepository(db) {
  if (!db || typeof db.query !== "function") {
    throw new TypeError("A database client with query(sql, params) is required");
  }

  return {
    async list({
      projectId,
      userId,
      scope,
      statusFilter = "active",
      activityWindow = "all",
      limit = 100,
    }) {
      if (!TICKET_QUEUE_SCOPES.includes(scope)) {
        throw new TypeError(`Invalid queue scope: ${scope}`);
      }
      if (!TICKET_STATUS_FILTERS.includes(statusFilter)) {
        throw new TypeError(`Invalid ticket status filter: ${statusFilter}`);
      }
      if (!TICKET_ACTIVITY_WINDOWS.includes(activityWindow)) {
        throw new TypeError(`Invalid ticket activity window: ${activityWindow}`);
      }

      const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 200));
      const result = await db.query(
        `SELECT t.*
         FROM tickets t
         INNER JOIN projects p ON p.id = t.project_id
         WHERE t.project_id = $1
           AND (
             $3 = 'project'
             OR (
               $3 = 'own'
               AND (t.assigned_to_user_id = $2 OR t.created_by_user_id = $2)
             )
             OR (
               $3 = 'team'
               AND (
                 t.assigned_to_user_id = $2
                 OR t.created_by_user_id = $2
                 OR EXISTS (
                   SELECT 1
                   FROM project_memberships pm
                   WHERE pm.project_id = t.project_id
                     AND pm.user_id = t.assigned_to_user_id
                     AND pm.status = 'active'
                     AND pm.supervisor_user_id = $2
                 )
                 OR EXISTS (
                   SELECT 1
                   FROM teams supervised_team
                   WHERE supervised_team.project_id = t.project_id
                     AND supervised_team.id = t.assigned_team_id
                     AND supervised_team.status = 'active'
                     AND supervised_team.supervisor_user_id = $2
                 )
               )
             )
           )
           AND (
             $4 = 'all'
             OR ($4 = 'active' AND t.status NOT IN ('resolved', 'closed'))
             OR ($4 = 'resolved' AND t.status = 'resolved')
           )
           AND (
             $5 = 'all'
             OR (
               $5 = 'today'
               AND (t.updated_at AT TIME ZONE p.timezone)::date =
                   (NOW() AT TIME ZONE p.timezone)::date
             )
             OR (
               $5 = 'yesterday'
               AND (t.updated_at AT TIME ZONE p.timezone)::date =
                   ((NOW() AT TIME ZONE p.timezone)::date - 1)
             )
             OR (
               $5 = 'last_7_days'
               AND (t.updated_at AT TIME ZONE p.timezone)::date >=
                   ((NOW() AT TIME ZONE p.timezone)::date - 6)
             )
             OR (
               $5 = 'last_30_days'
               AND (t.updated_at AT TIME ZONE p.timezone)::date >=
                   ((NOW() AT TIME ZONE p.timezone)::date - 29)
             )
           )
         ORDER BY t.updated_at DESC
         LIMIT $6`,
        [projectId, userId, scope, statusFilter, activityWindow, safeLimit],
      );

      return result.rows.map(mapTicket);
    },
  };
}
