import test from "node:test";
import assert from "node:assert/strict";

import { PLATFORM_ROLES, PROJECT_ROLES } from "../src/core/access-control.js";
import { createTicketAssignmentService } from "../src/tickets/ticket-assignment-service.js";

function fakeRepositories() {
  const users = new Map([
    ["manager", { id: "manager", platformRole: PLATFORM_ROLES.MEMBER, status: "active" }],
    ["supervisor", { id: "supervisor", platformRole: PLATFORM_ROLES.MEMBER, status: "active" }],
    ["supervisor-2", { id: "supervisor-2", platformRole: PLATFORM_ROLES.MEMBER, status: "active" }],
    ["agent-a", { id: "agent-a", platformRole: PLATFORM_ROLES.MEMBER, status: "active" }],
    ["agent-b", { id: "agent-b", platformRole: PLATFORM_ROLES.MEMBER, status: "active" }],
    ["kiddio-agent", { id: "kiddio-agent", platformRole: PLATFORM_ROLES.MEMBER, status: "active" }],
  ]);
  const memberships = [
    { userId: "manager", projectId: "ipro", role: PROJECT_ROLES.MANAGER, status: "active" },
    { userId: "supervisor", projectId: "ipro", role: PROJECT_ROLES.SUPERVISOR, status: "active" },
    { userId: "supervisor-2", projectId: "ipro", role: PROJECT_ROLES.SUPERVISOR, status: "active" },
    { userId: "agent-a", projectId: "ipro", role: PROJECT_ROLES.AGENT, status: "active", supervisorUserId: "supervisor" },
    { userId: "agent-b", projectId: "ipro", role: PROJECT_ROLES.AGENT, status: "active", supervisorUserId: "supervisor-2" },
    { userId: "kiddio-agent", projectId: "kiddio", role: PROJECT_ROLES.AGENT, status: "active" },
  ];
  const teams = [
    { id: "support", projectId: "ipro", supervisorUserId: "supervisor", status: "active" },
    { id: "other-team", projectId: "ipro", supervisorUserId: "supervisor-2", status: "active" },
  ];
  let ticket = {
    id: "ticket:1",
    projectId: "ipro",
    ticketCode: "TK-0000001",
    assignedToUserId: "agent-a",
    assignedTeamId: null,
    createdByUserId: "agent-a",
    version: 3,
  };
  const history = [];
  const audit = [];

  return {
    state: {
      get ticket() { return ticket; },
      history,
      audit,
    },
    users: {
      async findById(id) { return users.get(id) ?? null; },
    },
    memberships: {
      async listForUser(userId) { return memberships.filter((item) => item.userId === userId); },
      async find({ userId, projectId }) {
        return memberships.find((item) => item.userId === userId && item.projectId === projectId) ?? null;
      },
    },
    teams: {
      async listForProject(projectId) { return teams.filter((team) => team.projectId === projectId); },
    },
    ticketsV2: {
      async findByCode({ projectId, ticketCode }) {
        return ticket.projectId === projectId && ticket.ticketCode === ticketCode ? { ...ticket } : null;
      },
    },
    ticketAssignment: {
      async assign({ projectId, ticketCode, assignedToUserId, assignedTeamId, expectedVersion }) {
        if (ticket.projectId !== projectId || ticket.ticketCode !== ticketCode) return null;
        if (expectedVersion != null && expectedVersion !== ticket.version) return null;
        ticket = {
          ...ticket,
          assignedToUserId,
          assignedTeamId,
          version: ticket.version + 1,
        };
        return { ...ticket };
      },
      async appendHistory(event) { history.push(event); return event; },
    },
    audit: {
      async append(event) { audit.push(event); return event; },
    },
  };
}

function serviceWith(repo) {
  return createTicketAssignmentService({
    pool: {},
    runInTransaction: async (_pool, work) => work({}),
    repositoryFactory: () => repo,
  });
}

test("Supervisor can reassign own supervised ticket to another supervised Agent", async () => {
  const repo = fakeRepositories();
  const service = serviceWith(repo);

  // Make agent-b part of the same Supervisor for this test.
  const agentBMembership = await repo.memberships.find({ userId: "agent-b", projectId: "ipro" });
  agentBMembership.supervisorUserId = "supervisor";

  const updated = await service.assign({
    actorId: "supervisor",
    projectId: "ipro",
    ticketCode: "TK-0000001",
    assignedToUserId: "agent-b",
    expectedVersion: 3,
  });

  assert.equal(updated.assignedToUserId, "agent-b");
  assert.equal(updated.version, 4);
  assert.equal(repo.state.history.at(-1).eventType, "assignment_changed");
  assert.equal(repo.state.audit.at(-1).action, "ticket.assignment_changed");
});

test("Supervisor cannot assign ticket to Agent supervised by someone else", async () => {
  const repo = fakeRepositories();
  const service = serviceWith(repo);

  await assert.rejects(
    service.assign({
      actorId: "supervisor",
      projectId: "ipro",
      ticketCode: "TK-0000001",
      assignedToUserId: "agent-b",
      expectedVersion: 3,
    }),
    (error) => error.code === "FORBIDDEN",
  );
  assert.equal(repo.state.ticket.assignedToUserId, "agent-a");
});

test("Supervisor cannot assign to another Supervisor's team", async () => {
  const repo = fakeRepositories();
  const service = serviceWith(repo);

  await assert.rejects(
    service.assign({
      actorId: "supervisor",
      projectId: "ipro",
      ticketCode: "TK-0000001",
      assignedTeamId: "other-team",
    }),
    (error) => error.code === "FORBIDDEN",
  );
});

test("Manager can assign project ticket to any active project Agent", async () => {
  const repo = fakeRepositories();
  const service = serviceWith(repo);

  const updated = await service.assign({
    actorId: "manager",
    projectId: "ipro",
    ticketCode: "TK-0000001",
    assignedToUserId: "agent-b",
  });

  assert.equal(updated.assignedToUserId, "agent-b");
});

test("assignment rejects an employee who belongs only to another project", async () => {
  const repo = fakeRepositories();
  const service = serviceWith(repo);

  await assert.rejects(
    service.assign({
      actorId: "manager",
      projectId: "ipro",
      ticketCode: "TK-0000001",
      assignedToUserId: "kiddio-agent",
    }),
    (error) => error.code === "INVALID_INPUT",
  );
});

test("stale expected version returns conflict and preserves assignment", async () => {
  const repo = fakeRepositories();
  const service = serviceWith(repo);

  await assert.rejects(
    service.assign({
      actorId: "manager",
      projectId: "ipro",
      ticketCode: "TK-0000001",
      assignedToUserId: "agent-b",
      expectedVersion: 2,
    }),
    (error) => error.code === "CONFLICT",
  );
  assert.equal(repo.state.ticket.assignedToUserId, "agent-a");
});

test("ticket cannot be assigned to employee and team simultaneously", async () => {
  const repo = fakeRepositories();
  const service = serviceWith(repo);

  await assert.rejects(
    service.assign({
      actorId: "manager",
      projectId: "ipro",
      ticketCode: "TK-0000001",
      assignedToUserId: "agent-b",
      assignedTeamId: "support",
    }),
    (error) => error.code === "INVALID_INPUT",
  );
});
