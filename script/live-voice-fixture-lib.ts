import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Page } from "playwright";

const SOFT_WALKTHROUGH_STORAGE_KEY = "zeeme-soft-walkthrough-v3";
const INSTALLER_SOURCE_PATH = resolve("script/live-voice-fixture-install.browser.js");

let installerSourcePromise: Promise<string> | null = null;

export interface LiveVoiceFixtureDefinition {
  id: string;
  kind: "noise" | "voice_like";
  durationMs: number;
  gain: number;
  carrierHz?: number;
  backgroundNoiseGain?: number;
}

export interface LiveVoiceFixtureManifest {
  fixtures: LiveVoiceFixtureDefinition[];
}

export interface InstallLiveVoiceFixtureOptions {
  sampleRate?: number;
}

declare global {
  interface Window {
    __pwLiveAudio?: {
      clearTraces?: () => void;
      getDiagnostics?: () => Record<string, unknown>;
      getTraces?: () => Array<{
        at: number;
        event: string;
        metadata: Record<string, unknown>;
      }>;
      playFixture?: (id: string) => Promise<void>;
      stop?: () => void;
    };
    __zeemeLiveDebug?: {
      clearTraces?: () => void;
      getSpeechState?: () => Record<string, unknown> | null;
      getTokenConfigSummary?: () => Record<string, unknown> | null;
      getTraces?: () => Array<{
        at: number;
        event: string;
        metadata: Record<string, unknown>;
      }>;
    };
  }
}

async function getInstallerSource(): Promise<string> {
  if (!installerSourcePromise) {
    installerSourcePromise = readFile(INSTALLER_SOURCE_PATH, "utf8");
  }
  return installerSourcePromise;
}

function buildInstallerContent(
  manifest: LiveVoiceFixtureManifest,
  options: InstallLiveVoiceFixtureOptions,
  installerSource: string,
): string {
  const serializedArgs = JSON.stringify({
    fixtureManifest: manifest,
    fixtureOptions: options,
  }).replace(/</g, "\\u003c");
  return `${installerSource}\nwindow.__installLiveVoiceFixtureMic(${serializedArgs});`;
}

export async function installLiveVoiceFixtureMic(
  page: Page,
  manifest: LiveVoiceFixtureManifest,
  options: InstallLiveVoiceFixtureOptions = {},
): Promise<void> {
  const installerSource = await getInstallerSource();
  const content = buildInstallerContent(manifest, options, installerSource);
  await page.addInitScript({ content });
  await page.addScriptTag({ content });
}

export async function installLiveVoiceAppTestBypass(page: Page): Promise<void> {
  await page.addInitScript(
    ({ softWalkthroughStorageKey }) => {
      try {
        window.localStorage.setItem(softWalkthroughStorageKey, "done");
      } catch {
        // Ignore localStorage restrictions in non-browser contexts.
      }
    },
    {
      softWalkthroughStorageKey: SOFT_WALKTHROUGH_STORAGE_KEY,
    },
  );
}

export async function clearLiveTraceBuffer(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__zeemeLiveDebug?.clearTraces?.();
    window.__pwLiveAudio?.clearTraces?.();
  });
}

export async function playLiveFixture(
  page: Page,
  fixtureId: string,
): Promise<void> {
  await page.evaluate(async (id) => {
    await window.__pwLiveAudio?.playFixture?.(id);
  }, fixtureId);
}

export async function readLiveVoiceFixtureDiagnostics(
  page: Page,
): Promise<Record<string, unknown>> {
  return page.evaluate(() => ({
    installed: Boolean(window.__pwLiveAudio),
    keys: Object.keys(window.__pwLiveAudio ?? {}),
    ...(window.__pwLiveAudio?.getDiagnostics?.() ?? {}),
  }));
}

export async function waitForLiveVoiceInputReady(
  page: Page,
  timeoutMs = 20_000,
): Promise<void> {
  await page.waitForFunction(
    () => {
      const speechState = window.__zeemeLiveDebug?.getSpeechState?.();
      if (!speechState || typeof speechState !== "object") {
        return false;
      }
      const sessionReadyForRealtimeInput =
        speechState.sessionReadyForRealtimeInput === true;
      const currentSpeechState =
        typeof speechState.speechState === "string"
          ? speechState.speechState
          : null;
      return (
        sessionReadyForRealtimeInput &&
        currentSpeechState !== "assistant_speaking"
      );
    },
    { timeout: timeoutMs },
  );
}

export async function readLiveTraceBuffer(page: Page): Promise<
  Array<{
    at: number;
    event: string;
    metadata: Record<string, unknown>;
  }>
> {
  return page.evaluate(
    () =>
      window.__zeemeLiveDebug?.getTraces?.() ??
      window.__pwLiveAudio?.getTraces?.() ??
      [],
  );
}
