import { ensureLocalDatabaseUrl } from "./ensure-local-db";

ensureLocalDatabaseUrl();

const MIN_SESSIONS_FOR_ALERTS = Number.parseInt(
  process.env.TELEMETRY_ALERT_MIN_SESSIONS ?? "10",
  10,
);
const MIN_FIRST_GOOD_RATE = Number.parseFloat(
  process.env.TELEMETRY_ALERT_MIN_FIRST_GOOD_RATE ?? "0.55",
);
const MAX_NO_USABLE_RATE = Number.parseFloat(
  process.env.TELEMETRY_ALERT_MAX_NO_USABLE_RATE ?? "0.25",
);
const MAX_FAILED_RATE = Number.parseFloat(
  process.env.TELEMETRY_ALERT_MAX_FAILED_RATE ?? "0.2",
);

async function main(): Promise<void> {
  const { getTelemetryWindowSummary } = await import("../server/telemetry");
  const now = new Date();
  const last24h = await getTelemetryWindowSummary({
    label: "last_24h",
    since: new Date(now.getTime() - 24 * 60 * 60 * 1000),
    until: now,
  });
  const last7d = await getTelemetryWindowSummary({
    label: "last_7d",
    since: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
    until: now,
  });

  const issues: string[] = [];
  const sessionsStarted = last24h.summary.sessionsStarted;
  if (sessionsStarted >= MIN_SESSIONS_FOR_ALERTS) {
    if (last24h.summary.firstGoodConversationRate < MIN_FIRST_GOOD_RATE) {
      issues.push("first_good_conversation_rate_below_threshold");
    }
    if (last24h.summary.noUsableTranscriptRate > MAX_NO_USABLE_RATE) {
      issues.push("no_usable_transcript_rate_above_threshold");
    }
    const failedRate =
      sessionsStarted > 0
        ? last24h.summary.failedSessions / sessionsStarted
        : 0;
    if (failedRate > MAX_FAILED_RATE) {
      issues.push("failed_session_rate_above_threshold");
    }
  }

  const payload = {
    ok: issues.length === 0,
    issues,
    windows: {
      last24h,
      last7d,
    },
  };

  console.log(JSON.stringify(payload, null, 2));
  if (issues.length > 0) {
    process.exit(1);
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
