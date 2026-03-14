const DEFAULT_DATABASE_URL =
  "postgresql://postgres@127.0.0.1:5432/my_ai_companion_local";

export function ensureLocalDatabaseUrl(): void {
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = DEFAULT_DATABASE_URL;
  }
}
