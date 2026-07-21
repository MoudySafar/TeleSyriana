import express from "express";

import { safeUser } from "../http-utils.js";

export function createProfileRouter({ profile, requireAuth }) {
  if (!profile || !requireAuth) {
    throw new TypeError("Profile service and authentication middleware are required");
  }

  const router = express.Router();

  router.patch("/preferences", requireAuth, async (req, res) => {
    const user = await profile.updatePreferences({
      userId: req.auth.user.id,
      locale: req.body?.locale,
      theme: req.body?.theme,
    });
    res.json({ success: true, user: safeUser(user) });
  });

  return router;
}
