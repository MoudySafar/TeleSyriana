import test from "node:test";
import assert from "node:assert/strict";

import { PLATFORM_ROLES, PROJECT_ROLES } from "../src/core/access-control.js";
import { createPersistentEmployeeService } from "../src/employees/persistent-employee-service.js";

function createFakeRepositories() {
  const users = new Map([
    ["manager", { id: "manager", staffCode: "2001", displayName: "Manager", platformRole: PLATFORM_ROLES.MEMBER, status: "active" }],
    ["hr", { id: "hr", staffCode: "3001", displayName: "HR", platformRole: PLATFORM_ROLES.HR, status: "active" }],
    ["agent", { id: "agent", staffCode: "1001", displayName: "Agent", platformRole: PLATFORM_ROLES.MEMBER, status: "active" }],
    ["reema", { id: "reema", staffCode: "1042", displayName: "Reema Obaid", platformRole: PLATFORM_ROLES.MEMBER, status: "active" }],
    ["kiddio-supervisor", { id: "kiddio-supervisor", staffCode: "2050", displayName: "Kiddio Supervisor", platformRole: PLATFORM_ROLES.MEMBER, status: "active" }],
  ]);
  const memberships = [
    { id: "m-manager", userId: "manager", projectId: "ipro", role: PROJECT_ROLES.MANAGER, status: "active" },
    { id: "m-agent", userId: "agent", projectId: "ipro", role: PROJECT_ROLES.AGENT, status: "active" },
    { id: "m-reema-ipro", userId: "reema", projectId: "ipro", role: PROJECT_ROLES.SUPERVISOR, status: "active" },
    { id: "m-kiddio-supervisor", userId: "kiddio-supervisor", projectId: "kiddio", role: PROJECT_ROLES.SUPERVISOR, status: "active" },
  ];
  const teams = [
    { id: "support", projectId: "ipro", name: "iPro Support", supervisorUserId: "reema", status: "active" },
    { id: "kiddio-support", projectId: "kiddio", name: "Kiddio Support", supervisorUserId: "kiddio-supervisor", status: "active" },
  ];
  const audit = [];
  const teamMembers = [];
  const credentials = [];
  const revokedSessionUsers = [];

  return {
    state: { users, memberships, teams, audit, teamMembers, credentials, revokedSessionUsers },
    users: {
      async findById(id) { return users.get(id) ?? null; },
      async findByStaffCode(staffCode) {
        return [...users.values()].find((user) => user.staffCode === staffCode) ?? null;
      },
      async create(input) {
        const user = {
          ...input,
          status: "active",
          createdAt: "now",
          updatedAt: "now",
          disabledAt: null,
        };
        users.set(user.id, user);
        return user;
      },
      async setStatus({ userId, status }) {
        const current = users.get(userId);
        const next = { ...current, status };
        users.set(userId, next);
        return next;
      },
    },
    memberships: {
      async listForUser(userId) { return memberships.filter((item) => item.userId === userId); },
      async find({ userId, projectId }) {
        return memberships.find((item) => item.userId === userId && item.projectId === projectId) ?? null;
      },
      async create(input) {
        const membership = { ...input, status: "active" };
        memberships.push(membership);
        return membership;
      },
      async setRole({ userId, projectId, role }) {
        const membership = memberships.find((item) => item.userId === userId && item.projectId === projectId);
        membership.role = role;
        return { ...membership };
      },
      async setStatus({ userId, projectId, status }) {
        const membership = memberships.find((item) => item.userId === userId && item.projectId === projectId);
        membership.status = status;
        return { ...membership };
      },
    },
    membershipAdmin: {
      async assign({ id, userId, projectId, role, supervisorUserId = null }) {
        const current = memberships.find((item) => item.userId === userId && item.projectId === projectId);
        if (current) {
          Object.assign(current, { role, status: "active", supervisorUserId });
          return { ...current };
        }
        const membership = { id, userId, projectId, role, status: "active", supervisorUserId };
        memberships.push(membership);
        return membership;
      },
    },
    teams: {
      async listForProject(projectId) {
        return teams.filter((team) => team.projectId === projectId && team.status === "active");
      },
      async addMember(input) {
        teamMembers.push(input);
        return input;
      },
    },
    audit: {
      async append(event) {
        audit.push(event);
        return event;
      },
    },
    auth: {
      async upsertCredential(input) {
        credentials.push(input);
        return input;
      },
      async revokeAllUserSessions(userId) {
        revokedSessionUsers.push(userId);
        return [];
      },
    },
  };
}

function serviceWith(repositories) {
  let transactions = 0;
  const service = createPersistentEmployeeService({
    pool: {},
    runInTransaction: async (_pool, work) => {
      transactions += 1;
      return work({});
    },
    repositoryFactory: () => repositories,
  });
  return { service, getTransactions: () => transactions };
}

test("Manager employee creation persists user membership credential team assignment and audit in one transaction", async () => {
  const repositories = createFakeRepositories();
  const { service, getTransactions } = serviceWith(repositories);

  const result = await service.createForProject({
    actorId: "manager",
    projectId: "ipro",
    input: {
      id: "new-agent",
      staffCode: "1050",
      displayName: "New Agent",
      role: PROJECT_ROLES.AGENT,
      teamId: "support",
      supervisorUserId: "reema",
      locale: "ar",
      theme: "dark",
      temporarySecret: "241155",
    },
  });

  assert.equal(getTransactions(), 1);
  assert.equal(result.user.displayName, "New Agent");
  assert.equal(result.membership.projectId, "ipro");
  assert.equal(result.membership.supervisorUserId, "reema");
  assert.equal(result.mustResetLoginSecret, true);
  assert.equal(repositories.state.teamMembers[0].teamId, "support");
  assert.equal(repositories.state.credentials[0].userId, "new-agent");
  assert.equal(repositories.state.credentials[0].mustReset, true);
  assert.notEqual(repositories.state.credentials[0].secretHash, "241155");
  assert.equal(repositories.state.audit[0].action, "employee.created_for_project");
});

test("employee creation rejects team from another project", async () => {
  const repositories = createFakeRepositories();
  const { service } = serviceWith(repositories);

  await assert.rejects(
    service.createForProject({
      actorId: "manager",
      projectId: "ipro",
      input: {
        id: "bad-team-agent",
        staffCode: "1051",
        displayName: "Bad Team Agent",
        role: PROJECT_ROLES.AGENT,
        teamId: "kiddio-support",
        temporarySecret: "241166",
      },
    }),
    /does not belong to this project/,
  );
});

test("employee creation rejects missing temporary login secret before persistence", async () => {
  const repositories = createFakeRepositories();
  const { service, getTransactions } = serviceWith(repositories);

  await assert.rejects(
    service.createForProject({
      actorId: "manager",
      projectId: "ipro",
      input: { id: "new", staffCode: "1099", displayName: "New" },
    }),
    /temporarySecret is required/,
  );

  assert.equal(getTransactions(), 0);
});

test("Manager can persist Agent to Supervisor promotion inside iPro", async () => {
  const repositories = createFakeRepositories();
  const { service } = serviceWith(repositories);

  const result = await service.changeProjectRole({
    actorId: "manager",
    projectId: "ipro",
    targetUserId: "agent",
    nextRole: PROJECT_ROLES.SUPERVISOR,
  });

  assert.equal(result.membership.role, PROJECT_ROLES.SUPERVISOR);
  assert.equal(repositories.state.audit.at(-1).action, "employee.project_role_changed");
});

test("HR can assign Reema as Kiddio Agent without changing her iPro Supervisor membership", async () => {
  const repositories = createFakeRepositories();
  const { service } = serviceWith(repositories);

  const result = await service.assignExistingToProject({
    actorId: "hr",
    projectId: "kiddio",
    targetUserId: "reema",
    role: PROJECT_ROLES.AGENT,
    supervisorUserId: "kiddio-supervisor",
    teamId: "kiddio-support",
  });

  const iproMembership = repositories.state.memberships.find(
    (item) => item.userId === "reema" && item.projectId === "ipro",
  );
  const kiddioMembership = repositories.state.memberships.find(
    (item) => item.userId === "reema" && item.projectId === "kiddio",
  );

  assert.equal(iproMembership.role, PROJECT_ROLES.SUPERVISOR);
  assert.equal(kiddioMembership.role, PROJECT_ROLES.AGENT);
  assert.equal(kiddioMembership.supervisorUserId, "kiddio-supervisor");
  assert.equal(result.membership.projectId, "kiddio");
  assert.equal(repositories.state.audit.at(-1).action, "employee.project_assigned");
});

test("iPro Manager cannot assign an existing employee into another project", async () => {
  const repositories = createFakeRepositories();
  const { service } = serviceWith(repositories);

  await assert.rejects(
    service.assignExistingToProject({
      actorId: "manager",
      projectId: "kiddio",
      targetUserId: "reema",
      role: PROJECT_ROLES.AGENT,
    }),
    (error) => error.code === "FORBIDDEN",
  );

  assert.equal(
    repositories.state.memberships.some((item) => item.userId === "reema" && item.projectId === "kiddio"),
    false,
  );
});

test("cross-project assignment rejects a Supervisor from the wrong project", async () => {
  const repositories = createFakeRepositories();
  const { service } = serviceWith(repositories);

  await assert.rejects(
    service.assignExistingToProject({
      actorId: "hr",
      projectId: "kiddio",
      targetUserId: "reema",
      role: PROJECT_ROLES.AGENT,
      supervisorUserId: "manager",
    }),
    /active Supervisor or Manager in this project/,
  );
});

test("Manager cannot persist a global account disable", async () => {
  const repositories = createFakeRepositories();
  const { service } = serviceWith(repositories);

  await assert.rejects(
    service.disableAccount({ actorId: "manager", targetUserId: "agent" }),
    /Forbidden/,
  );
  assert.equal(repositories.state.users.get("agent").status, "active");
  assert.deepEqual(repositories.state.revokedSessionUsers, []);
});

test("HR global disable preserves employee and revokes all active sessions", async () => {
  const repositories = createFakeRepositories();
  const { service } = serviceWith(repositories);

  const result = await service.disableAccount({ actorId: "hr", targetUserId: "agent" });

  assert.equal(result.user.id, "agent");
  assert.equal(result.user.status, "disabled");
  assert.equal(repositories.state.users.has("agent"), true);
  assert.deepEqual(repositories.state.revokedSessionUsers, ["agent"]);
  assert.equal(repositories.state.audit.at(-1).action, "employee.account_disabled");
});
