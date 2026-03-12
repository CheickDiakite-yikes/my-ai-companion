import { existsSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";

const rootDir = process.cwd();
const envPaths = [
  { path: resolve(rootDir, ".env"), override: false },
  { path: resolve(rootDir, ".env.local"), override: true },
];

for (const entry of envPaths) {
  if (!existsSync(entry.path)) continue;
  dotenv.config({
    path: entry.path,
    override: entry.override,
  });
}
