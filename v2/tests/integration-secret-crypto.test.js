import test from "node:test";
import assert from "node:assert/strict";

import {
  decryptIntegrationCredentials,
  encryptIntegrationCredentials,
} from "../src/integrations/secret-crypto.js";

const masterKey = Buffer.alloc(32, 7).toString("base64");

test("Shopify credentials are encrypted and can be decrypted with the master key", () => {
  const input = {
    clientId: "client-id-example",
    clientSecret: "super-secret-shopify-value",
  };

  const encrypted = encryptIntegrationCredentials(input, masterKey);
  const serialized = JSON.stringify(encrypted);

  assert.equal(encrypted.algorithm, "aes-256-gcm");
  assert.doesNotMatch(serialized, /super-secret-shopify-value/);
  assert.doesNotMatch(serialized, /client-id-example/);
  assert.deepEqual(decryptIntegrationCredentials(encrypted, masterKey), input);
});

test("encrypted credentials cannot be decrypted with the wrong master key", () => {
  const encrypted = encryptIntegrationCredentials(
    { clientId: "id", clientSecret: "secret" },
    masterKey,
  );
  const wrongKey = Buffer.alloc(32, 8).toString("base64");

  assert.throws(() => decryptIntegrationCredentials(encrypted, wrongKey));
});
