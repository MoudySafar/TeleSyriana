import express from "express";

export function createEmployeeDirectoryRouter({ employeeDirectory }) {
  if (!employeeDirectory) throw new TypeError("Employee directory service is required");

  const router = express.Router({ mergeParams: true });

  router.get("/", async (req, res) => {
    const employees = await employeeDirectory.list({
      actorId: req.auth.user.id,
      projectId: req.params.projectId,
    });
    res.json({ success: true, employees });
  });

  router.get("/:userId", async (req, res) => {
    const result = await employeeDirectory.getProfile({
      actorId: req.auth.user.id,
      projectId: req.params.projectId,
      targetUserId: req.params.userId,
    });
    res.json({ success: true, ...result });
  });

  return router;
}
