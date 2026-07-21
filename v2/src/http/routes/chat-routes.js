import express from "express";

export function createChatRouter({ chat }) {
  if (!chat) throw new TypeError("Chat service is required");

  const router = express.Router({ mergeParams: true });

  router.get("/channels", async (req, res) => {
    const channels = await chat.listChannels({
      actorId: req.auth.user.id,
      projectId: req.params.projectId,
    });
    res.json({ success: true, channels });
  });

  router.get("/channels/:channelId/messages", async (req, res) => {
    const result = await chat.listMessages({
      actorId: req.auth.user.id,
      projectId: req.params.projectId,
      channelId: req.params.channelId,
      afterSequence: req.query.afterSequence,
      limit: req.query.limit,
    });
    res.json({ success: true, ...result });
  });

  router.post("/channels/:channelId/messages", async (req, res) => {
    const message = await chat.sendMessage({
      actorId: req.auth.user.id,
      projectId: req.params.projectId,
      channelId: req.params.channelId,
      body: req.body?.body,
    });
    res.status(201).json({ success: true, message });
  });

  router.post("/channels/:channelId/read", async (req, res) => {
    const readState = await chat.markRead({
      actorId: req.auth.user.id,
      projectId: req.params.projectId,
      channelId: req.params.channelId,
      messageId: req.body?.messageId,
    });
    res.json({ success: true, readState });
  });

  router.patch("/messages/:messageId", async (req, res) => {
    const message = await chat.editMessage({
      actorId: req.auth.user.id,
      projectId: req.params.projectId,
      messageId: req.params.messageId,
      body: req.body?.body,
    });
    res.json({ success: true, message });
  });

  router.delete("/messages/:messageId", async (req, res) => {
    const message = await chat.deleteMessage({
      actorId: req.auth.user.id,
      projectId: req.params.projectId,
      messageId: req.params.messageId,
    });
    res.json({ success: true, message });
  });

  router.post("/messages/:messageId/reactions", async (req, res) => {
    const reaction = await chat.addReaction({
      actorId: req.auth.user.id,
      projectId: req.params.projectId,
      messageId: req.params.messageId,
      emoji: req.body?.emoji,
    });
    res.json({ success: true, reaction });
  });

  router.delete("/messages/:messageId/reactions", async (req, res) => {
    const reaction = await chat.removeReaction({
      actorId: req.auth.user.id,
      projectId: req.params.projectId,
      messageId: req.params.messageId,
      emoji: req.body?.emoji ?? req.query.emoji,
    });
    res.json({ success: true, reaction });
  });

  return router;
}
