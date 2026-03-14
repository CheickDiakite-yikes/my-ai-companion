import { ensureLocalDatabaseUrl } from "./ensure-local-db";

ensureLocalDatabaseUrl();

async function main(): Promise<void> {
  const { rollupTelemetryDay } = await import("../server/telemetry");
  const args = process.argv.slice(2);
  const dayArg = resolveStringArg(args, "--day");
  const daysBack = resolveNumberArg(args, "--daysBack", 1);
  const results: Array<{ day: string; upserted: number }> = [];

  if (dayArg) {
    results.push(await rollupTelemetryDay({ day: new Date(dayArg) }));
  } else {
    const today = new Date();
    for (let offset = daysBack; offset >= 0; offset -= 1) {
      const day = new Date(today);
      day.setDate(today.getDate() - offset);
      results.push(await rollupTelemetryDay({ day }));
    }
  }

  console.log(JSON.stringify({ ok: true, results }, null, 2));
}

function resolveStringArg(args: string[], name: string): string | null {
  const match = args.find((item) => item.startsWith(`${name}=`));
  if (!match) return null;
  const value = match.slice(name.length + 1).trim();
  return value.length > 0 ? value : null;
}

function resolveNumberArg(args: string[], name: string, fallback: number): number {
  const value = resolveStringArg(args, name);
  const parsed = value ? Number.parseInt(value, 10) : fallback;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
