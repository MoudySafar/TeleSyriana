import express from "express";

import { createAuthRepository } from "../auth/auth-repository.js";
import { createAuthenticationService } from "../auth/auth-service.js";
import { isGlobalProjectViewer } from "../core/access-control.js";
import { checkDatabaseHealth } from "../db/postgres.js";
import { createRepositories } from "../db/repositories.js";
import { createPersistentEmployeeService } from "../employees/persistent-employee-service.js";
import { createShopifyIntegrationService } from "../integrations/shopify-service.js";
import { createProjectService } from "../projects/project-service.js";

const DEFAULT_COOKIE_NAME = "ts_session";

function parseCookies(header = "") {
  const output = {};
  for (const entry of String(header).split(";")) {
    const separator = entry.indexOf("=");
    if (separator < 0) continue;
    const key = entry.slice(0, separator).trim();
    const rawValue = entry.slice(separator + 1).trim();
    if (!key) continue;
    try {
      output[key] = decodeURIComponent(rawValue);
    } catch {
      output[key] = rawValue;
    }
  }
  return output;
}

function getSessionToken(req, cookieName) {
  const authorization = String(req.headers.authorization || "");
  if (authorization.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim();
  }
  return parseCookies(req.headers.cookie)[cookieName] || null;
}

function cookieSecure() {
  if (process.env.COOKIE_SECURE === "false") return false;
  if (process.env.COOKIE_SECURE === "true") return true;
  return process.env.NODE_ENV === "production";
}

function setSessionCookie(res, { cookieName, token, expiresAt }) {
  const expires = new Date(expiresAt);
  const parts = [
    `${cookieName}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${expires.toUTCString()}`,
  ];
  if (cookieSecure()) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearSessionCookie(res, cookieName) {
  const parts = [
    `${cookieName}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "Max-Age=0",
  ];
  if (cookieSecure()) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function safeUser(user) {
  return {
    id: user.id,
    staffCode: user.staffCode,
    displayName: user.displayName,
    email: user.email ?? null,
    platformRole: user.platformRole,
    status: user.status,
    locale: user.locale ?? "en",
    theme: user.theme ?? "system",
  };
}

function defaultServices(pool) {
  const repositories = createRepositories(pool);
  const authRepository = createAuthRepository(pool);
  const authentication = createAuthenticationService({
    users: repositories.users,
    auth: authRepository,
  });

  return {
    authentication,
    projects: createProjectService({
      projects: repositories.projects,
      memberships: repositories.memberships,
    }),
    employees: createPersistentEmployeeService({ pool }),
    integrations: createShopifyIntegrationService({ pool }),
    healthCheck: () => checkDatabaseHealth(pool),
  };
}

function statusForError(error) {
  if (error?.code === "UNAUTHENTICATED" || error?.code === "INVALID_CREDENTIALS") return 401;
  if (error?.code === "FORBIDDEN") return 403;
  if (error?.code === "NOT_FOUND") return 404;
  if (error?.code === "AUTH_LOCKED") return 429;
  if (error?.code === "CONFLICT" || error?.code === "23505") return 409;
  if (["SHOPIFY_AUTH_ERROR", "SHOPIFY_SHOP_MISMATCH", "SHOPIFY_VERIFY_ERROR"].includes(error?.code)) return 422;
  if (["SHOPIFY_NETWORK_ERROR", "SHOPIFY_API_ERROR", "SHOPIFY_GRAPHQL_ERROR"].includes(error?.code)) return 502;
  if (error?.code === "23514") return 400;
  return 500;
}

export function createApp({ pool, services = null, cookieName = DEFAULT_COOKIE_NAME } = {}) {
  if (!pool && !services) {
    throw new TypeError("A database pool or explicit service overrides are required");
  }

  const resolved = services || defaultServices(pool);
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "512kb" }));
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  const requireAuth = async (req, _res, next) => {
    try {
      const token = getSessionToken(req, cookieName);
      const auth = await resolved.authentication.authenticateSession(token);
      req.auth = { ...auth, token };
      next();
    } catch (error) {
      next(error);
    }
  };

  const requireProject = async (req, _res, next) => {
    try {
      req.projectContext = await resolved.projects.requireProjectContext({
        user: req.auth.user,
        projectId: req.params.projectId,
      });
      next();
    } catch (error) {
      next(error);
    }
  };

  app.get("/health", async (_req, res) => {
    const health = await resolved.healthCheck();
    res.json({ success: true, ...health });
  });

  app.post("/api/auth/login", async (req, res) => {
    const result = await resolved.authentication.login({
      staffCode: req.body?.staffCode,
      secret: req.body?.secret,
    });

    setSessionCookie(res, {
      cookieName,
      token: result.token,
      expiresAt: result.session.expiresAt,
    });

    res.json({
      success: true,
      user: safeUser(result.user),
      mustResetLoginSecret: result.mustReset,
    });
  });

  app.post("/api/auth/logout", requireAuth, async (req, res) => {
    await resolved.authentication.logout(req.auth.token);
    clearSessionCookie(res, cookieName);
    res.json({ success: true });
  });

  app.post("/api/auth/change-secret", requireAuth, async (req, res) => {
    await resolved.authentication.changeSecret({
      userId: req.auth.user.id,
      currentSecret: req.body?.currentSecret,
      nextSecret: req.body?.nextSecret,
    });
    clearSessionCookie(res, cookieName);
    res.json({ success: true, reauthenticate: true });
  });

  app.get("/api/me", requireAuth, async (req, res) => {
    const projects = await resolved.projects.listVisibleProjects(req.auth.user);
    res.json({
      success: true,
      user: safeUser(req.auth.user),
      projects,
      canViewAllProjects: isGlobalProjectViewer(req.auth.user),
    });
  });

  app.get("/api/projects", requireAuth, async (req, res) => {
    const projects = await resolved.projects.listVisibleProjects(req.auth.user);
    res.json({ success: true, projects });
  });

  app.post("/api/projects/:projectId/employees", requireAuth, requireProject, async (req, res) => {
    const result = await resolved.employees.createForProject({
      actorId: req.auth.user.id,
      projectId: req.params.projectId,
      input: req.body || {},
    });

    res.status(201).json({
      success: true,
      employee: safeUser(result.user),
      membership: result.membership,
      mustResetLoginSecret: result.mustResetLoginSecret,
    });
  });

  app.patch("/api/projects/:projectId/employees/:userId/role", requireAuth, requireProject, async (req, res) => {
    const result = await resolved.employees.changeProjectRole({
      actorId: req.auth.user.id,
      projectId: req.params.projectId,
      targetUserId: req.params.userId,
      nextRole: req.body?.role,
    });

    res.json({ success: true, membership: result.membership });
  });

  app.post("/api/projects/:projectId/employees/:userId/disable", requireAuth, requireProject, async (req, res) => {
    const result = await resolved.employees.disableFromProject({
      actorId: req.auth.user.id,
      projectId: req.params.projectId,
      targetUserId: req.params.userId,
    });

    res.json({ success: true, membership: result.membership });
  });

  app.post("/api/projects/:projectId/employees/:userId/reactivate", requireAuth, requireProject, async (req, res) => {
    const result = await resolved.employees.reactivateInProject({
      actorId: req.auth.user.id,
      projectId: req.params.projectId,
      targetUserId: req.params.userId,
    });

    res.json({ success: true, membership: result.membership });
  });

  app.post("/api/employees/:userId/disable-account", requireAuth, async (req, res) => {
    const result = await resolved.employees.disableAccount({
      actorId: req.auth.user.id,
      targetUserId: req.params.userId,
    });
    res.json({ success: true, employee: safeUser(result.user) });
  });

  app.post("/api/employees/:userId/reactivate-account", requireAuth, async (req, res) => {
    const result = await resolved.employees.reactivateAccount({
      actorId: req.auth.user.id,
      targetUserId: req.params.userId,
    });
    res.json({ success: true, employee: safeUser(result.user) });
  });

  app.get("/api/projects/:projectId/integrations/shopify", requireAuth, requireProject, async (req, res) => {
    const connections = await resolved.integrations.list({
      actorId: req.auth.user.id,
      projectId: req.params.projectId,
    });
    res.json({ success: true, connections });
  });

  app.post("/api/projects/:projectId/integrations/shopify", requireAuth, requireProject, async (req, res) => {
    const connection = await resolved.integrations.createPending({
      actorId: req.auth.user.id,
      projectId: req.params.projectId,
      input: req.body || {},
    });
    res.status(201).json({ success: true, connection });
  });

  app.post("/api/projects/:projectId/integrations/shopify/:connectionId/verify", requireAuth, requireProject, async (req, res) => {
    const result = await resolved.integrations.verify({
      actorId: req.auth.user.id,
      projectId: req.params.projectId,
      connectionId: req.params.connectionId,
    });
    res.json({ success: true, ...result });
  });

  app.post("/api/projects/:projectId/integrations/shopify/:connectionId/activate", requireAuth, requireProject, async (req, res) => {
    const connection = await resolved.integrations.activateVerifiedAsDefault({
      actorId: req.auth.user.id,
      projectId: req.params.projectId,
      connectionId: req.params.connectionId,
    });
    res.json({ success: true, connection });
  });

  app.use((error, _req, res, _next) => {
    const status = statusForError(error);
    if (status >= 500) console.error("TeleSyriana V2 API error:", error);

    res.status(status).json({
      success: false,
      error: status >= 500 ? "Internal server error" : error.message,
      code: error?.code ?? null,
    });
  });

  return app;
}
