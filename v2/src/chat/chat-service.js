import { randomUUID } from "node:crypto";

import {
  CAPABILITIES,
  PLATFORM_ROLES,
  PROJECT_ROLES,
  getActiveMembership,
  hasCapability,
} from "../core/access-control.js";
import { withTransaction } from "../db/postgres.js";
import { createRepositories } from "../db/repositories.js";
import { createChatRepository } from "./chat-repository.js";

function forbidden(message = "Chat access denied") {
  const error = new Error(message);
  error.code = "FORBIDDEN";
  return error;
}

function notFound(entity) {
  const error = new Error(`${entity} not found`);
  error.code = "NOT_FOUND";
  return error;
}

function normalizeMessageBody(body) {
  const normalized = String(body ?? "").replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    const error = new Error("Message body is required");
    error.code = "INVALID_INPUT";
    throw error;
  }
  if (normalized.length > 10_000) {
    const error = new Error("Message body exceeds 10,000 characters");
    error.code = "INVALID_INPUT";
    throw error;
  }
  return normalized;
}

function normalizeEmoji(emoji) {
  const normalized = String(emoji ?? "").trim();
  if (!normalized || normalized.length > 32) {
    const error = new Error("A valid reaction emoji is required");
    error.code = "INVALID_INPUT";
    throw error;
  }
  return normalized;
}

function persistenceRepositories(db) {
  return {
    ...createRepositories(db),
    chat: createChatRepository(db),
  };
}

async function loadActorContext(repositories, actorId, projectId, capability) {
  const actor = await repositories.users.findById(actorId);
  if (!actor || actor.status !== "active") throw forbidden("Active employee account required");
  const memberships = await repositories.memberships.listForUser(actorId);
  if (!hasCapability({ user: actor, memberships, projectId, capability })) {
    throw forbidden();
  }
  return {
    actor,
    memberships,
    membership: getActiveMembership(memberships, actor.id, projectId),
  };
}

async function accessContext(repositories, { actor, membership, projectId }) {
  const [teams, userTeamIds] = await Promise.all([
    repositories.teams.listForProject(projectId),
    repositories.chat.listUserTeamIds({ projectId, userId: actor.id }),
  ]);
  return { teams, userTeamIds: new Set(userTeamIds), membership };
}

function canAccessChannel({ actor, channel, teams, userTeamIds, membership }) {
  if (channel.channelType === "project") return true;
  if (actor.platformRole === PLATFORM_ROLES.CEO) return true;
  if (membership?.role === PROJECT_ROLES.MANAGER) return true;
  const team = teams.find((item) => item.id === channel.teamId);
  if (team?.supervisorUserId === actor.id) return true;
  return userTeamIds.has(channel.teamId);
}

async function requireChannel(repositories, { actor, membership, projectId, channelId }) {
  const channel = await repositories.chat.findChannel({ projectId, channelId });
  if (!channel) throw notFound("Chat channel");
  const context = await accessContext(repositories, { actor, membership, projectId });
  if (!canAccessChannel({ actor, channel, ...context })) {
    throw forbidden("You do not have access to this chat channel");
  }
  return channel;
}

function attachReactions(messages, reactions) {
  const byMessage = new Map();
  for (const reaction of reactions) {
    if (!byMessage.has(reaction.messageId)) byMessage.set(reaction.messageId, []);
    byMessage.get(reaction.messageId).push(reaction);
  }
  return messages.map((message) => ({
    ...message,
    reactions: byMessage.get(message.id) || [],
  }));
}

export function createChatService({
  pool,
  runInTransaction = withTransaction,
  repositoryFactory = persistenceRepositories,
} = {}) {
  if (!pool) throw new TypeError("A database pool is required");

  const transaction = (work) =>
    runInTransaction(pool, async (db) => work(repositoryFactory(db)));

  return {
    async listChannels({ actorId, projectId }) {
      return transaction(async (repositories) => {
        const { actor, memberships, membership } = await loadActorContext(
          repositories,
          actorId,
          projectId,
          CAPABILITIES.CHAT_READ,
        );
        const channels = await repositories.chat.listChannels(projectId);
        const context = await accessContext(repositories, { actor, membership, projectId });
        const visible = channels.filter((channel) =>
          canAccessChannel({ actor, channel, ...context }),
        );

        return Promise.all(
          visible.map(async (channel) => ({
            ...channel,
            unreadCount: await repositories.chat.countUnread({
              channelId: channel.id,
              userId: actor.id,
            }),
          })),
        );
      });
    },

    async listMessages({ actorId, projectId, channelId, afterSequence = 0, limit = 100 }) {
      return transaction(async (repositories) => {
        const { actor, membership } = await loadActorContext(
          repositories,
          actorId,
          projectId,
          CAPABILITIES.CHAT_READ,
        );
        const channel = await requireChannel(repositories, {
          actor,
          membership,
          projectId,
          channelId,
        });
        const messages = await repositories.chat.listMessages({
          channelId,
          afterSequence,
          limit,
        });
        const reactions = await repositories.chat.listReactions(messages.map((message) => message.id));
        const readState = await repositories.chat.getReadState({ channelId, userId: actor.id });

        return {
          channel,
          messages: attachReactions(messages, reactions),
          readState,
        };
      });
    },

    async sendMessage({ actorId, projectId, channelId, body }) {
      const messageBody = normalizeMessageBody(body);
      return transaction(async (repositories) => {
        const { actor, membership } = await loadActorContext(
          repositories,
          actorId,
          projectId,
          CAPABILITIES.CHAT_SEND,
        );
        await requireChannel(repositories, { actor, membership, projectId, channelId });
        return repositories.chat.createMessage({
          id: `message:${randomUUID()}`,
          channelId,
          authorUserId: actor.id,
          body: messageBody,
        });
      });
    },

    async editMessage({ actorId, projectId, messageId, body }) {
      const messageBody = normalizeMessageBody(body);
      return transaction(async (repositories) => {
        const { actor, membership } = await loadActorContext(
          repositories,
          actorId,
          projectId,
          CAPABILITIES.CHAT_EDIT_OWN,
        );
        const current = await repositories.chat.findMessage(messageId);
        if (!current) throw notFound("Chat message");
        await requireChannel(repositories, {
          actor,
          membership,
          projectId,
          channelId: current.channelId,
        });
        if (current.authorUserId !== actor.id) {
          throw forbidden("You can only edit your own messages");
        }
        if (current.deleted) {
          const error = new Error("Deleted messages cannot be edited");
          error.code = "CONFLICT";
          throw error;
        }

        const updated = await repositories.chat.editMessage({ messageId, body: messageBody });
        await repositories.audit.append({
          actorUserId: actor.id,
          projectId,
          action: "chat.message_edited",
          targetType: "chat_message",
          targetId: messageId,
          metadata: { channelId: current.channelId },
        });
        return updated;
      });
    },

    async deleteMessage({ actorId, projectId, messageId }) {
      return transaction(async (repositories) => {
        const { actor, memberships, membership } = await loadActorContext(
          repositories,
          actorId,
          projectId,
          CAPABILITIES.CHAT_DELETE_OWN,
        );
        const current = await repositories.chat.findMessage(messageId);
        if (!current) throw notFound("Chat message");
        await requireChannel(repositories, {
          actor,
          membership,
          projectId,
          channelId: current.channelId,
        });

        const canModerate = hasCapability({
          user: actor,
          memberships,
          projectId,
          capability: CAPABILITIES.CHAT_MODERATE,
        });
        if (current.authorUserId !== actor.id && !canModerate) {
          throw forbidden("You can only delete your own messages");
        }

        const deleted = await repositories.chat.softDeleteMessage({
          messageId,
          deletedByUserId: actor.id,
        });
        await repositories.audit.append({
          actorUserId: actor.id,
          projectId,
          action: "chat.message_deleted",
          targetType: "chat_message",
          targetId: messageId,
          metadata: { channelId: current.channelId, originalAuthorUserId: current.authorUserId },
        });
        return deleted;
      });
    },

    async addReaction({ actorId, projectId, messageId, emoji }) {
      const normalizedEmoji = normalizeEmoji(emoji);
      return transaction(async (repositories) => {
        const { actor, membership } = await loadActorContext(
          repositories,
          actorId,
          projectId,
          CAPABILITIES.CHAT_REACT,
        );
        const message = await repositories.chat.findMessage(messageId);
        if (!message || message.deleted) throw notFound("Chat message");
        await requireChannel(repositories, {
          actor,
          membership,
          projectId,
          channelId: message.channelId,
        });
        return repositories.chat.addReaction({
          messageId,
          userId: actor.id,
          emoji: normalizedEmoji,
        });
      });
    },

    async removeReaction({ actorId, projectId, messageId, emoji }) {
      const normalizedEmoji = normalizeEmoji(emoji);
      return transaction(async (repositories) => {
        const { actor, membership } = await loadActorContext(
          repositories,
          actorId,
          projectId,
          CAPABILITIES.CHAT_REACT,
        );
        const message = await repositories.chat.findMessage(messageId);
        if (!message) throw notFound("Chat message");
        await requireChannel(repositories, {
          actor,
          membership,
          projectId,
          channelId: message.channelId,
        });
        return repositories.chat.removeReaction({
          messageId,
          userId: actor.id,
          emoji: normalizedEmoji,
        });
      });
    },

    async markRead({ actorId, projectId, channelId, sequenceNumber }) {
      const sequence = Number(sequenceNumber);
      if (!Number.isInteger(sequence) || sequence < 0) {
        const error = new Error("A valid message sequence is required");
        error.code = "INVALID_INPUT";
        throw error;
      }

      return transaction(async (repositories) => {
        const { actor, membership } = await loadActorContext(
          repositories,
          actorId,
          projectId,
          CAPABILITIES.CHAT_READ,
        );
        await requireChannel(repositories, { actor, membership, projectId, channelId });
        return repositories.chat.markRead({
          channelId,
          userId: actor.id,
          sequenceNumber: sequence,
        });
      });
    },
  };
}

export { normalizeMessageBody };
