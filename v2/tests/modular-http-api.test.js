import test from "node:test";
import assert from "node:assert/strict";

import { createModularApp } from "../src/http/app-modular.js";

const reema = {
  id: "reema",
  staffCode: "1042",
  displayName: "Reema Obaid",
  email: null,
  platformRole: "member",
  status: "active",
  locale: "en",
  theme: "system",
};

function fakeServices() {
  const calls = {
    ticketQueue: [],
    teams: [],
    assignments: [],
  };

  return {
    calls,
    healthCheck: async () => ({ ok: true, databaseTime: "now" }),
    authentication: {
      async login({ staffCode, secret }) {
        if (staffCode !== "1042" || secret !== "241155") {
          const error = new Error("Invalid staff code or login secret");
          error.code = "INVALID_CREDENTIALS";
          throw error;
        }
        return {
          token: "raw-session-token",
          session: { id: "session-1", userId: "reema", expiresAt: new Date(Date.now() + 3_600_000) },
          user: reema,
          mustReset: false,
        };
      },
      async authenticateSession(token) {
        if (token !== "raw-session-token") {
          const error = new Error("Authentication required");
          error.code = "UNAUTHENTICATED";
          throw error;
        }
        return { user: reema, session: { id: "session-1", userId: "reema" } };
      },
      async logout() {},
      async changeSecret() {},
    },
    projects: {
      async listVisibleProjects() {
        return [{ id: "ipro", name: "iPro", status: "active", isDefault: true }];
      },
      async requireProjectContext({ projectId }) {
        if (projectId !== "ipro") {
          const error = new Error("Project access denied");
          error.code = "FORBIDDEN";
          throw error;
        }
        return { projectId, project: { id: "ipro", name: "iPro" } };
      },
    },
    projectAdmin: {
      async create() {
        const error = new Error("Only CEO can create TeleSyriana projects");
        error.code = "FORBIDDEN";
        throw error;
      },
      async update() {
        const error = new Error("Only CEO can update TeleSyriana projects");
        error.code = "FORBIDDEN";
        throw error;
      },
    },
    employees: {
      async createForProject() { throw new Error("not used"); },
      async assignExistingToProject(input) {
        calls.assignments.push(input);
        return {
          user: { ...reema, id: input.targetUserId },
          membership: {
            userId: input.targetUserId,
            projectId: input.projectId,
            role: input.role,
            status: "active",
          },
        };
      },
      async changeProjectRole() { throw new Error("not used"); },
      async disableFromProject() { throw new Error("not used"); },
      async reactivateInProject() { throw new Error("not used"); },
      async disableAccount() { throw new Error("not used"); },
      async reactivateAccount() { throw new Error("not used"); },
    },
    teams: {
      async list(input) {
        calls.teams.push(input);
        return [{ id: "support", projectId: input.projectId, name: "Support" }];
      },
      async create() { throw new Error("not used"); },
      async listMembers() { return []; },
      async setSupervisor() { throw new Error("not used"); },
      async addMember() { throw new Error("not used"); },
      async removeMember() { throw new Error("not used"); },
    },
    tickets: {
      async search() { return []; },
      async create() { throw new Error("not used"); },
      async getByCode() { throw new Error("not used"); },
      async updateStatus() { throw new Error("not used"); },
      async addComment() { throw new Error("not used"); },
      async editComment() { throw new Error("not used"); },
      async deleteComment() { throw new Error("not used"); },
    },
    ticketQueue: {
      async list(input) {
        calls.ticketQueue.push(input);
        return [{ id: "ticket:1", status: input.statusFilter }];
      },
    },
    orders: {
      async search() { return { projectId: "ipro", count: 0, orders: [] }; },
    },
    chat: {
      async listChannels() { return []; },
      async listMessages() { return { channel: {}, messages: [], readState: null }; },
      async sendMessage() { throw new Error("not used"); },
      async markRead() { throw new Error("not used"); },
      async editMessage() { throw new Error("not used"); },
      async deleteMessage() { throw new Error("not used"); },
      async addReaction() { throw new Error("not used"); },
      async removeReaction() { throw new Error("not used"); },
    },
    jobs: {
      async list() { return []; },
      async create() { throw new Error("not used"); },
      async update() { throw new Error("not used"); },
      async apply() { throw new Error("not used"); },
      async refer() { throw new Error("not used"); },
      async pipeline() { throw new Error("not used"); },
      async updateApplicationStatus() { throw new Error("not used"); },
      async updateReferralStatus() { throw new Error("not used"); },
    },
    integrations: {
      async list() { return []; },
      async createPending() { throw new Error("not used"); },
      async verify() { throw new Error("not used"); },
      async activateVerifiedAsDefault() { throw new Error("not used"); },
    },
  };
}

async function withServer(app, work) {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    const address = server.address();
    return await work(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function login(baseUrl) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ staffCode: "1042", secret: "241155" }),
  });
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie").split(";")[0];
}

test("filtered ticket queue reaches modular queue service with resolved/today filters", async () => {
  const services = fakeServices();
  const app = createModularApp({ services });

  await withServer(app, async (baseUrl) => {
    const cookie = await login(baseUrl);
    const response = await fetch(
      `${baseUrl}/api/projects/ipro/tickets?status=resolved&activity=today&limit=25`,
      { headers: { cookie } },
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.tickets[0].status, "resolved");
    assert.equal(services.calls.ticketQueue[0].statusFilter, "resolved");
    assert.equal(services.calls.ticketQueue[0].activityWindow, "today");
    assert.equal(services.calls.ticketQueue[0].limit, "25");
  });
});

test("Supervisor teams route is project scoped", async () => {
  const services = fakeServices();
  const app = createModularApp({ services });

  await withServer(app, async (baseUrl) => {
    const cookie = await login(baseUrl);
    const response = await fetch(`${baseUrl}/api/projects/ipro/teams`, { headers: { cookie } });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body.teams.map((team) => team.id), ["support"]);
    assert.equal(services.calls.teams[0].projectId, "ipro");
  });
});

test("unrelated project is rejected before the team service runs", async () => {
  const services = fakeServices();
  const app = createModularApp({ services });

  await withServer(app, async (baseUrl) => {
    const cookie = await login(baseUrl);
    const response = await fetch(`${baseUrl}/api/projects/kiddio/teams`, { headers: { cookie } });
    const body = await response.json();

    assert.equal(response.status, 403);
    assert.equal(body.code, "FORBIDDEN");
    assert.equal(services.calls.teams.length, 0);
  });
});

test("cross-project membership endpoint passes role team and Supervisor selection to employee service", async () => {
  const services = fakeServices();
  const app = createModularApp({ services });

  await withServer(app, async (baseUrl) => {
    const cookie = await login(baseUrl);
    const response = await fetch(`${baseUrl}/api/projects/ipro/employees/fatima/membership`, {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        role: "agent",
        supervisorUserId: "reema",
        teamId: "support",
      }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(services.calls.assignments[0], {
      actorId: "reema",
      projectId: "ipro",
      targetUserId: "fatima",
      role: "agent",
      supervisorUserId: "reema",
      teamId: "support",
    });
  });
});
