import { createPostgresPool } from "../db/postgres.js";
import { createTeleSyrianaPlatformV2 } from "./platform-v2.js";

const pool = createPostgresPool();
const { app, broker } = createTeleSyrianaPlatformV2({ pool });
const port = Number(process.env.PORT || 4000);

const server = app.listen(port, () => {
  console.log(`TeleSyriana V2 staging platform listening on port ${port}`);
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
