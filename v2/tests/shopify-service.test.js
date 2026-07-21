import test from "node:test";
import assert from "node:assert/strict";

import { PLATFORM_ROLES, PROJECT_ROLES } from "../src/core/access-control.js";
import { createShopifyIntegrationService } from "../src/integrations/shopify-service.js";

const masterKey = Buffer.alloc(32, 4).toString("base64");

function fakeRepositories() {
  const users = new Map([
    ["ceo", { id: "ceo", platformRole: PLATFORM_ROLES.CEO, status: "active" }],
    ["hr", { id: "hr", platformRole: PLATFORM_ROLES.HR, status: "active" }],
    ["manager", { id: "manager", platformRole: PLATFORM_ROLES.MEMBER, status: "active" }],
  ]);
  const memberships = [
    { userId: "manager", projectId: "ipro", role: PROJECT_ROLES.MANAGER, status: "active" },
  ];
  const connections = [
    {
      id: "shopify:ipro:legacy",
      projectId: "ipro",
      label: "Current iPro Shopify",
      shopDomain: null,
      apiVersion: null,
      credentialSource: "legacy_env",
      credentialPayload: null,
      status: "active",
      verificationStatus: "verified",
      isDefault: true,
    },
  ];
  const audit = [];

  const repositories = {
    state: { connections, audit },
    users: {
      async findById(id) { return users.get(id) ?? null; },
    },
    memberships: {
      async listForUser(userId) { return memberships.filter((item) => item.userId === userId); },
    },
    shopify: {
      async listForProject(projectId) { return connections.filter((item) => item.projectId === projectId); },
      async findById(id) { return connections.find((item) => item.id === id) ?? null; },
      async findDefaultForProject(projectId) {
        return connections.find((item) => item.projectId === projectId && item.isDefault && item.status === "active") ?? null;
      },
      async createPending(input) {
        const connection = {
          ...input,
          credentialSource: "encrypted_db",
          status: "pending",
          verificationStatus: "unverified",
          verifiedAt: null,
          isDefault: false,
        };
        connections.push(connection);
        return connection;
      },
      async markVerification({ connectionId, verified }) {
        const connection = connections.find((item) => item.id === connectionId);
        connection.verificationStatus = verified ? "verified" : "failed";
        connection.verifiedAt = verified ? new Date() : null;
        return { ...connection };
      },
      async activateAsDefault({ connectionId, projectId }) {
        for (const connection of connections) {
          if (connection.projectId === projectId) connection.isDefault = false;
        }
        const connection = connections.find((item) => item.id === connectionId && item.projectId === projectId);
        if (!connection || connection.verificationStatus !== "verified") return null;
        connection.isDefault = true;
        connection.status = "active";
        return { ...connection };
      },
    },
    audit: {
      async append(event) {
        audit.push(event);
        return event;
      },
    },
  };

  return repositories;
}

function serviceWith(repositories, client = null) {
  return createShopifyIntegrationService({
    pool: {},
    runInTransaction: async (_pool, work) => work({}),
    repositoryFactory: () => repositories,
    masterKey,
    env: {
      SHOPIFY_SHOP: "ipro-legacy",
      SHOPIFY_CLIENT_ID: "legacy-client-id",
      SHOPIFY_CLIENT_SECRET: "legacy-client-secret",
      SHOPIFY_API_VERSION: "2026-04",
    },
    client: client || {
      async verifyConfiguration(config) {
        return { ok: true, shop: { name: "New Store", myshopifyDomain: config.shopDomain } };
      },
    },
  });
}

test("Manager cannot create Shopify connections even inside assigned iPro project", async () => {
  const repositories = fakeRepositories();
  const service = serviceWith(repositories);

  await assert.rejects(
    service.createPending({
      actorId: "manager",
      projectId: "ipro",
      input: { shopDomain: "another-shop", clientId: "id", clientSecret: "secret" },
    }),
    (error) => error.code === "FORBIDDEN",
  );
  assert.equal(repositories.state.connections.length, 1);
});

test("HR can view projects globally but cannot manage Shopify integrations", async () => {
  const repositories = fakeRepositories();
  const service = serviceWith(repositories);

  await assert.rejects(
    service.list({ actorId: "hr", projectId: "ipro" }),
    (error) => error.code === "FORBIDDEN",
  );
});

test("CEO creates encrypted pending Shopify connection without receiving credential payload", async () => {
  const repositories = fakeRepositories();
  const service = serviceWith(repositories);

  const connection = await service.createPending({
    actorId: "ceo",
    projectId: "ipro",
    input: {
      label: "Replacement candidate",
      shopDomain: "new-ipro",
      clientId: "new-client-id",
      clientSecret: "new-client-secret",
    },
  });

  const stored = repositories.state.connections.at(-1);
  assert.equal(connection.status, "pending");
  assert.equal(connection.verificationStatus, "unverified");
  assert.equal(connection.isDefault, false);
  assert.equal("credentialPayload" in connection, false);
  assert.doesNotMatch(JSON.stringify(stored.credentialPayload), /new-client-secret/);
  assert.equal(repositories.state.connections[0].isDefault, true);
});

test("legacy iPro default resolves from existing environment without copying its secret into DB", async () => {
  const repositories = fakeRepositories();
  const service = serviceWith(repositories);

  const config = await service.resolveDefaultConfiguration("ipro");

  assert.equal(config.connection.id, "shopify:ipro:legacy");
  assert.equal(config.shopDomain, "ipro-legacy.myshopify.com");
  assert.equal(config.apiVersion, "2026-04");
  assert.equal(config.clientSecret, "legacy-client-secret");
  assert.equal(repositories.state.connections[0].credentialPayload, null);
});

test("new connection must verify before CEO can explicitly activate it as default", async () => {
  const repositories = fakeRepositories();
  const service = serviceWith(repositories);

  const pending = await service.createPending({
    actorId: "ceo",
    projectId: "ipro",
    input: {
      label: "Verified candidate",
      shopDomain: "verified-shop",
      clientId: "new-client-id",
      clientSecret: "new-client-secret",
    },
  });

  await assert.rejects(
    service.activateVerifiedAsDefault({ actorId: "ceo", projectId: "ipro", connectionId: pending.id }),
    (error) => error.code === "CONFLICT",
  );
  assert.equal(repositories.state.connections[0].isDefault, true);

  const verification = await service.verify({
    actorId: "ceo",
    projectId: "ipro",
    connectionId: pending.id,
  });
  assert.equal(verification.connection.verificationStatus, "verified");

  const active = await service.activateVerifiedAsDefault({
    actorId: "ceo",
    projectId: "ipro",
    connectionId: pending.id,
  });
  assert.equal(active.isDefault, true);
  assert.equal(repositories.state.connections[0].isDefault, false);
});
