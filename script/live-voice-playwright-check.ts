import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { db } from "../server/db";
import { storage } from "../server/storage";
import { users } from "../shared/models/auth";
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
}

type LiveTraceEntry = {
  at: number;
  event: string;
  metadata: Record<string, unknown>;
};

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

    await clearTraceBuffer();
    await playLiveFixture(page, "noise_only");
    await page.waitForTimeout(2400);
    const noiseTrace = await readTraceBuffer();
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
    const speechTrace = await readTraceBuffer();
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
    const interruptTrace = await readTraceBuffer();
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

    await clearTraceBuffer();
    const conversationId = await resolveActiveConversationId(page, args.baseUrl);
    await seedVoiceStageDraftFixture(args.email, conversationId);
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

async function seedVoiceStageDraftFixture(
  email: string,
  conversationId: string,
): Promise<void> {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  assert.ok(user?.id, `Expected to find user for ${email}`);

  const prompt = "draft an email to voice-stage@example.com saying hello from voice mode";
  const preview = {
    kind: "email_compose" as const,
    title: "Create email draft",
    summary: "Create an email draft to voice-stage@example.com.",
    connector: "gmail" as const,
    requiresWriteAccess: true,
    proposedEmail: {
      to: ["voice-stage@example.com"],
      cc: [],
      subject: "Voice stage hello",
      bodyPreview: "hello from voice mode",
      sendAfterApproval: false,
    },
  };
  const plan = {
    version: "google_action_v1" as const,
    preview,
    execution: {
      kind: "email_compose" as const,
      sendAfterApproval: false,
      to: ["voice-stage@example.com"],
      cc: [],
      subject: "Voice stage hello",
      bodyText: "hello from voice mode",
    },
  };
  const completedAt = new Date();
  const task = await storage.createAgentTask({
    userId: user.id,
    conversationId,
    status: "completed",
    riskLevel: "high",
    taskKind: "google_action",
    prompt,
    requestedByMessageId: randomUUID(),
    plan,
    completedAt,
  });

  await storage.createMessage({
    conversationId,
    sender: "assistant",
    text: "Created a Gmail draft to voice-stage@example.com.",
    partIndex: 0,
    uiPayload: {
      kind: "agent_task_status",
      task: {
        id: task.id,
        conversationId: task.conversationId,
        status: task.status,
        riskLevel: task.riskLevel,
        taskKind: task.taskKind,
        prompt: task.prompt,
        errorMessage: task.errorMessage ?? null,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        completedAt: task.completedAt,
      },
      text: "Completed",
      googleActionPreview: preview,
      googleActionResult: {
        kind: "email_compose",
        connector: "gmail",
        status: "draft_created",
        summary: "Created a Gmail draft to voice-stage@example.com.",
        draftId: `voice-stage-draft-${task.id}`,
        messageId: `voice-stage-message-${task.id}`,
        threadId: null,
      },
    },
  });
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
    /(zee mail|create email draft|voice stage hello|voice-stage@example\.com)/i,
    "Expected the voice task stage to render the seeded Gmail surface",
  );

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
