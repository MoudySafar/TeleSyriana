import { createPostgresPool } from "../db/postgres.js";
import { createCandidatePlatform } from "./candidate-platform.js";

const pool = createPostgresPool();
const { app, broker } = createCandidatePlatform({ pool });
const port = Number(process.env.PORT || 4000);

const server = app.listen(port, () => {
  console.log(`TeleSyriana V2 candidate platform listening on port ${port}`);
});

async function shutdown(signal) {
  console.log(`TeleSyriana V2 received ${signal}; shutting down.`);
  server.close(async () => {
    try {
      await broker.stop();
    } finally {
      await pool.end();
      process.exit(0);
    }
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
