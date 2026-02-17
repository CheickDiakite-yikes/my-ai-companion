export type MobilePlatform = "ios" | "android" | "web";

const HOSTED_WEB_URL = "https://zeeme.replit.app";

export function createTraceId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `trace-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeUrl(value: string | undefined | null): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

export function defaultLocalWebUrl(platform: MobilePlatform): string {
  return HOSTED_WEB_URL;
}

export function resolveWebAppUrl(options?: {
  explicitUrl?: string;
  platform?: MobilePlatform;
  fallbackUrl?: string;
}): string {
  const explicit = normalizeUrl(options?.explicitUrl);
  if (explicit) {
    return explicit;
  }

  if (options?.platform) {
    return defaultLocalWebUrl(options.platform);
  }

  return options?.fallbackUrl ?? HOSTED_WEB_URL;
}
