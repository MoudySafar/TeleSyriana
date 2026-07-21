import test from "node:test";
import assert from "node:assert/strict";

import { PLATFORM_ROLES, PROJECT_ROLES } from "../src/core/access-control.js";
import { createChatService, normalizeMessageBody } from "../src/chat/chat-service.js";

function fakeRepositories() {
  const users = new Map([
    ["agent-a", { id: "agent-a", displayName: "Agent A", platformRole: PLATFORM_ROLES.MEMBER, status: "active" }],
    ["agent-b", { id: "agent-b", displayName: "Agent B", platformRole: PLATFORM_ROLES.MEMBER, status: "active" }],
    ["supervisor", { id: "supervisor", displayName: "Supervisor", platformRole: PLATFORM_ROLES.MEMBER, status: "active" }],
    ["manager", { id: "manager", displayName: "Manager", platformRole: PLATFORM_ROLES.MEMBER, status: "active" }],
    ["hr", { id: "hr", displayName: "HR", platformRole: PLATFORM_ROLES.HR, status: "active" }],
  ]);
  const memberships = [
    { userId: "agent-a", projectId: "ipro", role: PROJECT_ROLES.AGENT, status: "active" },
    { userId: "agent-b", projectId: "ipro", role: PROJECT_ROLES.AGENT, status: "active" },
    { userId: "supervisor", projectId: "ipro", role: PROJECT_ROLES.SUPERVISOR, status: "active" },
    { userId: "manager", projectId: "ipro", role: PROJECT_ROLES.MANAGER, status: "active" },
  ];
  const teams = [
    { id: "support", projectId: "ipro", name: "Support", supervisorUserId: "supervisor", status: "active" },
  ];
  const teamMembers = new Map([
    ["agent-a", ["support"]],
    ["agent-b", []],
  ]);
  const channels = [
    { id: "chat:ipro:general", projectId: "ipro", name: "General", channelType: "project", teamId: null, status: "active" },
    { id: "chat:ipro:support", projectId: "ipro", name: "Support", channelType: "team", teamId: "support", status: "active" },
  ];
  const messages = [];
  const reactions = [];
  const readStates = new Map();
  const audit = [];
  let sequence = 0;

  const repo = {
    users: {
      async findById(id) { return users.get(id) ?? null; },
    },
    memberships: {
      async listForUser(userId) { return memberships.filter((item) => item.userId === userId); },
    },
    teams: {
      async listForProject(projectId) { return teams.filter((team) => team.projectId === projectId); },
    },
    audit: {
      async append(event) { audit.push(event); return event; },
    },
    chat: {
      async listChannels(projectId) { return channels.filter((channel) => channel.projectId === projectId); },
      async findChannel({ projectId, channelId }) {
        return channels.find((channel) => channel.projectId === projectId && channel.id === channelId) ?? null;
      },
      async listUserTeamIds({ userId }) { return teamMembers.get(userId) || []; },
      async listMessages({ channelId, afterSequence = 0 }) {
        return messages.filter((message) => message.channelId === channelId && message.sequenceNumber > Number(afterSequence || 0));
      },
      async findMessage(messageId) { return messages.find((message) => message.id === messageId) ?? null; },
      async createMessage({ id, channelId, authorUserId, body }) {
        sequence += 1;
        const message = {
          id,
          sequenceNumber: sequence,
          channelId,
          authorUserId,
          authorName: users.get(authorUserId)?.displayName ?? null,
          body,
          deleted: false,
        };
        messages.push(message);
        return message;
      },
      async editMessage({ messageId, body }) {
        const message = messages.find((item) => item.id === messageId);
        message.body = body;
        message.editedAt = "now";
        return { ...message };
      },
      async softDeleteMessage({ messageId, deletedByUserId }) {
        const message = messages.find((item) => item.id === messageId);
        message.deleted = true;
        message.body = null;
        message.deletedByUserId = deletedByUserId;
        return { ...message };
      },
      async listReactions(messageIds) {
        return reactions.filter((reaction) => messageIds.includes(reaction.messageId));
      },
      async addReaction({ messageId, userId, emoji }) {
        const exists = reactions.find((reaction) => reaction.messageId === messageId && reaction.userId === userId && reaction.emoji === emoji);
        if (exists) return null;
        const reaction = { messageId, userId, emoji, createdAt: "now" };
        reactions.push(reaction);
        return reaction;
      },
      async removeReaction({ messageId, userId, emoji }) {
        const index = reactions.findIndex((reaction) => reaction.messageId === messageId && reaction.userId === userId && reaction.emoji === emoji);
        if (index < 0) return null;
        return reactions.splice(index, 1)[0];
      },
      async getReadState({ channelId, userId }) { return readStates.get(`${channelId}:${userId}`) ?? null; },
      async markRead({ channelId, userId, sequenceNumber }) {
        const key = `${channelId}:${userId}`;
        const current = readStates.get(key);
        const state = {
          channelId,
          userId,
          lastReadSequence: Math.max(current?.lastReadSequence || 0, sequenceNumber),
          lastReadAt: "now",
        };
        readStates.set(key, state);
        return state;
      },
      async countUnread({ channelId, userId }) {
        const lastRead = readStates.get(`${channelId}:${userId}`)?.lastReadSequence || 0;
        return messages.filter((message) =>
          message.channelId === channelId &&
          !message.deleted &&
          message.authorUserId !== userId &&
          message.sequenceNumber > lastRead,
        ).length;
      },
    },
  };

  return { repo, state: { messages, reactions, readStates, audit } };
}

function serviceWith(repo) {
  return createChatService({
    pool: {},
    runInTransaction: async (_pool, work) => work({}),
    repositoryFactory: () => repo,
  });
}

test("multiline chat text preserves new lines", () => {
  assert.equal(normalizeMessageBody("First line\r\nSecond line\nThird line"), "First line\nSecond line\nThird line");
});

test("Agent sees iPro General and only team channels they belong to", async () => {
  const { repo } = fakeRepositories();
  const service = serviceWith(repo);

  const agentA = await service.listChannels({ actorId: "agent-a", projectId: "ipro" });
  const agentB = await service.listChannels({ actorId: "agent-b", projectId: "ipro" });

  assert.deepEqual(agentA.map((channel) => channel.id), ["chat:ipro:general", "chat:ipro:support"]);
  assert.deepEqual(agentB.map((channel) => channel.id), ["chat:ipro:general"]);
});

test("Team Supervisor can access their team channel even without explicit team-member row", async () => {
  const { repo } = fakeRepositories();
  const service = serviceWith(repo);

  const channels = await service.listChannels({ actorId: "supervisor", projectId: "ipro" });

  assert.deepEqual(channels.map((channel) => channel.id), ["chat:ipro:general", "chat:ipro:support"]);
});

test("HR project visibility does not automatically expose project chat", async () => {
  const { repo } = fakeRepositories();
  const service = serviceWith(repo);

  await assert.rejects(
    service.listChannels({ actorId: "hr", projectId: "ipro" }),
    (error) => error.code === "FORBIDDEN",
  );
});

test("message send supports multiline body and reactions", async () => {
  const { repo, state } = fakeRepositories();
  const service = serviceWith(repo);

  const message = await service.sendMessage({
    actorId: "agent-a",
    projectId: "ipro",
    channelId: "chat:ipro:general",
    body: "Hello team\nCustomer replied.",
  });
  assert.equal(message.body, "Hello team\nCustomer replied.");

  await service.addReaction({
    actorId: "agent-b",
    projectId: "ipro",
    messageId: message.id,
    emoji: "👍",
  });

  const result = await service.listMessages({
    actorId: "agent-a",
    projectId: "ipro",
    channelId: "chat:ipro:general",
  });
  assert.equal(result.messages[0].reactions[0].emoji, "👍");
  assert.equal(state.reactions.length, 1);
});

test("cloud read state advances only to a real message and unread count survives browser changes", async () => {
  const { repo, state } = fakeRepositories();
  const service = serviceWith(repo);

  const message = await service.sendMessage({
    actorId: "agent-a",
    projectId: "ipro",
    channelId: "chat:ipro:general",
    body: "For Agent B",
  });

  let channels = await service.listChannels({ actorId: "agent-b", projectId: "ipro" });
  assert.equal(channels.find((channel) => channel.id === "chat:ipro:general").unreadCount, 1);

  await service.markRead({
    actorId: "agent-b",
    projectId: "ipro",
    channelId: "chat:ipro:general",
    messageId: message.id,
  });

  channels = await service.listChannels({ actorId: "agent-b", projectId: "ipro" });
  assert.equal(channels.find((channel) => channel.id === "chat:ipro:general").unreadCount, 0);
  assert.equal(state.readStates.get("chat:ipro:general:agent-b").lastReadSequence, message.sequenceNumber);
});

test("read state rejects a guessed or non-existent future message", async () => {
  const { repo } = fakeRepositories();
  const service = serviceWith(repo);

  await assert.rejects(
    service.markRead({
      actorId: "agent-b",
      projectId: "ipro",
      channelId: "chat:ipro:general",
      messageId: "message:not-real",
    }),
    (error) => error.code === "NOT_FOUND",
  );
});

test("Agent cannot delete another employee message but Supervisor can moderate project chat", async () => {
  const { repo, state } = fakeRepositories();
  const service = serviceWith(repo);

  const message = await service.sendMessage({
    actorId: "agent-a",
    projectId: "ipro",
    channelId: "chat:ipro:general",
    body: "Original message",
  });

  await assert.rejects(
    service.deleteMessage({ actorId: "agent-b", projectId: "ipro", messageId: message.id }),
    /only delete your own/,
  );

  const deleted = await service.deleteMessage({
    actorId: "supervisor",
    projectId: "ipro",
    messageId: message.id,
  });
  assert.equal(deleted.deleted, true);
  assert.equal(deleted.body, null);
  assert.equal(state.audit.at(-1).action, "chat.message_deleted");
});

test("Agent cannot open an unrelated team channel by guessing its channel ID", async () => {
  const { repo } = fakeRepositories();
  const service = serviceWith(repo);

  await assert.rejects(
    service.listMessages({
      actorId: "agent-b",
      projectId: "ipro",
      channelId: "chat:ipro:support",
    }),
    (error) => error.code === "FORBIDDEN",
  );
});
