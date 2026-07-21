import { getSessionToken } from "./session.js";

export function createRequireAuth({ authentication, cookieName }) {
  if (!authentication) throw new TypeError("Authentication service is required");

  return async function requireAuth(req, _res, next) {
    try {
      const token = getSessionToken(req, cookieName);
      const auth = await authentication.authenticateSession(token);
      req.auth = { ...auth, token };
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function createRequireProject({ projects }) {
  if (!projects) throw new TypeError("Project service is required");

  return async function requireProject(req, _res, next) {
    try {
      req.projectContext = await projects.requireProjectContext({
        user: req.auth.user,
        projectId: req.params.projectId,
      });
      next();
    } catch (error) {
      next(error);
    }
  };
}
