import { createRepositories } from "../db/repositories.js";
import { withTransaction } from "../db/postgres.js";
import {
  changeEmployeeProjectRole,
  createEmployeeForProject,
  disableEmployeeAccount,
  disableProjectMembership,
  reactivateEmployeeAccount,
  reactivateProjectMembership,
} from "./employee-service.js";

function notFound(entity, id) {
  const error = new Error(`${entity} not found: ${id}`);
  error.code = "NOT_FOUND";
  return error;
}

async function loadActorContext(repositories, actorId) {
  const actor = await repositories.users.findById(actorId);
  if (!actor) throw notFound("Actor", actorId);

  const memberships = await repositories.memberships.listForUser(actorId);
  return { actor, memberships };
}

async function persistAudit(repositories, auditEvent) {
  return repositories.audit.append({
    projectId: auditEvent.projectId ?? null,
    actorUserId: auditEvent.actorUserId,
    action: auditEvent.action,
    targetType: "user",
    targetId: auditEvent.targetUserId ?? null,
    metadata: auditEvent.metadata ?? {},
  });
}

export function createPersistentEmployeeService({
  pool,
  runInTransaction = withTransaction,
  repositoryFactory = createRepositories,
} = {}) {
  if (!pool) throw new TypeError("A database pool is required");

  const transaction = (work) =>
    runInTransaction(pool, async (db) => work(repositoryFactory(db)));

  return {
    async createForProject({ actorId, projectId, input }) {
      return transaction(async (repositories) => {
        const { actor, memberships } = await loadActorContext(repositories, actorId);
        const duplicate = await repositories.users.findByStaffCode(input.staffCode);

        const domain = createEmployeeForProject({
          actor,
          memberships,
          projectId,
          existingUsers: duplicate ? [duplicate] : [],
          input,
        });

        const user = await repositories.users.create({
          id: domain.user.id,
          staffCode: domain.user.staffCode,
          displayName: domain.user.displayName,
          email: input.email ?? null,
          platformRole: domain.user.platformRole,
          locale: input.locale ?? input.language ?? "en",
          theme: input.theme ?? "system",
        });

        const membership = await repositories.memberships.create({
          id: domain.membership.id,
          userId: user.id,
          projectId,
          role: domain.membership.role,
          supervisorUserId: input.supervisorUserId ?? input.supervisorId ?? null,
        });

        if (input.teamId) {
          await repositories.teams.addMember({ teamId: input.teamId, userId: user.id });
        }

        const audit = await persistAudit(repositories, domain.auditEvent);
        return { user, membership, audit };
      });
    },

    async changeProjectRole({ actorId, projectId, targetUserId, nextRole }) {
      return transaction(async (repositories) => {
        const { actor, memberships } = await loadActorContext(repositories, actorId);
        const targetMembership = await repositories.memberships.find({
          userId: targetUserId,
          projectId,
        });
        if (!targetMembership) throw notFound("Project membership", `${targetUserId}:${projectId}`);

        const domain = changeEmployeeProjectRole({
          actor,
          memberships,
          projectId,
          targetMembership,
          nextRole,
        });

        const membership = await repositories.memberships.setRole({
          userId: targetUserId,
          projectId,
          role: domain.membership.role,
        });
        const audit = await persistAudit(repositories, domain.auditEvent);
        return { membership, audit };
      });
    },

    async disableFromProject({ actorId, projectId, targetUserId }) {
      return transaction(async (repositories) => {
        const { actor, memberships } = await loadActorContext(repositories, actorId);
        const targetMembership = await repositories.memberships.find({
          userId: targetUserId,
          projectId,
        });
        if (!targetMembership) throw notFound("Project membership", `${targetUserId}:${projectId}`);

        const domain = disableProjectMembership({
          actor,
          memberships,
          projectId,
          targetMembership,
        });

        const membership = await repositories.memberships.setStatus({
          userId: targetUserId,
          projectId,
          status: "disabled",
        });
        const audit = await persistAudit(repositories, domain.auditEvent);
        return { membership, audit };
      });
    },

    async reactivateInProject({ actorId, projectId, targetUserId }) {
      return transaction(async (repositories) => {
        const { actor, memberships } = await loadActorContext(repositories, actorId);
        const targetMembership = await repositories.memberships.find({
          userId: targetUserId,
          projectId,
        });
        if (!targetMembership) throw notFound("Project membership", `${targetUserId}:${projectId}`);

        const domain = reactivateProjectMembership({
          actor,
          memberships,
          projectId,
          targetMembership,
        });

        const membership = await repositories.memberships.setStatus({
          userId: targetUserId,
          projectId,
          status: "active",
        });
        const audit = await persistAudit(repositories, domain.auditEvent);
        return { membership, audit };
      });
    },

    async disableAccount({ actorId, targetUserId }) {
      return transaction(async (repositories) => {
        const { actor, memberships } = await loadActorContext(repositories, actorId);
        const targetUser = await repositories.users.findById(targetUserId);
        if (!targetUser) throw notFound("User", targetUserId);

        const domain = disableEmployeeAccount({ actor, memberships, targetUser });
        const user = await repositories.users.setStatus({ userId: targetUserId, status: "disabled" });
        const audit = await persistAudit(repositories, domain.auditEvent);
        return { user, audit };
      });
    },

    async reactivateAccount({ actorId, targetUserId }) {
      return transaction(async (repositories) => {
        const { actor, memberships } = await loadActorContext(repositories, actorId);
        const targetUser = await repositories.users.findById(targetUserId);
        if (!targetUser) throw notFound("User", targetUserId);

        const domain = reactivateEmployeeAccount({ actor, memberships, targetUser });
        const user = await repositories.users.setStatus({ userId: targetUserId, status: "active" });
        const audit = await persistAudit(repositories, domain.auditEvent);
        return { user, audit };
      });
    },
  };
}
