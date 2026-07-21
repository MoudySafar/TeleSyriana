import test from "node:test";
import assert from "node:assert/strict";

import { createProfileService } from "../src/profile/profile-service.js";

function fakeRepository() {
  const calls = [];
  return {
    calls,
    async updatePreferences(input) {
      calls.push(input);
      return {
        id: input.userId,
        displayName: "Reema Obaid",
        status: "active",
        platformRole: "member",
        locale: input.locale,
        theme: input.theme,
      };
    },
  };
}

function serviceWith(repository) {
  return createProfileService({
    pool: {},
    runInTransaction: async (_pool, work) => work({}),
    repositoryFactory: () => repository,
  });
}

test("employee language and theme are stored together in cloud profile", async () => {
  const repository = fakeRepository();
  const service = serviceWith(repository);

  const result = await service.updatePreferences({
    userId: "reema",
    locale: "ar",
    theme: "dark",
  });

  assert.equal(result.locale, "ar");
  assert.equal(result.theme, "dark");
  assert.deepEqual(repository.calls[0], {
    userId: "reema",
    locale: "ar",
    theme: "dark",
  });
});

test("unsupported locale is rejected", async () => {
  const repository = fakeRepository();
  const service = serviceWith(repository);

  await assert.rejects(
    service.updatePreferences({ userId: "reema", locale: "fr", theme: "dark" }),
    (error) => error.code === "INVALID_INPUT",
  );
  assert.equal(repository.calls.length, 0);
});

test("unsupported theme is rejected", async () => {
  const repository = fakeRepository();
  const service = serviceWith(repository);

  await assert.rejects(
    service.updatePreferences({ userId: "reema", locale: "en", theme: "neon" }),
    (error) => error.code === "INVALID_INPUT",
  );
  assert.equal(repository.calls.length, 0);
});
