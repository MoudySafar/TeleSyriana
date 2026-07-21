import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

function decodeMasterKey(value = process.env.INTEGRATION_MASTER_KEY) {
  const raw = String(value || "").trim();
  if (!raw) throw new Error("INTEGRATION_MASTER_KEY is required");

  let key;
  if (/^[a-f0-9]{64}$/i.test(raw)) {
    key = Buffer.from(raw, "hex");
  } else {
    key = Buffer.from(raw, "base64");
  }

  if (key.length !== 32) {
    throw new Error("INTEGRATION_MASTER_KEY must decode to exactly 32 bytes");
  }
  return key;
}

export function encryptIntegrationCredentials(value, masterKey) {
  const key = decodeMasterKey(masterKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    version: 1,
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    tag: tag.toString("base64"),
  };
}

export function decryptIntegrationCredentials(payload, masterKey) {
  if (!payload || payload.version !== 1 || payload.algorithm !== "aes-256-gcm") {
    throw new Error("Unsupported encrypted integration credential payload");
  }

  const key = decodeMasterKey(masterKey);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(payload.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]);

  return JSON.parse(plaintext.toString("utf8"));
}

export function generateIntegrationMasterKey() {
  return randomBytes(32).toString("base64");
}
