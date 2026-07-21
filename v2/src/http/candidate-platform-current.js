import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";

import { createGlobalEmployeeService } from "../employees/global-employee-service.js";
import { createProjectEventBroker } from "../realtime/project-event-broker.js";
import { createCandidateApp } from "./candidate-app.js";
import { sendError } from "./http-utils.js";
import { createGlobalWorkforceRouter } from "./routes/global-workforce-routes.js";
import { createRealtimeRouter } from "./routes/realtime-routes.js";
import { DEFAULT_COOKIE_NAME } from "./session.js";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
export const currentCandidateWebRoot = path.resolve(currentDir, "../../web");

export function createCurrentCandidatePlatform({
  pool,
  services = null,
  realtimeBroker = null,
  globalEmployees = null,
  cookieName = DEFAULT_COOKIE_NAME,
} = {}) {
  if (!pool && !services) {
    throw new TypeError("A database pool or explicit service overrides are required");
  }

  const candidate = createCandidateApp({ pool, services, cookieName });
  const broker = realtimeBroker || createProjectEventBroker(pool);
  const globalEmployeeService = globalEmployees || createGlobalEmployeeService({ pool });
  const { app, services: resolved, requireAuth, requireProject } = candidate;

  app.use(
    "/api/workforce/employees",
    createGlobalWorkforceRouter({
      globalEmployees: globalEmployeeService,
      requireAuth,
    }),
  );

  app.use(
    "/api/projects/:projectId/events",
    requireAuth,
    requireProject,
    createRealtimeRouter({ broker, workspace: resolved.workspace }),
  );

  app.use(
    express.static(currentCandidateWebRoot, {
      index: false,
      fallthrough: true,
      etag: true,
      maxAge: 0,
    }),
  );

  app.get(/.*/, (req, res, next) => {
    if (req.path === "/health" || req.path.startsWith("/api/")) return next();
    return res.sendFile(path.join(currentCandidateWebRoot, "candidate.html"));
  });

  app.use((req, res) => {
    res.status(404).json({ success: false, error: "Not found" });
  });

  app.use((error, _req, res, _next) => {
    sendError(error, res);
  });

  return {
    app,
    broker,
    services: resolved,
    globalEmployees: globalEmployeeService,
  };
}
