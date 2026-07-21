import express from "express";

import { safeUser } from "../http-utils.js";
import { clearSessionCookie, setSessionCookie } from "../session.js";

export function createAuthRouter({ authentication, requireAuth, cookieName }) {
  if (!authentication || !requireAuth) {
    throw new TypeError("Authentication service and middleware are required");
  }

  const router = express.Router();

  router.post("/login", async (req, res) => {
    const result = await authentication.login({
      staffCode: req.body?.staffCode,
      secret: req.body?.secret,
    });

    setSessionCookie(res, {
      cookieName,
      token: result.token,
      expiresAt: result.session.expiresAt,
    });

    res.json({
      success: true,
      user: safeUser(result.user),
      mustResetLoginSecret: result.mustReset,
    });
  });

  router.post("/logout", requireAuth, async (req, res) => {
    await authentication.logout(req.auth.token);
    clearSessionCookie(res, { cookieName });
    res.json({ success: true });
  });

  router.post("/change-secret", requireAuth, async (req, res) => {
    await authentication.changeSecret({
      userId: req.auth.user.id,
      currentSecret: req.body?.currentSecret,
      nextSecret: req.body?.nextSecret,
    });
    clearSessionCookie(res, { cookieName });
    res.json({ success: true, reauthenticate: true });
  });

  return router;
}
