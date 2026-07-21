import { createPostgresPool } from "../db/postgres.js";
import { createTeleSyrianaV2App } from "./app-v2.js";

const pool = createPostgresPool();
const app = createTeleSyrianaV2App({ pool });
const port = Number(process.env.PORT || 4000);

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
