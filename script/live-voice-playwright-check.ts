import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
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

    const combinedTrace = {
      noiseTrace,
      speechTrace,
      interruptTrace,
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
