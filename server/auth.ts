import { createHash, randomBytes } from "crypto";
import type { Express, Request, RequestHandler } from "express";
import session from "express-session";
import connectPg from "connect-pg-simple";
import bcrypt from "bcryptjs";
import { db } from "./db";
import { users, registerSchema, loginSchema, type User } from "@shared/models/auth";
import { eq } from "drizzle-orm";

declare module "express-session" {
  interface SessionData {
    userId: string;
    googleAuth?: {
      state: string;
      codeVerifier: string;
      returnTo: string;
      issuedAt: number;
    };
  }
}

const GOOGLE_SSO_PASSWORD_PLACEHOLDER = "__AUTH0_GOOGLE_SSO_ACCOUNT__";
const GOOGLE_AUTH_STATE_TTL_MS = 10 * 60 * 1000;

function parseAuth0Domain(): string | null {
  const raw = (process.env.AUTH0_DOMAIN ?? "").trim();
  if (!raw) return null;
  const withoutProtocol = raw.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  return withoutProtocol || null;
}

function getAuth0Config() {
  const domain = parseAuth0Domain();
  const clientId = (process.env.AUTH0_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.AUTH0_CLIENT_SECRET ?? "").trim();
  const connection = (process.env.AUTH0_GOOGLE_CONNECTION ?? "google-oauth2").trim();
  const audience = (process.env.AUTH0_AUDIENCE ?? "").trim() || null;
  const postLoginRedirect =
    (process.env.AUTH0_POST_LOGIN_REDIRECT ?? "/").trim() || "/";
  const redirectUriOverride =
    (process.env.AUTH0_REDIRECT_URI ?? "").trim() || null;
  const missing: string[] = [];
  if (!domain) missing.push("AUTH0_DOMAIN");
  if (!clientId) missing.push("AUTH0_CLIENT_ID");
  if (!clientSecret) missing.push("AUTH0_CLIENT_SECRET");
  return {
    domain,
    clientId,
    clientSecret,
    connection,
    audience,
    postLoginRedirect,
    redirectUriOverride,
    missing,
    configured: missing.length === 0,
  };
}

function toBase64Url(input: Buffer): string {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function randomBase64Url(bytes: number): string {
  return toBase64Url(randomBytes(bytes));
}

function createCodeChallenge(verifier: string): string {
  const digest = createHash("sha256").update(verifier).digest();
  return toBase64Url(digest);
}

function isBcryptHash(value: string): boolean {
  return /^\$2[abxy]\$/.test(value);
}

function sanitizeReturnTo(returnToRaw: unknown, fallback: string): string {
  if (typeof returnToRaw !== "string") return fallback;
  const value = returnToRaw.trim();
  if (!value) return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  return value;
}

function resolveGoogleSsoCallbackUrl(req: Request): string {
  const auth0 = getAuth0Config();
  if (auth0.redirectUriOverride) return auth0.redirectUriOverride;
  return `${req.protocol}://${req.get("host")}/api/auth/google/callback`;
}

function deriveNamesFromProfile(email: string, givenName?: string | null, familyName?: string | null, fullName?: string | null) {
  const fallbackBase = email.split("@")[0] || "User";
  const fallbackFirst = fallbackBase.replace(/[._-]+/g, " ").trim().split(/\s+/)[0] || "User";
  const firstName = (givenName ?? "").trim() || fallbackFirst;
  const lastName = (familyName ?? "").trim() || (() => {
    const words = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
    if (words.length >= 2) return words.slice(1).join(" ");
    return "User";
  })();
  return { firstName, lastName };
}

export function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  const sessionSecret =
    process.env.SESSION_SECRET ?? "dev-only-session-secret-change-me";

  if (!process.env.SESSION_SECRET && process.env.NODE_ENV !== "production") {
    console.warn(
      "[auth] SESSION_SECRET is not set; using development fallback secret.",
    );
  }

  const sessionTtl = 7 * 24 * 60 * 60 * 1000;
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });

  app.use(
    session({
      secret: sessionSecret,
      store: sessionStore,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        maxAge: sessionTtl,
        sameSite: "lax",
      },
    })
  );
}

export function registerAuthRoutes(app: Express) {
  app.get("/api/auth/google/start", async (req, res) => {
    const fallbackReturnTo = sanitizeReturnTo(
      (process.env.AUTH0_POST_LOGIN_REDIRECT ?? "/").trim(),
      "/",
    );
    const returnTo = sanitizeReturnTo(req.query.returnTo, fallbackReturnTo);
    const redirectWithError = (reason: string) => {
      const redirectUrl = new URL(returnTo, `${req.protocol}://${req.get("host")}`);
      redirectUrl.searchParams.set("auth_error", reason);
      return res.redirect(redirectUrl.toString());
    };

    try {
      const auth0 = getAuth0Config();
      if (!auth0.configured || !auth0.domain) {
        return redirectWithError("google_sso_not_configured");
      }

      const mode = typeof req.query.mode === "string" ? req.query.mode : "signin";
      const callbackUrl = resolveGoogleSsoCallbackUrl(req);
      const state = randomBase64Url(32);
      const codeVerifier = randomBase64Url(64);
      const codeChallenge = createCodeChallenge(codeVerifier);
      req.session.googleAuth = {
        state,
        codeVerifier,
        returnTo,
        issuedAt: Date.now(),
      };

      const authorizeUrl = new URL(`https://${auth0.domain}/authorize`);
      authorizeUrl.searchParams.set("response_type", "code");
      authorizeUrl.searchParams.set("client_id", auth0.clientId);
      authorizeUrl.searchParams.set("redirect_uri", callbackUrl);
      authorizeUrl.searchParams.set("scope", "openid profile email");
      authorizeUrl.searchParams.set("state", state);
      authorizeUrl.searchParams.set("code_challenge", codeChallenge);
      authorizeUrl.searchParams.set("code_challenge_method", "S256");
      authorizeUrl.searchParams.set("connection", auth0.connection);
      authorizeUrl.searchParams.set("prompt", "select_account");
      if (mode === "signup") {
        authorizeUrl.searchParams.set("screen_hint", "signup");
      }
      if (auth0.audience) {
        authorizeUrl.searchParams.set("audience", auth0.audience);
      }

      return res.redirect(authorizeUrl.toString());
    } catch (error) {
      console.error("[auth/google/start] failed:", error);
      return redirectWithError("google_sign_in_failed");
    }
  });

  app.get("/api/auth/google/callback", async (req, res) => {
    const fallbackReturnTo = sanitizeReturnTo(
      (process.env.AUTH0_POST_LOGIN_REDIRECT ?? "/").trim(),
      "/",
    );
    const redirectWithError = (reason: string, returnToOverride?: string) => {
      const redirectUrl = new URL(
        returnToOverride ?? fallbackReturnTo,
        `${req.protocol}://${req.get("host")}`,
      );
      redirectUrl.searchParams.set("auth_error", reason);
      return res.redirect(redirectUrl.toString());
    };

    try {
      const auth0 = getAuth0Config();
      if (!auth0.configured || !auth0.domain) {
        return redirectWithError("google_sso_not_configured");
      }

      const stateFromSession = req.session.googleAuth;
      const returnTo = sanitizeReturnTo(
        stateFromSession?.returnTo,
        fallbackReturnTo,
      );
      if (!stateFromSession) {
        return redirectWithError("invalid_oauth_state", returnTo);
      }
      if (Date.now() - stateFromSession.issuedAt > GOOGLE_AUTH_STATE_TTL_MS) {
        req.session.googleAuth = undefined;
        return redirectWithError("expired_oauth_state", returnTo);
      }

      const errorFromProvider =
        typeof req.query.error === "string" ? req.query.error : null;
      if (errorFromProvider) {
        req.session.googleAuth = undefined;
        return redirectWithError(errorFromProvider, returnTo);
      }

      const code = typeof req.query.code === "string" ? req.query.code : null;
      const state = typeof req.query.state === "string" ? req.query.state : null;
      if (!code || !state || state !== stateFromSession.state) {
        req.session.googleAuth = undefined;
        return redirectWithError("invalid_oauth_state", returnTo);
      }

      const callbackUrl = resolveGoogleSsoCallbackUrl(req);
      const tokenResponse = await fetch(`https://${auth0.domain}/oauth/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          grant_type: "authorization_code",
          client_id: auth0.clientId,
          client_secret: auth0.clientSecret,
          code,
          redirect_uri: callbackUrl,
          code_verifier: stateFromSession.codeVerifier,
        }),
      });

      if (!tokenResponse.ok) {
        const text = await tokenResponse.text().catch(() => "");
        console.error("[auth/google/callback] token exchange failed", {
          status: tokenResponse.status,
          body: text.slice(0, 300),
        });
        req.session.googleAuth = undefined;
        return redirectWithError("oauth_exchange_failed", returnTo);
      }

      const tokenPayload = (await tokenResponse.json()) as {
        access_token?: string;
      };
      if (!tokenPayload.access_token) {
        req.session.googleAuth = undefined;
        return redirectWithError("missing_access_token", returnTo);
      }

      const userInfoResponse = await fetch(`https://${auth0.domain}/userinfo`, {
        headers: {
          Authorization: `Bearer ${tokenPayload.access_token}`,
        },
      });

      if (!userInfoResponse.ok) {
        req.session.googleAuth = undefined;
        return redirectWithError("userinfo_fetch_failed", returnTo);
      }

      const profile = (await userInfoResponse.json()) as {
        email?: string;
        given_name?: string;
        family_name?: string;
        name?: string;
        picture?: string;
      };
      const email = (profile.email ?? "").trim().toLowerCase();
      if (!email) {
        req.session.googleAuth = undefined;
        return redirectWithError("missing_email", returnTo);
      }

      const { firstName, lastName } = deriveNamesFromProfile(
        email,
        profile.given_name,
        profile.family_name,
        profile.name,
      );

      const [existing] = await db.select().from(users).where(eq(users.email, email));
      let user: User;
      if (existing) {
        const updatePayload: Partial<typeof users.$inferInsert> = {
          updatedAt: new Date(),
        };
        if (!existing.firstName && firstName) updatePayload.firstName = firstName;
        if (!existing.lastName && lastName) updatePayload.lastName = lastName;
        if (!existing.profileImageUrl && profile.picture) {
          updatePayload.profileImageUrl = profile.picture;
        }
        const [updated] = await db
          .update(users)
          .set(updatePayload)
          .where(eq(users.id, existing.id))
          .returning();
        user = updated ?? existing;
      } else {
        const [created] = await db
          .insert(users)
          .values({
            email,
            passwordHash: GOOGLE_SSO_PASSWORD_PLACEHOLDER,
            firstName,
            lastName,
            profileImageUrl: profile.picture ?? null,
          })
          .returning();
        user = created;
      }

      req.session.userId = user.id;
      req.session.googleAuth = undefined;
      return res.redirect(returnTo);
    } catch (error) {
      console.error("[auth/google/callback] failed:", error);
      return redirectWithError("google_sign_in_failed");
    }
  });

  app.post("/api/auth/register", async (req, res) => {
    try {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.issues[0].message });
      }

      const { email, password, firstName, lastName, profession, referralSource } = parsed.data;

      const [existing] = await db.select().from(users).where(eq(users.email, email));
      if (existing) {
        return res.status(409).json({ message: "An account with this email already exists" });
      }

      const passwordHash = await bcrypt.hash(password, 12);

      const [user] = await db
        .insert(users)
        .values({
          email,
          passwordHash,
          firstName,
          lastName,
          profession: profession || null,
          referralSource: referralSource || null,
        })
        .returning();

      req.session.userId = user.id;

      const { passwordHash: _, ...safeUser } = user;
      res.status(201).json(safeUser);
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ message: "Something went wrong. Please try again." });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.issues[0].message });
      }

      const { email, password } = parsed.data;

      const [user] = await db.select().from(users).where(eq(users.email, email));
      if (!user) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      if (!isBcryptHash(user.passwordHash)) {
        return res
          .status(401)
          .json({ message: "Use Google sign-in for this account." });
      }

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      req.session.userId = user.id;

      const { passwordHash: _, ...safeUser } = user;
      res.json(safeUser);
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ message: "Something went wrong. Please try again." });
    }
  });

  app.get("/api/auth/user", async (req, res) => {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    try {
      const [user] = await db.select().from(users).where(eq(users.id, req.session.userId));
      if (!user) {
        req.session.destroy(() => {});
        return res.status(401).json({ message: "Unauthorized" });
      }

      const { passwordHash: _, ...safeUser } = user;
      res.json(safeUser);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: "Failed to log out" });
      }
      res.clearCookie("connect.sid");
      res.json({ message: "Logged out" });
    });
  });
}

export const isAuthenticated: RequestHandler = (req, res, next) => {
  if (!req.session.userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  next();
};
