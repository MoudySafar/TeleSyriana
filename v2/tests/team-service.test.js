import test from "node:test";
import assert from "node:assert/strict";

import { PLATFORM_ROLES, PROJECT_ROLES } from "../src/core/access-control.js";
import { createTeamService } from "../src/teams/team-service.js";

function fakeRepositories() {
  const users = new Map([
    ["manager", { id: "manager", displayName: "Manager", platformRole: PLATFORM_ROLES.MEMBER, status: "active" }],
    ["supervisor", { id: "supervisor", displayName: "Supervisor", platformRole: PLATFORM_ROLES.MEMBER, status: "active" }],
    ["supervisor-2", { id: "supervisor-2", displayName: "Supervisor 2", platformRole: PLATFORM_ROLES.MEMBER, status: "active" }],
    ["agent-a", { id: "agent-a", displayName: "Agent A", platformRole: PLATFORM_ROLES.MEMBER, status: "active" }],
    ["agent-b", { id: "agent-b", displayName: "Agent B", platformRole: PLATFORM_ROLES.MEMBER, status: "active" }],
    ["hr", { id: "hr", displayName: "HR", platformRole: PLATFORM_ROLES.HR, status: "active" }],
  ]);
  const memberships = [
    { id: "m-manager", userId: "manager", projectId: "ipro", role: PROJECT_ROLES.MANAGER, status: "active", supervisorUserId: null },
    { id: "m-supervisor", userId: "supervisor", projectId: "ipro", role: PROJECT_ROLES.SUPERVISOR, status: "active", supervisorUserId: null },
    { id: "m-supervisor-2", userId: "supervisor-2", projectId: "ipro", role: PROJECT_ROLES.SUPERVISOR, status: "active", supervisorUserId: null },
    { id: "m-agent-a", userId: "agent-a", projectId: "ipro", role: PROJECT_ROLES.AGENT, status: "active", supervisorUserId: "supervisor" },
    { id: "m-agent-b", userId: "agent-b", projectId: "ipro", role: PROJECT_ROLES.AGENT, status: "active", supervisorUserId: null },
  ];
  const teams = [
    { id: "support", projectId: "ipro", name: "Support", supervisorUserId: "supervisor", status: "active" },
    { id: "operations", projectId: "ipro", name: "Operations", supervisorUserId: "supervisor-2", status: "active" },
  ];
  const members = [
    { teamId: "support", userId: "agent-a", status: "active" },
  ];
  const chatChannels = [];
  const audit = [];

  const repo = {
    users: {
      async findById(id) { return users.get(id) ?? null; },
    },
    memberships: {
      async listForUser(userId) { return memberships.filter((item) => item.userId === userId); },
      async find({ userId, projectId }) {
        return memberships.find((item) => item.userId === userId && item.projectId === projectId) ?? null;
      },
    },
    membershipAdmin: {
      async setSupervisor({ userId, projectId, supervisorUserId }) {
        const membership = memberships.find((item) => item.userId === userId && item.projectId === projectId);
        membership.supervisorUserId = supervisorUserId;
        return { ...membership };
      },
    },
    teamAdmin: {
      async listForProject(projectId) { return teams.filter((team) => team.projectId === projectId && team.status === "active"); },
      async find({ projectId, teamId }) {
        return teams.find((team) => team.projectId === projectId && team.id === teamId && team.status === "active") ?? null;
      },
      async create({ id, projectId, name, supervisorUserId }) {
        const team = { id, projectId, name, supervisorUserId, status: "active" };
        teams.push(team);
        return team;
      },
      async setSupervisor({ projectId, teamId, supervisorUserId }) {
        const team = teams.find((item) => item.projectId === projectId && item.id === teamId);
        team.supervisorUserId = supervisorUserId;
        return { ...team };
      },
      async listMembers({ projectId, teamId }) {
        return members
          .filter((member) => member.teamId === teamId && member.status === "active")
          .map((member) => {
            const membership = memberships.find(
              (item) => item.userId === member.userId && item.projectId === projectId,
            );
            return {
              ...member,
              projectRole: membership?.role ?? null,
              displayName: users.get(member.userId)?.displayName ?? null,
            };
          });
      },
      async listUserTeamIds({ projectId, userId }) {
        return members
          .filter((member) => member.userId === userId && member.status === "active")
          .filter((member) => teams.some((team) => team.id === member.teamId && team.projectId === projectId))
          .map((member) => member.teamId);
      },
      async addMember({ teamId, userId }) {
        const existing = members.find((item) => item.teamId === teamId && item.userId === userId);
        if (existing) {
          existing.status = "active";
          return { ...existing };
        }
        const member = { teamId, userId, status: "active" };
        members.push(member);
        return member;
      },
      async removeMember({ teamId, userId }) {
        const index = members.findIndex((item) => item.teamId === teamId && item.userId === userId);
        if (index < 0) return null;
        return members.splice(index, 1)[0];
      },
      async createTeamChatChannel(input) {
        chatChannels.push(input);
        return input;
      },
    },
    audit: {
      async append(event) { audit.push(event); return event; },
    },
  };

  return { repo, state: { users, memberships, teams, members, chatChannels, audit } };
}

function serviceWith(repo) {
  return createTeamService({
    pool: {},
    runInTransaction: async (_pool, work) => work({}),
    repositoryFactory: () => repo,
  });
}

test("Manager can create a team and private team chat channel", async () => {
  const { repo, state } = fakeRepositories();
  const service = serviceWith(repo);

  const team = await service.create({
    actorId: "manager",
    projectId: "ipro",
    input: { name: "Returns", supervisorUserId: "supervisor" },
  });

  assert.equal(team.name, "Returns");
  assert.equal(team.supervisorUserId, "supervisor");
  assert.equal(state.chatChannels.length, 1);
  assert.equal(state.chatChannels[0].teamId, team.id);
  assert.equal(state.audit.at(-1).action, "team.created");
});

test("Supervisor sees and manages only their own supervised or member team", async () => {
  const { repo } = fakeRepositories();
  const service = serviceWith(repo);

  const visible = await service.list({ actorId: "supervisor", projectId: "ipro" });
  assert.deepEqual(visible.map((team) => team.id), ["support"]);

  await assert.rejects(
    service.addMember({
      actorId: "supervisor",
      projectId: "ipro",
      teamId: "operations",
      userId: "agent-b",
    }),
    (error) => error.code === "FORBIDDEN",
  );
});

test("Supervisor can add an Agent to their team and becomes that Agent project supervisor", async () => {
  const { repo, state } = fakeRepositories();
  const service = serviceWith(repo);

  await service.addMember({
    actorId: "supervisor",
    projectId: "ipro",
    teamId: "support",
    userId: "agent-b",
  });

  const membership = state.memberships.find((item) => item.userId === "agent-b" && item.projectId === "ipro");
  assert.equal(membership.supervisorUserId, "supervisor");
  assert.equal(state.members.some((item) => item.teamId === "support" && item.userId === "agent-b"), true);
  assert.equal(state.audit.at(-1).action, "team.member_added");
});

test("Supervisor cannot add another Supervisor to their team", async () => {
  const { repo } = fakeRepositories();
  const service = serviceWith(repo);

  await assert.rejects(
    service.addMember({
      actorId: "supervisor",
      projectId: "ipro",
      teamId: "support",
      userId: "supervisor-2",
    }),
    /can add Agents/,
  );
});

test("Manager changing team Supervisor synchronizes existing Agent memberships", async () => {
  const { repo, state } = fakeRepositories();
  const service = serviceWith(repo);

  await service.setSupervisor({
    actorId: "manager",
    projectId: "ipro",
    teamId: "support",
    supervisorUserId: "supervisor-2",
  });

  const agentMembership = state.memberships.find((item) => item.userId === "agent-a");
  assert.equal(agentMembership.supervisorUserId, "supervisor-2");
  assert.equal(state.teams.find((team) => team.id === "support").supervisorUserId, "supervisor-2");
});

test("Agent can view only their own team and cannot manage membership", async () => {
  const { repo } = fakeRepositories();
  const service = serviceWith(repo);

  const visible = await service.list({ actorId: "agent-a", projectId: "ipro" });
  assert.deepEqual(visible.map((team) => team.id), ["support"]);

  await assert.rejects(
    service.addMember({
      actorId: "agent-a",
      projectId: "ipro",
      teamId: "support",
      userId: "agent-b",
    }),
    (error) => error.code === "FORBIDDEN",
  );
});

test("Supervisor removal clears Agent supervisor relationship when it matches the team", async () => {
  const { repo, state } = fakeRepositories();
  const service = serviceWith(repo);

  await service.removeMember({
    actorId: "supervisor",
    projectId: "ipro",
    teamId: "support",
    userId: "agent-a",
  });

  const membership = state.memberships.find((item) => item.userId === "agent-a");
  assert.equal(membership.supervisorUserId, null);
  assert.equal(state.members.some((item) => item.teamId === "support" && item.userId === "agent-a"), false);
});
