import test from "node:test";
import assert from "node:assert/strict";

import {
  CAPABILITIES,
  PLATFORM_ROLES,
  PROJECT_ROLES,
  canAccessProject,
  getVisibleProjectIds,
  hasCapability,
  mapLegacyStaffToV2,
} from "../src/core/access-control.js";

const projects = [
  { id: "ipro", status: "active" },
  { id: "kiddio", status: "active" },
  { id: "archived", status: "archived" },
];

const memberships = [
  { userId: "reema", projectId: "ipro", role: PROJECT_ROLES.SUPERVISOR, status: "active" },
  { userId: "fatima", projectId: "ipro", role: PROJECT_ROLES.AGENT, status: "active" },
  { userId: "manager-1", projectId: "ipro", role: PROJECT_ROLES.MANAGER, status: "active" },
];

test("CEO can see every active project", () => {
  const user = { id: "ceo", platformRole: PLATFORM_ROLES.CEO, status: "active" };
  assert.deepEqual(getVisibleProjectIds({ user, memberships, projects }), ["ipro", "kiddio"]);
});

test("HR can see every active project", () => {
  const user = { id: "hr", platformRole: PLATFORM_ROLES.HR, status: "active" };
  assert.deepEqual(getVisibleProjectIds({ user, memberships, projects }), ["ipro", "kiddio"]);
});

test("Supervisor only sees projects they are actively assigned to", () => {
  const user = { id: "reema", platformRole: PLATFORM_ROLES.MEMBER, status: "active" };
  assert.deepEqual(getVisibleProjectIds({ user, memberships, projects }), ["ipro"]);
  assert.equal(canAccessProject({ user, memberships, projectId: "ipro" }), true);
  assert.equal(canAccessProject({ user, memberships, projectId: "kiddio" }), false);
});

test("Agent cannot access an unrelated project", () => {
  const user = { id: "fatima", platformRole: PLATFORM_ROLES.MEMBER, status: "active" };
  assert.equal(canAccessProject({ user, memberships, projectId: "ipro" }), true);
  assert.equal(canAccessProject({ user, memberships, projectId: "kiddio" }), false);
});

test("Manager is scoped to assigned projects rather than global visibility", () => {
  const user = { id: "manager-1", platformRole: PLATFORM_ROLES.MEMBER, status: "active" };
  assert.deepEqual(getVisibleProjectIds({ user, memberships, projects }), ["ipro"]);
  assert.equal(canAccessProject({ user, memberships, projectId: "kiddio" }), false);
});

test("Supervisor gets team ticket capability but not project-wide ticket capability", () => {
  const user = { id: "reema", platformRole: PLATFORM_ROLES.MEMBER, status: "active" };
  assert.equal(
    hasCapability({ user, memberships, projectId: "ipro", capability: CAPABILITIES.TICKETS_VIEW_TEAM }),
    true,
  );
  assert.equal(
    hasCapability({ user, memberships, projectId: "ipro", capability: CAPABILITIES.TICKETS_VIEW_PROJECT }),
    false,
  );
});

test("HR account management does not automatically grant ticket project access", () => {
  const user = { id: "hr", platformRole: PLATFORM_ROLES.HR, status: "active" };
  assert.equal(
    hasCapability({ user, memberships, projectId: "ipro", capability: CAPABILITIES.EMPLOYEES_CREATE }),
    true,
  );
  assert.equal(
    hasCapability({ user, memberships, projectId: "ipro", capability: CAPABILITIES.TICKETS_VIEW_PROJECT }),
    false,
  );
});

test("Disabled users cannot see or access projects", () => {
  const user = { id: "reema", platformRole: PLATFORM_ROLES.MEMBER, status: "disabled" };
  assert.deepEqual(getVisibleProjectIds({ user, memberships, projects }), []);
  assert.equal(canAccessProject({ user, memberships, projectId: "ipro" }), false);
});

test("Legacy admin maps to CEO without fabricating a project role", () => {
  const { user, membership } = mapLegacyStaffToV2({
    staff: { staffCode: "9999", name: "Owner", role: "admin", active: true },
    iproProjectId: "ipro",
  });

  assert.equal(user.platformRole, PLATFORM_ROLES.CEO);
  assert.equal(membership, null);
});

test("Legacy supervisor maps to an iPro supervisor membership", () => {
  const { user, membership } = mapLegacyStaffToV2({
    staff: { staffCode: "1001", name: "Reema", role: "supervisor", active: true },
    iproProjectId: "ipro",
  });

  assert.equal(user.platformRole, PLATFORM_ROLES.MEMBER);
  assert.equal(membership.projectId, "ipro");
  assert.equal(membership.role, PROJECT_ROLES.SUPERVISOR);
});
