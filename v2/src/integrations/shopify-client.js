const TOKEN_REFRESH_SAFETY_MS = 120_000;

function shopifyError(message, code, details = null) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

export function createShopifyAdminClient({
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("A fetch implementation is required");
  }

  const tokenCache = new Map();

  async function getAccessToken(config) {
    const cacheKey = `${config.connection?.id || config.shopDomain}:${config.clientId}`;
    const cached = tokenCache.get(cacheKey);
    if (cached && now() < cached.expiresAt - TOKEN_REFRESH_SAFETY_MS) {
      return cached.accessToken;
    }

    const tokenUrl = `https://${config.shopDomain}/admin/oauth/access_token`;
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.clientId,
      client_secret: config.clientSecret,
    });

    let response;
    try {
      response = await fetchImpl(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
    } catch (error) {
      throw shopifyError("Could not reach Shopify token endpoint", "SHOPIFY_NETWORK_ERROR", error.message);
    }

    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.access_token) {
      throw shopifyError(
        "Shopify client credentials were rejected",
        "SHOPIFY_AUTH_ERROR",
        { status: response.status, error: data?.error ?? null, description: data?.error_description ?? null },
      );
    }

    const expiresInSeconds = Number(data.expires_in || 86_399);
    tokenCache.set(cacheKey, {
      accessToken: data.access_token,
      expiresAt: now() + expiresInSeconds * 1000,
    });

    return data.access_token;
  }

  async function graphql(config, query, variables = {}) {
    const accessToken = await getAccessToken(config);
    const endpoint = `https://${config.shopDomain}/admin/api/${config.apiVersion}/graphql.json`;

    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
        body: JSON.stringify({ query, variables }),
      });
    } catch (error) {
      throw shopifyError("Could not reach Shopify Admin API", "SHOPIFY_NETWORK_ERROR", error.message);
    }

    const data = await response.json().catch(() => null);
    if (!response.ok || !data) {
      throw shopifyError(
        "Shopify Admin API returned an invalid response",
        "SHOPIFY_API_ERROR",
        { status: response.status },
      );
    }

    if (data.errors?.length) {
      throw shopifyError("Shopify GraphQL request failed", "SHOPIFY_GRAPHQL_ERROR", data.errors);
    }

    return data.data;
  }

  return {
    getAccessToken,
    graphql,

    async verifyConfiguration(config) {
      const data = await graphql(
        config,
        `query TeleSyrianaVerifyShopifyConnection {
          shop {
            name
            myshopifyDomain
          }
        }`,
      );

      const shop = data?.shop;
      if (!shop?.myshopifyDomain) {
        throw shopifyError("Shopify verification returned no shop identity", "SHOPIFY_VERIFY_ERROR");
      }

      if (String(shop.myshopifyDomain).toLowerCase() !== String(config.shopDomain).toLowerCase()) {
        throw shopifyError(
          "Shopify credentials belong to a different shop",
          "SHOPIFY_SHOP_MISMATCH",
          { expected: config.shopDomain, actual: shop.myshopifyDomain },
        );
      }

      return {
        ok: true,
        shop: {
          name: shop.name,
          myshopifyDomain: shop.myshopifyDomain,
        },
      };
    },

    clearTokenCache() {
      tokenCache.clear();
    },
  };
}
