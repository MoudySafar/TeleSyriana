import {
  CAPABILITIES,
  authorizeProjectContext,
  hasCapability,
} from "../core/access-control.js";

const EXPOSED_CAPABILITIES = Object.freeze([
  CAPABILITIES.PROJECTS_MANAGE,
  CAPABILITIES.EMPLOYEES_VIEW,
  CAPABILITIES.EMPLOYEES_CREATE,
  CAPABILITIES.EMPLOYEES_CHANGE_ROLE,
  CAPABILITIES.EMPLOYEES_ASSIGN_PROJECT,
  CAPABILITIES.EMPLOYEES_ASSIGN_TEAM,
  CAPABILITIES.TEAMS_VIEW,
  CAPABILITIES.TEAMS_CREATE,
  CAPABILITIES.TEAMS_MANAGE_OWN,
  CAPABILITIES.TEAMS_MANAGE_PROJECT,
  CAPABILITIES.ORDERS_SEARCH,
  CAPABILITIES.TICKETS_CREATE,
  CAPABILITIES.TICKETS_VIEW_OWN,
  CAPABILITIES.TICKETS_VIEW_TEAM,
  CAPABILITIES.TICKETS_VIEW_PROJECT,
  CAPABILITIES.TICKETS_SEARCH,
  CAPABILITIES.CHAT_READ,
  CAPABILITIES.JOBS_CREATE,
  CAPABILITIES.JOBS_MANAGE,
  CAPABILITIES.JOBS_APPLY,
  CAPABILITIES.JOBS_REFER,
  CAPABILITIES.INTEGRATIONS_MANAGE,
  CAPABILITIES.AUDIT_VIEW,
]);

export function createWorkspaceService({ projects, memberships }) {
  if (!projects || !memberships) {
    throw new TypeError("Project and membership repositories are required");
  }

  return {
    async get({ user, projectId }) {
      const [project, userMemberships] = await Promise.all([
        projects.findById(projectId),
        memberships.listForUser(user.id),
      ]);
      if (!project || project.status !== "active") {
        const error = new Error("Project not found");
        error.code = "NOT_FOUND";
        throw error;
      }

      const authorized = authorizeProjectContext({
        user,
        memberships: userMemberships,
        projectId,
      });
      if (!authorized) {
        const error = new Error("Project access denied");
        error.code = "FORBIDDEN";
        throw error;
      }

      const capabilities = Object.fromEntries(
        EXPOSED_CAPABILITIES.map((capability) => [
          capability,
          hasCapability({
            user,
            memberships: userMemberships,
            projectId,
            capability,
          }),
        ]),
      );

      return {
        project,
        membership: authorized.membership,
        platformRole: user.platformRole,
        globalProjectViewer: authorized.globalProjectViewer,
        capabilities,
      };
    },
  };
}

export { EXPOSED_CAPABILITIES };
