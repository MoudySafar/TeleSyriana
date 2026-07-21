import { randomUUID } from "node:crypto";

import { CAPABILITIES, hasCapability } from "../core/access-control.js";
import { withTransaction } from "../db/postgres.js";
import { createRepositories } from "../db/repositories.js";
import { createProjectAdminRepository } from "./project-admin-repository.js";

function normalizeSlug(value) {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) {
    const error = new Error("A project slug is required");
    error.code = "INVALID_INPUT";
    throw error;
  }
  return slug;
}

function requiredText(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    const error = new Error(`${name} is required`);
    error.code = "INVALID_INPUT";
    throw error;
  }
  return normalized;
}

function validateTimezone(timezone) {
  const value = String(timezone || "UTC").trim() || "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(new Date());
  } catch {
    const error = new Error(`Invalid IANA timezone: ${value}`);
    error.code = "INVALID_INPUT";
    throw error;
  }
  return value;
}

function repositoriesFor(db) {
  return {
    ...createRepositories(db),
    projectAdmin: createProjectAdminRepository(db),
  };
}

async function requireProjectAdmin(repositories, actorId) {
  const actor = await repositories.users.findById(actorId);
  if (!actor || actor.status !== "active") {
    const error = new Error("Active CEO account required");
    error.code = "FORBIDDEN";
    throw error;
  }
  const memberships = await repositories.memberships.listForUser(actorId);
  if (!hasCapability({
    user: actor,
    memberships,
    projectId: null,
    capability: CAPABILITIES.PROJECTS_MANAGE,
  })) {
    const error = new Error("Only CEO can create or change TeleSyriana projects");
    error.code = "FORBIDDEN";
    throw error;
  }
  return actor;
}

export function createProjectAdminService({
  pool,
  runInTransaction = withTransaction,
  repositoryFactory = repositoriesFor,
} = {}) {
  if (!pool) throw new TypeError("A database pool is required");

  const transaction = (work) =>
    runInTransaction(pool, async (db) => work(repositoryFactory(db)));

  return {
    async create({ actorId, input = {} }) {
      const name = requiredText(input.name, "name");
      const slug = normalizeSlug(input.slug || name);
      const timezone = validateTimezone(input.timezone || "UTC");

      return transaction(async (repositories) => {
        const actor = await requireProjectAdmin(repositories, actorId);
        const project = await repositories.projectAdmin.create({
          id: `project:${randomUUID()}`,
          slug,
          name,
          timezone,
        });
        await repositories.projectAdmin.createGeneralChatChannel({
          projectId: project.id,
          createdByUserId: actor.id,
        });
        await repositories.audit.append({
          actorUserId: actor.id,
          projectId: project.id,
          action: "project.created",
          targetType: "project",
          targetId: project.id,
          metadata: { slug: project.slug, name: project.name, timezone: project.timezone },
        });
        return project;
      });
    },

    async update({ actorId, projectId, fields = {} }) {
      const timezone = fields.timezone == null ? null : validateTimezone(fields.timezone);
      const status = fields.status == null ? null : String(fields.status);
      if (status != null && !["active", "archived"].includes(status)) {
        const error = new Error(`Invalid project status: ${status}`);
        error.code = "INVALID_INPUT";
        throw error;
      }

      return transaction(async (repositories) => {
        const actor = await requireProjectAdmin(repositories, actorId);
        const current = await repositories.projectAdmin.findById(projectId);
        if (!current) {
          const error = new Error("Project not found");
          error.code = "NOT_FOUND";
          throw error;
        }
        if (current.isDefault && status === "archived") {
          const error = new Error("The default iPro project cannot be archived");
          error.code = "CONFLICT";
          throw error;
        }

        const project = await repositories.projectAdmin.update({
          projectId,
          name: fields.name == null ? null : requiredText(fields.name, "name"),
          timezone,
          status,
        });
        await repositories.audit.append({
          actorUserId: actor.id,
          projectId,
          action: "project.updated",
          targetType: "project",
          targetId: projectId,
          metadata: { previousStatus: current.status, status: project.status, timezone: project.timezone },
        });
        return project;
      });
    },
  };
}

export { normalizeSlug, validateTimezone };
