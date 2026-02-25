import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

const ENCRYPTION_ALGO = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;

function resolveEncryptionKey(): Buffer {
  const raw = process.env.GOOGLE_INTEGRATION_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new Error("GOOGLE_INTEGRATION_ENCRYPTION_KEY is not configured");
  }

  const maybeBase64 = /^[A-Za-z0-9+/=]+$/.test(raw) && raw.length % 4 === 0;
  if (maybeBase64) {
    const decoded = Buffer.from(raw, "base64");
    if (decoded.length === 32) {
      return decoded;
    }
  }

  if (raw.length >= 32) {
    return createHash("sha256").update(raw).digest();
  }

  throw new Error(
    "GOOGLE_INTEGRATION_ENCRYPTION_KEY must be 32-byte base64 or a long passphrase",
  );
}

export function encryptGoogleToken(value: string): string {
  const key = resolveEncryptionKey();
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ENCRYPTION_ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptGoogleToken(payload: string): string {
  const key = resolveEncryptionKey();
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("Invalid encrypted token payload");
  }

  const iv = Buffer.from(parts[1], "base64");
  const authTag = Buffer.from(parts[2], "base64");
  const ciphertext = Buffer.from(parts[3], "base64");
  const decipher = createDecipheriv(ENCRYPTION_ALGO, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
