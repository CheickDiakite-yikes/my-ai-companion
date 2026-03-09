import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { db } from "../server/db";
import { encryptGoogleToken } from "../server/google-integration-crypto";
import { users } from "../shared/models/auth";
import { googleIntegrations } from "../shared/schema";
import {
  clearLiveTraceBuffer,
  installLiveVoiceFixtureMic,
  playLiveFixture,
  readLiveTraceBuffer,
  type LiveVoiceFixtureManifest,
} from "./live-voice-fixture-lib";

interface CliArgs {
  baseUrl: string;
  email: string;
  password: string;
  outputDir: string;
  skipAudioPreflight: boolean;
}

type LiveTraceEntry = {
  at: number;
  event: string;
  metadata: Record<string, unknown>;
};

type GoogleFixtureScopeMode = "read" | "write";

const GOOGLE_GMAIL_READONLY_SCOPE =
  "https://www.googleapis.com/auth/gmail.readonly";
const GOOGLE_GMAIL_COMPOSE_SCOPE =
  "https://www.googleapis.com/auth/gmail.compose";
const GOOGLE_GMAIL_SEND_SCOPE =
  "https://www.googleapis.com/auth/gmail.send";
const GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE =
  "https://www.googleapis.com/auth/calendar.events.readonly";
const GOOGLE_CALENDAR_EVENTS_WRITE_SCOPE =
  "https://www.googleapis.com/auth/calendar.events";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(args.outputDir, { recursive: true });
  const manifest = await loadManifest();
  const browser = await launchBrowser();
  let context: BrowserContext | null = null;

  try {
    const contextOrigin = new URL(args.baseUrl).origin;
    context = await browser.newContext({
      viewport: { width: 430, height: 932 },
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    });
    await context.grantPermissions(["microphone"], {
      origin: contextOrigin,
    });
    const page = await context.newPage();
    const consoleTraceBuffer: LiveTraceEntry[] = [];
    page.on("console", (message) => {
      const trace = parseLiveTraceConsoleMessage(message.text());
      if (!trace) return;
      consoleTraceBuffer.push(trace);
      if (consoleTraceBuffer.length > 500) {
        consoleTraceBuffer.splice(0, consoleTraceBuffer.length - 500);
      }
    });

    const clearTraceBuffer = async (): Promise<void> => {
      consoleTraceBuffer.splice(0, consoleTraceBuffer.length);
      await clearLiveTraceBuffer(page);
    };

    const readTraceBuffer = async (): Promise<LiveTraceEntry[]> => {
      const injectedTrace = await readLiveTraceBuffer(page);
      return injectedTrace.length > 0 ? injectedTrace : consoleTraceBuffer.slice();
    };

    await installLiveVoiceFixtureMic(page, manifest);
    await login(page, args);
    await dismissOnboardingIfPresent(page);
    await startVoiceSession(page, readTraceBuffer, clearTraceBuffer);
    await assertVoiceStageClosedByDefault(page);

    let noiseTrace: LiveTraceEntry[] = [];
    let speechTrace: LiveTraceEntry[] = [];
    let interruptTrace: LiveTraceEntry[] = [];

    if (!args.skipAudioPreflight) {
      await clearTraceBuffer();
      await playLiveFixture(page, "noise_only");
      await page.waitForTimeout(2400);
      noiseTrace = await readTraceBuffer();
      if (noiseTrace.length > 0) {
        assert.equal(
          hasSpeechState(noiseTrace, "user_speaking"),
          false,
          "noise_only fixture should not trigger user_speaking",
        );
      }

      await clearTraceBuffer();
      await playLiveFixture(page, "speech_burst");
      await page.waitForTimeout(2800);
      speechTrace = await readTraceBuffer();
      if (speechTrace.length > 0) {
        assert.equal(
          hasSpeechState(speechTrace, "candidate_user_speech") ||
            speechTrace.some((entry) => entry.event === "live.audio.activity_start_sent"),
          true,
          "speech_burst should trigger speech candidate or activity start",
        );
        assert.equal(
          hasSpeechState(speechTrace, "user_speaking"),
          true,
          "speech_burst should enter user_speaking",
        );
      }

      await clearTraceBuffer();
      await page.getByTestId("button-interrupt-assistant").click();
      await page.waitForTimeout(800);
      interruptTrace = await readTraceBuffer();
      if (interruptTrace.length > 0) {
        assert.equal(
          interruptTrace.some((entry) =>
            [
              "live.assistant.interrupt_requested",
              "live.assistant.interrupt_ignored_no_assistant_audio",
              "live.assistant.interrupt_ignored",
            ].includes(entry.event),
          ),
          true,
          "manual interrupt button should either request interrupt or be explicitly ignored while assistant is idle",
        );
      }
    }

    await clearTraceBuffer();
    const conversationId = await resolveActiveConversationId(page, args.baseUrl);
    await upsertGoogleIntegrationFixture(args.email, "write");
    await prepareLiveGoogleAction(page, args.baseUrl, {
      conversationId,
      functionName: "prepare_google_calendar_action",
      request: "create a calendar event lunch with Alex",
      timezone: "America/New_York",
      expectedStatus: "clarification_needed",
    });
    await assertVoiceCalendarSessionSurface(page, readTraceBuffer);
    await prepareLiveGoogleAction(page, args.baseUrl, {
      conversationId,
      functionName: "prepare_google_email_action",
      request: "draft an email to voice-stage@example.com saying hello from voice mode",
    });
    await prepareLiveGoogleAction(page, args.baseUrl, {
      conversationId,
      functionName: "prepare_google_calendar_action",
      request:
        "create a calendar event called lunch with Alex tomorrow at 2pm at Blue Bottle",
      timezone: "America/New_York",
    });
    const voiceStageTrace = await assertVoiceStageSurface(page, readTraceBuffer);

    const combinedTrace = {
      noiseTrace,
      speechTrace,
      interruptTrace,
      voiceStageTrace,
    };
    await writeFile(
      resolve(args.outputDir, "live-voice-playwright-traces.json"),
      JSON.stringify(combinedTrace, null, 2),
      "utf8",
    );
    await page.screenshot({
      path: resolve(args.outputDir, "live-voice-playwright.png"),
      fullPage: true,
    });
    await page.screenshot({
      path: resolve(args.outputDir, "live-voice-playwright-stage.png"),
      fullPage: true,
    });

    await page.getByTestId("button-end-call").click();
    console.log("live voice Playwright checks passed");
    await page.close();
  } finally {
    if (context) {
      await context.close();
    }
    await browser.close();
  }
}

async function assertVoiceStageClosedByDefault(page: Page): Promise<void> {
  assert.equal(
    await page.getByTestId("voice-task-stage").count(),
    0,
    "Voice stage should stay closed by default until a task surface is opened",
  );
  assert.equal(
    await page.getByTestId("button-voice-stage-open-canvas").count(),
    0,
    "Voice canvas reopen affordance should not show before a task surface exists",
  );
}

async function resolveActiveConversationId(
  page: Page,
  baseUrl: string,
): Promise<string> {
  const response = await page.request.get(`${baseUrl}/api/conversations`);
  assert.equal(response.ok(), true, "Expected conversation list request to succeed");
  const payload = (await response.json()) as Array<{ id: string }>;
  const conversationId = payload[0]?.id;
  assert.ok(conversationId, "Expected at least one active conversation");
  return conversationId;
}

function scopesForMode(mode: GoogleFixtureScopeMode): string[] {
  const baseScopes = [
    GOOGLE_GMAIL_READONLY_SCOPE,
    GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE,
  ];
  if (mode === "read") {
    return baseScopes;
  }
  return [
    ...baseScopes,
    GOOGLE_GMAIL_COMPOSE_SCOPE,
    GOOGLE_GMAIL_SEND_SCOPE,
    GOOGLE_CALENDAR_EVENTS_WRITE_SCOPE,
  ];
}

async function upsertGoogleIntegrationFixture(
  email: string,
  mode: GoogleFixtureScopeMode,
): Promise<void> {
  const [user] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  assert.ok(user?.id, `Expected to find user for ${email}`);

  const encryptedAccessToken = encryptGoogleToken(`fixture-access-token-${mode}`);
  const encryptedRefreshToken = encryptGoogleToken(`fixture-refresh-token-${mode}`);
  const scopes = scopesForMode(mode);

  await db
    .insert(googleIntegrations)
    .values({
      userId: user.id,
      provider: "google",
      googleSub: `fixture-google-sub-${mode}`,
      email,
      scopes,
      refreshTokenEncrypted: encryptedRefreshToken,
      accessTokenEncrypted: encryptedAccessToken,
      expiry: new Date(Date.now() + 24 * 60 * 60 * 1000),
      status: "connected",
      lastError: null,
    })
    .onConflictDoUpdate({
      target: googleIntegrations.userId,
      set: {
        googleSub: `fixture-google-sub-${mode}`,
        email,
        scopes,
        refreshTokenEncrypted: encryptedRefreshToken,
        accessTokenEncrypted: encryptedAccessToken,
        expiry: new Date(Date.now() + 24 * 60 * 60 * 1000),
        status: "connected",
        lastError: null,
        updatedAt: new Date(),
      },
    });
}

async function prepareLiveGoogleAction(
  page: Page,
  baseUrl: string,
  params: {
    conversationId: string;
    functionName: "prepare_google_email_action" | "prepare_google_calendar_action";
    request: string;
    timezone?: string;
    expectedStatus?: "approval_required" | "clarification_needed" | "upgrade_required";
  },
): Promise<void> {
  const functionId = randomUUID();
  const response = await page.request.post(`${baseUrl}/api/live/tool-response`, {
    data: {
      conversationId: params.conversationId,
      clientTimeZone: params.timezone ?? "America/New_York",
      functionCalls: [
        {
          id: functionId,
          name: params.functionName,
          args:
            params.functionName === "prepare_google_calendar_action"
              ? {
                  request: params.request,
                  timezone: params.timezone ?? "America/New_York",
                }
              : {
                  request: params.request,
                },
        },
      ],
    },
  });
  assert.equal(
    response.ok(),
    true,
    `Expected live tool-response to succeed for ${params.functionName}`,
  );
  const payload = (await response.json()) as {
    functionResponses?: Array<{
      id?: string;
      response?: {
        result?: {
          status?: string;
          message?: string;
          taskId?: string | null;
        };
      };
    }>;
  };
  const functionResponse = payload.functionResponses?.find(
    (entry) => entry.id === functionId,
  );
  const resultStatus = functionResponse?.response?.result?.status ?? null;
  const expectedStatus = params.expectedStatus ?? "approval_required";
  assert.equal(
    resultStatus,
    expectedStatus,
    `Expected ${params.functionName} to return ${expectedStatus}, got ${resultStatus}`,
  );
  if (expectedStatus === "approval_required") {
    assert.ok(
      functionResponse?.response?.result?.taskId,
      `Expected ${params.functionName} to return a task id`,
    );
  }
}

async function assertVoiceCalendarSessionSurface(
  page: Page,
  readTraceBuffer: () => Promise<LiveTraceEntry[]>,
): Promise<void> {
  try {
    await page.waitForSelector('[data-testid="voice-task-stage"]', {
      timeout: 12_000,
    });
  } catch (error) {
    const trace = await readTraceBuffer();
    throw new Error(
      `Voice calendar clarification surface did not appear: ${error instanceof Error ? error.message : String(error)}\nRecent traces: ${JSON.stringify(trace.slice(-20), null, 2)}`,
    );
  }

  const stage = page.getByTestId("voice-task-stage");
  const stageText = (await stage.textContent()) ?? "";
  assert.match(
    stageText,
    /(event in progress|zee calendar|when it should happen|time tbd|lunch with alex)/i,
    "Expected the voice stage to render the calendar clarification surface",
  );
  await page.waitForSelector(
    '[data-testid="voice-task-stage"] [data-testid="google-calendar-session-card"]',
    {
      timeout: 5_000,
    },
  );
}

async function assertVoiceStageSurface(
  page: Page,
  readTraceBuffer: () => Promise<LiveTraceEntry[]>,
): Promise<LiveTraceEntry[]> {
  try {
    await page.waitForSelector('[data-testid="voice-task-stage"]', {
      timeout: 12_000,
    });
  } catch (error) {
    const trace = await readTraceBuffer();
    throw new Error(
      `Voice stage surface did not appear: ${error instanceof Error ? error.message : String(error)}\nRecent traces: ${JSON.stringify(trace.slice(-20), null, 2)}`,
    );
  }

  const stage = page.getByTestId("voice-task-stage");
  const stageText = (await stage.textContent()) ?? "";
  assert.match(
    stageText,
    /(zee calendar|create calendar event|lunch with alex|blue bottle)/i,
    "Expected the voice task stage to prefer the newest calendar surface",
  );
  await page.waitForSelector('[data-testid="button-voice-stage-surface-1"]', {
    timeout: 5_000,
  });
  await stage.getByTestId("button-google-calendar-quick-open-event").click();
  await page.waitForSelector('[data-testid="google-calendar-event-dialog"]', {
    timeout: 5_000,
  });
  await page.keyboard.press("Escape");
  await page.getByTestId("button-voice-stage-surface-1").click();
  await page.waitForSelector(
    '[data-testid="voice-task-stage"] [data-testid="button-google-email-quick-open-draft"]',
    {
      timeout: 5_000,
    },
  );
  await page.waitForSelector(
    '[data-testid="voice-task-stage"] [data-testid="google-email-collapsed-card"], [data-testid="voice-task-stage"] [data-testid="google-email-preview-card"]',
    {
      timeout: 5_000,
    },
  );
  await stage.getByTestId("button-google-email-quick-open-draft").click();
  await page.waitForSelector('[data-testid="google-email-draft-dialog"]', {
    timeout: 5_000,
  });
  await page.waitForSelector('[data-testid="input-google-email-draft-to"]', {
    timeout: 5_000,
  });
  await page.keyboard.press("Escape");

  let trace = await readTraceBuffer();
  assert.equal(
    trace.some((entry) => entry.event === "voice.stage.surface_resolved"),
    true,
    "Expected a voice.stage.surface_resolved trace after the task surface appeared",
  );
  assert.equal(
    trace.some((entry) => entry.event === "voice.stage.surface_visible"),
    true,
    "Expected a voice.stage.surface_visible trace after the task surface appeared",
  );
  assert.equal(
    trace.some((entry) => entry.event === "voice.stage.candidate_snapshot"),
    true,
    "Expected a voice.stage.candidate_snapshot trace after the task surface appeared",
  );
  assert.equal(
    trace.some((entry) => entry.event === "voice.stage.surface_selected"),
    true,
    "Expected a voice.stage.surface_selected trace after switching surfaces",
  );

  await page.getByTestId("button-voice-stage-dismiss").click();
  await page.waitForSelector('[data-testid="button-voice-stage-open-canvas"]', {
    timeout: 5_000,
  });
  await page.waitForSelector('[data-testid="button-end-call"]', {
    timeout: 5_000,
  });
  await page.getByTestId("button-voice-stage-open-canvas").click();
  await page.waitForSelector('[data-testid="voice-task-stage"]', {
    timeout: 5_000,
  });

  trace = await readTraceBuffer();
  assert.equal(
    trace.some((entry) => entry.event === "voice.stage.surface_dismissed"),
    true,
    "Expected a voice.stage.surface_dismissed trace after hiding the canvas",
  );
  assert.equal(
    trace.some((entry) => entry.event === "voice.stage.surface_reopened"),
    true,
    "Expected a voice.stage.surface_reopened trace after reopening the canvas",
  );

  return trace;
}

function parseArgs(argv: string[]): CliArgs {
  let baseUrl = "";
  let email = "";
  let password = "";
  let outputDir = "";
  let skipAudioPreflight = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--base-url" && next) {
      baseUrl = next;
      index += 1;
      continue;
    }
    if (arg === "--email" && next) {
      email = next;
      index += 1;
      continue;
    }
    if (arg === "--password" && next) {
      password = next;
      index += 1;
      continue;
    }
    if (arg === "--output-dir" && next) {
      outputDir = next;
      index += 1;
      continue;
    }
    if (arg === "--skip-audio-preflight") {
      skipAudioPreflight = true;
    }
  }

  if (!baseUrl || !email || !password || !outputDir) {
    throw new Error(
      "Usage: tsx script/live-voice-playwright-check.ts --base-url <url> --email <email> --password <password> --output-dir <dir>",
    );
  }

  return {
    baseUrl,
    email,
    password,
    outputDir: resolve(outputDir),
    skipAudioPreflight,
  };
}

async function loadManifest(): Promise<LiveVoiceFixtureManifest> {
  const manifestPath = resolve(
    process.cwd(),
    "script/fixtures/live-voice/manifest.json",
  );
  const raw = await readFile(manifestPath, "utf8");
  return JSON.parse(raw) as LiveVoiceFixtureManifest;
}

async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({
      channel: "chrome",
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--use-fake-ui-for-media-stream",
      ],
    });
  } catch (chromeLaunchError) {
    try {
      return await chromium.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-dev-shm-usage",
          "--use-fake-ui-for-media-stream",
        ],
      });
    } catch {
      const details =
        chromeLaunchError instanceof Error
          ? chromeLaunchError.message
          : String(chromeLaunchError);
      throw new Error(
        `Failed to launch browser. Install Chromium (npx playwright install chromium). Root error: ${details}`,
      );
    }
  }
}

async function login(page: Page, args: CliArgs): Promise<void> {
  await page.goto(`${args.baseUrl}?liveDebug=1`, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-testid="button-sign-in"]', {
    timeout: 30_000,
  });
  await page.getByTestId("button-sign-in").click();
  await page.waitForSelector('[data-testid="input-login-email"]', {
    timeout: 30_000,
  });
  await page.getByTestId("input-login-email").fill(args.email);
  await page.getByTestId("input-login-password").fill(args.password);
  await page.getByTestId("button-login-submit").click();
  await page.waitForSelector('[data-testid="button-start-call"]', {
    timeout: 35_000,
  });
}

async function dismissOnboardingIfPresent(page: Page): Promise<void> {
  const skip = page.getByTestId("button-skip-onboarding");
  if (await skip.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await skip.click();
    await page
      .waitForSelector('[data-testid="button-skip-onboarding"]', {
        state: "hidden",
        timeout: 10_000,
      })
      .catch(() => undefined);
  }
}

async function startVoiceSession(
  page: Page,
  readTraceBuffer: () => Promise<LiveTraceEntry[]>,
  clearTraceBuffer: () => Promise<void>,
): Promise<void> {
  await clearTraceBuffer();
  await page.getByTestId("button-start-call").click();

  try {
    await page.waitForSelector('[data-testid="button-end-call"]', {
      timeout: 90_000,
    });
    await page.waitForSelector('[data-testid="button-interrupt-assistant"]', {
      timeout: 20_000,
    });
  } catch (error) {
    const trace = await readTraceBuffer();
    throw new Error(
      `Voice session failed to reach active controls: ${error instanceof Error ? error.message : String(error)}\nRecent traces: ${JSON.stringify(trace.slice(-12), null, 2)}`,
    );
  }

  const started = await readTraceBuffer();
  if (started.some((entry) => entry.event === "live.start.failed")) {
    throw new Error(
      `Voice session failed to start: ${JSON.stringify(started.slice(-12), null, 2)}`,
    );
  }
}

function parseLiveTraceConsoleMessage(text: string): LiveTraceEntry | null {
  if (!text.startsWith("[LiveTrace] ")) {
    return null;
  }
  const raw = text.slice("[LiveTrace] ".length).trim();
  if (!raw) {
    return null;
  }
  const firstSpace = raw.indexOf(" ");
  const event = firstSpace === -1 ? raw : raw.slice(0, firstSpace);
  const metadataText = firstSpace === -1 ? "" : raw.slice(firstSpace + 1).trim();
  return {
    at: Date.now(),
    event,
    metadata: metadataText ? { raw: metadataText } : {},
  };
}

function hasSpeechState(
  trace: Array<{
    at: number;
    event: string;
    metadata: Record<string, unknown>;
  }>,
  nextState: string,
): boolean {
  return trace.some(
    (entry) =>
      entry.event === "live.audio.speech_state_changed" &&
      entry.metadata?.nextState === nextState,
  );
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
