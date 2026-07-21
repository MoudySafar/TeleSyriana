import { bootstrapFirstCeo } from "../src/bootstrap/bootstrap-ceo.js";
import { createPostgresPool } from "../src/db/postgres.js";

const pool = createPostgresPool();

try {
  const result = await bootstrapFirstCeo({
    pool,
    staffCode: process.env.BOOTSTRAP_CEO_STAFF_CODE,
    displayName: process.env.BOOTSTRAP_CEO_NAME,
    email: process.env.BOOTSTRAP_CEO_EMAIL || null,
    secret: process.env.BOOTSTRAP_CEO_SECRET,
    locale: process.env.BOOTSTRAP_CEO_LOCALE || "en",
    theme: process.env.BOOTSTRAP_CEO_THEME || "system",
  });

  console.log(`Created TeleSyriana CEO account ${result.user.staffCode} (${result.user.displayName}).`);
  console.log("The CEO must reset the temporary login secret after first login.");
} finally {
  await pool.end();
}
