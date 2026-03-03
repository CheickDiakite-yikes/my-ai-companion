import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";

interface CliArgs {
  baseUrl: string;
  email: string;
  password: string;
  outputDir: string;
}

interface PromptCase {
  id: string;
  text: string;
  expected: RegExp;
}

interface ConversationMessage {
  id: string;
  sender: "user" | "assistant";
  text: string;
}

const PROMPT_CASES: PromptCase[] = [
  {
    id: "calendar_today",
    text: "what do i have on my calendar today?",
    expected: /(calendar|schedule|event|connect|google)/i,
  },
  {
    id: "email_last_day",
    text: "can you summarize my unread emails from last day",
    expected: /(email|inbox|message|connect|google)/i,
  },
  {
    id: "combined_week",
    text: "any key emails or events i should have on mind this week?",
    expected: /(email|event|calendar|inbox|connect|google)/i,
  },
];

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(args.outputDir, { recursive: true });

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({
      viewport: { width: 430, height: 932 },
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    });

    await login(page, args);
    await dismissOnboardingIfPresent(page);
    await verifyConnectedAccountsUi(page, args.outputDir);
    await verifyPromptFlows(page, args.baseUrl, args.outputDir);

    console.log("google-personal-context Playwright checks passed");
    await page.close();
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
      "Usage: tsx script/google-personal-context-playwright-check.ts --base-url <url> --email <email> --password <password> --output-dir <dir>",
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
        `Failed to launch browser. Install Chromium (npx playwright install chromium). Root error: ${details}`,
      );
    }
  }
}

async function login(page: Page, args: CliArgs): Promise<void> {
  await page.goto(args.baseUrl, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-testid="button-sign-in"]', { timeout: 30_000 });
  await page.getByTestId("button-sign-in").click();
  await page.waitForSelector('[data-testid="input-login-email"]', { timeout: 30_000 });
  await page.getByTestId("input-login-email").fill(args.email);
  await page.getByTestId("input-login-password").fill(args.password);
  await page.getByTestId("button-login-submit").click();
  await page.waitForSelector('[data-testid="input-message"]', { timeout: 35_000 });
}

async function dismissOnboardingIfPresent(page: Page): Promise<void> {
  const skip = page.getByTestId("button-skip-onboarding");
  if (await skip.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await skip.click();
    await page.waitForSelector('[data-testid="button-skip-onboarding"]', {
      state: "hidden",
      timeout: 10_000,
    }).catch(() => undefined);
  }
}

async function verifyConnectedAccountsUi(page: Page, outputDir: string): Promise<void> {
  await page.getByTestId("button-profile").click();
  await page.waitForSelector('[data-testid="button-toggle-connected-accounts"]', {
    timeout: 15_000,
  });

  const googleAccountVisible = await page
    .getByText("Google Account")
    .isVisible()
    .catch(() => false);
  if (!googleAccountVisible) {
    await page.getByTestId("button-toggle-connected-accounts").click();
  }
  await page
    .waitForSelector("text=Google Account", { timeout: 12_000 })
    .catch(async () => {
      await page.getByTestId("button-toggle-connected-accounts").click();
      await page.waitForSelector("text=Google Account", { timeout: 12_000 });
    });

  const connectCount = await page.locator('[data-testid="button-connect-google"]').count();
  const disconnectCount = await page
    .locator('[data-testid="button-disconnect-google"]')
    .count();
  assert.ok(
    connectCount + disconnectCount > 0,
    "Expected connect or disconnect action in Connected Accounts section",
  );

  await page.screenshot({
    path: resolve(outputDir, "google-personal-context-profile.png"),
    fullPage: true,
  });

  if ((await page.locator('[data-testid="button-close-profile"]').count()) > 0) {
    await page.getByTestId("button-close-profile").click();
  }

  await page.waitForSelector('[data-testid="input-message"]', { timeout: 15_000 });
}

async function verifyPromptFlows(
  page: Page,
  baseUrl: string,
  outputDir: string,
): Promise<void> {
  const conversationId = await resolveActiveConversationId(page, baseUrl);

  for (const promptCase of PROMPT_CASES) {
    const beforeMessages = await fetchConversationMessages(
      page,
      baseUrl,
      conversationId,
    );
    const beforeAssistantCount = beforeMessages.filter(
      (message) => message.sender === "assistant",
    ).length;

    const messageInput = page.getByTestId("input-message");
    await messageInput.fill(promptCase.text);
    await messageInput.press("Enter");

    const latest = await waitForLatestAssistantReply({
      page,
      baseUrl,
      conversationId,
      previousAssistantCount: beforeAssistantCount,
      timeoutMs: 90_000,
    });

    assert.ok(latest.length > 0, `${promptCase.id} should produce an assistant reply`);
    assert.match(
      latest,
      promptCase.expected,
      `${promptCase.id} reply should mention relevant Google personal context terms`,
    );

    const pageText = await page.locator("body").innerText();
    assert.equal(
      /message failed to send/i.test(pageText),
      false,
      `${promptCase.id} should not trigger message send failure`,
    );

    await page.screenshot({
      path: resolve(outputDir, `google-personal-context-${promptCase.id}.png`),
      fullPage: true,
    });
  }
}

async function resolveActiveConversationId(page: Page, baseUrl: string): Promise<string> {
  const response = await page.request.get(`${baseUrl}/api/conversations`);
  assert.equal(response.ok(), true, "Expected conversation list request to succeed");
  const payload = (await response.json()) as Array<{ id: string }>;
  const conversationId = payload[0]?.id;
  assert.ok(conversationId, "Expected at least one active conversation");
  return conversationId;
}

async function fetchConversationMessages(
  page: Page,
  baseUrl: string,
  conversationId: string,
): Promise<ConversationMessage[]> {
  const response = await page.request.get(
    `${baseUrl}/api/conversations/${conversationId}/messages`,
  );
  assert.equal(
    response.ok(),
    true,
    `Expected messages fetch to succeed for conversation ${conversationId}`,
  );
  return (await response.json()) as ConversationMessage[];
}

async function waitForLatestAssistantReply(input: {
  page: Page;
  baseUrl: string;
  conversationId: string;
  previousAssistantCount: number;
  timeoutMs: number;
}): Promise<string> {
  const deadline = Date.now() + input.timeoutMs;
  let latest = "";

  while (Date.now() < deadline) {
    const messages = await fetchConversationMessages(
      input.page,
      input.baseUrl,
      input.conversationId,
    );
    const assistantMessages = messages.filter(
      (message) => message.sender === "assistant" && message.text.trim().length > 0,
    );
    if (assistantMessages.length > input.previousAssistantCount) {
      latest = assistantMessages.at(-1)?.text.replace(/\s+/g, " ").trim() ?? "";
      if (latest.length > 0) {
        return latest;
      }
    }
    await input.page.waitForTimeout(1200);
  }

  return latest;
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
