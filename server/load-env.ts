import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";

const rootDir = process.cwd();
const externallyProvidedKeys = new Set(Object.keys(process.env));
const envPaths = [
  resolve(rootDir, ".env"),
  resolve(rootDir, ".env.local"),
];

for (const path of envPaths) {
  if (!existsSync(path)) continue;
  const parsed = dotenv.parse(readFileSync(path));
  for (const [key, value] of Object.entries(parsed)) {
    if (externallyProvidedKeys.has(key)) {
      continue;
    }
    process.env[key] = value;
  }
}
