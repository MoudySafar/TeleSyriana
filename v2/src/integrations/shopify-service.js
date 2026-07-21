import { randomUUID } from "node:crypto";

import { CAPABILITIES, hasCapability } from "../core/access-control.js";
import { withTransaction } from "../db/postgres.js";
import { createRepositories } from "../db/repositories.js";
import { createShopifyAdminClient } from "./shopify-client.js";
import {
  decryptIntegrationCredentials,
  encryptIntegrationCredentials,
} from "./secret-crypto.js";
import { createShopifyRepository } from "./shopify-repository.js";

function required(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function canonicalShopDomain(value) {
  const raw = required(value, "shopDomain")
    .replace(/^https?:\/\//i, "")
    .replace(/\/$/, "")
    .trim()
    .toLowerCase();

  const domain = raw.endsWith(".myshopify.com") ? raw : `${raw}.myshopify.com`;
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain)) {
    throw new Error("shopDomain must be a valid Shopify myshopify.com domain or shop handle");
  }
  return domain;
}

function publicConnection(connection) {
  if (!connection) return null;
  const { credentialPayload: _credentialPayload, ...safe } = connection;
  return safe;
}

async function requireIntegrationManager(repositories, { actorId, projectId }) {
  const actor = await repositories.users.findById(actorId);
  if (!actor) {
    const error = new Error(`Actor not found: ${actorId}`);
    error.code = "NOT_FOUND";
    throw error;
  }

  const memberships = await repositories.memberships.listForUser(actorId);
  if (!hasCapability({
    user: actor,
    memberships,
    projectId,
    capability: CAPABILITIES.INTEGRATIONS_MANAGE,
  })) {
    const error = new Error("Forbidden: integration management requires CEO permission");
    error.code = "FORBIDDEN";
    throw error;
  }

  return { actor, memberships };
}

function persistenceRepositories(db) {
  return {
    ...createRepositories(db),
    shopify: createShopifyRepository(db),
  };
}

export function createShopifyIntegrationService({
  pool,
  runInTransaction = withTransaction,
  repositoryFactory = persistenceRepositories,
  masterKey = process.env.INTEGRATION_MASTER_KEY,
  env = process.env,
  client = createShopifyAdminClient(),
} = {}) {
  if (!pool) throw new TypeError("A database pool is required");

  const transaction = (work) =>
    runInTransaction(pool, async (db) => work(repositoryFactory(db)));

  function resolveConfiguration(connection) {
    if (connection.credentialSource === "legacy_env") {
      return {
        connection: publicConnection(connection),
        shopDomain: canonicalShopDomain(env.SHOPIFY_SHOP),
        // Keep the current iPro API version unless the existing environment changes it.
        apiVersion: env.SHOPIFY_API_VERSION || connection.apiVersion || "2026-04",
        clientId: required(env.SHOPIFY_CLIENT_ID, "SHOPIFY_CLIENT_ID"),
        clientSecret: required(env.SHOPIFY_CLIENT_SECRET, "SHOPIFY_CLIENT_SECRET"),
      };
    }

    const credentials = decryptIntegrationCredentials(connection.credentialPayload, masterKey);
    return {
      connection: publicConnection(connection),
      shopDomain: canonicalShopDomain(connection.shopDomain),
      apiVersion: connection.apiVersion || "2026-07",
      clientId: required(credentials.clientId, "clientId"),
      clientSecret: required(credentials.clientSecret, "clientSecret"),
    };
  }

  return {
    async list({ actorId, projectId }) {
      return transaction(async (repositories) => {
        await requireIntegrationManager(repositories, { actorId, projectId });
        const connections = await repositories.shopify.listForProject(projectId);
        return connections.map(publicConnection);
      });
    },

    async createPending({ actorId, projectId, input }) {
      const shopDomain = canonicalShopDomain(input?.shopDomain);
      const clientId = required(input?.clientId, "clientId");
      const clientSecret = required(input?.clientSecret, "clientSecret");
      const credentialPayload = encryptIntegrationCredentials(
        { clientId, clientSecret },
        masterKey,
      );

      return transaction(async (repositories) => {
        const { actor } = await requireIntegrationManager(repositories, { actorId, projectId });
        const connection = await repositories.shopify.createPending({
          id: `shopify:${randomUUID()}`,
          projectId,
          label: String(input?.label || "Shopify").trim() || "Shopify",
          shopDomain,
          // New project connections use the current Admin API generation by default.
          apiVersion: String(input?.apiVersion || "2026-07").trim(),
          credentialPayload,
          createdByUserId: actor.id,
        });

        await repositories.audit.append({
          actorUserId: actor.id,
          projectId,
          action: "integration.shopify_created_pending",
          targetType: "shopify_connection",
          targetId: connection.id,
          metadata: {
            shopDomain,
            label: connection.label,
          },
        });

        return publicConnection(connection);
      });
    },

    async verify({ actorId, projectId, connectionId }) {
      const preparation = await transaction(async (repositories) => {
        await requireIntegrationManager(repositories, { actorId, projectId });
        const connection = await repositories.shopify.findById(connectionId);
        if (!connection || connection.projectId !== projectId) {
          const error = new Error("Shopify connection not found");
          error.code = "NOT_FOUND";
          throw error;
        }
        return {
          connection,
          configuration: resolveConfiguration(connection),
        };
      });

      let verification;
      let verificationError = null;
      try {
        verification = await client.verifyConfiguration(preparation.configuration);
      } catch (error) {
        verificationError = error;
      }

      const updated = await transaction(async (repositories) => {
        const { actor } = await requireIntegrationManager(repositories, { actorId, projectId });
        const current = await repositories.shopify.findById(connectionId);
        if (!current || current.projectId !== projectId) {
          const error = new Error("Shopify connection not found");
          error.code = "NOT_FOUND";
          throw error;
        }

        const connection = await repositories.shopify.markVerification({
          connectionId,
          verified: !verificationError,
        });

        await repositories.audit.append({
          actorUserId: actor.id,
          projectId,
          action: verificationError
            ? "integration.shopify_verification_failed"
            : "integration.shopify_verified",
          targetType: "shopify_connection",
          targetId: connectionId,
          metadata: verificationError
            ? { errorCode: verificationError.code || "SHOPIFY_VERIFY_ERROR" }
            : { shopName: verification.shop.name, shopDomain: verification.shop.myshopifyDomain },
        });

        return connection;
      });

      if (verificationError) throw verificationError;
      return {
        connection: publicConnection(updated),
        shop: verification.shop,
      };
    },

    async activateVerifiedAsDefault({ actorId, projectId, connectionId }) {
      return transaction(async (repositories) => {
        const { actor } = await requireIntegrationManager(repositories, { actorId, projectId });
        const connection = await repositories.shopify.findById(connectionId);
        if (!connection || connection.projectId !== projectId) {
          const error = new Error("Shopify connection not found");
          error.code = "NOT_FOUND";
          throw error;
        }
        if (connection.verificationStatus !== "verified") {
          const error = new Error("Shopify connection must be verified before activation");
          error.code = "CONFLICT";
          throw error;
        }

        const activated = await repositories.shopify.activateAsDefault({
          connectionId,
          projectId,
        });
        if (!activated) {
          const error = new Error("Could not activate Shopify connection");
          error.code = "CONFLICT";
          throw error;
        }

        await repositories.audit.append({
          actorUserId: actor.id,
          projectId,
          action: "integration.shopify_activated_default",
          targetType: "shopify_connection",
          targetId: connectionId,
          metadata: { previousDefaultPreservedUntilActivation: true },
        });

        return publicConnection(activated);
      });
    },

    async resolveDefaultConfiguration(projectId) {
      const repositories = repositoryFactory(pool);
      const connection = await repositories.shopify.findDefaultForProject(projectId);
      if (!connection) {
        const error = new Error(`No active default Shopify connection for project: ${projectId}`);
        error.code = "NOT_FOUND";
        throw error;
      }
      return resolveConfiguration(connection);
    },
  };
}

export { canonicalShopDomain };
