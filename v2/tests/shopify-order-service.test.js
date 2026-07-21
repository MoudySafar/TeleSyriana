import test from "node:test";
import assert from "node:assert/strict";

import { PLATFORM_ROLES, PROJECT_ROLES } from "../src/core/access-control.js";
import {
  buildOrderSearchFilter,
  createShopifyOrderService,
} from "../src/orders/shopify-order-service.js";

function repositories() {
  const memberships = [
    { userId: "agent", projectId: "ipro", role: PROJECT_ROLES.AGENT, status: "active" },
    { userId: "supervisor", projectId: "ipro", role: PROJECT_ROLES.SUPERVISOR, status: "active" },
    { userId: "manager", projectId: "ipro", role: PROJECT_ROLES.MANAGER, status: "active" },
  ];
  return {
    memberships: {
      async listForUser(userId) {
        return memberships.filter((item) => item.userId === userId);
      },
    },
  };
}

function orderNode() {
  return {
    id: "gid://shopify/Order/12345",
    name: "#2515",
    createdAt: "2026-07-21T12:00:00Z",
    displayFinancialStatus: "PAID",
    displayFulfillmentStatus: "FULFILLED",
    cancelledAt: null,
    cancelReason: null,
    totalPriceSet: { shopMoney: { amount: "49.99", currencyCode: "GBP" } },
    customer: {
      id: "gid://shopify/Customer/1",
      firstName: "Test",
      lastName: "Customer",
      email: "customer@example.com",
      phone: "+441234567890",
      numberOfOrders: 2,
      amountSpent: { amount: "99.98", currencyCode: "GBP" },
    },
    shippingAddress: null,
    billingAddress: null,
    lineItems: {
      edges: [
        {
          node: {
            title: "Apple Pencil",
            quantity: 1,
            variantTitle: "USB-C",
            sku: "PENCIL-USBC",
            variant: null,
          },
        },
      ],
    },
    fulfillments: [],
    refunds: [],
  };
}

function serviceFor({ actor, resolvedProject = "ipro" }) {
  const integrationCalls = [];
  const graphqlCalls = [];
  const integrations = {
    async resolveDefaultConfiguration(projectId) {
      integrationCalls.push(projectId);
      return {
        connection: { id: `shopify:${projectId}:default`, label: `${projectId} Shopify` },
        shopDomain: `${resolvedProject}.myshopify.com`,
        apiVersion: "2026-07",
        clientId: "client-id",
        clientSecret: "client-secret",
      };
    },
  };
  const client = {
    async graphql(config, query, variables) {
      graphqlCalls.push({ config, query, variables });
      return { orders: { edges: [{ node: orderNode() }] } };
    },
  };

  const service = createShopifyOrderService({
    repositories: repositories(),
    integrations,
    client,
  });
  return { service, actor, integrationCalls, graphqlCalls };
}

test("order search normalizes order numbers email phone and free text", () => {
  assert.equal(buildOrderSearchFilter("#2515"), "name:#2515");
  assert.equal(buildOrderSearchFilter("2515"), "name:#2515");
  assert.equal(buildOrderSearchFilter("customer@example.com"), "email:customer@example.com");
  assert.equal(buildOrderSearchFilter("+44 1234 567890"), "phone:+44 1234 567890");
  assert.equal(buildOrderSearchFilter("Test Customer"), "Test Customer");
});

test("iPro Agent searches through the iPro default Shopify connection", async () => {
  const actor = { id: "agent", platformRole: PLATFORM_ROLES.MEMBER, status: "active" };
  const { service, integrationCalls, graphqlCalls } = serviceFor({ actor, resolvedProject: "ipro-store" });

  const result = await service.search({ actor, projectId: "ipro", query: "#2515" });

  assert.deepEqual(integrationCalls, ["ipro"]);
  assert.equal(graphqlCalls[0].variables.query, "name:#2515");
  assert.equal(result.connection.id, "shopify:ipro:default");
  assert.equal(result.orders[0].order.number, "#2515");
  assert.equal(result.orders[0].customer.email, "customer@example.com");
  assert.equal(
    result.orders[0].adminUrl,
    "https://admin.shopify.com/store/ipro-store/orders/12345",
  );
});

test("HR project visibility does not grant customer order search access", async () => {
  const actor = { id: "hr", platformRole: PLATFORM_ROLES.HR, status: "active" };
  const { service, integrationCalls } = serviceFor({ actor });

  await assert.rejects(
    service.search({ actor, projectId: "ipro", query: "#2515" }),
    (error) => error.code === "FORBIDDEN",
  );
  assert.deepEqual(integrationCalls, []);
});

test("CEO can search a selected project using only that project's default connection", async () => {
  const actor = { id: "ceo", platformRole: PLATFORM_ROLES.CEO, status: "active" };
  const { service, integrationCalls } = serviceFor({ actor, resolvedProject: "kiddio-store" });

  const result = await service.search({ actor, projectId: "kiddio", query: "2515" });

  assert.deepEqual(integrationCalls, ["kiddio"]);
  assert.equal(result.projectId, "kiddio");
  assert.equal(result.connection.id, "shopify:kiddio:default");
});

test("empty order search query is rejected before Shopify is called", async () => {
  const actor = { id: "agent", platformRole: PLATFORM_ROLES.MEMBER, status: "active" };
  const { service, integrationCalls } = serviceFor({ actor });

  await assert.rejects(
    service.search({ actor, projectId: "ipro", query: "   " }),
    (error) => error.code === "INVALID_INPUT",
  );
  assert.deepEqual(integrationCalls, []);
});
