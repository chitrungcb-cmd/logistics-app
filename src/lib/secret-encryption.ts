import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const PREFIX = "enc:v1";

export function isEncryptedSecret(value: string) {
  return value.startsWith(`${PREFIX}:`);
}

function encryptionKey() {
  const tokenKey = process.env.TOKEN_ENCRYPTION_KEY;
  const authKey = process.env.AUTH_SECRET;
  if (process.env.NODE_ENV === "production") {
    if (!tokenKey || Buffer.byteLength(tokenKey, "utf8") < 32) {
      throw new Error("TOKEN_ENCRYPTION_KEY must contain at least 32 bytes in production.");
    }
    if (tokenKey === authKey) {
      throw new Error("TOKEN_ENCRYPTION_KEY must be different from AUTH_SECRET.");
    }
  }
  const source = tokenKey ?? authKey;
  if (!source) throw new Error("TOKEN_ENCRYPTION_KEY or AUTH_SECRET is not set.");
  return createHash("sha256").update(source).digest();
}

export function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(":");
}

export function decryptSecret(value: string) {
  if (!isEncryptedSecret(value)) return value; // one-time compatibility for an existing token
  const [, , ivRaw, tagRaw, encryptedRaw] = value.split(":");
  if (!ivRaw || !tagRaw || !encryptedRaw) throw new Error("Encrypted secret has an invalid format.");

  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
