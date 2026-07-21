import { isGlobalProjectViewer } from "../core/access-control.js";
import { withTransaction } from "../db/postgres.js";
import { createRepositories } from "../db/repositories.js";
import { createGlobalEmployeeRepository } from "./global-employee-repository.js";

function forbidden() {
  const error = new Error("Global workforce access denied");
  error.code = "FORBIDDEN";
  return error;
}

function repositorySet(db) {
  return {
    ...createRepositories(db),
    globalEmployees: createGlobalEmployeeRepository(db),
  };
}

export function createGlobalEmployeeService({
  pool,
  runInTransaction = withTransaction,
  repositoryFactory = repositorySet,
} = {}) {
  if (!pool) throw new TypeError("A database pool is required");

  return {
    async list({ actorId, query = null, limit = 100 }) {
      return runInTransaction(pool, async (db) => {
        const repositories = repositoryFactory(db);
        const actor = await repositories.users.findById(actorId);
        if (!actor || actor.status !== "active" || !isGlobalProjectViewer(actor)) {
          throw forbidden();
        }
        return repositories.globalEmployees.list({ query, limit });
      });
    },
  };
}
