import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import {
  clearLiveTraceBuffer,
  installLiveVoiceAppTestBypass,
  installLiveVoiceFixtureMic,
  playLiveFixture,
  readLiveTraceBuffer,
  readLiveVoiceFixtureDiagnostics,
  waitForLiveVoiceInputReady,
  type LiveVoiceFixtureManifest,
} from "./live-voice-fixture-lib";

interface CliArgs {
  baseUrl: string;
  outputDir: string;
  strictAudio: boolean;
}

interface LiveTraceEntry {
  at: number;
  event: string;
  metadata: Record<string, unknown>;
}

interface BrowserProfileCase {
  id: string;
  userAgent: string;
  viewport: { width: number; height: number };
  fixtureSampleRate: number;
  expectedPlatform: "desktop" | "android" | "ios";
  expectedSpeechMode: "desktop_default" | "mobile_relaxed";
  expectedCaptureAttemptLabel: string;
}

interface RuntimeAssertions {
  fixtureDiagnostics: Record<string, unknown>;
  inputPeakRms: number;
  inputPeakThreshold: number;
  inputRmsSpikeObserved: boolean;
  observedSpeechStates: string[];
}

const PROFILES: BrowserProfileCase[] = [
  {
    id: "desktop_chrome_like",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
    fixtureSampleRate: 48_000,
    expectedPlatform: "desktop",
    expectedSpeechMode: "desktop_default",
    expectedCaptureAttemptLabel: "desktop_echo_cancel_only",
  },
  {
    id: "iphone_safari_like",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    viewport: { width: 430, height: 932 },
    fixtureSampleRate: 44_100,
    expectedPlatform: "ios",
    expectedSpeechMode: "mobile_relaxed",
    expectedCaptureAttemptLabel: "mobile_echo_cancel_agc",
  },
  {
    id: "android_chrome_like",
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
    viewport: { width: 412, height: 915 },
    fixtureSampleRate: 48_000,
    expectedPlatform: "android",
    expectedSpeechMode: "mobile_relaxed",
    expectedCaptureAttemptLabel: "mobile_echo_cancel_agc",
  },
];

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const manifest = await loadManifest();
  await mkdir(args.outputDir, { recursive: true });
  const browser = await launchBrowser();
  const results: Array<Record<string, unknown>> = [];

  try {
    for (const profile of PROFILES) {
      const result = await runProfile(browser, args.baseUrl, manifest, profile, args.strictAudio);
      results.push(result);
    }
  } finally {
    await browser.close();
  }

  const outputPath = resolve(args.outputDir, "live-voice-browser-profile-smoke.json");
  await writeFile(outputPath, JSON.stringify(results, null, 2), "utf8");
  console.log(
    JSON.stringify(
      {
        ok: true,
        outputPath,
        profiles: results.map((result) => result.profileId),
      },
      null,
      2,
    ),
  );
}

function parseArgs(argv: string[]): CliArgs {
  let baseUrl = "";
  let outputDir = "";
  let strictAudio = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--base-url" && next) {
      baseUrl = next;
      index += 1;
      continue;
    }
    if (arg === "--output-dir" && next) {
      outputDir = next;
      index += 1;
      continue;
    }
    if (arg === "--strict-audio") {
      strictAudio = true;
    }
  }

  if (!baseUrl || !outputDir) {
    throw new Error(
      "Usage: node --import tsx script/live-voice-browser-profile-smoke.ts --base-url <url> --output-dir <dir> [--strict-audio]",
    );
  }

  return {
    baseUrl,
    outputDir: resolve(outputDir),
    strictAudio,
  };
}

async function loadManifest(): Promise<LiveVoiceFixtureManifest> {
  const manifestPath = resolve("script/fixtures/live-voice/manifest.json");
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
  } catch {
    return chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--use-fake-ui-for-media-stream",
      ],
    });
  }
}

async function runProfile(
  browser: Browser,
  baseUrl: string,
  manifest: LiveVoiceFixtureManifest,
  profile: BrowserProfileCase,
  strictAudio: boolean,
): Promise<Record<string, unknown>> {
  const origin = new URL(baseUrl).origin;
    const context = await browser.newContext({
      viewport: profile.viewport,
      userAgent: profile.userAgent,
    });

  try {
    await context.grantPermissions(["microphone"], { origin });
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
    await installLiveVoiceAppTestBypass(page);
    await installLiveVoiceFixtureMic(page, manifest, {
      sampleRate: profile.fixtureSampleRate,
    });

    const email = `voice.browser.${profile.id}.${Date.now()}@example.com`;
    const password = "TestPass123!";
    await registerAndBootstrapUser(context, baseUrl, email, password);
    await page.goto(`${baseUrl}?liveDebug=1`, { waitUntil: "networkidle" });
    await installLiveVoiceFixtureMic(page, manifest, {
      sampleRate: profile.fixtureSampleRate,
    });
    await dismissSoftWalkthroughIfPresent(page);
    await page.waitForSelector('[data-testid="button-start-call"]', {
      timeout: 30_000,
    });

    await clearLiveTraceBuffer(page);
    consoleTraceBuffer.splice(0, consoleTraceBuffer.length);
    await page.getByTestId("button-start-call").click();
    await page.waitForSelector('[data-testid="button-end-call"]', {
      timeout: 90_000,
    });

    const startupTraces = await readTraceBuffer(page, consoleTraceBuffer);
    await waitForLiveVoiceInputReady(page);
    await clearLiveTraceBuffer(page);
    consoleTraceBuffer.splice(0, consoleTraceBuffer.length);
    await playLiveFixture(page, "speech_burst");
    const inputWindow = await measureInputRmsWindow(page, 3000);
    const fixtureDiagnostics = await readLiveVoiceFixtureDiagnostics(page);

    const traces = await readTraceBuffer(page, consoleTraceBuffer);
    const combinedTraces = [...startupTraces, ...traces];
    if (!combinedTraces.some((entry) => entry.event === "live.audio.capture_config")) {
      throw new Error(
        `${profile.id}: missing live.audio.capture_config\nRecent traces: ${JSON.stringify(
          combinedTraces.slice(-30),
          null,
          2,
        )}`,
      );
    }
    assertTraceForProfile(combinedTraces, profile, {
      fixtureDiagnostics,
      inputPeakRms: inputWindow.peakRms,
      inputPeakThreshold: inputWindow.peakThreshold,
      inputRmsSpikeObserved: inputWindow.peakRms >= Math.max(inputWindow.peakThreshold * 1.35, 0.0045),
      observedSpeechStates: inputWindow.observedSpeechStates,
    }, strictAudio);
    assert.equal(
      Number(fixtureDiagnostics.getUserMediaInterceptCount ?? 0) > 0,
      true,
      `${profile.id}: synthetic microphone should intercept getUserMedia`,
    );

    await page.getByTestId("button-end-call").click();
    await page.close();

    return {
      profileId: profile.id,
      traceEvents: combinedTraces.length,
      expectedPlatform: profile.expectedPlatform,
      expectedSpeechMode: profile.expectedSpeechMode,
      inputPeakRms: inputWindow.peakRms,
      inputPeakThreshold: inputWindow.peakThreshold,
      inputRmsSpikeObserved:
        inputWindow.peakRms >= Math.max(inputWindow.peakThreshold * 1.35, 0.0045),
      strictAudio,
      audioObserved:
        combinedTraces.some(
          (entry) =>
            entry.event === "live.audio.activity_start_sent" ||
            (entry.event === "live.audio.speech_state_changed" &&
              (entry.metadata?.nextState === "candidate_user_speech" ||
                entry.metadata?.nextState === "user_speaking")),
        ) ||
        inputWindow.peakRms >= Math.max(inputWindow.peakThreshold * 1.35, 0.0045),
      observedSpeechStates: inputWindow.observedSpeechStates,
      fixtureDiagnostics,
      observedCaptureAttemptLabel: findEvent(combinedTraces, "live.audio.track_config_granted")
        ?.metadata?.captureAttemptLabel ?? null,
      observedCapturePath: findEvent(combinedTraces, "live.audio.capture_path")?.metadata ?? null,
    };
  } finally {
    await context.close();
  }
}

async function dismissSoftWalkthroughIfPresent(page: Page): Promise<void> {
  const snooze = page.getByTestId("button-soft-walkthrough-snooze");
  if (await snooze.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await snooze.click();
    await page
      .waitForSelector('[data-testid="soft-walkthrough-overlay"]', {
        state: "hidden",
        timeout: 10_000,
      })
      .catch(() => undefined);
  }
}

async function readTraceBuffer(
  page: Page,
  consoleTraceBuffer: LiveTraceEntry[],
): Promise<LiveTraceEntry[]> {
  const injectedTrace = await readLiveTraceBuffer(page);
  return injectedTrace.length > 0 ? injectedTrace : consoleTraceBuffer.slice();
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

async function measureInputRmsWindow(
  page: Page,
  durationMs: number,
): Promise<{
  peakRms: number;
  peakThreshold: number;
  observedSpeechStates: string[];
}> {
  return page.evaluate(async (windowDurationMs) => {
    const peak = {
      peakRms: 0,
      peakThreshold: 0,
      observedSpeechStates: [] as string[],
    };
    const deadline = Date.now() + windowDurationMs;
    while (Date.now() < deadline) {
      const speechState = window.__zeemeLiveDebug?.getSpeechState?.();
      if (!speechState || typeof speechState !== "object") {
        await new Promise((resolve) => window.setTimeout(resolve, 50));
        continue;
      }
      const currentRms =
        typeof speechState.currentRms === "number" ? speechState.currentRms : 0;
      const activeThreshold =
        typeof speechState.activeThreshold === "number"
          ? speechState.activeThreshold
          : 0;
      const stateName =
        typeof speechState.speechState === "string" ? speechState.speechState : null;
      peak.peakRms = Math.max(peak.peakRms, currentRms);
      peak.peakThreshold = Math.max(peak.peakThreshold, activeThreshold);
      if (stateName && !peak.observedSpeechStates.includes(stateName)) {
        peak.observedSpeechStates.push(stateName);
      }
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
    return peak;
  }, durationMs);
}

async function registerAndBootstrapUser(
  context: BrowserContext,
  baseUrl: string,
  email: string,
  password: string,
): Promise<void> {
  const register = await context.request.post(`${baseUrl}/api/auth/register`, {
    data: {
      email,
      password,
      confirmPassword: password,
      firstName: "Voice",
      lastName: "Profile",
      profession: "QA",
      referralSource: "codex",
    },
  });
  assert.equal(register.status(), 201, "browser-profile smoke should register a user");

  const prefs = await context.request.put(`${baseUrl}/api/preferences`, {
    data: {
      selectedPersona: "Zee",
      selectedVoice: "Kore",
      selectedTheme: "sunset_path",
      onboardingCompleted: true,
    },
  });
  assert.equal(prefs.status(), 200, "browser-profile smoke should complete onboarding");
}

function assertTraceForProfile(
  traces: LiveTraceEntry[],
  profile: BrowserProfileCase,
  runtimeAssertions: RuntimeAssertions,
  strictAudio: boolean,
): void {
  assert.equal(
    traces.some((entry) => entry.event === "live.start.failed"),
    false,
    `${profile.id}: live start should succeed`,
  );
  assert.equal(
    traces.some((entry) => entry.event === "live.audio.capture_failed"),
    false,
    `${profile.id}: mic capture should succeed`,
  );

  const captureConfig = findEvent(traces, "live.audio.capture_config");
  assert.ok(captureConfig, `${profile.id}: expected live.audio.capture_config`);
  assert.equal(
    captureConfig?.metadata?.compatibilityProfile?.platformClass,
    profile.expectedPlatform,
    `${profile.id}: compatibility platform should match profile`,
  );
  assert.equal(
    captureConfig?.metadata?.speechDetectionProfile?.mode,
    profile.expectedSpeechMode,
    `${profile.id}: speech profile should match profile`,
  );

  const trackGranted = findEvent(traces, "live.audio.track_config_granted");
  assert.ok(trackGranted, `${profile.id}: expected live.audio.track_config_granted`);
  assert.equal(
    trackGranted?.metadata?.captureAttemptLabel,
    profile.expectedCaptureAttemptLabel,
    `${profile.id}: expected capture attempt label`,
  );

  const capturePath = findEvent(traces, "live.audio.capture_path");
  assert.ok(capturePath, `${profile.id}: expected live.audio.capture_path`);
  assert.equal(
    capturePath?.metadata?.analyzerKind,
    "audio_worklet",
    `${profile.id}: expected AudioWorklet capture path`,
  );
  assert.equal(
    capturePath?.metadata?.targetSampleRate,
    16000,
    `${profile.id}: expected 16k target sample rate`,
  );

  const inputFrameTiming = findEvent(traces, "live.audio.input_frame_timing");
  assert.ok(inputFrameTiming, `${profile.id}: expected live.audio.input_frame_timing`);
  assert.equal(
    inputFrameTiming?.metadata?.inputSampleRate,
    16000,
    `${profile.id}: input AudioContext should run at 16kHz`,
  );

  const speechObserved = traces.some(
    (entry) =>
      entry.event === "live.audio.activity_start_sent" ||
      (entry.event === "live.audio.speech_state_changed" &&
        (entry.metadata?.nextState === "candidate_user_speech" ||
          entry.metadata?.nextState === "user_speaking")),
  );
  if (strictAudio) {
    assert.equal(
      speechObserved || runtimeAssertions.inputRmsSpikeObserved,
      true,
      `${profile.id}: expected speech fixture to trigger capture markers or a measurable live input RMS spike (peakRms=${runtimeAssertions.inputPeakRms.toFixed(4)}, peakThreshold=${runtimeAssertions.inputPeakThreshold.toFixed(4)}, states=${runtimeAssertions.observedSpeechStates.join(",") || "none"}, fixture=${JSON.stringify(runtimeAssertions.fixtureDiagnostics)})`,
    );
  }
}

function findEvent(
  traces: LiveTraceEntry[],
  eventName: string,
): LiveTraceEntry | null {
  return traces.find((entry) => entry.event === eventName) ?? null;
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
