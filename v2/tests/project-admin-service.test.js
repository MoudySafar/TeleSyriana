import test from "node:test";
import assert from "node:assert/strict";

import { PLATFORM_ROLES } from "../src/core/access-control.js";
import {
  createProjectAdminService,
  validateTimezone,
} from "../src/projects/project-admin-service.js";

function fakeRepositories() {
  const users = new Map([
    ["ceo", { id: "ceo", platformRole: PLATFORM_ROLES.CEO, status: "active" }],
    ["hr", { id: "hr", platformRole: PLATFORM_ROLES.HR, status: "active" }],
  ]);
  const projects = new Map([
    ["ipro", { id: "ipro", slug: "ipro", name: "iPro", status: "active", isDefault: true, timezone: "Asia/Damascus" }],
  ]);
  const chats = [];
  const audit = [];

  return {
    state: { projects, chats, audit },
    users: {
      async findById(id) { return users.get(id) ?? null; },
    },
    memberships: {
      async listForUser() { return []; },
    },
    projectAdmin: {
      async create({ id, slug, name, timezone }) {
        const project = { id, slug, name, status: "active", isDefault: false, timezone };
        projects.set(id, project);
        return project;
      },
      async createGeneralChatChannel({ projectId, createdByUserId }) {
        const channel = { id: `chat:${projectId}:general`, projectId, name: "General", createdByUserId };
        chats.push(channel);
        return channel;
      },
      async findById(projectId) { return projects.get(projectId) ?? null; },
      async update({ projectId, name, timezone, status }) {
        const current = projects.get(projectId);
        const updated = {
          ...current,
          name: name ?? current.name,
          timezone: timezone ?? current.timezone,
          status: status ?? current.status,
        };
        projects.set(projectId, updated);
        return updated;
      },
    },
    audit: {
      async append(event) { audit.push(event); return event; },
    },
  };
}

function serviceWith(repositories) {
  return createProjectAdminService({
    pool: {},
    runInTransaction: async (_pool, work) => work({}),
    repositoryFactory: () => repositories,
  });
}

test("CEO can create a project with timezone General chat and audit", async () => {
  const repositories = fakeRepositories();
  const service = serviceWith(repositories);

  const project = await service.create({
    actorId: "ceo",
    input: { name: "Kiddio Toys", slug: "kiddio", timezone: "Europe/London" },
  });

  assert.equal(project.slug, "kiddio");
  assert.equal(project.timezone, "Europe/London");
  assert.equal(repositories.state.chats.length, 1);
  assert.equal(repositories.state.chats[0].projectId, project.id);
  assert.equal(repositories.state.audit.at(-1).action, "project.created");
});

test("HR can view all projects but cannot create a new TeleSyriana project", async () => {
  const repositories = fakeRepositories();
  const service = serviceWith(repositories);

  await assert.rejects(
    service.create({ actorId: "hr", input: { name: "Hidden Project" } }),
    (error) => error.code === "FORBIDDEN",
  );
});

test("default iPro project cannot be archived", async () => {
  const repositories = fakeRepositories();
  const service = serviceWith(repositories);

  await assert.rejects(
    service.update({ actorId: "ceo", projectId: "ipro", fields: { status: "archived" } }),
    (error) => error.code === "CONFLICT",
  );
  assert.equal(repositories.state.projects.get("ipro").status, "active");
});

test("project timezone must be a valid IANA timezone", () => {
  assert.equal(validateTimezone("Asia/Damascus"), "Asia/Damascus");
  assert.throws(() => validateTimezone("Not/A-Timezone"), /Invalid IANA timezone/);
});
