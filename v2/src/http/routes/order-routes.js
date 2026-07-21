import express from "express";

export function createOrderRouter({ orders }) {
  if (!orders) throw new TypeError("Order service is required");

  const router = express.Router({ mergeParams: true });

  router.get("/search", async (req, res) => {
    const result = await orders.search({
      actor: req.auth.user,
      projectId: req.params.projectId,
      query: req.query.q,
    });
    res.json({ success: true, ...result });
  });

  return router;
}
