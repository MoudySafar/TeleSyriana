import test from "node:test";
import assert from "node:assert/strict";

import { createShopifyAdminClient } from "../src/integrations/shopify-client.js";

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}

test("Shopify verification uses form-encoded client credentials and Admin GraphQL token header", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) {
      return jsonResponse({ access_token: "access-token", expires_in: 86399 });
    }
    return jsonResponse({
      data: {
        shop: {
          name: "iPro",
          myshopifyDomain: "ipro-test.myshopify.com",
        },
      },
    });
  };

  const client = createShopifyAdminClient({ fetchImpl, now: () => 1000 });
  const result = await client.verifyConfiguration({
    connection: { id: "shopify:test" },
    shopDomain: "ipro-test.myshopify.com",
    apiVersion: "2026-07",
    clientId: "client-id",
    clientSecret: "client-secret",
  });

  assert.equal(result.ok, true);
  assert.equal(calls[0].url, "https://ipro-test.myshopify.com/admin/oauth/access_token");
  assert.equal(calls[0].options.headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.equal(calls[0].options.body.get("grant_type"), "client_credentials");
  assert.equal(calls[0].options.body.get("client_id"), "client-id");
  assert.equal(calls[0].options.body.get("client_secret"), "client-secret");

  assert.equal(
    calls[1].url,
    "https://ipro-test.myshopify.com/admin/api/2026-07/graphql.json",
  );
  assert.equal(calls[1].options.headers["X-Shopify-Access-Token"], "access-token");
  assert.doesNotMatch(calls[1].options.body, /client-secret/);
});

test("Shopify access tokens are cached before expiry", async () => {
  let tokenCalls = 0;
  let graphqlCalls = 0;
  const fetchImpl = async (url) => {
    if (url.includes("/admin/oauth/access_token")) {
      tokenCalls += 1;
      return jsonResponse({ access_token: "cached-token", expires_in: 86399 });
    }
    graphqlCalls += 1;
    return jsonResponse({ data: { shop: { name: "iPro", myshopifyDomain: "ipro.myshopify.com" } } });
  };

  const client = createShopifyAdminClient({ fetchImpl, now: () => 1000 });
  const config = {
    connection: { id: "shopify:ipro" },
    shopDomain: "ipro.myshopify.com",
    apiVersion: "2026-07",
    clientId: "client-id",
    clientSecret: "client-secret",
  };

  await client.verifyConfiguration(config);
  await client.verifyConfiguration(config);

  assert.equal(tokenCalls, 1);
  assert.equal(graphqlCalls, 2);
});

test("verification rejects credentials that identify a different Shopify store", async () => {
  const fetchImpl = async (url) => {
    if (url.includes("/admin/oauth/access_token")) {
      return jsonResponse({ access_token: "token", expires_in: 86399 });
    }
    return jsonResponse({ data: { shop: { name: "Other", myshopifyDomain: "other.myshopify.com" } } });
  };

  const client = createShopifyAdminClient({ fetchImpl });

  await assert.rejects(
    client.verifyConfiguration({
      connection: { id: "shopify:test" },
      shopDomain: "expected.myshopify.com",
      apiVersion: "2026-07",
      clientId: "client-id",
      clientSecret: "client-secret",
    }),
    (error) => error.code === "SHOPIFY_SHOP_MISMATCH",
  );
});
