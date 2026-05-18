'use strict';

const express = require('express');
const { getShopifyAccessToken, getShopDomain } = require('../lib/shopify-token');

const router = express.Router();

function authenticate(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key || key !== process.env.API_SECRET_KEY) {
    return res.status(401).json({ success: false, error: 'Unauthorised' });
  }
  next();
}

function buildSearchFilter(rawQuery) {
  const q = String(rawQuery || '').trim();

  if (/^#?\d{3,}$/.test(q)) {
    return `name:#${q.replace('#', '')}`;
  }

  if (q.includes('@')) {
    return `email:${q}`;
  }

  if (/^\+?[\d\s\-().]{7,}$/.test(q)) {
    return `phone:${q}`;
  }

  return q;
}

const ORDERS_QUERY = `
  query SearchOrders($query: String!) {
    orders(first: 10, query: $query, sortKey: CREATED_AT, reverse: true) {
      edges {
        node {
          id
          name
          createdAt
          displayFinancialStatus
          displayFulfillmentStatus
          cancelledAt
          cancelReason
          totalPriceSet {
            shopMoney { amount currencyCode }
          }
          customer {
            id
            firstName
            lastName
            email
            phone
            numberOfOrders
            amountSpent { amount currencyCode }
          }
          shippingAddress {
            firstName lastName company
            address1 address2
            city province zip country
            phone
          }
          billingAddress {
            firstName lastName company
            address1 address2
            city province zip country
            phone
          }
          lineItems(first: 50) {
            edges {
              node {
                title
                quantity
                variantTitle
                sku
                variant {
                  id
                  title
                  sku
                  image { url }
                  product { id title }
                }
              }
            }
          }
          fulfillments {
            id
            status
            createdAt
            trackingInfo {
              number
              url
              company
            }
            fulfillmentLineItems(first: 50) {
              edges {
                node {
                  quantity
                  lineItem { title }
                }
              }
            }
          }
          refunds {
            id
            createdAt
            refundLineItems(first: 50) {
              edges {
                node {
                  quantity
                  lineItem { title }
                  subtotalSet { shopMoney { amount currencyCode } }
                }
              }
            }
          }
        }
      }
    }
  }
`;

function shopifyAdminLink(orderGid) {
  const storeHandle = getShopDomain().replace('.myshopify.com', '');
  const orderId = String(orderGid || '').split('/').pop();
  return `https://admin.shopify.com/store/${storeHandle}/orders/${orderId}`;
}

function formatOrder(node) {
  const lineItems = node.lineItems?.edges ?? [];
  const fulfillments = node.fulfillments ?? [];
  const refunds = node.refunds ?? [];

  return {
    order: {
      id: node.id,
      number: node.name,
      created_at: node.createdAt,
      payment_status: node.displayFinancialStatus,
      fulfillment_status: node.displayFulfillmentStatus,
      total_paid: {
        amount: node.totalPriceSet?.shopMoney?.amount ?? null,
        currency: node.totalPriceSet?.shopMoney?.currencyCode ?? null,
      },
      cancelled_at: node.cancelledAt ?? null,
      cancel_reason: node.cancelReason ?? null,
    },
    customer: {
      id: node.customer?.id ?? null,
      name: [node.customer?.firstName, node.customer?.lastName].filter(Boolean).join(' ') || null,
      email: node.customer?.email ?? null,
      phone: node.customer?.phone ?? null,
      number_of_orders: node.customer?.numberOfOrders ?? null,
      amount_spent: {
        amount: node.customer?.amountSpent?.amount ?? null,
        currency: node.customer?.amountSpent?.currencyCode ?? null,
      },
    },
    shipping_address: node.shippingAddress ?? null,
    billing_address: node.billingAddress ?? null,
    items: lineItems.map(({ node: item }) => ({
      title: item.title,
      quantity: item.quantity,
      variant: item.variantTitle || item.variant?.title || null,
      sku: item.sku || item.variant?.sku || null,
      image_url: item.variant?.image?.url ?? null,
      product_id: item.variant?.product?.id ?? null,
      product_title: item.variant?.product?.title ?? null,
    })),
    fulfillments: fulfillments.map(f => ({
      id: f.id,
      status: f.status,
      created_at: f.createdAt,
      tracking: (f.trackingInfo ?? []).map(t => ({
        number: t.number,
        url: t.url,
        company: t.company,
      })),
      items: (f.fulfillmentLineItems?.edges ?? []).map(({ node: fi }) => ({
        title: fi.lineItem?.title ?? null,
        quantity: fi.quantity,
      })),
    })),
    refunds: refunds.map(r => ({
      id: r.id,
      created_at: r.createdAt,
      items: (r.refundLineItems?.edges ?? []).map(({ node: ri }) => ({
        title: ri.lineItem?.title ?? null,
        quantity: ri.quantity,
        subtotal: ri.subtotalSet?.shopMoney?.amount ?? null,
        currency: ri.subtotalSet?.shopMoney?.currencyCode ?? null,
      })),
    })),
    admin_url: shopifyAdminLink(node.id),
  };
}

router.get('/search-orders', authenticate, async (req, res) => {
  const q = String(req.query.q || '').trim();

  if (!q) {
    return res.status(400).json({
      success: false,
      error: 'Missing required query param: q',
    });
  }

  const queryUsed = buildSearchFilter(q);
  const apiVersion = process.env.SHOPIFY_API_VERSION || '2026-04';
  const shopDomain = getShopDomain();
  const url = `https://${shopDomain}/admin/api/${apiVersion}/graphql.json`;

  let accessToken;
  try {
    accessToken = await getShopifyAccessToken();
  } catch (err) {
    return res.status(502).json({
      success: false,
      error: 'Could not get Shopify access token',
      details: err.message,
    });
  }

  let shopifyResponse;
  try {
    shopifyResponse = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify({
        query: ORDERS_QUERY,
        variables: { query: queryUsed },
      }),
    });
  } catch (networkErr) {
    console.error('Network error reaching Shopify:', networkErr);
    return res.status(502).json({ success: false, error: 'Failed to reach Shopify API' });
  }

  const data = await shopifyResponse.json().catch(() => null);

  if (!data) {
    return res.status(502).json({ success: false, error: 'Invalid JSON response from Shopify' });
  }

  if (!shopifyResponse.ok || data.errors) {
    return res.status(422).json({
      success: false,
      error: 'Shopify GraphQL error',
      status: shopifyResponse.status,
      graphql_errors: data.errors ?? null,
      raw: data,
    });
  }

  const orders = (data?.data?.orders?.edges ?? []).map(({ node }) => formatOrder(node));

  return res.json({
    success: true,
    count: orders.length,
    query_used: queryUsed,
    orders,
  });
});

module.exports = router;
