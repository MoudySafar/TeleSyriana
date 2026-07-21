import test from "node:test";
import assert from "node:assert/strict";

import { PLATFORM_ROLES, PROJECT_ROLES } from "../src/core/access-control.js";
import { createProjectService } from "../src/projects/project-service.js";

const allProjects = [
  { id: "ipro", name: "iPro", status: "active" },
  { id: "kiddio", name: "Kiddio", status: "active" },
];

const allMemberships = [
  { userId: "reema", projectId: "ipro", role: PROJECT_ROLES.SUPERVISOR, status: "active" },
  { userId: "manager", projectId: "ipro", role: PROJECT_ROLES.MANAGER, status: "active" },
];

function service() {
  return createProjectService({
    projects: {
      async listActive() { return allProjects; },
      async findById(id) { return allProjects.find((project) => project.id === id) ?? null; },
    },
    memberships: {
      async listForUser(userId) { return allMemberships.filter((item) => item.userId === userId); },
    },
  });
}

test("CEO receives all projects", async () => {
  const projects = await service().listVisibleProjects({
    id: "ceo",
    platformRole: PLATFORM_ROLES.CEO,
    status: "active",
  });

  assert.deepEqual(projects.map((project) => project.id), ["ipro", "kiddio"]);
});

test("HR receives all projects", async () => {
  const projects = await service().listVisibleProjects({
    id: "hr",
    platformRole: PLATFORM_ROLES.HR,
    status: "active",
  });

  assert.deepEqual(projects.map((project) => project.id), ["ipro", "kiddio"]);
});

test("Supervisor sees only iPro and cannot require Kiddio context", async () => {
  const user = { id: "reema", platformRole: PLATFORM_ROLES.MEMBER, status: "active" };
  const projects = await service().listVisibleProjects(user);

  assert.deepEqual(projects.map((project) => project.id), ["ipro"]);
  await assert.rejects(
    service().requireProjectContext({ user, projectId: "kiddio" }),
    (error) => error.code === "FORBIDDEN",
  );
});

test("Manager is also restricted to explicitly assigned projects", async () => {
  const user = { id: "manager", platformRole: PLATFORM_ROLES.MEMBER, status: "active" };
  const projects = await service().listVisibleProjects(user);

  assert.deepEqual(projects.map((project) => project.id), ["ipro"]);
});
