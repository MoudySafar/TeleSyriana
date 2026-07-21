import express from "express";

export function createTicketRouter({ tickets, ticketQueue }) {
  if (!tickets || !ticketQueue) {
    throw new TypeError("Ticket and ticket queue services are required");
  }

  const router = express.Router({ mergeParams: true });

  router.get("/search", async (req, res) => {
    const result = await tickets.search({
      actorId: req.auth.user.id,
      projectId: req.params.projectId,
      query: req.query.q,
      limit: req.query.limit,
    });
    res.json({ success: true, tickets: result });
  });

  router.get("/", async (req, res) => {
    const result = await ticketQueue.list({
      actorId: req.auth.user.id,
      projectId: req.params.projectId,
      statusFilter: req.query.status || "active",
      activityWindow: req.query.activity || "all",
      limit: req.query.limit,
    });
    res.json({ success: true, tickets: result });
  });

  router.post("/", async (req, res) => {
    const ticket = await tickets.create({
      actorId: req.auth.user.id,
      projectId: req.params.projectId,
      input: req.body || {},
    });
    res.status(201).json({ success: true, ticket });
  });

  router.get("/:ticketCode", async (req, res) => {
    const result = await tickets.getByCode({
      actorId: req.auth.user.id,
      projectId: req.params.projectId,
      ticketCode: req.params.ticketCode,
    });
    res.json({ success: true, ...result });
  });

  router.patch("/:ticketCode/status", async (req, res) => {
    const ticket = await tickets.updateStatus({
      actorId: req.auth.user.id,
      projectId: req.params.projectId,
      ticketCode: req.params.ticketCode,
      status: req.body?.status,
      expectedVersion: req.body?.expectedVersion ?? null,
    });
    res.json({ success: true, ticket });
  });

  router.post("/:ticketCode/comments", async (req, res) => {
    const comment = await tickets.addComment({
      actorId: req.auth.user.id,
      projectId: req.params.projectId,
      ticketCode: req.params.ticketCode,
      body: req.body?.body,
    });
    res.status(201).json({ success: true, comment });
  });

  return router;
}

export function createTicketCommentRouter({ tickets }) {
  if (!tickets) throw new TypeError("Ticket service is required");

  const router = express.Router({ mergeParams: true });

  router.patch("/:commentId", async (req, res) => {
    const comment = await tickets.editComment({
      actorId: req.auth.user.id,
      projectId: req.params.projectId,
      commentId: req.params.commentId,
      body: req.body?.body,
    });
    res.json({ success: true, comment });
  });

  router.delete("/:commentId", async (req, res) => {
    const comment = await tickets.deleteComment({
      actorId: req.auth.user.id,
      projectId: req.params.projectId,
      commentId: req.params.commentId,
    });
    res.json({ success: true, comment });
  });

  return router;
}
