import {
  CAPABILITIES,
  hasCapability,
  isGlobalProjectViewer,
} from "../core/access-control.js";
import { withTransaction } from "../db/postgres.js";
import { createRepositories } from "../db/repositories.js";
import { createEmployeeDirectoryRepository } from "./employee-directory-repository.js";

function forbidden() {
  const error = new Error("Employee directory access denied");
  error.code = "FORBIDDEN";
  return error;
}

function notFound() {
  const error = new Error("Employee not found in this project");
  error.code = "NOT_FOUND";
  return error;
}

function repositorySet(db) {
  return {
    ...createRepositories(db),
    directory: createEmployeeDirectoryRepository(db),
  };
}

async function context(repositories, actorId, projectId) {
  const actor = await repositories.users.findById(actorId);
  if (!actor || actor.status !== "active") throw forbidden();
  const memberships = await repositories.memberships.listForUser(actorId);
  if (!hasCapability({
    user: actor,
    memberships,
    projectId,
    capability: CAPABILITIES.EMPLOYEES_VIEW,
  })) {
    throw forbidden();
  }
  return { actor, memberships };
}

function hasFullProjectDirectory({ actor, memberships, projectId }) {
  return hasCapability({
    user: actor,
    memberships,
    projectId,
    capability: CAPABILITIES.TEAMS_MANAGE_PROJECT,
  });
}

export function createEmployeeDirectoryService({
  pool,
  runInTransaction = withTransaction,
  repositoryFactory = repositorySet,
} = {}) {
  if (!pool) throw new TypeError("A database pool is required");

  const transaction = (work) =>
    runInTransaction(pool, async (db) => work(repositoryFactory(db)));

  return {
    async list({ actorId, projectId }) {
      return transaction(async (repositories) => {
        const { actor, memberships } = await context(repositories, actorId, projectId);
        const supervisorScopeUserId = hasFullProjectDirectory({ actor, memberships, projectId })
          ? null
          : actor.id;

        return repositories.directory.listProject({
          projectId,
          supervisorScopeUserId,
        });
      });
    },

    async getProfile({ actorId, projectId, targetUserId }) {
      return transaction(async (repositories) => {
        const { actor, memberships } = await context(repositories, actorId, projectId);
        const supervisorScopeUserId = hasFullProjectDirectory({ actor, memberships, projectId })
          ? null
          : actor.id;
        const visible = await repositories.directory.listProject({
          projectId,
          supervisorScopeUserId,
        });
        const employee = visible.find((item) => item.id === targetUserId);
        if (!employee) throw notFound();

        const projectMemberships = isGlobalProjectViewer(actor)
          ? await repositories.directory.listMemberships(targetUserId)
          : [{
              projectId: employee.projectId,
              role: employee.projectRole,
              status: employee.membershipStatus,
              supervisorUserId: employee.supervisorUserId,
              supervisorName: employee.supervisorName,
            }];

        return { employee, projectMemberships };
      });
    },
  };
}
