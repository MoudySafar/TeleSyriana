export function safeUser(user) {
  return {
    id: user.id,
    staffCode: user.staffCode,
    displayName: user.displayName,
    email: user.email ?? null,
    platformRole: user.platformRole,
    status: user.status,
    locale: user.locale ?? "en",
    theme: user.theme ?? "system",
  };
}

export function statusForError(error) {
  if (error?.code === "UNAUTHENTICATED" || error?.code === "INVALID_CREDENTIALS") return 401;
  if (error?.code === "FORBIDDEN") return 403;
  if (error?.code === "NOT_FOUND") return 404;
  if (error?.code === "INVALID_INPUT" || error?.code === "23514") return 400;
  if (error?.code === "AUTH_LOCKED") return 429;
  if (error?.code === "CONFLICT" || error?.code === "23505") return 409;
  if (["SHOPIFY_AUTH_ERROR", "SHOPIFY_SHOP_MISMATCH", "SHOPIFY_VERIFY_ERROR"].includes(error?.code)) return 422;
  if (["SHOPIFY_NETWORK_ERROR", "SHOPIFY_API_ERROR", "SHOPIFY_GRAPHQL_ERROR"].includes(error?.code)) return 502;
  return 500;
}

export function sendError(error, res) {
  const status = statusForError(error);
  if (status >= 500) console.error("TeleSyriana V2 API error:", error);
  res.status(status).json({
    success: false,
    error: status >= 500 ? "Internal server error" : error.message,
    code: error?.code ?? null,
  });
}
