import { withTransaction } from "../db/postgres.js";
import { createProfileRepository } from "./profile-repository.js";

const LOCALES = new Set(["en", "ar"]);
const THEMES = new Set(["light", "dark", "system"]);

function invalidInput(message) {
  const error = new Error(message);
  error.code = "INVALID_INPUT";
  return error;
}

export function createProfileService({
  pool,
  runInTransaction = withTransaction,
  repositoryFactory = createProfileRepository,
} = {}) {
  if (!pool) throw new TypeError("A database pool is required");

  return {
    async updatePreferences({ userId, locale, theme }) {
      const normalizedLocale = String(locale || "").trim();
      const normalizedTheme = String(theme || "").trim();
      if (!LOCALES.has(normalizedLocale)) {
        throw invalidInput(`Unsupported locale: ${normalizedLocale}`);
      }
      if (!THEMES.has(normalizedTheme)) {
        throw invalidInput(`Unsupported theme: ${normalizedTheme}`);
      }

      return runInTransaction(pool, async (db) => {
        const profile = await repositoryFactory(db).updatePreferences({
          userId,
          locale: normalizedLocale,
          theme: normalizedTheme,
        });
        if (!profile) {
          const error = new Error("Active employee profile not found");
          error.code = "NOT_FOUND";
          throw error;
        }
        return profile;
      });
    },
  };
}

export { LOCALES, THEMES };
