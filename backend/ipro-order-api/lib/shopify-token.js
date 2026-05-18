'use strict';

let cachedToken = null;
let cachedTokenExpiresAt = 0;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function getShopDomain() {
  const shop = requireEnv('SHOPIFY_SHOP').replace(/^https?:\/\//, '').replace(/\.myshopify\.com$/, '').trim();
  return `${shop}.myshopify.com`;
}

async function getShopifyAccessToken() {
  const now = Date.now();

  if (cachedToken && now < cachedTokenExpiresAt - 120_000) {
    return cachedToken;
  }

  const shopDomain = getShopDomain();
  const url = `https://${shopDomain}/admin/oauth/access_token`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: requireEnv('SHOPIFY_CLIENT_ID'),
      client_secret: requireEnv('SHOPIFY_CLIENT_SECRET'),
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.access_token) {
    console.error('Shopify token request failed:', {
      status: response.status,
      statusText: response.statusText,
      error: data.error,
      error_description: data.error_description,
    });

    throw new Error(data.error_description || data.error || 'Failed to get Shopify access token');
  }

  cachedToken = data.access_token;
  const expiresInSeconds = Number(data.expires_in || 23 * 60 * 60);
  cachedTokenExpiresAt = now + expiresInSeconds * 1000;

  return cachedToken;
}

module.exports = {
  getShopifyAccessToken,
  getShopDomain,
};
