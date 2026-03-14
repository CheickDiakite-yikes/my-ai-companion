import { ensureLocalDatabaseUrl } from "./ensure-local-db";

ensureLocalDatabaseUrl();

async function main(): Promise<void> {
  const { purgeTelemetryData } = await import("../server/telemetry");
  const result = await purgeTelemetryData();
  console.log(JSON.stringify({ ok: true, result }, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
