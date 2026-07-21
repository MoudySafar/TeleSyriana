import express from "express";

export function createWorkspaceRouter({ workspace }) {
  if (!workspace) throw new TypeError("Workspace service is required");

  const router = express.Router({ mergeParams: true });

  router.get("/context", async (req, res) => {
    const context = await workspace.get({
      user: req.auth.user,
      projectId: req.params.projectId,
    });
    res.json({ success: true, ...context });
  });

  return router;
}
