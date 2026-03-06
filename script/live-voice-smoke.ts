import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

interface LiveTokenSummaryPayload {
  configSummary?: {
    activityHandling?: string;
    automaticActivityDetectionDisabled?: boolean;
    sessionResumptionEnabled?: boolean;
    contextWindowCompressionEnabled?: boolean;
    effectiveInterruptMode?: string;
    forceAlwaysRespond?: boolean;
    proactiveAudio?: boolean;
    thinkingBudget?: number | null;
    maxOutputTokens?: number;
  };
}

interface ExportedTracePayload {
  tokenConfigSummary?: LiveTokenSummaryPayload["configSummary"];
  traces?: Array<{
    at?: number;
    event?: string;
    metadata?: Record<string, unknown>;
  }>;
}

interface CliArgs {
  tokenJsonPath: string;
  traceJsonPath: string | null;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const tokenPayload = await loadJson<LiveTokenSummaryPayload>(args.tokenJsonPath);
  assertLiveTokenSummary(tokenPayload.configSummary);

  if (args.traceJsonPath) {
    const tracePayload = await loadJson<ExportedTracePayload>(args.traceJsonPath);
    if (tracePayload.tokenConfigSummary) {
      assertLiveTokenSummary(tracePayload.tokenConfigSummary);
    }
    assertLiveTraceMarkers(tracePayload.traces ?? []);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        tokenJsonPath: args.tokenJsonPath,
        traceJsonPath: args.traceJsonPath,
      },
      null,
      2,
    ),
  );
}

function parseArgs(argv: string[]): CliArgs {
  let tokenJsonPath = "";
  let traceJsonPath: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--token-json" && next) {
      tokenJsonPath = next;
      index += 1;
      continue;
    }
    if (arg === "--trace-json" && next) {
      traceJsonPath = next;
      index += 1;
    }
  }

  if (!tokenJsonPath) {
    throw new Error(
      "Usage: tsx script/live-voice-smoke.ts --token-json <path> [--trace-json <path>]",
    );
  }

  return {
    tokenJsonPath: resolve(tokenJsonPath),
    traceJsonPath: traceJsonPath ? resolve(traceJsonPath) : null,
  };
}

async function loadJson<T>(path: string): Promise<T> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as T;
}

function assertLiveTokenSummary(
  summary: LiveTokenSummaryPayload["configSummary"] | undefined,
): void {
  assert.ok(summary, "configSummary is required");
  assert.equal(
    summary.activityHandling,
    "START_OF_ACTIVITY_INTERRUPTS",
    "stable live profile must use START_OF_ACTIVITY_INTERRUPTS",
  );
  assert.equal(
    summary.automaticActivityDetectionDisabled,
    true,
    "stable live profile must disable automatic activity detection",
  );
  assert.equal(
    summary.sessionResumptionEnabled,
    true,
    "stable live profile must enable session resumption",
  );
  assert.equal(
    summary.contextWindowCompressionEnabled,
    true,
    "stable live profile must enable context window compression",
  );
  assert.equal(
    summary.effectiveInterruptMode,
    "client_manual_activity",
    "stable live profile must advertise client_manual_activity interrupt mode",
  );
  assert.equal(
    summary.forceAlwaysRespond,
    true,
    "stable live profile must keep forceAlwaysRespond enabled",
  );
  assert.equal(
    summary.proactiveAudio,
    false,
    "stable live profile must keep proactiveAudio disabled",
  );
  assert.ok(
    (summary.thinkingBudget ?? 0) >= 128,
    "stable live profile must keep thinkingBudget >= 128",
  );
  assert.ok(
    (summary.maxOutputTokens ?? 0) >= 1000,
    "stable live profile must keep maxOutputTokens >= 1000",
  );
}

function assertLiveTraceMarkers(
  traces: Array<{
    at?: number;
    event?: string;
    metadata?: Record<string, unknown>;
  }>,
): void {
  const events = new Set(
    traces
      .map((trace) => trace.event)
      .filter((value): value is string => typeof value === "string"),
  );

  const required = [
    "live.token.created",
    "live.audio.capture_config",
    "live.audio.track_config_granted",
    "live.audio.speech_state_changed",
  ];

  required.forEach((event) => {
    assert.ok(events.has(event), `trace export is missing required marker: ${event}`);
  });

  if (events.has("live.assistant.interrupt_button_pressed")) {
    assert.ok(
      events.has("live.assistant.interrupt_requested") ||
        events.has("live.assistant.interrupt_ignored") ||
        events.has("live.assistant.interrupt_ignored_no_assistant_audio"),
      "interrupt button traces must include requested or ignored marker",
    );
  }
  if (events.has("live.assistant.interrupt_requested")) {
    assert.ok(
      events.has("live.audio.activity_start_sent"),
      "interrupt request must emit activity_start_sent marker",
    );
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
