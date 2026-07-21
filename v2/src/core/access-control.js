// TeleSyriana V2 centralized access-control foundation.
// No project-sensitive module should make authorization decisions by checking role strings directly.

export const PLATFORM_ROLES = Object.freeze({
  CEO: "ceo",
  HR: "hr",
  MEMBER: "member",
});

export const PROJECT_ROLES = Object.freeze({
  MANAGER: "manager",
  SUPERVISOR: "supervisor",
  AGENT: "agent",
});

export const CAPABILITIES = Object.freeze({
  PROJECTS_VIEW_ALL: "projects.view_all",
  PROJECTS_MANAGE: "projects.manage",

  EMPLOYEES_VIEW: "employees.view",
  EMPLOYEES_CREATE: "employees.create",
  EMPLOYEES_DISABLE_ACCOUNT: "employees.disable_account",
  EMPLOYEES_REACTIVATE_ACCOUNT: "employees.reactivate_account",
  EMPLOYEES_DISABLE_MEMBERSHIP: "employees.disable_membership",
  EMPLOYEES_REACTIVATE_MEMBERSHIP: "employees.reactivate_membership",
  EMPLOYEES_CHANGE_ROLE: "employees.change_role",
  EMPLOYEES_ASSIGN_PROJECT: "employees.assign_project",
  EMPLOYEES_ASSIGN_TEAM: "employees.assign_team",

  TEAMS_VIEW: "teams.view",
  TEAMS_CREATE: "teams.create",
  TEAMS_MANAGE_PROJECT: "teams.manage_project",
  TEAMS_MANAGE_OWN: "teams.manage_own",

  ORDERS_SEARCH: "orders.search",

  TICKETS_CREATE: "tickets.create",
  TICKETS_VIEW_OWN: "tickets.view_own",
  TICKETS_VIEW_TEAM: "tickets.view_team",
  TICKETS_VIEW_PROJECT: "tickets.view_project",
  TICKETS_SEARCH: "tickets.search",
  TICKETS_ASSIGN: "tickets.assign",
  TICKETS_UPDATE_STATUS: "tickets.update_status",
  TICKETS_COMMENT: "tickets.comment",
  TICKETS_MODERATE_COMMENTS: "tickets.moderate_comments",
  TICKETS_RESOLVE: "tickets.resolve",

  CHAT_READ: "chat.read",
  CHAT_SEND: "chat.send",
  CHAT_REACT: "chat.react",
  CHAT_EDIT_OWN: "chat.edit_own",
  CHAT_DELETE_OWN: "chat.delete_own",
  CHAT_MODERATE: "chat.moderate",

  JOBS_CREATE: "jobs.create",
  JOBS_MANAGE: "jobs.manage",
  JOBS_APPLY: "jobs.apply",
  JOBS_REFER: "jobs.refer",

  INTEGRATIONS_MANAGE: "integrations.manage",
  AUDIT_VIEW: "audit.view",
});

const ALL_CAPABILITIES = Object.freeze(Object.values(CAPABILITIES));

const PLATFORM_CAPABILITIES = Object.freeze({
  [PLATFORM_ROLES.CEO]: ALL_CAPABILITIES,
  [PLATFORM_ROLES.HR]: [
    CAPABILITIES.PROJECTS_VIEW_ALL,
    CAPABILITIES.EMPLOYEES_VIEW,
    CAPABILITIES.EMPLOYEES_CREATE,
    CAPABILITIES.EMPLOYEES_DISABLE_ACCOUNT,
    CAPABILITIES.EMPLOYEES_REACTIVATE_ACCOUNT,
    CAPABILITIES.EMPLOYEES_DISABLE_MEMBERSHIP,
    CAPABILITIES.EMPLOYEES_REACTIVATE_MEMBERSHIP,
    CAPABILITIES.EMPLOYEES_CHANGE_ROLE,
    CAPABILITIES.EMPLOYEES_ASSIGN_PROJECT,
    CAPABILITIES.EMPLOYEES_ASSIGN_TEAM,
    CAPABILITIES.TEAMS_VIEW,
    CAPABILITIES.TEAMS_CREATE,
    CAPABILITIES.TEAMS_MANAGE_PROJECT,
    CAPABILITIES.JOBS_CREATE,
    CAPABILITIES.JOBS_MANAGE,
    CAPABILITIES.JOBS_APPLY,
    CAPABILITIES.JOBS_REFER,
    CAPABILITIES.AUDIT_VIEW,
  ],
  [PLATFORM_ROLES.MEMBER]: [],
});

const PROJECT_CAPABILITIES = Object.freeze({
  [PROJECT_ROLES.MANAGER]: [
    CAPABILITIES.EMPLOYEES_VIEW,
    CAPABILITIES.EMPLOYEES_CREATE,
    CAPABILITIES.EMPLOYEES_DISABLE_MEMBERSHIP,
    CAPABILITIES.EMPLOYEES_REACTIVATE_MEMBERSHIP,
    CAPABILITIES.EMPLOYEES_CHANGE_ROLE,
    CAPABILITIES.EMPLOYEES_ASSIGN_TEAM,
    CAPABILITIES.TEAMS_VIEW,
    CAPABILITIES.TEAMS_CREATE,
    CAPABILITIES.TEAMS_MANAGE_PROJECT,
    CAPABILITIES.ORDERS_SEARCH,
    CAPABILITIES.TICKETS_CREATE,
    CAPABILITIES.TICKETS_VIEW_OWN,
    CAPABILITIES.TICKETS_VIEW_TEAM,
    CAPABILITIES.TICKETS_VIEW_PROJECT,
    CAPABILITIES.TICKETS_SEARCH,
    CAPABILITIES.TICKETS_ASSIGN,
    CAPABILITIES.TICKETS_UPDATE_STATUS,
    CAPABILITIES.TICKETS_COMMENT,
    CAPABILITIES.TICKETS_MODERATE_COMMENTS,
    CAPABILITIES.TICKETS_RESOLVE,
    CAPABILITIES.CHAT_READ,
    CAPABILITIES.CHAT_SEND,
    CAPABILITIES.CHAT_REACT,
    CAPABILITIES.CHAT_EDIT_OWN,
    CAPABILITIES.CHAT_DELETE_OWN,
    CAPABILITIES.CHAT_MODERATE,
    CAPABILITIES.JOBS_CREATE,
    CAPABILITIES.JOBS_MANAGE,
    CAPABILITIES.JOBS_APPLY,
    CAPABILITIES.JOBS_REFER,
  ],
  [PROJECT_ROLES.SUPERVISOR]: [
    CAPABILITIES.EMPLOYEES_VIEW,
    CAPABILITIES.TEAMS_VIEW,
    CAPABILITIES.TEAMS_MANAGE_OWN,
    CAPABILITIES.ORDERS_SEARCH,
    CAPABILITIES.TICKETS_CREATE,
    CAPABILITIES.TICKETS_VIEW_OWN,
    CAPABILITIES.TICKETS_VIEW_TEAM,
    CAPABILITIES.TICKETS_SEARCH,
    CAPABILITIES.TICKETS_ASSIGN,
    CAPABILITIES.TICKETS_UPDATE_STATUS,
    CAPABILITIES.TICKETS_COMMENT,
    CAPABILITIES.TICKETS_MODERATE_COMMENTS,
    CAPABILITIES.TICKETS_RESOLVE,
    CAPABILITIES.CHAT_READ,
    CAPABILITIES.CHAT_SEND,
    CAPABILITIES.CHAT_REACT,
    CAPABILITIES.CHAT_EDIT_OWN,
    CAPABILITIES.CHAT_DELETE_OWN,
    CAPABILITIES.CHAT_MODERATE,
    CAPABILITIES.JOBS_APPLY,
    CAPABILITIES.JOBS_REFER,
  ],
  [PROJECT_ROLES.AGENT]: [
    CAPABILITIES.TEAMS_VIEW,
    CAPABILITIES.ORDERS_SEARCH,
    CAPABILITIES.TICKETS_CREATE,
    CAPABILITIES.TICKETS_VIEW_OWN,
    CAPABILITIES.TICKETS_SEARCH,
    CAPABILITIES.TICKETS_UPDATE_STATUS,
    CAPABILITIES.TICKETS_COMMENT,
    CAPABILITIES.TICKETS_RESOLVE,
    CAPABILITIES.CHAT_READ,
    CAPABILITIES.CHAT_SEND,
    CAPABILITIES.CHAT_REACT,
    CAPABILITIES.CHAT_EDIT_OWN,
    CAPABILITIES.CHAT_DELETE_OWN,
    CAPABILITIES.JOBS_APPLY,
    CAPABILITIES.JOBS_REFER,
  ],
});

export function isGlobalProjectViewer(user) {
  return Boolean(user) && [PLATFORM_ROLES.CEO, PLATFORM_ROLES.HR].includes(user.platformRole);
}

export function getActiveMembership(memberships, userId, projectId) {
  return memberships.find(
    (membership) =>
      membership.userId === userId &&
      membership.projectId === projectId &&
      membership.status === "active",
  ) || null;
}

/**
 * Returns only project IDs the user is allowed to know exist.
 * CEO/HR receive all active project IDs. Everyone else receives only their
 * own active membership projects. This prevents UI/API project enumeration.
 */
export function getVisibleProjectIds({ user, memberships, projects }) {
  if (!user || user.status !== "active") return [];

  if (isGlobalProjectViewer(user)) {
    return projects.filter((project) => project.status === "active").map((project) => project.id);
  }

  return memberships
    .filter((membership) => membership.userId === user.id && membership.status === "active")
    .map((membership) => membership.projectId);
}

export function canAccessProject({ user, memberships, projectId }) {
  if (!user || user.status !== "active") return false;
  if (isGlobalProjectViewer(user)) return true;
  return Boolean(getActiveMembership(memberships, user.id, projectId));
}

/**
 * Capability checks are always performed inside a project context unless the
 * capability comes from a global CEO/HR platform role.
 */
export function hasCapability({ user, memberships, projectId, capability }) {
  if (!user || user.status !== "active") return false;

  const platformCapabilities = PLATFORM_CAPABILITIES[user.platformRole] || [];
  if (platformCapabilities.includes(capability)) return true;

  if (!projectId) return false;

  const membership = getActiveMembership(memberships, user.id, projectId);
  if (!membership) return false;

  const projectCapabilities = PROJECT_CAPABILITIES[membership.role] || [];
  return projectCapabilities.includes(capability);
}

/**
 * Returns a safe project context. Callers should respond with 403 when null.
 */
export function authorizeProjectContext({ user, memberships, projectId }) {
  if (!canAccessProject({ user, memberships, projectId })) return null;

  return {
    userId: user.id,
    projectId,
    platformRole: user.platformRole,
    membership: getActiveMembership(memberships, user.id, projectId),
    globalProjectViewer: isGlobalProjectViewer(user),
  };
}

/**
 * Legacy migration helper only. The current MVP uses `admin` and one role per
 * staff record. During migration, admin maps to CEO and all other legacy users
 * become project members of iPro. New V2 code should not depend on this shape.
 */
export function mapLegacyStaffToV2({ staff, iproProjectId }) {
  const user = {
    id: `user:${staff.staffCode}`,
    staffCode: staff.staffCode,
    displayName: staff.name,
    platformRole: staff.role === "admin" ? PLATFORM_ROLES.CEO : PLATFORM_ROLES.MEMBER,
    status: staff.active === false ? "disabled" : "active",
  };

  const legacyProjectRole = [
    PROJECT_ROLES.MANAGER,
    PROJECT_ROLES.SUPERVISOR,
    PROJECT_ROLES.AGENT,
  ].includes(staff.role)
    ? staff.role
    : null;

  const membership = legacyProjectRole
    ? {
        userId: user.id,
        projectId: iproProjectId,
        role: legacyProjectRole,
        status: user.status === "active" ? "active" : "disabled",
      }
    : null;

  return { user, membership };
}
