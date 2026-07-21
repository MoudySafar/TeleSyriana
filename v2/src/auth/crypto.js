import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

const SCRYPT_PARAMS = Object.freeze({
  N: 16_384,
  r: 8,
  p: 1,
  keyLength: 64,
});

export function validateLoginSecret(secret) {
  const value = String(secret ?? "");
  if (!value) throw new Error("Login secret is required");

  if (/^\d+$/.test(value)) {
    if (value.length < 6) {
      throw new Error("Numeric PIN must contain at least 6 digits");
    }
    return value;
  }

  if (value.length < 8) {
    throw new Error("Password must contain at least 8 characters");
  }

  return value;
}

export async function hashLoginSecret(secret, salt = randomBytes(16).toString("base64url")) {
  const value = validateLoginSecret(secret);
  const derived = await scrypt(value, salt, SCRYPT_PARAMS.keyLength, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
  });

  const payload = Buffer.from(derived).toString("base64url");
  return {
    salt,
    hash: `scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${payload}`,
  };
}

export async function verifyLoginSecret(secret, { hash, salt }) {
  if (!hash || !salt) return false;

  const [algorithm, nValue, rValue, pValue, encoded] = String(hash).split("$");
  if (algorithm !== "scrypt" || !encoded) return false;

  const N = Number(nValue);
  const r = Number(rValue);
  const p = Number(pValue);
  if (![N, r, p].every(Number.isFinite)) return false;

  let value;
  try {
    value = validateLoginSecret(secret);
  } catch {
    return false;
  }

  const expected = Buffer.from(encoded, "base64url");
  const derived = Buffer.from(
    await scrypt(value, salt, expected.length, { N, r, p }),
  );

  if (expected.length !== derived.length) return false;
  return timingSafeEqual(expected, derived);
}

export function hashSessionToken(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}

export function createSessionToken() {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: hashSessionToken(token),
  };
}
