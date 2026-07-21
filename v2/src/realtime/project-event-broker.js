const CHANNEL = "telesyriana_events";

export function createProjectEventBroker(pool, { logger = console } = {}) {
  if (!pool || typeof pool.connect !== "function") {
    throw new TypeError("A PostgreSQL pool with connect() is required");
  }

  let client = null;
  let starting = null;
  let stopped = false;
  const listeners = new Map();

  function dispatch(event) {
    if (!event?.projectId) return;
    const projectListeners = listeners.get(event.projectId);
    if (!projectListeners) return;
    for (const listener of projectListeners) {
      try {
        listener(event);
      } catch (error) {
        logger.error?.("TeleSyriana realtime subscriber error:", error);
      }
    }
  }

  async function disconnectClient() {
    const current = client;
    client = null;
    if (!current) return;
    try {
      current.removeAllListeners("notification");
      current.removeAllListeners("error");
      current.release();
    } catch (error) {
      logger.error?.("TeleSyriana realtime release error:", error);
    }
  }

  async function start() {
    if (stopped) throw new Error("Realtime broker has been stopped");
    if (client) return client;
    if (starting) return starting;

    starting = (async () => {
      const nextClient = await pool.connect();
      nextClient.on("notification", (message) => {
        if (message.channel !== CHANNEL || !message.payload) return;
        try {
          dispatch(JSON.parse(message.payload));
        } catch (error) {
          logger.error?.("Invalid TeleSyriana realtime payload:", error);
        }
      });
      nextClient.on("error", async (error) => {
        logger.error?.("TeleSyriana realtime PostgreSQL connection error:", error);
        if (client === nextClient) await disconnectClient();
      });
      await nextClient.query(`LISTEN ${CHANNEL}`);
      client = nextClient;
      return nextClient;
    })();

    try {
      return await starting;
    } finally {
      starting = null;
    }
  }

  async function subscribe(projectId, listener) {
    if (!projectId || typeof listener !== "function") {
      throw new TypeError("projectId and listener are required");
    }
    await start();
    if (!listeners.has(projectId)) listeners.set(projectId, new Set());
    listeners.get(projectId).add(listener);

    return () => {
      const projectListeners = listeners.get(projectId);
      if (!projectListeners) return;
      projectListeners.delete(listener);
      if (projectListeners.size === 0) listeners.delete(projectId);
    };
  }

  async function stop() {
    stopped = true;
    listeners.clear();
    await disconnectClient();
  }

  return {
    channel: CHANNEL,
    start,
    subscribe,
    stop,
    get subscriberCount() {
      let count = 0;
      for (const group of listeners.values()) count += group.size;
      return count;
    },
  };
}
