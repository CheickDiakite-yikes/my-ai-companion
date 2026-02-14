import { sql } from "drizzle-orm";

const DEFAULT_DATABASE_URL =
  "postgresql://postgres@127.0.0.1:5432/my_ai_companion_local";

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = DEFAULT_DATABASE_URL;
}

async function run(): Promise<void> {
  const [{ storage }, { db }, { messages }] = await Promise.all([
    import("../server/storage.ts"),
    import("../server/db.ts"),
    import("../shared/schema.ts"),
  ]);

  const [beforeRow] = await db
    .select({
      count: sql<number>`COUNT(*)::int`,
    })
    .from(messages)
    .where(sql`${messages.messagePurpose} = 'conversation' AND jsonb_typeof(${messages.uiPayload}) = 'object' AND (${messages.uiPayload} ->> 'kind') LIKE 'agent_%'`);

  const before = Number(beforeRow?.count ?? 0);
  const result = await storage.backfillLegacyAgentUiMessagePurpose();

  console.log(
    JSON.stringify(
      {
        before,
        updated: result.updatedCount,
        remaining: result.remainingCount,
      },
      null,
      2,
    ),
  );
}

void run().catch((error) => {
  console.error(error);
  process.exit(1);
});
