import express from "express";

export function createShopifyIntegrationRouter({ integrations }) {
  if (!integrations) throw new TypeError("Shopify integration service is required");

  const router = express.Router({ mergeParams: true });

  router.get("/", async (req, res) => {
    const connections = await integrations.list({
      actorId: req.auth.user.id,
      projectId: req.params.projectId,
    });
    res.json({ success: true, connections });
  });

  router.post("/", async (req, res) => {
    const connection = await integrations.createPending({
      actorId: req.auth.user.id,
      projectId: req.params.projectId,
      input: req.body || {},
    });
    res.status(201).json({ success: true, connection });
  });

  router.post("/:connectionId/verify", async (req, res) => {
    const result = await integrations.verify({
      actorId: req.auth.user.id,
      projectId: req.params.projectId,
      connectionId: req.params.connectionId,
    });
    res.json({ success: true, ...result });
  });

  router.post("/:connectionId/activate", async (req, res) => {
    const connection = await integrations.activateVerifiedAsDefault({
      actorId: req.auth.user.id,
      projectId: req.params.projectId,
      connectionId: req.params.connectionId,
    });
    res.json({ success: true, connection });
  });

  return router;
}
