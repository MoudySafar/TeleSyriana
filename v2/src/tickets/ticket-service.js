import { randomUUID } from "node:crypto";

import { CAPABILITIES, hasCapability } from "../core/access-control.js";
import { withTransaction } from "../db/postgres.js";
import { createRepositories } from "../db/repositories.js";
import { createTicketRepository } from "./ticket-repository.js";

const PRIORITIES = new Set(["emergency", "high", "medium", "normal"]);
const STATUSES = new Set([
  "open",
  "waiting_customer",
  "waiting_courier",
  "waiting_supplier",
  "escalated",
  "resolved",
  "closed",
]);

function requiredText(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    const error = new Error(`${name} is required`);
    error.code = "INVALID_INPUT";
    throw error;
  }
  return normalized;
}

function optionalText(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function forbidden(message = "Forbidden") {
  const error = new Error(message);
  error.code = "FORBIDDEN";
  return error;
}

function notFound(ticketCode) {
  const error = new Error(`Ticket not found: ${ticketCode}`);
  error.code = "NOT_FOUND";
  return error;
}

function assertCapability({ actor, memberships, projectId, capability }) {
  if (!hasCapability({ user: actor, memberships, projectId, capability })) {
    throw forbidden(`Forbidden: missing capability ${capability}`);
  }
}

function deriveInitialStatus({ type, priority, summary }) {
  const normalized = String(summary || "").toLowerCase();
  const escalationWords = ["chargeback", "legal", "fake", "angry", "social", "refund dispute"];
  const escalationTypes = new Set([
    "angry_customer",
    "chargeback_risk",
    "item_not_genuine",
    "product_not_arrived",
    "address_change",
  ]);

  if (
    priority === "emergency" ||
    escalationTypes.has(type) ||
    escalationWords.some((word) => normalized.includes(word))
  ) {
    return "escalated";
  }
  return "open";
}

function persistenceRepositories(db) {
  return {
    ...createRepositories(db),
    tickets: createTicketRepository(db),
  };
}

async function loadActorContext(repositories, actorId) {
  const actor = await repositories.users.findById(actorId);
  if (!actor || actor.status !== "active") throw forbidden("Active employee account required");
  const memberships = await repositories.memberships.listForUser(actorId);
  return { actor, memberships };
}

async function canModifyTicket({ repositories, actor, memberships, projectId, ticket }) {
  if (hasCapability({
    user: actor,
    memberships,
    projectId,
    capability: CAPABILITIES.TICKETS_VIEW_PROJECT,
  })) {
    return true;
  }

  if (ticket.assignedToUserId === actor.id || ticket.createdByUserId === actor.id) {
    return true;
  }

  if (!hasCapability({
    user: actor,
    memberships,
    projectId,
    capability: CAPABILITIES.TICKETS_VIEW_TEAM,
  })) {
    return false;
  }

  if (ticket.assignedToUserId) {
    const targetMembership = await repositories.memberships.find({
      userId: ticket.assignedToUserId,
      projectId,
    });
    if (targetMembership?.supervisorUserId === actor.id) return true;
  }

  if (ticket.assignedTeamId) {
    const teams = await repositories.teams.listForProject(projectId);
    const assignedTeam = teams.find((team) => team.id === ticket.assignedTeamId);
    if (assignedTeam?.supervisorUserId === actor.id) return true;
  }

  return false;
}

export function createTicketService({
  pool,
  runInTransaction = withTransaction,
  repositoryFactory = persistenceRepositories,
} = {}) {
  if (!pool) throw new TypeError("A database pool is required");

  const transaction = (work) =>
    runInTransaction(pool, async (db) => work(repositoryFactory(db)));

  return {
    async create({ actorId, projectId, input = {} }) {
      return transaction(async (repositories) => {
        const { actor, memberships } = await loadActorContext(repositories, actorId);
        assertCapability({
          actor,
          memberships,
          projectId,
          capability: CAPABILITIES.TICKETS_CREATE,
        });

        const priority = String(input.priority || "normal").trim();
        if (!PRIORITIES.has(priority)) {
          const error = new Error(`Invalid ticket priority: ${priority}`);
          error.code = "INVALID_INPUT";
          throw error;
        }

        const type = String(input.type || "general_question").trim() || "general_question";
        const internalSummary = optionalText(input.internalSummary ?? input.note);
        const status = deriveInitialStatus({ type, priority, summary: internalSummary });

        const ticket = await repositories.tickets.create({
          id: `ticket:${randomUUID()}`,
          projectId,
          orderNumber: optionalText(input.orderNumber)?.replace(/^#/, "") ?? null,
          customerName: optionalText(input.customerName),
          customerEmail: optionalText(input.customerEmail)?.toLowerCase() ?? null,
          customerPhone: optionalText(input.customerPhone),
          trackingNumber: optionalText(input.trackingNumber),
          subject: optionalText(input.subject),
          type,
          priority,
          status,
          risk: status === "escalated" ? "high" : "low",
          internalSummary,
          createdByUserId: actor.id,
          assignedToUserId: input.assignedToUserId || actor.id,
          assignedTeamId: input.assignedTeamId || null,
        });

        await repositories.tickets.history.append({
          ticketId: ticket.id,
          projectId,
          actorUserId: actor.id,
          eventType: "ticket.created",
          afterData: {
            status: ticket.status,
            priority: ticket.priority,
            assignedToUserId: ticket.assignedToUserId,
          },
        });

        return ticket;
      });
    },

    /**
     * Search is intentionally project-wide once the actor has TICKETS_SEARCH.
     * It is not restricted to the current queue/assignee. This fixes the legacy
     * behaviour where old or another-agent tickets disappeared from search.
     */
    async search({ actorId, projectId, query, limit = 50 }) {
      return transaction(async (repositories) => {
        const { actor, memberships } = await loadActorContext(repositories, actorId);
        assertCapability({
          actor,
          memberships,
          projectId,
          capability: CAPABILITIES.TICKETS_SEARCH,
        });

        const normalized = requiredText(query, "query");
        return repositories.tickets.searchProject({ projectId, query: normalized, limit });
      });
    },

    async getByCode({ actorId, projectId, ticketCode }) {
      return transaction(async (repositories) => {
        const { actor, memberships } = await loadActorContext(repositories, actorId);
        assertCapability({
          actor,
          memberships,
          projectId,
          capability: CAPABILITIES.TICKETS_SEARCH,
        });

        const ticket = await repositories.tickets.findByCode({ projectId, code: ticketCode });
        if (!ticket) throw notFound(ticketCode);

        const [comments, history] = await Promise.all([
          repositories.tickets.comments.list(ticket.id),
          repositories.tickets.history.list(ticket.id),
        ]);

        return { ticket, comments, history };
      });
    },

    async listQueue({ actorId, projectId, includeResolved = false, limit = 100 }) {
      return transaction(async (repositories) => {
        const { actor, memberships } = await loadActorContext(repositories, actorId);

        if (hasCapability({
          user: actor,
          memberships,
          projectId,
          capability: CAPABILITIES.TICKETS_VIEW_PROJECT,
        })) {
          return repositories.tickets.listProject({ projectId, includeResolved, limit });
        }

        assertCapability({
          actor,
          memberships,
          projectId,
          capability: CAPABILITIES.TICKETS_VIEW_OWN,
        });
        return repositories.tickets.listMine({
          projectId,
          userId: actor.id,
          includeResolved,
          limit,
        });
      });
    },

    async updateStatus({ actorId, projectId, ticketCode, status, expectedVersion = null }) {
      return transaction(async (repositories) => {
        const { actor, memberships } = await loadActorContext(repositories, actorId);
        assertCapability({
          actor,
          memberships,
          projectId,
          capability: CAPABILITIES.TICKETS_UPDATE_STATUS,
        });

        if (!STATUSES.has(status)) {
          const error = new Error(`Invalid ticket status: ${status}`);
          error.code = "INVALID_INPUT";
          throw error;
        }

        const current = await repositories.tickets.findByCode({ projectId, code: ticketCode });
        if (!current) throw notFound(ticketCode);
        if (!(await canModifyTicket({ repositories, actor, memberships, projectId, ticket: current }))) {
          throw forbidden("Ticket is read-only because it is not assigned to you or your team");
        }

        const updated = await repositories.tickets.setStatus({
          projectId,
          ticketId: current.id,
          status,
          expectedVersion,
        });
        if (!updated) {
          const error = new Error("Ticket changed since it was loaded; reload before updating");
          error.code = "CONFLICT";
          throw error;
        }

        await repositories.tickets.history.append({
          ticketId: current.id,
          projectId,
          actorUserId: actor.id,
          eventType: "ticket.status_changed",
          beforeData: { status: current.status, version: current.version },
          afterData: { status: updated.status, version: updated.version },
        });

        return updated;
      });
    },

    async addComment({ actorId, projectId, ticketCode, body }) {
      const commentBody = requiredText(body, "body");
      return transaction(async (repositories) => {
        const { actor, memberships } = await loadActorContext(repositories, actorId);
        assertCapability({
          actor,
          memberships,
          projectId,
          capability: CAPABILITIES.TICKETS_COMMENT,
        });

        const ticket = await repositories.tickets.findByCode({ projectId, code: ticketCode });
        if (!ticket) throw notFound(ticketCode);
        if (!(await canModifyTicket({ repositories, actor, memberships, projectId, ticket }))) {
          throw forbidden("Ticket is read-only because it is not assigned to you or your team");
        }

        const comment = await repositories.tickets.comments.create({
          id: `comment:${randomUUID()}`,
          ticketId: ticket.id,
          authorUserId: actor.id,
          body: commentBody,
        });
        await repositories.tickets.touch({ projectId, ticketId: ticket.id });
        await repositories.tickets.history.append({
          ticketId: ticket.id,
          projectId,
          actorUserId: actor.id,
          eventType: "ticket.comment_added",
          metadata: { commentId: comment.id },
        });
        return comment;
      });
    },

    async editComment({ actorId, projectId, commentId, body }) {
      const commentBody = requiredText(body, "body");
      return transaction(async (repositories) => {
        const { actor, memberships } = await loadActorContext(repositories, actorId);
        assertCapability({
          actor,
          memberships,
          projectId,
          capability: CAPABILITIES.TICKETS_COMMENT,
        });

        const current = await repositories.tickets.comments.find(commentId);
        if (!current) {
          const error = new Error("Comment not found");
          error.code = "NOT_FOUND";
          throw error;
        }
        const ticket = await repositories.tickets.findById({ projectId, ticketId: current.ticketId });
        if (!ticket) throw forbidden("Comment does not belong to this project");

        const canModerate = hasCapability({
          user: actor,
          memberships,
          projectId,
          capability: CAPABILITIES.TICKETS_MODERATE_COMMENTS,
        });
        if (current.authorUserId !== actor.id && !canModerate) {
          throw forbidden("You can only edit your own ticket comments");
        }
        if (current.deleted) {
          const error = new Error("Deleted comments cannot be edited");
          error.code = "CONFLICT";
          throw error;
        }

        const updated = await repositories.tickets.comments.edit({ commentId, body: commentBody });
        await repositories.tickets.touch({ projectId, ticketId: ticket.id });
        await repositories.tickets.history.append({
          ticketId: ticket.id,
          projectId,
          actorUserId: actor.id,
          eventType: "ticket.comment_edited",
          metadata: { commentId },
        });
        return updated;
      });
    },

    async deleteComment({ actorId, projectId, commentId }) {
      return transaction(async (repositories) => {
        const { actor, memberships } = await loadActorContext(repositories, actorId);
        assertCapability({
          actor,
          memberships,
          projectId,
          capability: CAPABILITIES.TICKETS_COMMENT,
        });

        const current = await repositories.tickets.comments.find(commentId);
        if (!current) {
          const error = new Error("Comment not found");
          error.code = "NOT_FOUND";
          throw error;
        }
        const ticket = await repositories.tickets.findById({ projectId, ticketId: current.ticketId });
        if (!ticket) throw forbidden("Comment does not belong to this project");

        const canModerate = hasCapability({
          user: actor,
          memberships,
          projectId,
          capability: CAPABILITIES.TICKETS_MODERATE_COMMENTS,
        });
        if (current.authorUserId !== actor.id && !canModerate) {
          throw forbidden("You can only delete your own ticket comments");
        }

        const deleted = await repositories.tickets.comments.softDelete({
          commentId,
          deletedByUserId: actor.id,
        });
        await repositories.tickets.touch({ projectId, ticketId: ticket.id });
        await repositories.tickets.history.append({
          ticketId: ticket.id,
          projectId,
          actorUserId: actor.id,
          eventType: "ticket.comment_deleted",
          metadata: { commentId },
        });
        return deleted;
      });
    },
  };
}
