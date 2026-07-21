import {
  CAPABILITIES,
  PLATFORM_ROLES,
  PROJECT_ROLES,
  hasCapability,
  isGlobalProjectViewer,
} from "../core/access-control.js";

const PROJECT_ROLE_VALUES = new Set(Object.values(PROJECT_ROLES));

function assertNonEmpty(value, fieldName) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${fieldName} is required`);
  return normalized;
}

function assertProjectRole(role) {
  if (!PROJECT_ROLE_VALUES.has(role)) {
    throw new Error(`Invalid project role: ${role}`);
  }
}

function createAuditEvent({ actor, action, projectId = null, targetUserId = null, metadata = {}, at }) {
  return {
    id: `audit:${crypto.randomUUID()}`,
    actorUserId: actor.id,
    action,
    projectId,
    targetUserId,
    metadata,
    createdAt: at,
  };
}

function assertCapability({ actor, memberships, projectId, capability }) {
  if (!hasCapability({ user: actor, memberships, projectId, capability })) {
    const error = new Error(`Forbidden: missing capability ${capability}`);
    error.code = "FORBIDDEN";
    throw error;
  }
}

export function createEmployeeForProject({
  actor,
  memberships,
  projectId,
  existingUsers,
  input,
  now = new Date().toISOString(),
}) {
  assertCapability({
    actor,
    memberships,
    projectId,
    capability: CAPABILITIES.EMPLOYEES_CREATE,
  });

  const staffCode = assertNonEmpty(input.staffCode, "staffCode");
  const displayName = assertNonEmpty(input.displayName, "displayName");
  const role = input.role || PROJECT_ROLES.AGENT;
  assertProjectRole(role);

  if (existingUsers.some((user) => user.staffCode === staffCode)) {
    throw new Error(`Staff code already exists: ${staffCode}`);
  }

  // Project Managers may create Agents/Supervisors in their own project, but
  // creating another Manager remains a global CEO/HR decision.
  if (role === PROJECT_ROLES.MANAGER && !isGlobalProjectViewer(actor)) {
    const error = new Error("Only CEO/HR can create a project Manager");
    error.code = "FORBIDDEN";
    throw error;
  }

  const user = {
    id: input.id || `user:${crypto.randomUUID()}`,
    staffCode,
    displayName,
    platformRole: PLATFORM_ROLES.MEMBER,
    status: "active",
    language: input.language || "en",
    theme: input.theme || "system",
    createdAt: now,
    updatedAt: now,
  };

  const membership = {
    id: `membership:${crypto.randomUUID()}`,
    userId: user.id,
    projectId,
    role,
    teamId: input.teamId || null,
    supervisorId: input.supervisorId || null,
    status: "active",
    createdAt: now,
    updatedAt: now,
  };

  const auditEvent = createAuditEvent({
    actor,
    action: "employee.created_for_project",
    projectId,
    targetUserId: user.id,
    metadata: { staffCode, role },
    at: now,
  });

  return { user, membership, auditEvent };
}

export function changeEmployeeProjectRole({
  actor,
  memberships,
  projectId,
  targetMembership,
  nextRole,
  now = new Date().toISOString(),
}) {
  assertCapability({
    actor,
    memberships,
    projectId,
    capability: CAPABILITIES.EMPLOYEES_CHANGE_ROLE,
  });
  assertProjectRole(nextRole);

  if (targetMembership.projectId !== projectId) {
    throw new Error("Target membership does not belong to this project");
  }

  if (nextRole === PROJECT_ROLES.MANAGER && !isGlobalProjectViewer(actor)) {
    const error = new Error("Only CEO/HR can promote an employee to Manager");
    error.code = "FORBIDDEN";
    throw error;
  }

  const previousRole = targetMembership.role;
  const membership = {
    ...targetMembership,
    role: nextRole,
    updatedAt: now,
  };

  const auditEvent = createAuditEvent({
    actor,
    action: "employee.project_role_changed",
    projectId,
    targetUserId: targetMembership.userId,
    metadata: { previousRole, nextRole },
    at: now,
  });

  return { membership, auditEvent };
}

export function disableProjectMembership({
  actor,
  memberships,
  projectId,
  targetMembership,
  now = new Date().toISOString(),
}) {
  assertCapability({
    actor,
    memberships,
    projectId,
    capability: CAPABILITIES.EMPLOYEES_DISABLE_MEMBERSHIP,
  });

  if (targetMembership.projectId !== projectId) {
    throw new Error("Target membership does not belong to this project");
  }

  if (targetMembership.userId === actor.id) {
    throw new Error("You cannot disable your own project membership");
  }

  const membership = {
    ...targetMembership,
    status: "disabled",
    updatedAt: now,
  };

  const auditEvent = createAuditEvent({
    actor,
    action: "employee.project_membership_disabled",
    projectId,
    targetUserId: targetMembership.userId,
    metadata: { previousRole: targetMembership.role },
    at: now,
  });

  return { membership, auditEvent };
}

export function reactivateProjectMembership({
  actor,
  memberships,
  projectId,
  targetMembership,
  now = new Date().toISOString(),
}) {
  assertCapability({
    actor,
    memberships,
    projectId,
    capability: CAPABILITIES.EMPLOYEES_REACTIVATE_MEMBERSHIP,
  });

  if (targetMembership.projectId !== projectId) {
    throw new Error("Target membership does not belong to this project");
  }

  const membership = {
    ...targetMembership,
    status: "active",
    updatedAt: now,
  };

  const auditEvent = createAuditEvent({
    actor,
    action: "employee.project_membership_reactivated",
    projectId,
    targetUserId: targetMembership.userId,
    at: now,
  });

  return { membership, auditEvent };
}

export function disableEmployeeAccount({
  actor,
  memberships,
  targetUser,
  now = new Date().toISOString(),
}) {
  assertCapability({
    actor,
    memberships,
    projectId: null,
    capability: CAPABILITIES.EMPLOYEES_DISABLE_ACCOUNT,
  });

  if (targetUser.id === actor.id) {
    throw new Error("You cannot disable your own TeleSyriana account");
  }

  const user = {
    ...targetUser,
    status: "disabled",
    updatedAt: now,
  };

  const auditEvent = createAuditEvent({
    actor,
    action: "employee.account_disabled",
    targetUserId: targetUser.id,
    metadata: { previousStatus: targetUser.status },
    at: now,
  });

  return { user, auditEvent };
}

export function reactivateEmployeeAccount({
  actor,
  memberships,
  targetUser,
  now = new Date().toISOString(),
}) {
  assertCapability({
    actor,
    memberships,
    projectId: null,
    capability: CAPABILITIES.EMPLOYEES_REACTIVATE_ACCOUNT,
  });

  const user = {
    ...targetUser,
    status: "active",
    updatedAt: now,
  };

  const auditEvent = createAuditEvent({
    actor,
    action: "employee.account_reactivated",
    targetUserId: targetUser.id,
    at: now,
  });

  return { user, auditEvent };
}
