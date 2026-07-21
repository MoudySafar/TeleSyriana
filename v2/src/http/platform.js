import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";

import { createTeleSyrianaV2App } from "./app-v2.js";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
export const webRoot = path.resolve(currentDir, "../../web");

export function createPlatformApp(options = {}) {
  const app = createTeleSyrianaV2App(options);

  app.use(
    express.static(webRoot, {
      index: false,
      fallthrough: true,
      etag: true,
      maxAge: 0,
    }),
  );

  // Express 5/path-to-regexp no longer accepts the old bare "*" route shape.
  // A RegExp fallback is explicit and keeps API/health paths from returning HTML.
  app.get(/.*/, (req, res, next) => {
    if (req.path === "/health" || req.path.startsWith("/api/")) return next();
    return res.sendFile(path.join(webRoot, "index.html"));
  });

  app.use((req, res) => {
    res.status(404).json({ success: false, error: "Not found" });
  });

  return app;
}
