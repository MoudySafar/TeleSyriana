import { CAPABILITIES, hasCapability } from "../core/access-control.js";
import { createRepositories } from "../db/repositories.js";
import { createShopifyAdminClient } from "../integrations/shopify-client.js";

export function buildOrderSearchFilter(rawQuery) {
  const query = String(rawQuery || "").trim();
  if (!query) return "";

  if (/^#?\d{3,}$/.test(query)) {
    return `name:#${query.replace("#", "")}`;
  }

  if (query.includes("@")) {
    return `email:${query}`;
  }

  if (/^\+?[\d\s\-().]{7,}$/.test(query)) {
    return `phone:${query}`;
  }

  return query;
}

const ORDERS_QUERY = `
  query TeleSyrianaSearchOrders($query: String!) {
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

function orderAdminUrl(shopDomain, orderGid) {
  const storeHandle = String(shopDomain || "").replace(/\.myshopify\.com$/i, "");
  const orderId = String(orderGid || "").split("/").pop();
  if (!storeHandle || !orderId) return null;
  return `https://admin.shopify.com/store/${storeHandle}/orders/${orderId}`;
}

function formatOrder(node, shopDomain) {
  const lineItems = node?.lineItems?.edges ?? [];
  const fulfillments = node?.fulfillments ?? [];
  const refunds = node?.refunds ?? [];

  return {
    order: {
      id: node.id,
      number: node.name,
      createdAt: node.createdAt,
      paymentStatus: node.displayFinancialStatus,
      fulfillmentStatus: node.displayFulfillmentStatus,
      totalPaid: {
        amount: node.totalPriceSet?.shopMoney?.amount ?? null,
        currency: node.totalPriceSet?.shopMoney?.currencyCode ?? null,
      },
      cancelledAt: node.cancelledAt ?? null,
      cancelReason: node.cancelReason ?? null,
    },
    customer: {
      id: node.customer?.id ?? null,
      name: [node.customer?.firstName, node.customer?.lastName].filter(Boolean).join(" ") || null,
      email: node.customer?.email ?? null,
      phone: node.customer?.phone ?? null,
      numberOfOrders: node.customer?.numberOfOrders ?? null,
      amountSpent: {
        amount: node.customer?.amountSpent?.amount ?? null,
        currency: node.customer?.amountSpent?.currencyCode ?? null,
      },
    },
    shippingAddress: node.shippingAddress ?? null,
    billingAddress: node.billingAddress ?? null,
    items: lineItems.map(({ node: item }) => ({
      title: item.title,
      quantity: item.quantity,
      variant: item.variantTitle || item.variant?.title || null,
      sku: item.sku || item.variant?.sku || null,
      imageUrl: item.variant?.image?.url ?? null,
      productId: item.variant?.product?.id ?? null,
      productTitle: item.variant?.product?.title ?? null,
    })),
    fulfillments: fulfillments.map((fulfillment) => ({
      id: fulfillment.id,
      status: fulfillment.status,
      createdAt: fulfillment.createdAt,
      tracking: (fulfillment.trackingInfo ?? []).map((tracking) => ({
        number: tracking.number,
        url: tracking.url,
        company: tracking.company,
      })),
      items: (fulfillment.fulfillmentLineItems?.edges ?? []).map(({ node: item }) => ({
        title: item.lineItem?.title ?? null,
        quantity: item.quantity,
      })),
    })),
    refunds: refunds.map((refund) => ({
      id: refund.id,
      createdAt: refund.createdAt,
      items: (refund.refundLineItems?.edges ?? []).map(({ node: item }) => ({
        title: item.lineItem?.title ?? null,
        quantity: item.quantity,
        subtotal: item.subtotalSet?.shopMoney?.amount ?? null,
        currency: item.subtotalSet?.shopMoney?.currencyCode ?? null,
      })),
    })),
    adminUrl: orderAdminUrl(shopDomain, node.id),
  };
}

function forbidden() {
  const error = new Error("Forbidden: order search is not available for this project role");
  error.code = "FORBIDDEN";
  return error;
}

export function createShopifyOrderService({
  db,
  repositories = null,
  integrations,
  client = createShopifyAdminClient(),
} = {}) {
  if (!db && !repositories) {
    throw new TypeError("A database client or repositories are required");
  }
  if (!integrations) {
    throw new TypeError("A Shopify integration service is required");
  }

  const repo = repositories || createRepositories(db);

  return {
    async search({ actor, projectId, query }) {
      const queryUsed = buildOrderSearchFilter(query);
      if (!queryUsed) {
        const error = new Error("Order search query is required");
        error.code = "INVALID_INPUT";
        throw error;
      }

      const memberships = await repo.memberships.listForUser(actor.id);
      if (!hasCapability({
        user: actor,
        memberships,
        projectId,
        capability: CAPABILITIES.ORDERS_SEARCH,
      })) {
        throw forbidden();
      }

      const configuration = await integrations.resolveDefaultConfiguration(projectId);
      const data = await client.graphql(configuration, ORDERS_QUERY, { query: queryUsed });
      const orders = (data?.orders?.edges ?? []).map(({ node }) =>
        formatOrder(node, configuration.shopDomain),
      );

      return {
        projectId,
        connection: {
          id: configuration.connection.id,
          label: configuration.connection.label,
        },
        queryUsed,
        count: orders.length,
        orders,
      };
    },
  };
}

export { ORDERS_QUERY, formatOrder };
