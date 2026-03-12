import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { attachTraceId, getTraceId, sanitizeForLog } from "./observability";
import { getGoogleIntegrationEncryptionKeyHealth } from "./google-integration-crypto";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: false,
  }),
);

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests, please try again shortly." },
  skip: (req) => !req.path.startsWith("/api"),
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many login attempts, please try again later." },
});

app.use("/api", apiLimiter);
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/register", authLimiter);
app.use("/api/auth/google/start", authLimiter);

app.use(
  express.json({
    limit: "5mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: "1mb" }));
app.use(attachTraceId);

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

function logGoogleIntegrationEncryptionKeyPreflight(): void {
  const featureEnabled =
    (process.env.ENABLE_GOOGLE_PERSONAL_CONTEXT ?? "false").toLowerCase() ===
    "true";

  if (!featureEnabled) {
    log(
      "google integration encryption key preflight skipped (ENABLE_GOOGLE_PERSONAL_CONTEXT=false)",
      "google",
    );
    return;
  }

  const health = getGoogleIntegrationEncryptionKeyHealth();
  const configured = health.configured ? "true" : "false";
  const mode = health.mode ? ` mode=${health.mode}` : "";
  const reason = health.reason ? ` reason=${health.reason}` : "";

  if (health.valid) {
    log(
      `google integration encryption key preflight: status=ok configured=${configured}${mode}`,
      "google",
    );
    return;
  }

  console.error(
    `[google] google integration encryption key preflight: status=invalid configured=${configured}${mode}${reason}`,
  );
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: unknown = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `[trace:${getTraceId(req)}] ${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(sanitizeForLog(capturedJsonResponse))}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  logGoogleIntegrationEncryptionKeyPreflight();

  const { ensurePgvectorExtension, backfillEmbeddings } = await import("./memory");
  await ensurePgvectorExtension();
  backfillEmbeddings().catch((err) =>
    console.error("[memory] Startup backfill failed:", err),
  );

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error(`[trace:${getTraceId(_req)}] Internal Server Error:`, sanitizeForLog(err));

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  const host = process.env.HOST || "0.0.0.0";
  const shouldUseReusePort = process.env.REUSE_PORT === "true";

  const listenOptions: {
    port: number;
    host: string;
    reusePort?: boolean;
  } = {
    port,
    host,
  };

  if (shouldUseReusePort) {
    listenOptions.reusePort = true;
  }

  httpServer.listen(
    listenOptions,
    () => {
      log(`serving on ${host}:${port}`);
    },
  );
})();
