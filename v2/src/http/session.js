export const DEFAULT_COOKIE_NAME = "ts_session";

export function parseCookies(header = "") {
  const output = {};
  for (const entry of String(header).split(";")) {
    const separator = entry.indexOf("=");
    if (separator < 0) continue;
    const key = entry.slice(0, separator).trim();
    const rawValue = entry.slice(separator + 1).trim();
    if (!key) continue;
    try {
      output[key] = decodeURIComponent(rawValue);
    } catch {
      output[key] = rawValue;
    }
  }
  return output;
}

export function getSessionToken(req, cookieName = DEFAULT_COOKIE_NAME) {
  const authorization = String(req.headers.authorization || "");
  if (authorization.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim();
  }
  return parseCookies(req.headers.cookie)[cookieName] || null;
}

export function cookieSecure(env = process.env) {
  if (env.COOKIE_SECURE === "false") return false;
  if (env.COOKIE_SECURE === "true") return true;
  return env.NODE_ENV === "production";
}

export function setSessionCookie(res, {
  cookieName = DEFAULT_COOKIE_NAME,
  token,
  expiresAt,
  env = process.env,
}) {
  const expires = new Date(expiresAt);
  const parts = [
    `${cookieName}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${expires.toUTCString()}`,
  ];
  if (cookieSecure(env)) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

export function clearSessionCookie(res, {
  cookieName = DEFAULT_COOKIE_NAME,
  env = process.env,
} = {}) {
  const parts = [
    `${cookieName}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "Max-Age=0",
  ];
  if (cookieSecure(env)) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}
