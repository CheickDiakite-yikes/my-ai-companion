import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  APP_THEME_OPTIONS,
  DEFAULT_APP_THEME_ID,
  getAppTheme,
  isAppThemeId,
} from "../client/src/lib/app-theme.ts";

const REQUIRED_THEME_VAR_KEYS = [
  "shellBg",
  "panelBg",
  "headerBg",
  "footerBg",
  "accent",
  "accentText",
  "muted",
  "textOnDark",
  "textOnDarkMuted",
  "inputBg",
  "inputBorder",
  "inputText",
  "inputPlaceholder",
  "userBubbleBg",
  "userBubbleText",
  "assistantBubbleBg",
  "assistantBubbleText",
  "mediaTrayFrom",
  "mediaTrayTo",
  "mediaTrayBorder",
  "cardSoftBg",
  "cardSoftBorder",
] as const;

async function run(): Promise<void> {
  assert.ok(
    APP_THEME_OPTIONS.length >= 4,
    "Expected at least four supported app themes",
  );

  assert.ok(
    APP_THEME_OPTIONS.some((theme) => theme.id === DEFAULT_APP_THEME_ID),
    "DEFAULT_APP_THEME_ID must exist in APP_THEME_OPTIONS",
  );

  for (const theme of APP_THEME_OPTIONS) {
    assert.ok(isAppThemeId(theme.id), `Theme id must be recognized: ${theme.id}`);
    for (const key of REQUIRED_THEME_VAR_KEYS) {
      const value = theme.vars[key];
      assert.ok(
        typeof value === "string" && value.trim().length > 0,
        `Theme ${theme.id} is missing vars.${key}`,
      );
    }
  }

  const fallbackTheme = getAppTheme("not-a-real-theme");
  assert.equal(
    fallbackTheme.id,
    DEFAULT_APP_THEME_ID,
    "Invalid theme ids should fallback to DEFAULT_APP_THEME_ID",
  );

  const appPath = path.resolve("client/src/App.tsx");
  const appSource = await readFile(appPath, "utf8");

  const requiredMarkers = [
    'kind: "agent_task_status"',
    'kind: "agent_approval"',
    'kind: "agent_artifact"',
    'data-testid="agent-unified-task-card"',
    'data-testid="agent-task-tabs"',
    'data-testid="agent-task-info-button"',
    'data-testid="agent-task-process-timeline"',
    'data-testid="agent-task-info-dialog"',
    'data-testid="outputs-history-artifact-card"',
    "var(--app-soft-card-bg)",
    "var(--app-soft-card-border)",
    "var(--app-on-dark)",
  ];

  for (const marker of requiredMarkers) {
    assert.ok(
      appSource.includes(marker),
      `App theme contract missing marker: ${marker}`,
    );
  }

  console.log("agent-theme contract checks passed");
}

void run().catch((error) => {
  console.error(error);
  process.exit(1);
});
