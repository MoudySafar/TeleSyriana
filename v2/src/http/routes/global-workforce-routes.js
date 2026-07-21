import express from "express";

export function createGlobalWorkforceRouter({ globalEmployees, requireAuth }) {
  if (!globalEmployees || !requireAuth) {
    throw new TypeError("Global employee service and authentication middleware are required");
  }

  const router = express.Router();

  router.get("/", requireAuth, async (req, res) => {
    const employees = await globalEmployees.list({
      actorId: req.auth.user.id,
      query: req.query.q || null,
      limit: req.query.limit,
    });
    res.json({ success: true, employees });
  });

  return router;
}
