import express from "express";

export function createTeamRouter({ teams }) {
  if (!teams) throw new TypeError("Team service is required");

  const router = express.Router({ mergeParams: true });

  router.get("/", async (req, res) => {
    const result = await teams.list({
      actorId: req.auth.user.id,
      projectId: req.params.projectId,
    });
    res.json({ success: true, teams: result });
  });

  router.post("/", async (req, res) => {
    const team = await teams.create({
      actorId: req.auth.user.id,
      projectId: req.params.projectId,
      input: req.body || {},
    });
    res.status(201).json({ success: true, team });
  });

  router.get("/:teamId/members", async (req, res) => {
    const members = await teams.listMembers({
      actorId: req.auth.user.id,
      projectId: req.params.projectId,
      teamId: req.params.teamId,
    });
    res.json({ success: true, members });
  });

  router.put("/:teamId/supervisor", async (req, res) => {
    const team = await teams.setSupervisor({
      actorId: req.auth.user.id,
      projectId: req.params.projectId,
      teamId: req.params.teamId,
      supervisorUserId: req.body?.supervisorUserId,
    });
    res.json({ success: true, team });
  });

  router.put("/:teamId/members/:userId", async (req, res) => {
    const member = await teams.addMember({
      actorId: req.auth.user.id,
      projectId: req.params.projectId,
      teamId: req.params.teamId,
      userId: req.params.userId,
    });
    res.json({ success: true, member });
  });

  router.delete("/:teamId/members/:userId", async (req, res) => {
    const member = await teams.removeMember({
      actorId: req.auth.user.id,
      projectId: req.params.projectId,
      teamId: req.params.teamId,
      userId: req.params.userId,
    });
    res.json({ success: true, member });
  });

  return router;
}
