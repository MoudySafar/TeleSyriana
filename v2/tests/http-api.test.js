import test from "node:test";
import assert from "node:assert/strict";

import { createApp } from "../src/http/app.js";

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
  return {
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
          mustReset: true,
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
      async logout() { return { revokedAt: new Date() }; },
      async changeSecret() { return { mustReset: false }; },
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
    employees: {
      async createForProject({ projectId, input }) {
        return {
          user: {
            id: "new-agent",
            staffCode: input.staffCode,
            displayName: input.displayName,
            platformRole: "member",
            status: "active",
            locale: "en",
            theme: "system",
          },
          membership: { userId: "new-agent", projectId, role: "agent", status: "active" },
          mustResetLoginSecret: true,
        };
      },
      async changeProjectRole() { return { membership: { role: "supervisor" } }; },
      async disableFromProject() { return { membership: { status: "disabled" } }; },
      async reactivateInProject() { return { membership: { status: "active" } }; },
      async disableAccount() { return { user: { ...reema, id: "target", status: "disabled" } }; },
      async reactivateAccount() { return { user: { ...reema, id: "target", status: "active" } }; },
    },
    tickets: {},
    orders: {},
    integrations: {},
    chat: {},
    jobs: {},
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

test("login sets HttpOnly session cookie and never returns raw token JSON", async () => {
  const app = createApp({ services: fakeServices(), cookieName: "ts_session" });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ staffCode: "1042", secret: "241155" }),
    });
    const body = await response.json();
    const setCookie = response.headers.get("set-cookie");

    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.mustResetLoginSecret, true);
    assert.equal("token" in body, false);
    assert.match(setCookie, /^ts_session=raw-session-token/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
  });
});

test("authenticated Supervisor me response contains only visible iPro project", async () => {
  const app = createApp({ services: fakeServices(), cookieName: "ts_session" });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/me`, {
      headers: { cookie: "ts_session=raw-session-token" },
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body.projects.map((project) => project.id), ["ipro"]);
    assert.equal(body.canViewAllProjects, false);
  });
});

test("project endpoint refuses unrelated project before employee action executes", async () => {
  const services = fakeServices();
  let employeeCreateCalls = 0;
  services.employees.createForProject = async () => {
    employeeCreateCalls += 1;
    throw new Error("should not run");
  };

  const app = createApp({ services, cookieName: "ts_session" });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/projects/kiddio/employees`, {
      method: "POST",
      headers: {
        cookie: "ts_session=raw-session-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        staffCode: "1050",
        displayName: "Another Agent",
        temporarySecret: "551122",
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 403);
    assert.equal(body.code, "FORBIDDEN");
    assert.equal(employeeCreateCalls, 0);
  });
});

test("employee creation response does not expose temporary secret or credential hash", async () => {
  const app = createApp({ services: fakeServices(), cookieName: "ts_session" });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/projects/ipro/employees`, {
      method: "POST",
      headers: {
        cookie: "ts_session=raw-session-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        staffCode: "1050",
        displayName: "New Agent",
        temporarySecret: "551122",
      }),
    });
    const text = await response.text();
    const body = JSON.parse(text);

    assert.equal(response.status, 201);
    assert.equal(body.employee.staffCode, "1050");
    assert.equal(body.mustResetLoginSecret, true);
    assert.doesNotMatch(text, /551122/);
    assert.doesNotMatch(text, /secretHash/);
  });
});
