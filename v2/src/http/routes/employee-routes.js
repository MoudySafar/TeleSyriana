import express from "express";

import { safeUser } from "../http-utils.js";

export function createProjectEmployeeRouter({ employees }) {
  if (!employees) throw new TypeError("Employee service is required");

  const router = express.Router({ mergeParams: true });

  router.post("/", async (req, res) => {
    const result = await employees.createForProject({
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

  router.put("/:userId/membership", async (req, res) => {
    const result = await employees.assignExistingToProject({
      actorId: req.auth.user.id,
      projectId: req.params.projectId,
      targetUserId: req.params.userId,
      role: req.body?.role,
      supervisorUserId: req.body?.supervisorUserId ?? null,
      teamId: req.body?.teamId ?? null,
    });
    res.json({
      success: true,
      employee: safeUser(result.user),
      membership: result.membership,
    });
  });

  router.patch("/:userId/role", async (req, res) => {
    const result = await employees.changeProjectRole({
      actorId: req.auth.user.id,
      projectId: req.params.projectId,
      targetUserId: req.params.userId,
      nextRole: req.body?.role,
    });
    res.json({ success: true, membership: result.membership });
  });

  router.post("/:userId/disable", async (req, res) => {
    const result = await employees.disableFromProject({
      actorId: req.auth.user.id,
      projectId: req.params.projectId,
      targetUserId: req.params.userId,
    });
    res.json({ success: true, membership: result.membership });
  });

  router.post("/:userId/reactivate", async (req, res) => {
    const result = await employees.reactivateInProject({
      actorId: req.auth.user.id,
      projectId: req.params.projectId,
      targetUserId: req.params.userId,
    });
    res.json({ success: true, membership: result.membership });
  });

  return router;
}

export function createGlobalEmployeeRouter({ employees, requireAuth }) {
  if (!employees || !requireAuth) {
    throw new TypeError("Employee service and authentication middleware are required");
  }

  const router = express.Router();

  router.post("/:userId/disable-account", requireAuth, async (req, res) => {
    const result = await employees.disableAccount({
      actorId: req.auth.user.id,
      targetUserId: req.params.userId,
    });
    res.json({ success: true, employee: safeUser(result.user) });
  });

  router.post("/:userId/reactivate-account", requireAuth, async (req, res) => {
    const result = await employees.reactivateAccount({
      actorId: req.auth.user.id,
      targetUserId: req.params.userId,
    });
    res.json({ success: true, employee: safeUser(result.user) });
  });

  return router;
}
