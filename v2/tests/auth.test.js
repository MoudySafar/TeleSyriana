import test from "node:test";
import assert from "node:assert/strict";

import { createAuthenticationService } from "../src/auth/auth-service.js";
import {
  hashLoginSecret,
  hashSessionToken,
  validateLoginSecret,
  verifyLoginSecret,
} from "../src/auth/crypto.js";

function fakeRepositories() {
  const usersById = new Map([
    ["reema", { id: "reema", staffCode: "1042", displayName: "Reema", status: "active", platformRole: "member" }],
  ]);
  const credentials = new Map();
  const sessions = new Map();

  const users = {
    async findById(id) { return usersById.get(id) ?? null; },
    async findByStaffCode(staffCode) {
      return [...usersById.values()].find((user) => user.staffCode === staffCode) ?? null;
    },
  };

  const auth = {
    async findCredential(userId) { return credentials.get(userId) ?? null; },
    async upsertCredential({ userId, secretHash, secretSalt, mustReset }) {
      const value = {
        userId,
        secretHash,
        secretSalt,
        mustReset,
        failedAttempts: 0,
        lockedUntil: null,
      };
      credentials.set(userId, value);
      return value;
    },
    async recordFailedAttempt({ userId, maxAttempts, lockUntil }) {
      const current = credentials.get(userId);
      const failedAttempts = current.failedAttempts + 1;
      const value = {
        ...current,
        failedAttempts,
        lockedUntil: failedAttempts >= maxAttempts ? lockUntil : current.lockedUntil,
      };
      credentials.set(userId, value);
      return value;
    },
    async resetFailures(userId) {
      const value = { ...credentials.get(userId), failedAttempts: 0, lockedUntil: null };
      credentials.set(userId, value);
      return value;
    },
    async createSession(session) {
      const value = { ...session, revokedAt: null };
      sessions.set(session.tokenHash, value);
      return value;
    },
    async findActiveSessionByTokenHash(tokenHash) {
      const session = sessions.get(tokenHash);
      if (!session || session.revokedAt) return null;
      return session;
    },
    async touchSession(sessionId) {
      return [...sessions.values()].find((session) => session.id === sessionId) ?? null;
    },
    async revokeSessionByTokenHash(tokenHash) {
      const current = sessions.get(tokenHash);
      if (!current) return null;
      const value = { ...current, revokedAt: new Date() };
      sessions.set(tokenHash, value);
      return value;
    },
    async revokeAllUserSessions(userId) {
      const revoked = [];
      for (const [tokenHash, session] of sessions) {
        if (session.userId === userId && !session.revokedAt) {
          const value = { ...session, revokedAt: new Date() };
          sessions.set(tokenHash, value);
          revoked.push(value);
        }
      }
      return revoked;
    },
  };

  return { users, auth, state: { usersById, credentials, sessions } };
}

test("credential hashing verifies the correct secret and rejects the wrong one", async () => {
  const credential = await hashLoginSecret("StrongPass123");

  assert.equal(await verifyLoginSecret("StrongPass123", credential), true);
  assert.equal(await verifyLoginSecret("WrongPass123", credential), false);
});

test("weak four digit PINs are rejected while six digit PINs are allowed", () => {
  assert.throws(() => validateLoginSecret("2411"), /at least 6 digits/);
  assert.equal(validateLoginSecret("241155"), "241155");
});

test("successful login returns a raw token but stores only its hash", async () => {
  const repositories = fakeRepositories();
  const service = createAuthenticationService({
    users: repositories.users,
    auth: repositories.auth,
    clock: () => new Date("2026-07-21T17:00:00.000Z"),
  });

  await service.setTemporarySecret({ userId: "reema", secret: "241155" });
  const result = await service.login({ staffCode: "1042", secret: "241155" });

  assert.ok(result.token.length > 20);
  assert.equal(result.mustReset, true);
  assert.equal(repositories.state.sessions.has(result.token), false);
  assert.equal(repositories.state.sessions.has(hashSessionToken(result.token)), true);
});

test("repeated failed logins temporarily lock the credential", async () => {
  const repositories = fakeRepositories();
  let now = new Date("2026-07-21T17:00:00.000Z");
  const service = createAuthenticationService({
    users: repositories.users,
    auth: repositories.auth,
    clock: () => now,
    maxFailedAttempts: 2,
    lockMinutes: 15,
  });

  await service.setTemporarySecret({ userId: "reema", secret: "241155" });

  await assert.rejects(service.login({ staffCode: "1042", secret: "999999" }), /Invalid staff code/);
  await assert.rejects(service.login({ staffCode: "1042", secret: "999999" }), /Invalid staff code/);

  const credential = repositories.state.credentials.get("reema");
  assert.equal(credential.failedAttempts, 2);
  assert.ok(credential.lockedUntil > now);

  await assert.rejects(
    service.login({ staffCode: "1042", secret: "241155" }),
    (error) => error.code === "AUTH_LOCKED",
  );

  now = new Date("2026-07-21T17:16:00.000Z");
  const result = await service.login({ staffCode: "1042", secret: "241155" });
  assert.equal(result.user.id, "reema");
});

test("disabled employee cannot establish or keep a session", async () => {
  const repositories = fakeRepositories();
  const service = createAuthenticationService({ users: repositories.users, auth: repositories.auth });

  await service.setTemporarySecret({ userId: "reema", secret: "StrongPass123" });
  const login = await service.login({ staffCode: "1042", secret: "StrongPass123" });

  repositories.state.usersById.set("reema", {
    ...repositories.state.usersById.get("reema"),
    status: "disabled",
  });

  await assert.rejects(
    service.authenticateSession(login.token),
    (error) => error.code === "UNAUTHENTICATED",
  );
  assert.ok(repositories.state.sessions.get(hashSessionToken(login.token)).revokedAt);
});
