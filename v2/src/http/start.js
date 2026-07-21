import { createPostgresPool } from "../db/postgres.js";
import { createApp } from "./app.js";

const port = Number(process.env.PORT || 4000);
const pool = createPostgresPool();
const app = createApp({ pool });

const server = app.listen(port, () => {
  console.log(`TeleSyriana V2 API listening on port ${port}`);
});

async function shutdown(signal) {
  console.log(`TeleSyriana V2 received ${signal}; shutting down.`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
