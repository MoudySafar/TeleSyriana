import { randomUUID } from "node:crypto";

import { createAuthRepository } from "../auth/auth-repository.js";
import { hashLoginSecret } from "../auth/crypto.js";
import {
  CAPABILITIES,
  PROJECT_ROLES,
  hasCapability,
} from "../core/access-control.js";
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
import { createMembershipAdminRepository } from "./membership-admin-repository.js";

function notFound(entity, id) {
  const error = new Error(`${entity} not found: ${id}`);
  error.code = "NOT_FOUND";
  return error;
}

function forbidden(message = "Forbidden") {
  const error = new Error(message);
  error.code = "FORBIDDEN";
  return error;
}

function invalidInput(message) {
  const error = new Error(message);
  error.code = "INVALID_INPUT";
  return error;
}

function createPersistenceRepositories(db) {
  return {
    ...createRepositories(db),
    auth: createAuthRepository(db),
    membershipAdmin: createMembershipAdminRepository(db),
  };
}

async function loadActorContext(repositories, actorId) {
  const actor = await repositories.users.findById(actorId);
  if (!actor || actor.status !== "active") throw notFound("Active actor", actorId);

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

async function validateProjectSupervisor(repositories, { projectId, supervisorUserId }) {
  if (!supervisorUserId) return null;

  const supervisor = await repositories.users.findById(supervisorUserId);
  if (!supervisor || supervisor.status !== "active") {
    throw invalidInput("Selected supervisor must be an active employee");
  }

  const supervisorMembership = await repositories.memberships.find({
    userId: supervisorUserId,
    projectId,
  });
  if (
    !supervisorMembership ||
    supervisorMembership.status !== "active" ||
    ![PROJECT_ROLES.SUPERVISOR, PROJECT_ROLES.MANAGER].includes(supervisorMembership.role)
  ) {
    throw invalidInput("Selected supervisor must be an active Supervisor or Manager in this project");
  }

  return supervisorMembership;
}

async function validateProjectTeam(repositories, { projectId, teamId }) {
  if (!teamId) return null;
  const teams = await repositories.teams.listForProject(projectId);
  const team = teams.find((item) => item.id === teamId && item.status !== "archived");
  if (!team) throw invalidInput("Selected team does not belong to this project");
  return team;
}

export function createPersistentEmployeeService({
  pool,
  runInTransaction = withTransaction,
  repositoryFactory = createPersistenceRepositories,
} = {}) {
  if (!pool) throw new TypeError("A database pool is required");

  const transaction = (work) =>
    runInTransaction(pool, async (db) => work(repositoryFactory(db)));

  return {
    async createForProject({ actorId, projectId, input }) {
      if (!input?.temporarySecret) {
        throw invalidInput("temporarySecret is required when creating an employee account");
      }

      // Hash outside the DB transaction so CPU-heavy key derivation does not
      // keep a database connection/transaction open longer than necessary.
      const temporaryCredential = await hashLoginSecret(input.temporarySecret);

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

        await validateProjectSupervisor(repositories, {
          projectId,
          supervisorUserId: input.supervisorUserId ?? input.supervisorId ?? null,
        });
        await validateProjectTeam(repositories, { projectId, teamId: input.teamId ?? null });

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

        await repositories.auth.upsertCredential({
          userId: user.id,
          secretHash: temporaryCredential.hash,
          secretSalt: temporaryCredential.salt,
          mustReset: true,
        });

        const audit = await persistAudit(repositories, domain.auditEvent);
        return { user, membership, audit, mustResetLoginSecret: true };
      });
    },

    async assignExistingToProject({
      actorId,
      projectId,
      targetUserId,
      role,
      supervisorUserId = null,
      teamId = null,
    }) {
      if (!Object.values(PROJECT_ROLES).includes(role)) {
        throw invalidInput(`Invalid project role: ${role}`);
      }

      return transaction(async (repositories) => {
        const { actor, memberships } = await loadActorContext(repositories, actorId);
        if (!hasCapability({
          user: actor,
          memberships,
          projectId,
          capability: CAPABILITIES.EMPLOYEES_ASSIGN_PROJECT,
        })) {
          throw forbidden("Only CEO or HR can assign an existing employee to another project");
        }

        const targetUser = await repositories.users.findById(targetUserId);
        if (!targetUser) throw notFound("User", targetUserId);
        if (targetUser.status !== "active") {
          throw invalidInput("Disabled employees must be reactivated before project assignment");
        }

        await validateProjectSupervisor(repositories, { projectId, supervisorUserId });
        await validateProjectTeam(repositories, { projectId, teamId });

        const previousMembership = await repositories.memberships.find({
          userId: targetUserId,
          projectId,
        });

        const membership = await repositories.membershipAdmin.assign({
          id: previousMembership?.id || `membership:${randomUUID()}`,
          userId: targetUserId,
          projectId,
          role,
          supervisorUserId,
        });

        if (teamId) {
          await repositories.teams.addMember({ teamId, userId: targetUserId });
        }

        const audit = await repositories.audit.append({
          projectId,
          actorUserId: actor.id,
          action: previousMembership ? "employee.project_membership_updated" : "employee.project_assigned",
          targetType: "user",
          targetId: targetUserId,
          metadata: {
            previousRole: previousMembership?.role ?? null,
            role,
            supervisorUserId,
            teamId,
          },
        });

        return { user: targetUser, membership, audit };
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
        await repositories.auth.revokeAllUserSessions(targetUserId);
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
