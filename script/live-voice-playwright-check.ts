import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(args.outputDir, { recursive: true });
  const manifest = await loadManifest();
  const browser = await launchBrowser();

  try {
    const page = await browser.newPage({
      viewport: { width: 430, height: 932 },
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    });

    await installLiveVoiceFixtureMic(page, manifest);
    await login(page, args);
    await dismissOnboardingIfPresent(page);
    await startVoiceSession(page);

    await clearLiveTraceBuffer(page);
    await playLiveFixture(page, "noise_only");
    await page.waitForTimeout(2400);
    const noiseTrace = await readLiveTraceBuffer(page);
    assert.equal(
      hasSpeechState(noiseTrace, "user_speaking"),
      false,
      "noise_only fixture should not trigger user_speaking",
    );

    await clearLiveTraceBuffer(page);
    await playLiveFixture(page, "speech_burst");
    await page.waitForTimeout(2800);
    const speechTrace = await readLiveTraceBuffer(page);
    assert.equal(
      hasSpeechState(speechTrace, "candidate_user_speech"),
      true,
      "speech_burst should enter candidate_user_speech",
    );
    assert.equal(
      hasSpeechState(speechTrace, "user_speaking"),
      true,
      "speech_burst should enter user_speaking",
    );

    await clearLiveTraceBuffer(page);
    await page.getByTestId("button-interrupt-assistant").click();
    await page.waitForTimeout(800);
    const interruptTrace = await readLiveTraceBuffer(page);
    assert.equal(
      interruptTrace.some(
        (entry) => entry.event === "live.assistant.interrupt_requested",
      ),
      true,
      "manual interrupt button should request an interrupt/activity start",
    );

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
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
  } catch (chromeLaunchError) {
    try {
      return await chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
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

async function startVoiceSession(page: Page): Promise<void> {
  await page.getByTestId("button-start-call").click();

  const started = await waitForTrace(
    page,
    (trace) =>
      trace.some((entry) => entry.event === "live.start.ready") ||
      trace.some((entry) => entry.event === "live.start.failed"),
    90_000,
  );

  if (started.some((entry) => entry.event === "live.start.failed")) {
    throw new Error(
      `Voice session failed to start: ${JSON.stringify(started.slice(-8), null, 2)}`,
    );
  }

  await page.waitForSelector('[data-testid="button-interrupt-assistant"]', {
    timeout: 30_000,
  });
}

async function waitForTrace(
  page: Page,
  predicate: (
    trace: Array<{
      at: number;
      event: string;
      metadata: Record<string, unknown>;
    }>,
  ) => boolean,
  timeoutMs: number,
): Promise<
  Array<{
    at: number;
    event: string;
    metadata: Record<string, unknown>;
  }>
> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const trace = await readLiveTraceBuffer(page);
    if (predicate(trace)) {
      return trace;
    }
    await page.waitForTimeout(300);
  }
  throw new Error(`Timed out waiting for LiveTrace condition after ${timeoutMs}ms`);
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
