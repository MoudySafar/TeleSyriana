import { randomUUID } from "node:crypto";

import {
  CAPABILITIES,
  PROJECT_ROLES,
  hasCapability,
} from "../core/access-control.js";
import { withTransaction } from "../db/postgres.js";
import { createRepositories } from "../db/repositories.js";
import { createMembershipAdminRepository } from "../employees/membership-admin-repository.js";
import { createTeamRepository } from "./team-repository.js";

function forbidden(message = "Team access denied") {
  const error = new Error(message);
  error.code = "FORBIDDEN";
  return error;
}

function notFound(entity) {
  const error = new Error(`${entity} not found`);
  error.code = "NOT_FOUND";
  return error;
}

function invalidInput(message) {
  const error = new Error(message);
  error.code = "INVALID_INPUT";
  return error;
}

function requiredName(value) {
  const name = String(value || "").trim();
  if (!name) throw invalidInput("Team name is required");
  if (name.length > 120) throw invalidInput("Team name is too long");
  return name;
}

function repositorySet(db) {
  return {
    ...createRepositories(db),
    teamAdmin: createTeamRepository(db),
    membershipAdmin: createMembershipAdminRepository(db),
  };
}

async function actorContext(repositories, actorId, projectId) {
  const actor = await repositories.users.findById(actorId);
  if (!actor || actor.status !== "active") throw forbidden("Active employee account required");
  const memberships = await repositories.memberships.listForUser(actorId);
  return { actor, memberships };
}

async function requireProjectMembership(repositories, { projectId, userId }) {
  const user = await repositories.users.findById(userId);
  const membership = await repositories.memberships.find({ userId, projectId });
  if (!user || user.status !== "active" || !membership || membership.status !== "active") {
    throw invalidInput("Employee must have an active membership in this project");
  }
  return { user, membership };
}

async function requireSupervisorCandidate(repositories, { projectId, supervisorUserId }) {
  if (!supervisorUserId) return null;
  const { membership } = await requireProjectMembership(repositories, {
    projectId,
    userId: supervisorUserId,
  });
  if (![PROJECT_ROLES.SUPERVISOR, PROJECT_ROLES.MANAGER].includes(membership.role)) {
    throw invalidInput("Team supervisor must be a Supervisor or Manager in this project");
  }
  return membership;
}

function canManageProjectTeams({ actor, memberships, projectId }) {
  return hasCapability({
    user: actor,
    memberships,
    projectId,
    capability: CAPABILITIES.TEAMS_MANAGE_PROJECT,
  });
}

function canManageOwnTeam({ actor, memberships, projectId, team }) {
  return (
    team.supervisorUserId === actor.id &&
    hasCapability({
      user: actor,
      memberships,
      projectId,
      capability: CAPABILITIES.TEAMS_MANAGE_OWN,
    })
  );
}

export function createTeamService({
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
        const { actor, memberships } = await actorContext(repositories, actorId, projectId);
        if (!hasCapability({
          user: actor,
          memberships,
          projectId,
          capability: CAPABILITIES.TEAMS_VIEW,
        })) {
          throw forbidden();
        }

        const teams = await repositories.teamAdmin.listForProject(projectId);
        if (canManageProjectTeams({ actor, memberships, projectId })) return teams;

        const memberTeamIds = new Set(
          await repositories.teamAdmin.listUserTeamIds({ projectId, userId: actor.id }),
        );
        return teams.filter(
          (team) => team.supervisorUserId === actor.id || memberTeamIds.has(team.id),
        );
      });
    },

    async create({ actorId, projectId, input = {} }) {
      const name = requiredName(input.name);
      return transaction(async (repositories) => {
        const { actor, memberships } = await actorContext(repositories, actorId, projectId);
        if (!hasCapability({
          user: actor,
          memberships,
          projectId,
          capability: CAPABILITIES.TEAMS_CREATE,
        })) {
          throw forbidden("Only CEO, HR or project Manager can create teams");
        }

        await requireSupervisorCandidate(repositories, {
          projectId,
          supervisorUserId: input.supervisorUserId ?? null,
        });

        const team = await repositories.teamAdmin.create({
          id: `team:${randomUUID()}`,
          projectId,
          name,
          supervisorUserId: input.supervisorUserId ?? null,
        });
        await repositories.teamAdmin.createTeamChatChannel({
          id: `chat:${projectId}:team:${team.id}`,
          projectId,
          teamId: team.id,
          name: team.name,
          createdByUserId: actor.id,
        });
        await repositories.audit.append({
          actorUserId: actor.id,
          projectId,
          action: "team.created",
          targetType: "team",
          targetId: team.id,
          metadata: { name: team.name, supervisorUserId: team.supervisorUserId },
        });
        return team;
      });
    },

    async listMembers({ actorId, projectId, teamId }) {
      return transaction(async (repositories) => {
        const { actor, memberships } = await actorContext(repositories, actorId, projectId);
        const team = await repositories.teamAdmin.find({ projectId, teamId });
        if (!team) throw notFound("Team");

        const canManage = canManageProjectTeams({ actor, memberships, projectId });
        const canOwn = canManageOwnTeam({ actor, memberships, projectId, team });
        const teamIds = new Set(
          await repositories.teamAdmin.listUserTeamIds({ projectId, userId: actor.id }),
        );
        if (!canManage && !canOwn && !teamIds.has(team.id)) throw forbidden();

        return repositories.teamAdmin.listMembers({ projectId, teamId });
      });
    },

    async setSupervisor({ actorId, projectId, teamId, supervisorUserId }) {
      return transaction(async (repositories) => {
        const { actor, memberships } = await actorContext(repositories, actorId, projectId);
        if (!canManageProjectTeams({ actor, memberships, projectId })) {
          throw forbidden("Only CEO, HR or project Manager can change a team Supervisor");
        }

        const current = await repositories.teamAdmin.find({ projectId, teamId });
        if (!current) throw notFound("Team");
        await requireSupervisorCandidate(repositories, { projectId, supervisorUserId });

        const team = await repositories.teamAdmin.setSupervisor({
          projectId,
          teamId,
          supervisorUserId,
        });
        const members = await repositories.teamAdmin.listMembers({ projectId, teamId });
        for (const member of members) {
          if (member.projectRole === PROJECT_ROLES.AGENT) {
            await repositories.membershipAdmin.setSupervisor({
              userId: member.userId,
              projectId,
              supervisorUserId,
            });
          }
        }

        await repositories.audit.append({
          actorUserId: actor.id,
          projectId,
          action: "team.supervisor_changed",
          targetType: "team",
          targetId: teamId,
          metadata: {
            previousSupervisorUserId: current.supervisorUserId,
            supervisorUserId,
          },
        });
        return team;
      });
    },

    async addMember({ actorId, projectId, teamId, userId }) {
      return transaction(async (repositories) => {
        const { actor, memberships } = await actorContext(repositories, actorId, projectId);
        const team = await repositories.teamAdmin.find({ projectId, teamId });
        if (!team) throw notFound("Team");

        const projectManager = canManageProjectTeams({ actor, memberships, projectId });
        const ownSupervisor = canManageOwnTeam({ actor, memberships, projectId, team });
        if (!projectManager && !ownSupervisor) throw forbidden();

        const { membership } = await requireProjectMembership(repositories, { projectId, userId });
        if (ownSupervisor && membership.role !== PROJECT_ROLES.AGENT) {
          throw forbidden("Supervisors can add Agents to their own team, not Managers or other Supervisors");
        }

        const member = await repositories.teamAdmin.addMember({ teamId, userId });
        if (membership.role === PROJECT_ROLES.AGENT) {
          await repositories.membershipAdmin.setSupervisor({
            userId,
            projectId,
            supervisorUserId: team.supervisorUserId ?? null,
          });
        }
        await repositories.audit.append({
          actorUserId: actor.id,
          projectId,
          action: "team.member_added",
          targetType: "team",
          targetId: teamId,
          metadata: { userId },
        });
        return member;
      });
    },

    async removeMember({ actorId, projectId, teamId, userId }) {
      return transaction(async (repositories) => {
        const { actor, memberships } = await actorContext(repositories, actorId, projectId);
        const team = await repositories.teamAdmin.find({ projectId, teamId });
        if (!team) throw notFound("Team");

        const projectManager = canManageProjectTeams({ actor, memberships, projectId });
        const ownSupervisor = canManageOwnTeam({ actor, memberships, projectId, team });
        if (!projectManager && !ownSupervisor) throw forbidden();

        const { membership } = await requireProjectMembership(repositories, { projectId, userId });
        if (ownSupervisor && membership.role !== PROJECT_ROLES.AGENT) {
          throw forbidden("Supervisors can remove Agents from their own team only");
        }

        const member = await repositories.teamAdmin.removeMember({ teamId, userId });
        if (!member) throw notFound("Team member");

        if (membership.role === PROJECT_ROLES.AGENT && membership.supervisorUserId === team.supervisorUserId) {
          await repositories.membershipAdmin.setSupervisor({
            userId,
            projectId,
            supervisorUserId: null,
          });
        }
        await repositories.audit.append({
          actorUserId: actor.id,
          projectId,
          action: "team.member_removed",
          targetType: "team",
          targetId: teamId,
          metadata: { userId },
        });
        return member;
      });
    },
  };
}
