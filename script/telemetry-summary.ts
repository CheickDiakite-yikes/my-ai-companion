import { ensureLocalDatabaseUrl } from "./ensure-local-db";

ensureLocalDatabaseUrl();

async function main(): Promise<void> {
  const { getTelemetryWindowSummary } = await import("../server/telemetry");
  const args = process.argv.slice(2);
  const days = resolveNumberArg(args, "--days", 1);
  const label = resolveStringArg(args, "--label") ?? `${days}d_summary`;
  const until = new Date();
  const since = new Date(until.getTime() - days * 24 * 60 * 60 * 1000);
  const result = await getTelemetryWindowSummary({ label, since, until });
  console.log(JSON.stringify(result, null, 2));
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
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
