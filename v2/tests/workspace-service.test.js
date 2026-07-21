import test from "node:test";
import assert from "node:assert/strict";

import {
  CAPABILITIES,
  PLATFORM_ROLES,
  PROJECT_ROLES,
} from "../src/core/access-control.js";
import { createWorkspaceService } from "../src/projects/workspace-service.js";

const projects = new Map([
  ["ipro", { id: "ipro", name: "iPro", status: "active", isDefault: true }],
  ["kiddio", { id: "kiddio", name: "Kiddio", status: "active", isDefault: false }],
]);

const memberships = [
  { userId: "reema", projectId: "ipro", role: PROJECT_ROLES.SUPERVISOR, status: "active" },
  { userId: "agent", projectId: "ipro", role: PROJECT_ROLES.AGENT, status: "active" },
  { userId: "manager", projectId: "ipro", role: PROJECT_ROLES.MANAGER, status: "active" },
];

function service() {
  return createWorkspaceService({
    projects: {
      async findById(id) { return projects.get(id) ?? null; },
    },
    memberships: {
      async listForUser(userId) { return memberships.filter((item) => item.userId === userId); },
    },
  });
}

test("Reema Supervisor iPro context exposes team tools but not project integrations", async () => {
  const result = await service().get({
    user: { id: "reema", platformRole: PLATFORM_ROLES.MEMBER, status: "active" },
    projectId: "ipro",
  });

  assert.equal(result.membership.role, PROJECT_ROLES.SUPERVISOR);
  assert.equal(result.capabilities[CAPABILITIES.TEAMS_MANAGE_OWN], true);
  assert.equal(result.capabilities[CAPABILITIES.TICKETS_VIEW_TEAM], true);
  assert.equal(result.capabilities[CAPABILITIES.INTEGRATIONS_MANAGE], false);
  assert.equal(result.globalProjectViewer, false);
});

test("Agent context hides employee management and integrations", async () => {
  const result = await service().get({
    user: { id: "agent", platformRole: PLATFORM_ROLES.MEMBER, status: "active" },
    projectId: "ipro",
  });

  assert.equal(result.capabilities[CAPABILITIES.EMPLOYEES_VIEW], false);
  assert.equal(result.capabilities[CAPABILITIES.TEAMS_VIEW], true);
  assert.equal(result.capabilities[CAPABILITIES.ORDERS_SEARCH], true);
  assert.equal(result.capabilities[CAPABILITIES.INTEGRATIONS_MANAGE], false);
});

test("HR can open project workforce/jobs context without customer tickets/chat/orders", async () => {
  const result = await service().get({
    user: { id: "hr", platformRole: PLATFORM_ROLES.HR, status: "active" },
    projectId: "ipro",
  });

  assert.equal(result.globalProjectViewer, true);
  assert.equal(result.membership, null);
  assert.equal(result.capabilities[CAPABILITIES.EMPLOYEES_VIEW], true);
  assert.equal(result.capabilities[CAPABILITIES.JOBS_MANAGE], true);
  assert.equal(result.capabilities[CAPABILITIES.TICKETS_SEARCH], false);
  assert.equal(result.capabilities[CAPABILITIES.CHAT_READ], false);
  assert.equal(result.capabilities[CAPABILITIES.ORDERS_SEARCH], false);
});

test("Supervisor cannot request another project's workspace context", async () => {
  await assert.rejects(
    service().get({
      user: { id: "reema", platformRole: PLATFORM_ROLES.MEMBER, status: "active" },
      projectId: "kiddio",
    }),
    (error) => error.code === "FORBIDDEN",
  );
});
