import test from "node:test";
import assert from "node:assert/strict";

import { createRepositories } from "../src/db/repositories.js";

function makeDb(rows = []) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      return { rows: typeof rows === "function" ? rows(sql, params) : rows };
    },
  };
}

test("project lookup is parameterized and maps database fields", async () => {
  const db = makeDb([
    {
      id: "ipro",
      slug: "ipro",
      name: "iPro",
      status: "active",
      is_default: true,
      created_at: "created",
      updated_at: "updated",
    },
  ]);
  const repositories = createRepositories(db);

  const project = await repositories.projects.findById("ipro");

  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].sql, /WHERE id = \$1/);
  assert.deepEqual(db.calls[0].params, ["ipro"]);
  assert.deepEqual(project, {
    id: "ipro",
    slug: "ipro",
    name: "iPro",
    status: "active",
    isDefault: true,
    createdAt: "created",
    updatedAt: "updated",
  });
});

test("user preference updates keep locale/theme server-side", async () => {
  const db = makeDb((sql, params) => [
    {
      id: params[0],
      staff_code: "1001",
      display_name: "Reema",
      email: null,
      auth_subject: null,
      platform_role: "member",
      account_status: "active",
      locale: params[1] ?? "en",
      theme: params[2] ?? "system",
      created_at: "created",
      updated_at: "updated",
      disabled_at: null,
    },
  ]);
  const repositories = createRepositories(db);

  const user = await repositories.users.updatePreferences({
    userId: "reema",
    locale: "ar",
    theme: "dark",
  });

  assert.deepEqual(db.calls[0].params, ["reema", "ar", "dark"]);
  assert.equal(user.locale, "ar");
  assert.equal(user.theme, "dark");
});

test("project membership role change is constrained to user and project", async () => {
  const db = makeDb((sql, params) => [
    {
      id: "membership-1",
      user_id: params[0],
      project_id: params[1],
      role: params[2],
      status: "active",
      supervisor_user_id: null,
      created_at: "created",
      updated_at: "updated",
    },
  ]);
  const repositories = createRepositories(db);

  const membership = await repositories.memberships.setRole({
    userId: "reema",
    projectId: "ipro",
    role: "supervisor",
  });

  assert.match(db.calls[0].sql, /user_id = \$1 AND project_id = \$2/);
  assert.deepEqual(db.calls[0].params, ["reema", "ipro", "supervisor"]);
  assert.equal(membership.role, "supervisor");
});

test("audit metadata is serialized and project query limit is capped", async () => {
  const db = makeDb([]);
  const repositories = createRepositories(db);

  await repositories.audit.append({
    projectId: "ipro",
    actorUserId: "ceo",
    action: "employee.project_role_changed",
    targetType: "user",
    targetId: "reema",
    metadata: { from: "agent", to: "supervisor" },
  });

  assert.equal(db.calls[0].params[0], "ipro");
  assert.equal(db.calls[0].params[1], "ceo");
  assert.equal(db.calls[0].params[5], JSON.stringify({ from: "agent", to: "supervisor" }));

  await repositories.audit.listForProject({ projectId: "ipro", limit: 10000 });
  assert.deepEqual(db.calls[1].params, ["ipro", 500]);
});
