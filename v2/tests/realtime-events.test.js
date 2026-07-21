import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import { createProjectEventBroker } from "../src/realtime/project-event-broker.js";
import { canReceiveEvent } from "../src/http/routes/realtime-routes.js";

function workspace(capabilities) {
  return { capabilities };
}

test("HR jobs capability receives job events but not ticket or chat event IDs", () => {
  const context = workspace({
    "jobs.apply": true,
    "jobs.manage": true,
    "tickets.search": false,
    "chat.read": false,
  });

  assert.equal(canReceiveEvent(context, { entityType: "job" }), true);
  assert.equal(canReceiveEvent(context, { entityType: "ticket" }), false);
  assert.equal(canReceiveEvent(context, { entityType: "ticket_comment" }), false);
  assert.equal(canReceiveEvent(context, { entityType: "chat_message" }), false);
});

test("Supervisor ticket and chat capabilities receive relevant project events", () => {
  const context = workspace({
    "tickets.search": true,
    "chat.read": true,
    "jobs.apply": true,
  });

  assert.equal(canReceiveEvent(context, { entityType: "ticket" }), true);
  assert.equal(canReceiveEvent(context, { entityType: "chat_message" }), true);
  assert.equal(canReceiveEvent(context, { entityType: "chat_reaction" }), true);
  assert.equal(canReceiveEvent(context, { entityType: "job" }), true);
});

class FakePgClient extends EventEmitter {
  constructor() {
    super();
    this.queries = [];
    this.released = false;
  }

  async query(sql) {
    this.queries.push(sql);
    return { rows: [] };
  }

  release() {
    this.released = true;
  }
}

test("PostgreSQL broker dispatches notifications only to subscribers of that project", async () => {
  const client = new FakePgClient();
  const pool = { async connect() { return client; } };
  const broker = createProjectEventBroker(pool, { logger: { error() {} } });
  const ipro = [];
  const kiddio = [];

  const unsubscribeIpro = await broker.subscribe("ipro", (event) => ipro.push(event));
  const unsubscribeKiddio = await broker.subscribe("kiddio", (event) => kiddio.push(event));

  client.emit("notification", {
    channel: "telesyriana_events",
    payload: JSON.stringify({ projectId: "ipro", type: "ticket.updated", entityType: "ticket", entityId: "ticket:1" }),
  });

  assert.equal(ipro.length, 1);
  assert.equal(kiddio.length, 0);
  assert.equal(client.queries[0], "LISTEN telesyriana_events");

  unsubscribeIpro();
  unsubscribeKiddio();
  await broker.stop();
  assert.equal(client.released, true);
});
