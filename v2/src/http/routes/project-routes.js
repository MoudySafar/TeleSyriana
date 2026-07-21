import express from "express";

export function createProjectRouter({ projects, projectAdmin, requireAuth }) {
  if (!projects || !projectAdmin || !requireAuth) {
    throw new TypeError("Project services and authentication middleware are required");
  }

  const router = express.Router();

  router.get("/", requireAuth, async (req, res) => {
    const visible = await projects.listVisibleProjects(req.auth.user);
    res.json({ success: true, projects: visible });
  });

  router.post("/", requireAuth, async (req, res) => {
    const project = await projectAdmin.create({
      actorId: req.auth.user.id,
      input: req.body || {},
    });
    res.status(201).json({ success: true, project });
  });

  router.patch("/:projectId", requireAuth, async (req, res) => {
    const project = await projectAdmin.update({
      actorId: req.auth.user.id,
      projectId: req.params.projectId,
      fields: req.body || {},
    });
    res.json({ success: true, project });
  });

  return router;
}
