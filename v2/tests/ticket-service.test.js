import test from "node:test";
import assert from "node:assert/strict";

import { PLATFORM_ROLES, PROJECT_ROLES } from "../src/core/access-control.js";
import { createTicketService } from "../src/tickets/ticket-service.js";

function fakeRepositories() {
  const users = new Map([
    ["agent-a", { id: "agent-a", platformRole: PLATFORM_ROLES.MEMBER, status: "active" }],
    ["agent-b", { id: "agent-b", platformRole: PLATFORM_ROLES.MEMBER, status: "active" }],
    ["supervisor", { id: "supervisor", platformRole: PLATFORM_ROLES.MEMBER, status: "active" }],
    ["manager", { id: "manager", platformRole: PLATFORM_ROLES.MEMBER, status: "active" }],
    ["hr", { id: "hr", platformRole: PLATFORM_ROLES.HR, status: "active" }],
  ]);
  const memberships = [
    { userId: "agent-a", projectId: "ipro", role: PROJECT_ROLES.AGENT, status: "active", supervisorUserId: "supervisor" },
    { userId: "agent-b", projectId: "ipro", role: PROJECT_ROLES.AGENT, status: "active", supervisorUserId: "supervisor" },
    { userId: "supervisor", projectId: "ipro", role: PROJECT_ROLES.SUPERVISOR, status: "active" },
    { userId: "manager", projectId: "ipro", role: PROJECT_ROLES.MANAGER, status: "active" },
  ];
  const tickets = [
    {
      id: "ticket:1",
      ticketNumber: 1,
      ticketCode: "TK-0000001",
      projectId: "ipro",
      orderNumber: "2515",
      customerName: "Customer One",
      customerEmail: "one@example.com",
      status: "open",
      priority: "normal",
      createdByUserId: "agent-b",
      assignedToUserId: "agent-b",
      assignedTeamId: null,
      version: 1,
    },
    {
      id: "ticket:2",
      ticketNumber: 2,
      ticketCode: "TK-0000002",
      projectId: "ipro",
      orderNumber: "2000",
      customerName: "Old Customer",
      customerEmail: "old@example.com",
      status: "resolved",
      priority: "normal",
      createdByUserId: "agent-b",
      assignedToUserId: "agent-b",
      assignedTeamId: null,
      version: 3,
    },
  ];
  const comments = [];
  const history = [];
  const calls = { search: [], listMine: [], listProject: [], touch: 0 };

  const repo = {
    users: {
      async findById(id) { return users.get(id) ?? null; },
    },
    memberships: {
      async listForUser(userId) { return memberships.filter((item) => item.userId === userId); },
      async find({ userId, projectId }) {
        return memberships.find((item) => item.userId === userId && item.projectId === projectId) ?? null;
      },
    },
    teams: {
      async listForProject() { return []; },
    },
    tickets: {
      async searchProject(input) {
        calls.search.push(input);
        const q = String(input.query).toLowerCase().replace(/^#/, "");
        return tickets.filter((ticket) =>
          ticket.projectId === input.projectId &&
          [
            ticket.ticketCode.toLowerCase(),
            ticket.orderNumber,
            ticket.customerEmail,
            ticket.customerName.toLowerCase(),
          ].some((value) => String(value || "").toLowerCase().includes(q)),
        );
      },
      async findByCode({ projectId, code }) {
        return tickets.find((ticket) => ticket.projectId === projectId && ticket.ticketCode === code) ?? null;
      },
      async findById({ projectId, ticketId }) {
        return tickets.find((ticket) => ticket.projectId === projectId && ticket.id === ticketId) ?? null;
      },
      async listMine(input) {
        calls.listMine.push(input);
        return tickets.filter((ticket) =>
          ticket.projectId === input.projectId &&
          (ticket.assignedToUserId === input.userId || ticket.createdByUserId === input.userId) &&
          (input.includeResolved || !["resolved", "closed"].includes(ticket.status)),
        );
      },
      async listProject(input) {
        calls.listProject.push(input);
        return tickets.filter((ticket) =>
          ticket.projectId === input.projectId &&
          (input.includeResolved || !["resolved", "closed"].includes(ticket.status)),
        );
      },
      async setStatus({ ticketId, status, expectedVersion }) {
        const ticket = tickets.find((item) => item.id === ticketId);
        if (expectedVersion != null && ticket.version !== expectedVersion) return null;
        ticket.status = status;
        ticket.version += 1;
        return { ...ticket };
      },
      async touch() {
        calls.touch += 1;
        return null;
      },
      comments: {
        async list(ticketId) { return comments.filter((comment) => comment.ticketId === ticketId); },
        async find(commentId) { return comments.find((comment) => comment.id === commentId) ?? null; },
        async create({ id, ticketId, authorUserId, body }) {
          const comment = { id, ticketId, authorUserId, body, deleted: false };
          comments.push(comment);
          return comment;
        },
        async edit({ commentId, body }) {
          const comment = comments.find((item) => item.id === commentId);
          comment.body = body;
          return { ...comment };
        },
        async softDelete({ commentId, deletedByUserId }) {
          const comment = comments.find((item) => item.id === commentId);
          comment.deleted = true;
          comment.body = null;
          comment.deletedByUserId = deletedByUserId;
          return { ...comment };
        },
      },
      history: {
        async append(event) {
          history.push(event);
          return event;
        },
        async list(ticketId) { return history.filter((event) => event.ticketId === ticketId); },
      },
    },
  };

  return { repo, state: { tickets, comments, history, calls } };
}

function serviceWith(repo) {
  return createTicketService({
    pool: {},
    runInTransaction: async (_pool, work) => work({}),
    repositoryFactory: () => repo,
  });
}

test("Agent search can find an iPro ticket assigned to another agent", async () => {
  const { repo, state } = fakeRepositories();
  const service = serviceWith(repo);

  const result = await service.search({
    actorId: "agent-a",
    projectId: "ipro",
    query: "2515",
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].assignedToUserId, "agent-b");
  assert.equal(state.calls.search.length, 1);
  assert.equal(state.calls.listMine.length, 0);
});

test("Agent search also finds resolved old tickets instead of hiding them from search", async () => {
  const { repo } = fakeRepositories();
  const service = serviceWith(repo);

  const result = await service.search({
    actorId: "agent-a",
    projectId: "ipro",
    query: "old@example.com",
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].status, "resolved");
});

test("Agent normal queue remains own/assigned and hides resolved by default", async () => {
  const { repo } = fakeRepositories();
  const service = serviceWith(repo);

  const result = await service.listQueue({ actorId: "agent-b", projectId: "ipro" });

  assert.deepEqual(result.map((ticket) => ticket.ticketCode), ["TK-0000001"]);
});

test("Manager normal queue can see the whole iPro project", async () => {
  const { repo, state } = fakeRepositories();
  const service = serviceWith(repo);

  await service.listQueue({ actorId: "manager", projectId: "ipro" });

  assert.equal(state.calls.listProject.length, 1);
  assert.equal(state.calls.listMine.length, 0);
});

test("HR cannot search customer tickets merely because HR can see projects", async () => {
  const { repo, state } = fakeRepositories();
  const service = serviceWith(repo);

  await assert.rejects(
    service.search({ actorId: "hr", projectId: "ipro", query: "2515" }),
    (error) => error.code === "FORBIDDEN",
  );
  assert.equal(state.calls.search.length, 0);
});

test("Agent can read another iPro ticket found by search but cannot change its status", async () => {
  const { repo } = fakeRepositories();
  const service = serviceWith(repo);

  const detail = await service.getByCode({
    actorId: "agent-a",
    projectId: "ipro",
    ticketCode: "TK-0000001",
  });
  assert.equal(detail.ticket.assignedToUserId, "agent-b");

  await assert.rejects(
    service.updateStatus({
      actorId: "agent-a",
      projectId: "ipro",
      ticketCode: "TK-0000001",
      status: "resolved",
      expectedVersion: 1,
    }),
    /read-only/,
  );
});

test("Supervisor can change status for an agent they supervise", async () => {
  const { repo, state } = fakeRepositories();
  const service = serviceWith(repo);

  const updated = await service.updateStatus({
    actorId: "supervisor",
    projectId: "ipro",
    ticketCode: "TK-0000001",
    status: "waiting_customer",
    expectedVersion: 1,
  });

  assert.equal(updated.status, "waiting_customer");
  assert.equal(state.history.at(-1).eventType, "ticket.status_changed");
});

test("ticket comment edits are limited to author unless Supervisor/Manager moderates", async () => {
  const { repo, state } = fakeRepositories();
  state.comments.push({
    id: "comment:1",
    ticketId: "ticket:1",
    authorUserId: "agent-b",
    body: "Original",
    deleted: false,
  });
  const service = serviceWith(repo);

  await assert.rejects(
    service.editComment({
      actorId: "agent-a",
      projectId: "ipro",
      commentId: "comment:1",
      body: "Agent A edit",
    }),
    /only edit your own/,
  );

  const moderated = await service.editComment({
    actorId: "supervisor",
    projectId: "ipro",
    commentId: "comment:1",
    body: "Supervisor corrected",
  });
  assert.equal(moderated.body, "Supervisor corrected");
  assert.equal(state.calls.touch, 1);
});

test("comment delete is soft and ticket activity is touched", async () => {
  const { repo, state } = fakeRepositories();
  state.comments.push({
    id: "comment:2",
    ticketId: "ticket:1",
    authorUserId: "agent-b",
    body: "Remove me",
    deleted: false,
  });
  const service = serviceWith(repo);

  const deleted = await service.deleteComment({
    actorId: "agent-b",
    projectId: "ipro",
    commentId: "comment:2",
  });

  assert.equal(deleted.deleted, true);
  assert.equal(deleted.body, null);
  assert.equal(state.calls.touch, 1);
  assert.equal(state.history.at(-1).eventType, "ticket.comment_deleted");
});

test("optimistic ticket version prevents overwriting a newer ticket state", async () => {
  const { repo } = fakeRepositories();
  const service = serviceWith(repo);

  await assert.rejects(
    service.updateStatus({
      actorId: "agent-b",
      projectId: "ipro",
      ticketCode: "TK-0000002",
      status: "open",
      expectedVersion: 2,
    }),
    (error) => error.code === "CONFLICT",
  );
});
