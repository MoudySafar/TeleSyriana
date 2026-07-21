import express from "express";

import { createApplicationServices } from "../app-services.js";
import { isGlobalProjectViewer } from "../core/access-control.js";
import { sendError, safeUser } from "./http-utils.js";
import { createRequireAuth, createRequireProject } from "./middleware.js";
import { createAuthRouter } from "./routes/auth-routes.js";
import { createChatRouter } from "./routes/chat-routes.js";
import {
  createGlobalEmployeeRouter,
  createProjectEmployeeRouter,
} from "./routes/employee-routes.js";
import { createShopifyIntegrationRouter } from "./routes/integration-routes.js";
import { createJobRouter } from "./routes/job-routes.js";
import { createOrderRouter } from "./routes/order-routes.js";
import { createProjectRouter } from "./routes/project-routes.js";
import { createTeamRouter } from "./routes/team-routes.js";
import {
  createTicketCommentRouter,
  createTicketRouter,
} from "./routes/ticket-routes.js";
import { DEFAULT_COOKIE_NAME } from "./session.js";

export function createModularApp({
  pool,
  services = null,
  cookieName = DEFAULT_COOKIE_NAME,
} = {}) {
  if (!pool && !services) {
    throw new TypeError("A database pool or explicit service overrides are required");
  }

  const resolved = services || createApplicationServices(pool);
  const requireAuth = createRequireAuth({
    authentication: resolved.authentication,
    cookieName,
  });
  const requireProject = createRequireProject({ projects: resolved.projects });

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

  app.get("/health", async (_req, res) => {
    const health = await resolved.healthCheck();
    res.json({ success: true, ...health });
  });

  app.use(
    "/api/auth",
    createAuthRouter({
      authentication: resolved.authentication,
      requireAuth,
      cookieName,
    }),
  );

  app.get("/api/me", requireAuth, async (req, res) => {
    const projects = await resolved.projects.listVisibleProjects(req.auth.user);
    res.json({
      success: true,
      user: safeUser(req.auth.user),
      projects,
      canViewAllProjects: isGlobalProjectViewer(req.auth.user),
    });
  });

  app.use(
    "/api/projects",
    createProjectRouter({
      projects: resolved.projects,
      projectAdmin: resolved.projectAdmin,
      requireAuth,
    }),
  );

  app.use(
    "/api/employees",
    createGlobalEmployeeRouter({
      employees: resolved.employees,
      requireAuth,
    }),
  );

  app.use(
    "/api/projects/:projectId/employees",
    requireAuth,
    requireProject,
    createProjectEmployeeRouter({ employees: resolved.employees }),
  );

  app.use(
    "/api/projects/:projectId/teams",
    requireAuth,
    requireProject,
    createTeamRouter({ teams: resolved.teams }),
  );

  app.use(
    "/api/projects/:projectId/tickets",
    requireAuth,
    requireProject,
    createTicketRouter({
      tickets: resolved.tickets,
      ticketQueue: resolved.ticketQueue,
    }),
  );

  app.use(
    "/api/projects/:projectId/ticket-comments",
    requireAuth,
    requireProject,
    createTicketCommentRouter({ tickets: resolved.tickets }),
  );

  app.use(
    "/api/projects/:projectId/orders",
    requireAuth,
    requireProject,
    createOrderRouter({ orders: resolved.orders }),
  );

  app.use(
    "/api/projects/:projectId/chat",
    requireAuth,
    requireProject,
    createChatRouter({ chat: resolved.chat }),
  );

  app.use(
    "/api/projects/:projectId/jobs",
    requireAuth,
    requireProject,
    createJobRouter({ jobs: resolved.jobs }),
  );

  app.use(
    "/api/projects/:projectId/integrations/shopify",
    requireAuth,
    requireProject,
    createShopifyIntegrationRouter({ integrations: resolved.integrations }),
  );

  app.use((error, _req, res, _next) => {
    sendError(error, res);
  });

  return app;
}
