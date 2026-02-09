import { createHmac, timingSafeEqual } from "crypto";

const DEFAULT_MEDIA_URL_TTL_SECONDS = 5 * 60;

function requireSigningSecret(): string {
  const configured =
    process.env.MEDIA_SIGNING_SECRET ??
    process.env.SESSION_SECRET ??
    "dev-media-signing-secret";
  const secret = configured.trim();
  if (secret.length >= 16) {
    return secret;
  }
  return `${secret}.media-signing-fallback`;
}

function payloadForSignature(attachmentId: string, userId: string, exp: number): string {
  return `${attachmentId}.${exp}.${userId}`;
}

export function createMediaSignature(
  attachmentId: string,
  userId: string,
  exp: number,
): string {
  const secret = requireSigningSecret();
  return createHmac("sha256", secret)
    .update(payloadForSignature(attachmentId, userId, exp))
    .digest("hex");
}

export function verifyMediaSignature(params: {
  attachmentId: string;
  userId: string;
  exp: number;
  sig: string;
}): boolean {
  if (!params.sig) return false;
  const expected = createMediaSignature(
    params.attachmentId,
    params.userId,
    params.exp,
  );

  const expectedBuffer = Buffer.from(expected, "hex");
  const providedBuffer = Buffer.from(params.sig, "hex");
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
}

export function getMediaUrlExpiry(epochSecondsNow = Math.floor(Date.now() / 1000)): number {
  return epochSecondsNow + DEFAULT_MEDIA_URL_TTL_SECONDS;
}

export function createSignedMediaPath(
  attachmentId: string,
  userId: string,
  epochSecondsNow?: number,
): string {
  const exp = getMediaUrlExpiry(epochSecondsNow);
  const sig = createMediaSignature(attachmentId, userId, exp);
  return `/api/media/${attachmentId}?exp=${exp}&sig=${sig}`;
}
