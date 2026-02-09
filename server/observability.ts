import { randomUUID } from "crypto";
import type { NextFunction, Request, Response } from "express";

declare global {
  namespace Express {
    interface Request {
      traceId?: string;
    }
  }
}

type Primitive = string | number | boolean | null;

const REDACT_KEYS = new Set([
  "authorization",
  "apiKey",
  "apikey",
  "sig",
  "signature",
  "token",
  "accessToken",
  "refreshToken",
  "password",
  "passwordHash",
  "secret",
  "session",
  "cookie",
  "set-cookie",
]);

function shouldRedactKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (REDACT_KEYS.has(key) || REDACT_KEYS.has(lower)) return true;

  const isTokenCountField =
    lower.endsWith("tokencount") || lower.includes("token_count");
  if (isTokenCountField) return false;

  return (
    lower.includes("token") ||
    lower.includes("secret") ||
    lower.includes("password") ||
    lower.includes("authorization") ||
    lower.includes("api_key") ||
    lower.includes("apikey")
  );
}

const MAX_LOG_STRING = 300;
const MAX_DEPTH = 5;

function truncate(input: string, maxLen = MAX_LOG_STRING): string {
  if (input.length <= maxLen) return input;
  return `${input.slice(0, maxLen)}...[truncated:${input.length - maxLen}]`;
}

function sanitizeString(input: string): string {
  let sanitized = input;
  sanitized = sanitized.replace(
    /([?&](?:sig|signature)=)[^&]+/gi,
    "$1[redacted]",
  );
  sanitized = sanitized.replace(/auth_tokens\/[A-Za-z0-9_-]{8,}/g, "auth_tokens/[redacted]");
  return truncate(sanitized);
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return sanitizeString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;

  if (depth >= MAX_DEPTH) return "[depth-limited]";

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, depth + 1));
  }

  if (typeof value === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (shouldRedactKey(key)) {
        sanitized[key] = "[redacted]";
        continue;
      }
      sanitized[key] = sanitizeValue(nested, depth + 1);
    }
    return sanitized;
  }

  return String(value);
}

export function sanitizeForLog(value: unknown): unknown {
  return sanitizeValue(value, 0);
}

export function getTraceId(req: Request): string {
  return req.traceId ?? "trace-missing";
}

export function attachTraceId(req: Request, res: Response, next: NextFunction) {
  const incoming =
    req.get("x-trace-id") ??
    req.get("x-request-id") ??
    req.get("x-correlation-id");
  req.traceId = incoming && incoming.trim().length > 0 ? incoming.trim() : randomUUID();
  res.setHeader("x-trace-id", req.traceId);
  next();
}

export function trace(
  req: Request,
  event: string,
  data: Record<string, unknown> = {},
) {
  const payload = {
    ts: new Date().toISOString(),
    level: "INFO",
    event,
    traceId: getTraceId(req),
    method: req.method,
    path: req.path,
    userId: (req as any).session?.userId ?? null,
    data: sanitizeForLog(data),
  };
  console.log(JSON.stringify(payload));
}

export function traceError(
  req: Request,
  event: string,
  error: unknown,
  data: Record<string, unknown> = {},
) {
  const err =
    error instanceof Error
      ? {
          name: error.name,
          message: error.message,
          stack: truncate(error.stack ?? "", 1200),
        }
      : { message: String(error) };

  const payload = {
    ts: new Date().toISOString(),
    level: "ERROR",
    event,
    traceId: getTraceId(req),
    method: req.method,
    path: req.path,
    userId: (req as any).session?.userId ?? null,
    data: sanitizeForLog({
      ...data,
      error: err,
    }),
  };
  console.error(JSON.stringify(payload));
}

export function elapsedMs(startedAt: number): number {
  return Date.now() - startedAt;
}
