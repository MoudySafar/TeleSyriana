import express from "express";

const EVENT_CAPABILITY = Object.freeze({
  ticket: "tickets.search",
  ticket_comment: "tickets.search",
  chat_message: "chat.read",
  chat_reaction: "chat.read",
  job: "jobs.apply",
});

function canReceiveEvent(workspaceContext, event) {
  const required = EVENT_CAPABILITY[event?.entityType];
  if (!required) return true;
  if (required === "jobs.apply") {
    return Boolean(
      workspaceContext.capabilities?.["jobs.apply"] ||
      workspaceContext.capabilities?.["jobs.manage"],
    );
  }
  return Boolean(workspaceContext.capabilities?.[required]);
}

function writeSse(res, { event = "message", id = null, data }) {
  if (id != null) res.write(`id: ${String(id).replaceAll("\n", "")}\n`);
  res.write(`event: ${String(event).replaceAll("\n", "")}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function createRealtimeRouter({ broker, workspace }) {
  if (!broker || !workspace) {
    throw new TypeError("Realtime broker and workspace service are required");
  }

  const router = express.Router({ mergeParams: true });

  router.get("/", async (req, res, next) => {
    try {
      const projectId = req.params.projectId;
      const workspaceContext = await workspace.get({
        user: req.auth.user,
        projectId,
      });

      res.status(200);
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders?.();

      let closed = false;
      const unsubscribe = await broker.subscribe(projectId, (event) => {
        if (closed || !canReceiveEvent(workspaceContext, event)) return;
        writeSse(res, {
          event: "project-change",
          id: event.at || Date.now(),
          data: event,
        });
      });

      writeSse(res, {
        event: "connected",
        data: { projectId, at: new Date().toISOString() },
      });

      const heartbeat = setInterval(() => {
        if (closed) return;
        res.write(`: keepalive ${Date.now()}\n\n`);
        // If the dedicated LISTEN connection dropped, start() re-establishes it
        // while keeping the existing subscriber map intact.
        broker.start().catch(() => {});
      }, 20_000);
      heartbeat.unref?.();

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe?.();
      };
      req.on("close", cleanup);
      req.on("aborted", cleanup);
      res.on("close", cleanup);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export { canReceiveEvent };
