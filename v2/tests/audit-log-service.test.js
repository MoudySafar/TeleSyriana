import test from "node:test";
import assert from "node:assert/strict";

import { PLATFORM_ROLES, PROJECT_ROLES } from "../src/core/access-control.js";
import { createAuditLogService } from "../src/audit/audit-log-service.js";

function fakeRepositories() {
  const users = new Map([
    ["ceo", { id: "ceo", platformRole: PLATFORM_ROLES.CEO, status: "active" }],
    ["hr", { id: "hr", platformRole: PLATFORM_ROLES.HR, status: "active" }],
    ["manager", { id: "manager", platformRole: PLATFORM_ROLES.MEMBER, status: "active" }],
  ]);
  const memberships = [
    { userId: "manager", projectId: "ipro", role: PROJECT_ROLES.MANAGER, status: "active" },
  ];
  const events = [
    { id: 1, projectId: "ipro", action: "employee.project_role_changed" },
    { id: 2, projectId: "ipro", action: "chat.message_deleted" },
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
    auditLog: {
      async list(input) {
        calls.push(input);
        return events.filter((event) =>
          event.projectId === input.projectId &&
          (!input.actionPrefix || event.action.startsWith(input.actionPrefix)),
        );
      },
    },
  };
}

function serviceWith(repo) {
  return createAuditLogService({
    pool: {},
    runInTransaction: async (_pool, work) => work({}),
    repositoryFactory: () => repo,
  });
}

test("CEO can read project audit events", async () => {
  const repo = fakeRepositories();
  const events = await serviceWith(repo).list({ actorId: "ceo", projectId: "ipro" });
  assert.equal(events.length, 2);
});

test("HR can filter audit events by action prefix", async () => {
  const repo = fakeRepositories();
  const events = await serviceWith(repo).list({
    actorId: "hr",
    projectId: "ipro",
    actionPrefix: "employee.",
  });
  assert.deepEqual(events.map((event) => event.action), ["employee.project_role_changed"]);
});

test("project Manager is denied audit log unless explicitly granted later", async () => {
  const repo = fakeRepositories();
  await assert.rejects(
    serviceWith(repo).list({ actorId: "manager", projectId: "ipro" }),
    (error) => error.code === "FORBIDDEN",
  );
  assert.equal(repo.state.calls.length, 0);
});
