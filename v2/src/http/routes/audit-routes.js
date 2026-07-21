import express from "express";

export function createAuditRouter({ auditLog }) {
  if (!auditLog) throw new TypeError("Audit log service is required");

  const router = express.Router({ mergeParams: true });

  router.get("/", async (req, res) => {
    const events = await auditLog.list({
      actorId: req.auth.user.id,
      projectId: req.params.projectId,
      actionPrefix: req.query.action || null,
      limit: req.query.limit,
    });
    res.json({ success: true, events });
  });

  return router;
}
