import { CAPABILITIES, hasCapability } from "../core/access-control.js";
import { createRepositories } from "../db/repositories.js";
import { withTransaction } from "../db/postgres.js";
import {
  TICKET_ACTIVITY_WINDOWS,
  TICKET_STATUS_FILTERS,
  createTicketQueueRepository,
} from "./ticket-queue-repository.js";

function invalidInput(message) {
  const error = new Error(message);
  error.code = "INVALID_INPUT";
  return error;
}

function forbidden() {
  const error = new Error("Ticket queue access denied");
  error.code = "FORBIDDEN";
  return error;
}

function repositorySet(db) {
  return {
    ...createRepositories(db),
    ticketQueue: createTicketQueueRepository(db),
  };
}

export function createTicketQueueService({
  pool,
  runInTransaction = withTransaction,
  repositoryFactory = repositorySet,
} = {}) {
  if (!pool) throw new TypeError("A database pool is required");

  const transaction = (work) =>
    runInTransaction(pool, async (db) => work(repositoryFactory(db)));

  return {
    async list({
      actorId,
      projectId,
      statusFilter = "active",
      activityWindow = "all",
      limit = 100,
    }) {
      if (!TICKET_STATUS_FILTERS.includes(statusFilter)) {
        throw invalidInput(`Invalid ticket status filter: ${statusFilter}`);
      }
      if (!TICKET_ACTIVITY_WINDOWS.includes(activityWindow)) {
        throw invalidInput(`Invalid ticket activity window: ${activityWindow}`);
      }

      return transaction(async (repositories) => {
        const actor = await repositories.users.findById(actorId);
        if (!actor || actor.status !== "active") throw forbidden();
        const memberships = await repositories.memberships.listForUser(actorId);

        let scope;
        if (hasCapability({
          user: actor,
          memberships,
          projectId,
          capability: CAPABILITIES.TICKETS_VIEW_PROJECT,
        })) {
          scope = "project";
        } else if (hasCapability({
          user: actor,
          memberships,
          projectId,
          capability: CAPABILITIES.TICKETS_VIEW_TEAM,
        })) {
          scope = "team";
        } else if (hasCapability({
          user: actor,
          memberships,
          projectId,
          capability: CAPABILITIES.TICKETS_VIEW_OWN,
        })) {
          scope = "own";
        } else {
          throw forbidden();
        }

        return repositories.ticketQueue.list({
          projectId,
          userId: actor.id,
          scope,
          statusFilter,
          activityWindow,
          limit,
        });
      });
    },
  };
}
