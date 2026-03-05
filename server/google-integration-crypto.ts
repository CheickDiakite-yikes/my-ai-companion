import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

const ENCRYPTION_ALGO = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;

export type GoogleIntegrationEncryptionKeyMode =
  | "base64_32byte"
  | "passphrase_sha256";

export interface GoogleIntegrationEncryptionKeyHealth {
  configured: boolean;
  valid: boolean;
  mode: GoogleIntegrationEncryptionKeyMode | null;
  reason: string | null;
}

function deriveEncryptionKey(
  raw: string,
): { key: Buffer; mode: GoogleIntegrationEncryptionKeyMode } | null {
  const maybeBase64 = /^[A-Za-z0-9+/=]+$/.test(raw) && raw.length % 4 === 0;
  if (maybeBase64) {
    const decoded = Buffer.from(raw, "base64");
    if (decoded.length === 32) {
      return {
        key: decoded,
        mode: "base64_32byte",
      };
    }
  }

  if (raw.length >= 32) {
    return {
      key: createHash("sha256").update(raw).digest(),
      mode: "passphrase_sha256",
    };
  }

  return null;
}

export function getGoogleIntegrationEncryptionKeyHealth(): GoogleIntegrationEncryptionKeyHealth {
  const raw = process.env.GOOGLE_INTEGRATION_ENCRYPTION_KEY?.trim();
  if (!raw) {
    return {
      configured: false,
      valid: false,
      mode: null,
      reason: "GOOGLE_INTEGRATION_ENCRYPTION_KEY is not configured",
    };
  }

  const derived = deriveEncryptionKey(raw);
  if (!derived) {
    return {
      configured: true,
      valid: false,
      mode: null,
      reason:
        "GOOGLE_INTEGRATION_ENCRYPTION_KEY must be 32-byte base64 or a long passphrase",
    };
  }

  return {
    configured: true,
    valid: true,
    mode: derived.mode,
    reason: null,
  };
}

function resolveEncryptionKey(): Buffer {
  const raw = process.env.GOOGLE_INTEGRATION_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new Error("GOOGLE_INTEGRATION_ENCRYPTION_KEY is not configured");
  }

  const derived = deriveEncryptionKey(raw);
  if (derived) {
    return derived.key;
  }

  throw new Error(
    "GOOGLE_INTEGRATION_ENCRYPTION_KEY must be 32-byte base64 or a long passphrase",
  );
}

export function encryptGoogleToken(value: string): string {
  const key = resolveEncryptionKey();
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ENCRYPTION_ALGO, key, iv, { authTagLength: AUTH_TAG_LENGTH_BYTES });
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
  const decipher = createDecipheriv(ENCRYPTION_ALGO, key, iv, { authTagLength: AUTH_TAG_LENGTH_BYTES });
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
