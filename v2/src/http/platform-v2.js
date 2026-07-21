import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";

import { createApplicationServicesV2 } from "../app-services-v2.js";
import { createProjectEventBroker } from "../realtime/project-event-broker.js";
import { createTeleSyrianaV2App } from "./app-v2.js";
import { sendError } from "./http-utils.js";
import { createRequireAuth, createRequireProject } from "./middleware.js";
import { createRealtimeRouter } from "./routes/realtime-routes.js";
import { DEFAULT_COOKIE_NAME } from "./session.js";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
export const webRootV2 = path.resolve(currentDir, "../../web");

export function createTeleSyrianaPlatformV2({
  pool,
  services = null,
  realtimeBroker = null,
  cookieName = DEFAULT_COOKIE_NAME,
} = {}) {
  if (!pool && !services) {
    throw new TypeError("A database pool or explicit service overrides are required");
  }

  const resolved = services || createApplicationServicesV2(pool);
  const broker = realtimeBroker || createProjectEventBroker(pool);
  const app = createTeleSyrianaV2App({ services: resolved, cookieName });
  const requireAuth = createRequireAuth({
    authentication: resolved.authentication,
    cookieName,
  });
  const requireProject = createRequireProject({ projects: resolved.projects });

  app.use(
    "/api/projects/:projectId/events",
    requireAuth,
    requireProject,
    createRealtimeRouter({ broker, workspace: resolved.workspace }),
  );

  app.use(
    express.static(webRootV2, {
      index: false,
      fallthrough: true,
      etag: true,
      maxAge: 0,
    }),
  );

  app.get(/.*/, (req, res, next) => {
    if (req.path === "/health" || req.path.startsWith("/api/")) return next();
    return res.sendFile(path.join(webRootV2, "index.html"));
  });

  app.use((req, res) => {
    res.status(404).json({ success: false, error: "Not found" });
  });

  app.use((error, _req, res, _next) => {
    sendError(error, res);
  });

  return { app, broker, services: resolved };
}
