import { randomUUID } from "node:crypto";

import { createAuthRepository } from "../auth/auth-repository.js";
import { hashLoginSecret } from "../auth/crypto.js";
import { PLATFORM_ROLES } from "../core/access-control.js";
import { withTransaction } from "../db/postgres.js";
import { createRepositories } from "../db/repositories.js";

function required(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

export async function bootstrapFirstCeo({
  pool,
  staffCode,
  displayName,
  email = null,
  secret,
  locale = "en",
  theme = "system",
  runInTransaction = withTransaction,
} = {}) {
  if (!pool) throw new TypeError("A database pool is required");

  const normalizedStaffCode = required(staffCode, "staffCode");
  const normalizedName = required(displayName, "displayName");
  const temporaryCredential = await hashLoginSecret(secret);

  return runInTransaction(pool, async (db) => {
    const repositories = createRepositories(db);
    const auth = createAuthRepository(db);

    const existing = await repositories.users.findByStaffCode(normalizedStaffCode);
    if (existing) {
      const error = new Error(`Staff code already exists: ${normalizedStaffCode}`);
      error.code = "ALREADY_EXISTS";
      throw error;
    }

    const user = await repositories.users.create({
      id: `user:${randomUUID()}`,
      staffCode: normalizedStaffCode,
      displayName: normalizedName,
      email: email ? String(email).trim() : null,
      platformRole: PLATFORM_ROLES.CEO,
      locale,
      theme,
    });

    await auth.upsertCredential({
      userId: user.id,
      secretHash: temporaryCredential.hash,
      secretSalt: temporaryCredential.salt,
      mustReset: true,
    });

    await repositories.audit.append({
      actorUserId: null,
      projectId: null,
      action: "system.bootstrap_ceo",
      targetType: "user",
      targetId: user.id,
      metadata: { staffCode: normalizedStaffCode },
    });

    return {
      user,
      mustResetLoginSecret: true,
    };
  });
}
