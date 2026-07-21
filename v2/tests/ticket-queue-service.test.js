import test from "node:test";
import assert from "node:assert/strict";

import { PLATFORM_ROLES, PROJECT_ROLES } from "../src/core/access-control.js";
import { createTicketQueueService } from "../src/tickets/ticket-queue-service.js";

function fakeRepositories() {
  const users = new Map([
    ["agent", { id: "agent", platformRole: PLATFORM_ROLES.MEMBER, status: "active" }],
    ["supervisor", { id: "supervisor", platformRole: PLATFORM_ROLES.MEMBER, status: "active" }],
    ["manager", { id: "manager", platformRole: PLATFORM_ROLES.MEMBER, status: "active" }],
    ["hr", { id: "hr", platformRole: PLATFORM_ROLES.HR, status: "active" }],
  ]);
  const memberships = [
    { userId: "agent", projectId: "ipro", role: PROJECT_ROLES.AGENT, status: "active" },
    { userId: "supervisor", projectId: "ipro", role: PROJECT_ROLES.SUPERVISOR, status: "active" },
    { userId: "manager", projectId: "ipro", role: PROJECT_ROLES.MANAGER, status: "active" },
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
    ticketQueue: {
      async list(input) {
        calls.push(input);
        return [{ id: "ticket:1", projectId: input.projectId }];
      },
    },
  };
}

function serviceWith(repositories) {
  return createTicketQueueService({
    pool: {},
    runInTransaction: async (_pool, work) => work({}),
    repositoryFactory: () => repositories,
  });
}

test("Agent receives own ticket queue scope", async () => {
  const repositories = fakeRepositories();
  const service = serviceWith(repositories);

  await service.list({ actorId: "agent", projectId: "ipro" });

  assert.equal(repositories.state.calls[0].scope, "own");
});

test("Supervisor receives team ticket queue scope", async () => {
  const repositories = fakeRepositories();
  const service = serviceWith(repositories);

  await service.list({ actorId: "supervisor", projectId: "ipro" });

  assert.equal(repositories.state.calls[0].scope, "team");
});

test("Manager receives project-wide ticket queue scope", async () => {
  const repositories = fakeRepositories();
  const service = serviceWith(repositories);

  await service.list({ actorId: "manager", projectId: "ipro" });

  assert.equal(repositories.state.calls[0].scope, "project");
});

test("queue forwards Resolved and Today filters to timezone-aware repository", async () => {
  const repositories = fakeRepositories();
  const service = serviceWith(repositories);

  await service.list({
    actorId: "supervisor",
    projectId: "ipro",
    statusFilter: "resolved",
    activityWindow: "today",
    limit: 25,
  });

  assert.deepEqual(repositories.state.calls[0], {
    projectId: "ipro",
    userId: "supervisor",
    scope: "team",
    statusFilter: "resolved",
    activityWindow: "today",
    limit: 25,
  });
});

test("queue rejects unknown date filters before database query", async () => {
  const repositories = fakeRepositories();
  const service = serviceWith(repositories);

  await assert.rejects(
    service.list({
      actorId: "agent",
      projectId: "ipro",
      activityWindow: "last_year",
    }),
    (error) => error.code === "INVALID_INPUT",
  );
  assert.equal(repositories.state.calls.length, 0);
});

test("HR project visibility alone does not grant ticket queue access", async () => {
  const repositories = fakeRepositories();
  const service = serviceWith(repositories);

  await assert.rejects(
    service.list({ actorId: "hr", projectId: "ipro" }),
    (error) => error.code === "FORBIDDEN",
  );
  assert.equal(repositories.state.calls.length, 0);
});
