import type { InboxDigestItem } from "@shared/agent";

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

interface GoogleUserInfoResponse {
  sub?: string;
  email?: string;
}

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v3/userinfo";
const GMAIL_MESSAGES_ENDPOINT =
  "https://gmail.googleapis.com/gmail/v1/users/me/messages";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

export function getGoogleOAuthConfig(): GoogleOAuthConfig | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) {
    return null;
  }
  return {
    clientId,
    clientSecret,
    redirectUri,
  };
}

export function resolveGoogleOAuthScopes(): string[] {
  const configured = (process.env.GOOGLE_OAUTH_SCOPES ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (configured.length > 0) {
    return configured;
  }

  return [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/gmail.readonly",
  ];
}

export function buildGoogleOAuthConnectUrl(params: {
  config: GoogleOAuthConfig;
  state: string;
  scopes: string[];
}): string {
  const query = new URLSearchParams({
    client_id: params.config.clientId,
    redirect_uri: params.config.redirectUri,
    response_type: "code",
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    scope: params.scopes.join(" "),
    state: params.state,
  });
  return `${GOOGLE_AUTH_ENDPOINT}?${query.toString()}`;
}

async function postGoogleToken(
  body: URLSearchParams,
): Promise<GoogleTokenResponse> {
  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const payload = (await response.json()) as GoogleTokenResponse;
  if (!response.ok) {
    const reason = payload.error_description ?? payload.error ?? response.statusText;
    throw new Error(`Google token exchange failed: ${reason}`);
  }
  return payload;
}

export async function exchangeGoogleOAuthCode(params: {
  config: GoogleOAuthConfig;
  code: string;
}): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiry: Date | null;
  scopes: string[];
  idToken: string | null;
}> {
  const body = new URLSearchParams({
    client_id: params.config.clientId,
    client_secret: params.config.clientSecret,
    redirect_uri: params.config.redirectUri,
    code: params.code,
    grant_type: "authorization_code",
  });
  const payload = await postGoogleToken(body);
  const accessToken = payload.access_token?.trim();
  if (!accessToken) {
    throw new Error("Google token exchange succeeded without access token");
  }
  const refreshToken = payload.refresh_token?.trim() || null;
  const expiry =
    typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in)
      ? new Date(Date.now() + payload.expires_in * 1000)
      : null;
  const scopes = (payload.scope ?? "")
    .split(" ")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return {
    accessToken,
    refreshToken,
    expiry,
    scopes,
    idToken: payload.id_token?.trim() || null,
  };
}

export async function refreshGoogleAccessToken(params: {
  refreshToken: string;
}): Promise<{ accessToken: string; expiry: Date | null; scopes: string[] }> {
  const config = getGoogleOAuthConfig();
  if (!config) {
    throw new Error("Google OAuth is not configured");
  }

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: params.refreshToken,
    grant_type: "refresh_token",
  });

  const payload = await postGoogleToken(body);
  const accessToken = payload.access_token?.trim();
  if (!accessToken) {
    throw new Error("Google token refresh succeeded without access token");
  }
  const expiry =
    typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in)
      ? new Date(Date.now() + payload.expires_in * 1000)
      : null;
  const scopes = (payload.scope ?? "")
    .split(" ")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return { accessToken, expiry, scopes };
}

export async function fetchGoogleUserInfo(params: {
  accessToken: string;
}): Promise<{ googleSub: string; email: string }> {
  const response = await fetch(GOOGLE_USERINFO_ENDPOINT, {
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
    },
  });

  const payload = (await response.json()) as GoogleUserInfoResponse;
  if (!response.ok) {
    throw new Error("Failed to fetch Google user profile");
  }

  const googleSub = payload.sub?.trim();
  const email = payload.email?.trim().toLowerCase();
  if (!googleSub || !email) {
    throw new Error("Google user profile missing required fields");
  }

  return { googleSub, email };
}

function pickHeader(
  headers: Array<{ name?: string; value?: string }> | undefined,
  target: string,
): string {
  if (!Array.isArray(headers)) return "";
  const lowerTarget = target.toLowerCase();
  const match = headers.find(
    (header) => header.name?.toLowerCase() === lowerTarget,
  );
  return match?.value?.trim() ?? "";
}

function classifyUrgency(params: {
  subject: string;
  snippet: string;
  from: string;
}): InboxDigestItem["urgency"] {
  const composite = `${params.subject} ${params.snippet}`.toLowerCase();
  if (/(urgent|asap|deadline|action required|today|eod|immediately|blocking)/i.test(composite)) {
    return "high";
  }

  if (/(newsletter|digest|no-reply|noreply|promotion|receipt)/i.test(`${params.from} ${composite}`)) {
    return "low";
  }

  return "medium";
}

export async function fetchGmailInboxDigest(params: {
  accessToken: string;
  maxThreads: number;
}): Promise<InboxDigestItem[]> {
  const maxThreads = Math.max(1, Math.min(20, Math.floor(params.maxThreads)));
  const query = new URLSearchParams({
    maxResults: String(maxThreads),
    q: "in:inbox newer_than:3d -category:promotions -category:social",
  });

  const listResponse = await fetch(`${GMAIL_MESSAGES_ENDPOINT}?${query.toString()}`, {
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
    },
  });
  const listPayload = (await listResponse.json()) as {
    messages?: Array<{ id?: string; threadId?: string }>;
  };

  if (!listResponse.ok) {
    throw new Error("Failed to list Gmail inbox threads");
  }

  const messageIds = (listPayload.messages ?? [])
    .map((message) => message.id?.trim())
    .filter((id): id is string => Boolean(id));

  if (messageIds.length === 0) {
    return [];
  }

  const detailPromises = messageIds.slice(0, maxThreads).map(async (messageId) => {
    const detailQuery = new URLSearchParams({
      format: "metadata",
      metadataHeaders: "From",
    });
    detailQuery.append("metadataHeaders", "Subject");

    const detailResponse = await fetch(
      `${GMAIL_MESSAGES_ENDPOINT}/${encodeURIComponent(messageId)}?${detailQuery.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${params.accessToken}`,
        },
      },
    );

    if (!detailResponse.ok) {
      return null;
    }

    const detailPayload = (await detailResponse.json()) as {
      id?: string;
      threadId?: string;
      snippet?: string;
      payload?: {
        headers?: Array<{ name?: string; value?: string }>;
      };
    };

    const from = pickHeader(detailPayload.payload?.headers, "From") || "Unknown sender";
    const subject = pickHeader(detailPayload.payload?.headers, "Subject") || "(No subject)";
    const snippet = (detailPayload.snippet ?? "").trim();

    return {
      threadId: detailPayload.threadId?.trim() || detailPayload.id?.trim() || messageId,
      from,
      subject,
      snippet,
      urgency: classifyUrgency({ subject, snippet, from }),
    } satisfies InboxDigestItem;
  });

  const resolved = await Promise.all(detailPromises);
  return resolved.filter((item): item is InboxDigestItem => Boolean(item));
}

export function requireGoogleOAuthConfig(): GoogleOAuthConfig {
  return {
    clientId: requiredEnv("GOOGLE_OAUTH_CLIENT_ID"),
    clientSecret: requiredEnv("GOOGLE_OAUTH_CLIENT_SECRET"),
    redirectUri: requiredEnv("GOOGLE_OAUTH_REDIRECT_URI"),
  };
}
