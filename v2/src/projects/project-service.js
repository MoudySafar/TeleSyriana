import {
  authorizeProjectContext,
  getVisibleProjectIds,
} from "../core/access-control.js";

function forbiddenProject() {
  const error = new Error("Project access denied");
  error.code = "FORBIDDEN";
  return error;
}

export function createProjectService({ projects, memberships } = {}) {
  if (!projects || !memberships) {
    throw new TypeError("Project and membership repositories are required");
  }

  return {
    async listVisibleProjects(user) {
      const [allProjects, userMemberships] = await Promise.all([
        projects.listActive(),
        memberships.listForUser(user.id),
      ]);

      const visibleIds = new Set(
        getVisibleProjectIds({
          user,
          memberships: userMemberships,
          projects: allProjects,
        }),
      );

      return allProjects.filter((project) => visibleIds.has(project.id));
    },

    async requireProjectContext({ user, projectId }) {
      const userMemberships = await memberships.listForUser(user.id);
      const context = authorizeProjectContext({
        user,
        memberships: userMemberships,
        projectId,
      });

      if (!context) throw forbiddenProject();

      const project = await projects.findById(projectId);
      if (!project || project.status !== "active") throw forbiddenProject();

      return { ...context, project };
    },
  };
}
