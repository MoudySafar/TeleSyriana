import test from "node:test";
import assert from "node:assert/strict";

import { PLATFORM_ROLES, PROJECT_ROLES } from "../src/core/access-control.js";
import { createEmployeeDirectoryService } from "../src/employees/employee-directory-service.js";

function fakeRepositories() {
  const users = new Map([
    ["manager", { id: "manager", platformRole: PLATFORM_ROLES.MEMBER, status: "active" }],
    ["supervisor", { id: "supervisor", platformRole: PLATFORM_ROLES.MEMBER, status: "active" }],
    ["agent-a", { id: "agent-a", platformRole: PLATFORM_ROLES.MEMBER, status: "active" }],
    ["agent-b", { id: "agent-b", platformRole: PLATFORM_ROLES.MEMBER, status: "active" }],
    ["hr", { id: "hr", platformRole: PLATFORM_ROLES.HR, status: "active" }],
  ]);
  const memberships = [
    { userId: "manager", projectId: "ipro", role: PROJECT_ROLES.MANAGER, status: "active" },
    { userId: "supervisor", projectId: "ipro", role: PROJECT_ROLES.SUPERVISOR, status: "active" },
    { userId: "agent-a", projectId: "ipro", role: PROJECT_ROLES.AGENT, status: "active", supervisorUserId: "supervisor" },
    { userId: "agent-b", projectId: "ipro", role: PROJECT_ROLES.AGENT, status: "active" },
  ];
  const employees = [
    {
      id: "manager",
      displayName: "Manager",
      projectId: "ipro",
      projectRole: "manager",
      membershipStatus: "active",
      supervisorUserId: null,
      teamIds: [],
    },
    {
      id: "supervisor",
      displayName: "Supervisor",
      projectId: "ipro",
      projectRole: "supervisor",
      membershipStatus: "active",
      supervisorUserId: null,
      teamIds: ["support"],
    },
    {
      id: "agent-a",
      displayName: "Agent A",
      projectId: "ipro",
      projectRole: "agent",
      membershipStatus: "active",
      supervisorUserId: "supervisor",
      teamIds: ["support"],
    },
    {
      id: "agent-b",
      displayName: "Agent B",
      projectId: "ipro",
      projectRole: "agent",
      membershipStatus: "active",
      supervisorUserId: null,
      teamIds: [],
    },
  ];
  const calls = [];

  return {
    state: { calls },
    users: {
      async findById(id) { return users.get(id) ?? null; },
    },
    memberships: {
      async listForUser(userId) { return memberships.filter((item) => item.userId === userId); },
    },
    directory: {
      async listProject({ projectId, supervisorScopeUserId }) {
        calls.push({ projectId, supervisorScopeUserId });
        if (!supervisorScopeUserId) return employees;
        return employees.filter(
          (employee) =>
            employee.id === supervisorScopeUserId ||
            employee.supervisorUserId === supervisorScopeUserId ||
            (employee.teamIds.includes("support") && supervisorScopeUserId === "supervisor"),
        );
      },
      async listMemberships(userId) {
        if (userId !== "agent-a") return [];
        return [
          { projectId: "ipro", projectName: "iPro", role: "agent", status: "active" },
          { projectId: "kiddio", projectName: "Kiddio", role: "agent", status: "active" },
        ];
      },
    },
  };
}

function serviceWith(repo) {
  return createEmployeeDirectoryService({
    pool: {},
    runInTransaction: async (_pool, work) => work({}),
    repositoryFactory: () => repo,
  });
}

test("Manager sees the whole assigned project workforce", async () => {
  const repo = fakeRepositories();
  const service = serviceWith(repo);

  const result = await service.list({ actorId: "manager", projectId: "ipro" });

  assert.equal(result.length, 4);
  assert.equal(repo.state.calls[0].supervisorScopeUserId, null);
});

test("Supervisor directory is scoped to self and supervised team", async () => {
  const repo = fakeRepositories();
  const service = serviceWith(repo);

  const result = await service.list({ actorId: "supervisor", projectId: "ipro" });

  assert.deepEqual(result.map((employee) => employee.id).sort(), ["agent-a", "supervisor"]);
  assert.equal(repo.state.calls[0].supervisorScopeUserId, "supervisor");
});

test("Agent has no workforce directory permission", async () => {
  const repo = fakeRepositories();
  const service = serviceWith(repo);

  await assert.rejects(
    service.list({ actorId: "agent-a", projectId: "ipro" }),
    (error) => error.code === "FORBIDDEN",
  );
});

test("HR may view employee memberships across projects", async () => {
  const repo = fakeRepositories();
  const service = serviceWith(repo);

  const profile = await service.getProfile({
    actorId: "hr",
    projectId: "ipro",
    targetUserId: "agent-a",
  });

  assert.deepEqual(profile.projectMemberships.map((item) => item.projectId), ["ipro", "kiddio"]);
});

test("Supervisor employee profile does not leak the employee's other project memberships", async () => {
  const repo = fakeRepositories();
  const service = serviceWith(repo);

  const profile = await service.getProfile({
    actorId: "supervisor",
    projectId: "ipro",
    targetUserId: "agent-a",
  });

  assert.deepEqual(profile.projectMemberships.map((item) => item.projectId), ["ipro"]);
});
