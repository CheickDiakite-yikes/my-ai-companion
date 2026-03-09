import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { chromium, type Browser, type Page } from "playwright";
import { db, pool } from "../server/db";
import { encryptGoogleToken } from "../server/google-integration-crypto";
import { users } from "../shared/models/auth";
import { googleIntegrations } from "../shared/schema";

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

type GoogleFixtureScopeMode = "read" | "write";

const GOOGLE_GMAIL_READONLY_SCOPE =
  "https://www.googleapis.com/auth/gmail.readonly";
const GOOGLE_GMAIL_COMPOSE_SCOPE =
  "https://www.googleapis.com/auth/gmail.compose";
const GOOGLE_GMAIL_SEND_SCOPE =
  "https://www.googleapis.com/auth/gmail.send";
const GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE =
  "https://www.googleapis.com/auth/calendar.events.readonly";
const GOOGLE_CALENDAR_EVENTS_WRITE_SCOPE =
  "https://www.googleapis.com/auth/calendar.events";

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

    console.log("[google-context-check] login");
    await login(page, args);
    console.log("[google-context-check] onboarding");
    await dismissOnboardingIfPresent(page);
    console.log("[google-context-check] disconnected status");
    await verifyDisconnectedConnectedAccountsUi(page, args.outputDir);
    console.log("[google-context-check] baseline prompts");
    await verifyPromptFlows(page, args.baseUrl, args.outputDir);
    console.log("[google-context-check] seed read scopes");
    await upsertGoogleIntegrationFixture(args.email, "read");
    console.log("[google-context-check] read-only status");
    await verifyReadOnlyGoogleAssistantState(page, args.outputDir);
    console.log("[google-context-check] upgrade-required compose");
    await verifyUpgradeRequiredComposeFlow(page, args.baseUrl);
    console.log("[google-context-check] seed write scopes");
    await upsertGoogleIntegrationFixture(args.email, "write");
    console.log("[google-context-check] write-enabled status");
    await verifyWriteEnabledGoogleAssistantState(page, args.outputDir);
    console.log("[google-context-check] approval card compose");
    await verifyApprovalCardComposeFlow(page, args.baseUrl, args.outputDir);

    console.log("google-personal-context Playwright checks passed");
    await page.close();
  } finally {
    await browser.close();
    await pool.end();
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

async function openConnectedAccounts(page: Page): Promise<void> {
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
}

async function closeProfile(page: Page): Promise<void> {
  if ((await page.locator('[data-testid="button-close-profile"]').count()) > 0) {
    await page.getByTestId("button-close-profile").click();
  }
  await page.waitForSelector('[data-testid="input-message"]', { timeout: 15_000 });
}

async function verifyDisconnectedConnectedAccountsUi(
  page: Page,
  outputDir: string,
): Promise<void> {
  await openConnectedAccounts(page);

  const connectCount = await page.locator('[data-testid="button-connect-google"]').count();
  const disconnectCount = await page
    .locator('[data-testid="button-disconnect-google"]')
    .count();
  assert.ok(
    connectCount + disconnectCount > 0,
    "Expected connect or disconnect action in Connected Accounts section",
  );

  await page.screenshot({
    path: resolve(outputDir, "google-personal-context-profile-disconnected.png"),
    fullPage: true,
  });

  await closeProfile(page);
}

async function verifyReadOnlyGoogleAssistantState(
  page: Page,
  outputDir: string,
): Promise<void> {
  await page.reload({ waitUntil: "networkidle" });
  await openConnectedAccounts(page);

  await page.waitForSelector("text=Gmail read ✓", { timeout: 15_000 });
  await page.waitForSelector("text=Calendar read ✓", { timeout: 15_000 });
  await page.waitForSelector("text=Gmail write —", { timeout: 15_000 });
  await page.waitForSelector("text=Calendar write —", { timeout: 15_000 });
  await page.waitForSelector('[data-testid="button-upgrade-google-access"]', {
    timeout: 15_000,
  });

  await page.screenshot({
    path: resolve(outputDir, "google-personal-context-profile-read-only.png"),
    fullPage: true,
  });

  await closeProfile(page);
}

async function verifyWriteEnabledGoogleAssistantState(
  page: Page,
  outputDir: string,
): Promise<void> {
  await page.reload({ waitUntil: "networkidle" });
  await openConnectedAccounts(page);

  await page.waitForSelector("text=Gmail read ✓", { timeout: 15_000 });
  await page.waitForSelector("text=Calendar read ✓", { timeout: 15_000 });
  await page.waitForSelector("text=Gmail write ✓", { timeout: 15_000 });
  await page.waitForSelector("text=Calendar write ✓", { timeout: 15_000 });
  assert.equal(
    await page.locator('[data-testid="button-upgrade-google-access"]').count(),
    0,
    "Upgrade Google access button should be hidden once write scopes are present",
  );

  await page.screenshot({
    path: resolve(outputDir, "google-personal-context-profile-write-enabled.png"),
    fullPage: true,
  });

  await closeProfile(page);
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

async function verifyUpgradeRequiredComposeFlow(
  page: Page,
  baseUrl: string,
): Promise<void> {
  const conversationId = await resolveActiveConversationId(page, baseUrl);
  const beforeMessages = await fetchConversationMessages(page, baseUrl, conversationId);
  const previousAssistantCount = beforeMessages.filter(
    (message) => message.sender === "assistant",
  ).length;

  await page.getByTestId("input-message").fill(
    "draft an email to alex@example.com saying hey alex just checking in",
  );
  await page.getByTestId("input-message").press("Enter");

  const latest = await waitForLatestAssistantReply({
    page,
    baseUrl,
    conversationId,
    previousAssistantCount,
    timeoutMs: 45_000,
  });
  assert.match(
    latest,
    /(gmail write access|upgrade google permissions|upgrade google access)/i,
    "Compose flow should request a Google access upgrade when write scopes are missing",
  );
}

async function verifyApprovalCardComposeFlow(
  page: Page,
  baseUrl: string,
  outputDir: string,
): Promise<void> {
  const conversationId = await resolveActiveConversationId(page, baseUrl);
  const beforeComposeMessages = await fetchConversationMessages(
    page,
    baseUrl,
    conversationId,
  );
  const beforeComposeAssistantCount = beforeComposeMessages.filter(
    (message) => message.sender === "assistant",
  ).length;

  await page.getByTestId("input-message").fill("draft an email to alex@example.com");
  await page.getByTestId("input-message").press("Enter");

  const composeReply = await waitForLatestAssistantReply({
    page,
    baseUrl,
    conversationId,
    previousAssistantCount: beforeComposeAssistantCount,
    timeoutMs: 45_000,
  });
  assert.match(
    composeReply,
    /(what you want the email to say|what should the email say|what should it say|draft it)/i,
    "Multi-turn compose should ask for the missing draft body first",
  );

  const composeSessionCard = page.locator(
    '[data-testid="google-compose-session-card"]',
  ).last();
  await composeSessionCard.waitFor({ state: "visible", timeout: 20_000 });
  await page.screenshot({
    path: resolve(outputDir, "google-personal-context-compose-session-card.png"),
    fullPage: true,
  });

  const afterComposeMessages = await fetchConversationMessages(
    page,
    baseUrl,
    conversationId,
  );
  const afterComposeAssistantCount = afterComposeMessages.filter(
    (message) => message.sender === "assistant",
  ).length;

  await page.getByTestId("input-message").fill(
    "ask if he is free to hang out on march 12th",
  );
  await page.getByTestId("input-message").press("Enter");

  await waitForLatestAssistantReply({
    page,
    baseUrl,
    conversationId,
    previousAssistantCount: afterComposeAssistantCount,
    timeoutMs: 45_000,
  });

  console.log("[google-context-check] waiting for approval surface");
  const approvalCard = page.locator('[data-testid="agent-approval-card"]').last();
  const unifiedCard = page.locator('[data-testid="agent-unified-task-card"]').last();
  const deadline = Date.now() + 45_000;
  let approvalCardCount = 0;
  let unifiedCardCount = 0;

  while (Date.now() < deadline) {
    approvalCardCount = await page.locator('[data-testid="agent-approval-card"]').count();
    unifiedCardCount = await page.locator('[data-testid="agent-unified-task-card"]').count();
    if (approvalCardCount > 0 || unifiedCardCount > 0) {
      break;
    }
    await page.waitForTimeout(1_000);
  }

  console.log(
    `[google-context-check] approval surface counts unified=${unifiedCardCount} approval=${approvalCardCount}`,
  );
  assert.ok(
    approvalCardCount > 0 || unifiedCardCount > 0,
    "Expected a Google approval UI card to render in chat",
  );

  if (unifiedCardCount > 0) {
    assert.ok(
      (await page.locator('[data-testid="google-email-preview-card"]').count()) > 0,
      "Expected the unified Google card to render the email composer preview",
    );
  }

  const taskId =
    (approvalCardCount > 0
      ? await approvalCard.getAttribute("data-agent-task-id")
      : await unifiedCard.getAttribute("data-agent-task-id")) ?? null;
  assert.ok(taskId, "Expected approval UI to expose a Google action task id");
  console.log(`[google-context-check] approval surface ready taskId=${taskId}`);

  const taskMessages = await fetchConversationMessages(page, baseUrl, conversationId);
  const previousAssistantCount = taskMessages.filter(
    (message) => message.sender === "assistant",
  ).length;

  console.log("[google-context-check] denying approval via API");
  const denyResponse = await page.request.post(
    `${baseUrl}/api/agent/tasks/${taskId}/approve`,
    {
      data: {
        approve: false,
        reason: "Denied from Playwright",
      },
    },
  );
  assert.equal(
    denyResponse.ok(),
    true,
    "Expected Google action denial request to succeed",
  );
  console.log("[google-context-check] waiting for denial reply");

  const latest = await waitForLatestAssistantReply({
    page,
    baseUrl,
    conversationId,
    previousAssistantCount,
    timeoutMs: 45_000,
  });
  assert.match(
    latest,
    /(canceled that task|canceled|cancelled)/i,
    "Denying the Google approval card should cancel the task cleanly",
  );

  await page.screenshot({
    path: resolve(outputDir, "google-personal-context-approval-card.png"),
    fullPage: true,
  });
  console.log("[google-context-check] approval flow complete");
}

function scopesForMode(mode: GoogleFixtureScopeMode): string[] {
  const baseScopes = [
    GOOGLE_GMAIL_READONLY_SCOPE,
    GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE,
  ];
  if (mode === "read") {
    return baseScopes;
  }
  return [
    ...baseScopes,
    GOOGLE_GMAIL_COMPOSE_SCOPE,
    GOOGLE_GMAIL_SEND_SCOPE,
    GOOGLE_CALENDAR_EVENTS_WRITE_SCOPE,
  ];
}

async function upsertGoogleIntegrationFixture(
  email: string,
  mode: GoogleFixtureScopeMode,
): Promise<void> {
  const [user] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  assert.ok(user?.id, `Expected to find user for ${email}`);

  const encryptedAccessToken = encryptGoogleToken(`fixture-access-token-${mode}`);
  const encryptedRefreshToken = encryptGoogleToken(`fixture-refresh-token-${mode}`);
  const scopes = scopesForMode(mode);

  await db
    .insert(googleIntegrations)
    .values({
      userId: user.id,
      provider: "google",
      googleSub: `fixture-google-sub-${mode}`,
      email,
      scopes,
      refreshTokenEncrypted: encryptedRefreshToken,
      accessTokenEncrypted: encryptedAccessToken,
      expiry: new Date(Date.now() + 24 * 60 * 60 * 1000),
      status: "connected",
      lastError: null,
    })
    .onConflictDoUpdate({
      target: googleIntegrations.userId,
      set: {
        googleSub: `fixture-google-sub-${mode}`,
        email,
        scopes,
        refreshTokenEncrypted: encryptedRefreshToken,
        accessTokenEncrypted: encryptedAccessToken,
        expiry: new Date(Date.now() + 24 * 60 * 60 * 1000),
        status: "connected",
        lastError: null,
        updatedAt: new Date(),
      },
    });
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
