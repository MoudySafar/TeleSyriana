import test from "node:test";
import assert from "node:assert/strict";

import { PLATFORM_ROLES, PROJECT_ROLES } from "../src/core/access-control.js";
import {
  changeEmployeeProjectRole,
  createEmployeeForProject,
  disableEmployeeAccount,
  disableProjectMembership,
} from "../src/employees/employee-service.js";

const manager = { id: "manager-1", platformRole: PLATFORM_ROLES.MEMBER, status: "active" };
const hr = { id: "hr-1", platformRole: PLATFORM_ROLES.HR, status: "active" };
const memberships = [
  { id: "m-manager", userId: manager.id, projectId: "ipro", role: PROJECT_ROLES.MANAGER, status: "active" },
];

test("project Manager can create an Agent inside iPro", () => {
  const result = createEmployeeForProject({
    actor: manager,
    memberships,
    projectId: "ipro",
    existingUsers: [],
    input: { id: "new-agent", staffCode: "1042", displayName: "New Agent", role: PROJECT_ROLES.AGENT },
    now: "2026-07-21T16:00:00.000Z",
  });

  assert.equal(result.user.status, "active");
  assert.equal(result.membership.projectId, "ipro");
  assert.equal(result.membership.role, PROJECT_ROLES.AGENT);
  assert.equal(result.auditEvent.action, "employee.created_for_project");
});

test("project Manager can promote Agent to Supervisor inside iPro", () => {
  const targetMembership = {
    id: "m-agent",
    userId: "agent-1",
    projectId: "ipro",
    role: PROJECT_ROLES.AGENT,
    status: "active",
  };

  const result = changeEmployeeProjectRole({
    actor: manager,
    memberships,
    projectId: "ipro",
    targetMembership,
    nextRole: PROJECT_ROLES.SUPERVISOR,
    now: "2026-07-21T16:01:00.000Z",
  });

  assert.equal(result.membership.role, PROJECT_ROLES.SUPERVISOR);
  assert.deepEqual(result.auditEvent.metadata, {
    previousRole: PROJECT_ROLES.AGENT,
    nextRole: PROJECT_ROLES.SUPERVISOR,
  });
});

test("project Manager cannot promote someone to Manager", () => {
  const targetMembership = {
    id: "m-agent",
    userId: "agent-1",
    projectId: "ipro",
    role: PROJECT_ROLES.AGENT,
    status: "active",
  };

  assert.throws(
    () =>
      changeEmployeeProjectRole({
        actor: manager,
        memberships,
        projectId: "ipro",
        targetMembership,
        nextRole: PROJECT_ROLES.MANAGER,
      }),
    /Only CEO\/HR can promote an employee to Manager/,
  );
});

test("project Manager can disable an iPro membership without deleting the user", () => {
  const targetMembership = {
    id: "m-agent",
    userId: "agent-1",
    projectId: "ipro",
    role: PROJECT_ROLES.AGENT,
    status: "active",
  };

  const result = disableProjectMembership({
    actor: manager,
    memberships,
    projectId: "ipro",
    targetMembership,
    now: "2026-07-21T16:02:00.000Z",
  });

  assert.equal(result.membership.status, "disabled");
  assert.equal(result.auditEvent.action, "employee.project_membership_disabled");
});

test("project Manager cannot globally disable the TeleSyriana account", () => {
  assert.throws(
    () =>
      disableEmployeeAccount({
        actor: manager,
        memberships,
        targetUser: { id: "agent-1", status: "active", platformRole: PLATFORM_ROLES.MEMBER },
      }),
    /Forbidden/,
  );
});

test("HR can globally disable an employee account while preserving the record", () => {
  const result = disableEmployeeAccount({
    actor: hr,
    memberships,
    targetUser: {
      id: "agent-1",
      staffCode: "1042",
      displayName: "New Agent",
      status: "active",
      platformRole: PLATFORM_ROLES.MEMBER,
    },
    now: "2026-07-21T16:03:00.000Z",
  });

  assert.equal(result.user.id, "agent-1");
  assert.equal(result.user.status, "disabled");
  assert.equal(result.auditEvent.targetUserId, "agent-1");
  assert.equal(result.auditEvent.action, "employee.account_disabled");
});
