import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";

type ThemeId =
  | "classic_teal"
  | "sunset_path"
  | "violet_city"
  | "crimson_noir";

interface CliArgs {
  baseUrl: string;
  email: string;
  password: string;
  outputDir: string;
}

const THEMES: ThemeId[] = [
  "classic_teal",
  "sunset_path",
  "violet_city",
  "crimson_noir",
];

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(args.outputDir, { recursive: true });

  const browser = await launchBrowser();
  try {
    const desktopPage = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    await runUiAssertions({
      page: desktopPage,
      baseUrl: args.baseUrl,
      email: args.email,
      password: args.password,
      outputDir: args.outputDir,
      variant: "desktop",
    });
    await desktopPage.close();

    const mobilePage = await browser.newPage({
      viewport: { width: 390, height: 844 },
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    });
    await runUiAssertions({
      page: mobilePage,
      baseUrl: args.baseUrl,
      email: args.email,
      password: args.password,
      outputDir: args.outputDir,
      variant: "mobile",
    });
    await mobilePage.close();

    console.log("agent-ui-theme Playwright checks passed");
  } finally {
    await browser.close();
  }
}

function parseArgs(argv: string[]): CliArgs {
  let baseUrl = "";
  let email = "";
  let password = "";
  let outputDir = "";

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--base-url" && next) {
      baseUrl = next;
      i += 1;
      continue;
    }
    if (arg === "--email" && next) {
      email = next;
      i += 1;
      continue;
    }
    if (arg === "--password" && next) {
      password = next;
      i += 1;
      continue;
    }
    if (arg === "--output-dir" && next) {
      outputDir = next;
      i += 1;
      continue;
    }
  }

  if (!baseUrl || !email || !password || !outputDir) {
    throw new Error(
      "Usage: tsx script/agent-ui-theme-playwright-check.ts --base-url <url> --email <email> --password <password> --output-dir <dir>",
    );
  }

  return {
    baseUrl,
    email,
    password,
    outputDir: resolve(outputDir),
  };
}

async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({
      channel: "chrome",
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
  } catch (chromeLaunchError) {
    try {
      return await chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      });
    } catch {
      const details =
        chromeLaunchError instanceof Error
          ? chromeLaunchError.message
          : String(chromeLaunchError);
      throw new Error(
        `Failed to launch browser. Install a compatible browser (e.g. run "npx playwright install chromium"). Root error: ${details}`,
      );
    }
  }
}

async function runUiAssertions(params: {
  page: Page;
  baseUrl: string;
  email: string;
  password: string;
  outputDir: string;
  variant: "desktop" | "mobile";
}): Promise<void> {
  const { page, baseUrl, email, password, outputDir, variant } = params;

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-testid="button-sign-in"]', { timeout: 25_000 });
  await page.getByTestId("button-sign-in").click();
  await page.waitForSelector('[data-testid="input-login-email"]', {
    timeout: 25_000,
  });
  await page.getByTestId("input-login-email").fill(email);
  await page.getByTestId("input-login-password").fill(password);
  await page.getByTestId("button-login-submit").click();

  await dismissOnboardingIfPresent(page);

  await page.waitForFunction(
    () =>
      document.querySelectorAll('[data-testid="agent-task-status-card"]').length >
        0 &&
      document.querySelectorAll('[data-testid="agent-artifact-card"]').length > 0,
    { timeout: 25_000 },
  );

  const statusCardCount = await page
    .locator('[data-testid="agent-task-status-card"]')
    .count();
  const artifactCardCount = await page
    .locator('[data-testid="agent-artifact-card"]')
    .count();
  assert.ok(statusCardCount >= 1, "Expected at least one agent task status card");
  assert.ok(artifactCardCount >= 1, "Expected at least one agent artifact card");

  await openProfilePanel(page);
  await ensureSectionOpen({
    page,
    toggleTestId: "button-toggle-account",
    requiredChildSelector: '[data-testid="button-open-outputs-history"]',
  });
  await page.getByTestId("button-open-outputs-history").click();
  await page.waitForSelector('[data-testid="outputs-history-artifact-card"]', {
    timeout: 20_000,
  });

  const historyCount = await page
    .locator('[data-testid="outputs-history-artifact-card"]')
    .count();
  assert.ok(
    historyCount >= 2,
    `Expected at least two artifacts in outputs history, got ${historyCount}`,
  );

  await page.waitForSelector('[data-testid="button-open-history-artifact"]', {
    timeout: 10_000,
  });
  await page.getByTestId("button-open-history-artifact").first().click();
  await page.waitForSelector('[data-testid="button-close-artifact-viewer"]', {
    timeout: 10_000,
  });
  await page.getByTestId("button-close-artifact-viewer").click();
  await page.waitForTimeout(200);

  await page.getByTestId("button-close-outputs-history").click();
  await page.waitForTimeout(200);

  for (const [index, themeId] of THEMES.entries()) {
    await openProfilePanel(page);
    await ensureSectionOpen({
      page,
      toggleTestId: "button-theme-toggle",
      requiredChildSelector: `[data-testid="button-theme-${themeId}"]`,
    });
    await page.evaluate((targetTheme) => {
      const button = document.querySelector(
        `[data-testid="button-theme-${targetTheme}"]`,
      );
      if (!(button instanceof HTMLElement)) {
        throw new Error(`Theme button missing: ${targetTheme}`);
      }
      button.click();
    }, themeId);
    await page.waitForFunction(
      (expected) =>
        document.documentElement.getAttribute("data-app-theme") === expected,
      themeId,
      { timeout: 10_000 },
    );

    const styleCheck = await page.evaluate(() => {
      const styles = getComputedStyle(document.documentElement);
      const softCard = styles.getPropertyValue("--app-soft-card-bg").trim();
      const softBorder = styles.getPropertyValue("--app-soft-card-border").trim();
      const onDark = styles.getPropertyValue("--app-on-dark").trim();
      return { softCard, softBorder, onDark };
    });
    assert.ok(styleCheck.softCard.length > 0, "Missing --app-soft-card-bg");
    assert.ok(styleCheck.softBorder.length > 0, "Missing --app-soft-card-border");
    assert.ok(styleCheck.onDark.length > 0, "Missing --app-on-dark");

    await page.screenshot({
      path: resolve(outputDir, `${variant}-profile-${themeId}.png`),
      fullPage: true,
    });

    await closeProfilePanel(page);
    await page.waitForSelector('[data-testid="agent-artifact-card"]', {
      state: "attached",
      timeout: 20_000,
    });
    await page.screenshot({
      path: resolve(outputDir, `${variant}-chat-${themeId}.png`),
      fullPage: true,
    });

    if (index < THEMES.length - 1) {
      await openProfilePanel(page);
    }
  }
}

async function openProfilePanel(page: Page): Promise<void> {
  if ((await page.locator('[data-testid="button-theme-toggle"]').count()) > 0) {
    return;
  }
  await page.getByTestId("button-profile").click();
  await page.waitForSelector('[data-testid="button-close-profile"]', {
    timeout: 15_000,
  });
  await page.waitForSelector('[data-testid="button-theme-toggle"]', {
    timeout: 15_000,
  });
}

async function closeProfilePanel(page: Page): Promise<void> {
  if ((await page.locator('[data-testid="button-close-profile"]').count()) === 0) {
    return;
  }
  await page.evaluate(() => {
    const closeButton = document.querySelector('[data-testid="button-close-profile"]');
    if (!(closeButton instanceof HTMLElement)) {
      throw new Error("Profile close button missing");
    }
    closeButton.click();
  });
  await page.waitForSelector('[data-testid="button-theme-toggle"]', {
    state: "hidden",
    timeout: 15_000,
  }).catch(() => undefined);
}

async function dismissOnboardingIfPresent(page: Page): Promise<void> {
  const skipOnboarding = page.getByTestId("button-skip-onboarding");
  if (await skipOnboarding.isVisible({ timeout: 15_000 }).catch(() => false)) {
    await skipOnboarding.click();
    await page.waitForSelector('[data-testid="button-skip-onboarding"]', {
      state: "hidden",
      timeout: 10_000,
    }).catch(() => undefined);
    await page.waitForTimeout(300);
  }
}

async function ensureSectionOpen(params: {
  page: Page;
  toggleTestId: string;
  requiredChildSelector: string;
}): Promise<void> {
  const { page, toggleTestId, requiredChildSelector } = params;
  if ((await page.locator(requiredChildSelector).count()) > 0) {
    return;
  }
  await page.getByTestId(toggleTestId).click();
  await page.waitForSelector(requiredChildSelector, { timeout: 10_000 });
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
