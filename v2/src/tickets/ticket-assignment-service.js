import {
  CAPABILITIES,
  PROJECT_ROLES,
  hasCapability,
} from "../core/access-control.js";
import { withTransaction } from "../db/postgres.js";
import { createRepositories } from "../db/repositories.js";
import { createTicketAssignmentRepository } from "./ticket-assignment-repository.js";
import { createTicketRepository } from "./ticket-repository.js";

function forbidden(message = "Ticket assignment denied") {
  const error = new Error(message);
  error.code = "FORBIDDEN";
  return error;
}

function invalidInput(message) {
  const error = new Error(message);
  error.code = "INVALID_INPUT";
  return error;
}

function notFound(message = "Ticket not found") {
  const error = new Error(message);
  error.code = "NOT_FOUND";
  return error;
}

function conflict(message = "Ticket changed before assignment could be saved") {
  const error = new Error(message);
  error.code = "CONFLICT";
  return error;
}

function repositorySet(db) {
  return {
    ...createRepositories(db),
    ticketsV2: createTicketRepository(db),
    ticketAssignment: createTicketAssignmentRepository(db),
  };
}

async function getActor(repositories, actorId, projectId) {
  const actor = await repositories.users.findById(actorId);
  if (!actor || actor.status !== "active") throw forbidden("Active employee account required");
  const memberships = await repositories.memberships.listForUser(actorId);
  if (!hasCapability({
    user: actor,
    memberships,
    projectId,
    capability: CAPABILITIES.TICKETS_ASSIGN,
  })) {
    throw forbidden();
  }
  return { actor, memberships };
}

async function supervisorOwnsTicket(repositories, { actorId, projectId, ticket }) {
  if (ticket.assignedToUserId === actorId || ticket.createdByUserId === actorId) return true;

  if (ticket.assignedToUserId) {
    const assignedMembership = await repositories.memberships.find({
      userId: ticket.assignedToUserId,
      projectId,
    });
    if (
      assignedMembership?.status === "active" &&
      assignedMembership.supervisorUserId === actorId
    ) return true;
  }

  if (ticket.assignedTeamId) {
    const teams = await repositories.teams.listForProject(projectId);
    if (teams.some((team) => team.id === ticket.assignedTeamId && team.supervisorUserId === actorId)) {
      return true;
    }
  }

  return false;
}

export function createTicketAssignmentService({
  pool,
  runInTransaction = withTransaction,
  repositoryFactory = repositorySet,
} = {}) {
  if (!pool) throw new TypeError("A database pool is required");

  return {
    async assign({
      actorId,
      projectId,
      ticketCode,
      assignedToUserId = null,
      assignedTeamId = null,
      expectedVersion = null,
    }) {
      if (assignedToUserId && assignedTeamId) {
        throw invalidInput("Assign a ticket to either an employee or a team, not both at the same time");
      }

      return runInTransaction(pool, async (db) => {
        const repositories = repositoryFactory(db);
        const { actor, memberships } = await getActor(repositories, actorId, projectId);
        const ticket = await repositories.ticketsV2.findByCode({ projectId, ticketCode });
        if (!ticket) throw notFound();

        const projectWide = hasCapability({
          user: actor,
          memberships,
          projectId,
          capability: CAPABILITIES.TICKETS_VIEW_PROJECT,
        });
        if (!projectWide) {
          const ownTeamTicket = await supervisorOwnsTicket(repositories, {
            actorId: actor.id,
            projectId,
            ticket,
          });
          if (!ownTeamTicket) {
            throw forbidden("Supervisors can reassign only tickets belonging to their own supervised queue");
          }
        }

        let targetMembership = null;
        if (assignedToUserId) {
          targetMembership = await repositories.memberships.find({
            userId: assignedToUserId,
            projectId,
          });
          const targetUser = await repositories.users.findById(assignedToUserId);
          if (!targetUser || targetUser.status !== "active" || targetMembership?.status !== "active") {
            throw invalidInput("Assigned employee must be active in this project");
          }

          if (!projectWide) {
            const allowedSupervisorTarget =
              assignedToUserId === actor.id ||
              (
                targetMembership.role === PROJECT_ROLES.AGENT &&
                targetMembership.supervisorUserId === actor.id
              );
            if (!allowedSupervisorTarget) {
              throw forbidden("Supervisors can assign only to themselves or Agents they supervise");
            }
          }
        }

        if (assignedTeamId) {
          const teams = await repositories.teams.listForProject(projectId);
          const team = teams.find((item) => item.id === assignedTeamId && item.status !== "archived");
          if (!team) throw invalidInput("Assigned team must belong to this project");
          if (!projectWide && team.supervisorUserId !== actor.id) {
            throw forbidden("Supervisors can assign only to their own supervised team");
          }
        }

        const updated = await repositories.ticketAssignment.assign({
          projectId,
          ticketCode,
          assignedToUserId,
          assignedTeamId,
          expectedVersion,
        });
        if (!updated) {
          const current = await repositories.ticketsV2.findByCode({ projectId, ticketCode });
          if (!current) throw notFound();
          throw conflict();
        }

        await repositories.ticketAssignment.appendHistory({
          ticketId: updated.id,
          actorUserId: actor.id,
          eventType: "assignment_changed",
          metadata: {
            previousAssignedToUserId: ticket.assignedToUserId ?? null,
            previousAssignedTeamId: ticket.assignedTeamId ?? null,
            assignedToUserId,
            assignedTeamId,
          },
        });
        await repositories.audit.append({
          actorUserId: actor.id,
          projectId,
          action: "ticket.assignment_changed",
          targetType: "ticket",
          targetId: updated.id,
          metadata: {
            ticketCode: updated.ticketCode,
            assignedToUserId,
            assignedTeamId,
          },
        });

        return updated;
      });
    },
  };
}
