import test from "node:test";
import assert from "node:assert/strict";

import { PLATFORM_ROLES, PROJECT_ROLES } from "../src/core/access-control.js";
import { createGlobalEmployeeService } from "../src/employees/global-employee-service.js";

function fakeRepositories() {
  const users = new Map([
    ["ceo", { id: "ceo", platformRole: PLATFORM_ROLES.CEO, status: "active" }],
    ["hr", { id: "hr", platformRole: PLATFORM_ROLES.HR, status: "active" }],
    ["manager", { id: "manager", platformRole: PLATFORM_ROLES.MEMBER, status: "active" }],
    ["supervisor", { id: "supervisor", platformRole: PLATFORM_ROLES.MEMBER, status: "active" }],
  ]);
  const calls = [];

  return {
    state: { calls },
    users: {
      async findById(id) { return users.get(id) ?? null; },
    },
    globalEmployees: {
      async list(input) {
        calls.push(input);
        return [{
          id: "reema",
          displayName: "Reema Obaid",
          memberships: [
            { projectId: "ipro", role: PROJECT_ROLES.SUPERVISOR, status: "active" },
            { projectId: "kiddio", role: PROJECT_ROLES.AGENT, status: "active" },
          ],
        }];
      },
    },
  };
}

function serviceWith(repo) {
  return createGlobalEmployeeService({
    pool: {},
    runInTransaction: async (_pool, work) => work({}),
    repositoryFactory: () => repo,
  });
}

test("CEO can search global workforce and see project memberships", async () => {
  const repo = fakeRepositories();
  const result = await serviceWith(repo).list({ actorId: "ceo", query: "Reema" });
  assert.equal(result[0].memberships.length, 2);
  assert.equal(repo.state.calls[0].query, "Reema");
});

test("HR can search global workforce", async () => {
  const repo = fakeRepositories();
  const result = await serviceWith(repo).list({ actorId: "hr" });
  assert.equal(result[0].displayName, "Reema Obaid");
});

test("Manager cannot enumerate global employees or their other projects", async () => {
  const repo = fakeRepositories();
  await assert.rejects(
    serviceWith(repo).list({ actorId: "manager" }),
    (error) => error.code === "FORBIDDEN",
  );
  assert.equal(repo.state.calls.length, 0);
});

test("Supervisor cannot enumerate global employees or their other projects", async () => {
  const repo = fakeRepositories();
  await assert.rejects(
    serviceWith(repo).list({ actorId: "supervisor" }),
    (error) => error.code === "FORBIDDEN",
  );
  assert.equal(repo.state.calls.length, 0);
});
