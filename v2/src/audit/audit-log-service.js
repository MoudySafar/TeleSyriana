import { CAPABILITIES, hasCapability } from "../core/access-control.js";
import { withTransaction } from "../db/postgres.js";
import { createRepositories } from "../db/repositories.js";
import { createAuditLogRepository } from "./audit-log-repository.js";

function forbidden() {
  const error = new Error("Audit log access denied");
  error.code = "FORBIDDEN";
  return error;
}

function repositorySet(db) {
  return {
    ...createRepositories(db),
    auditLog: createAuditLogRepository(db),
  };
}

export function createAuditLogService({
  pool,
  runInTransaction = withTransaction,
  repositoryFactory = repositorySet,
} = {}) {
  if (!pool) throw new TypeError("A database pool is required");

  return {
    async list({ actorId, projectId, actionPrefix = null, limit = 100 }) {
      return runInTransaction(pool, async (db) => {
        const repositories = repositoryFactory(db);
        const actor = await repositories.users.findById(actorId);
        if (!actor || actor.status !== "active") throw forbidden();
        const memberships = await repositories.memberships.listForUser(actor.id);
        if (!hasCapability({
          user: actor,
          memberships,
          projectId,
          capability: CAPABILITIES.AUDIT_VIEW,
        })) {
          throw forbidden();
        }

        return repositories.auditLog.list({ projectId, actionPrefix, limit });
      });
    },
  };
}
