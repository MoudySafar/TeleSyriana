import { randomUUID } from "node:crypto";

import {
  createSessionToken,
  hashLoginSecret,
  hashSessionToken,
  verifyLoginSecret,
} from "./crypto.js";

function authError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function invalidCredentials() {
  return authError("Invalid staff code or login secret", "INVALID_CREDENTIALS");
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60_000);
}

function addHours(date, hours) {
  return new Date(date.getTime() + hours * 3_600_000);
}

export function createAuthenticationService({
  users,
  auth,
  clock = () => new Date(),
  maxFailedAttempts = 5,
  lockMinutes = 15,
  sessionHours = 12,
} = {}) {
  if (!users || !auth) {
    throw new TypeError("User and authentication repositories are required");
  }

  return {
    async setTemporarySecret({ userId, secret }) {
      const user = await users.findById(userId);
      if (!user) throw authError(`User not found: ${userId}`, "NOT_FOUND");

      const { hash, salt } = await hashLoginSecret(secret);
      const credential = await auth.upsertCredential({
        userId,
        secretHash: hash,
        secretSalt: salt,
        mustReset: true,
      });
      await auth.revokeAllUserSessions(userId);
      return credential;
    },

    async changeSecret({ userId, currentSecret, nextSecret }) {
      const user = await users.findById(userId);
      if (!user || user.status !== "active") throw invalidCredentials();

      const credential = await auth.findCredential(userId);
      if (!credential) throw invalidCredentials();

      const valid = await verifyLoginSecret(currentSecret, {
        hash: credential.secretHash,
        salt: credential.secretSalt,
      });
      if (!valid) throw invalidCredentials();

      const { hash, salt } = await hashLoginSecret(nextSecret);
      const updated = await auth.upsertCredential({
        userId,
        secretHash: hash,
        secretSalt: salt,
        mustReset: false,
      });
      await auth.revokeAllUserSessions(userId);
      return updated;
    },

    async login({ staffCode, secret }) {
      const now = clock();
      const user = await users.findByStaffCode(String(staffCode || "").trim());
      if (!user || user.status !== "active") throw invalidCredentials();

      const credential = await auth.findCredential(user.id);
      if (!credential) throw invalidCredentials();

      if (credential.lockedUntil && new Date(credential.lockedUntil) > now) {
        throw authError("Account temporarily locked after repeated failed logins", "AUTH_LOCKED");
      }

      const valid = await verifyLoginSecret(secret, {
        hash: credential.secretHash,
        salt: credential.secretSalt,
      });

      if (!valid) {
        await auth.recordFailedAttempt({
          userId: user.id,
          maxAttempts: maxFailedAttempts,
          lockUntil: addMinutes(now, lockMinutes),
        });
        throw invalidCredentials();
      }

      await auth.resetFailures(user.id);

      const { token, tokenHash } = createSessionToken();
      const session = await auth.createSession({
        id: `session:${randomUUID()}`,
        userId: user.id,
        tokenHash,
        expiresAt: addHours(now, sessionHours),
      });

      return {
        token,
        session,
        user,
        mustReset: Boolean(credential.mustReset),
      };
    },

    async authenticateSession(token) {
      if (!token) throw authError("Authentication required", "UNAUTHENTICATED");

      const tokenHash = hashSessionToken(token);
      const session = await auth.findActiveSessionByTokenHash(tokenHash);
      if (!session) throw authError("Session expired or invalid", "UNAUTHENTICATED");

      const user = await users.findById(session.userId);
      if (!user || user.status !== "active") {
        await auth.revokeSessionByTokenHash(tokenHash);
        throw authError("Session expired or invalid", "UNAUTHENTICATED");
      }

      await auth.touchSession(session.id);
      return { user, session };
    },

    async logout(token) {
      if (!token) return null;
      return auth.revokeSessionByTokenHash(hashSessionToken(token));
    },
  };
}
