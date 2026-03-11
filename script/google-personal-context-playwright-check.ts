import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { chromium, type Browser, type Page } from "playwright";
import { db, pool } from "../server/db";
import { encryptGoogleToken } from "../server/google-integration-crypto";
import { storage } from "../server/storage";
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
    page.on("console", (message) => {
      const text = message.text();
      if (
        message.type() === "error" ||
        message.type() === "warning" ||
        /chat\.|google_ambiguity|pageerror/i.test(text)
      ) {
        console.log(`[google-context-browser:${message.type()}] ${text}`);
      }
    });
    page.on("pageerror", (error) => {
      console.log(`[google-context-browser:pageerror] ${error.message}`);
    });
    page.on("request", (request) => {
      if (request.url().includes("/api/chat/respond")) {
        console.log(
          `[google-context-browser:request] ${request.method()} ${request.url()}`,
        );
      }
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
    console.log("[google-context-check] compose phrasing coverage");
    await verifyComposeForRecipientPhrasingFlow(page, args.baseUrl, args.outputDir);
    console.log("[google-context-check] approval card compose");
    await verifyApprovalCardComposeFlow(page, args.baseUrl, args.outputDir);
    console.log("[google-context-check] existing draft selection");
    await verifyExistingDraftSelectionFlow(page, args.baseUrl, args.email, args.outputDir);
    console.log("[google-context-check] fresh compose overrides history");
    await verifyFreshComposeOverridesHistoryFlow(
      page,
      args.baseUrl,
      args.email,
      args.outputDir,
    );
    console.log("[google-context-check] ai compose recipient correction");
    await verifyAiComposeRecipientCorrectionFlow(
      page,
      args.baseUrl,
      args.outputDir,
    );
    console.log("[google-context-check] calendar clarification card");
    await verifyCalendarClarificationCardFlow(page, args.baseUrl, args.outputDir);
    console.log("[google-context-check] saved-draft revision follow-up");
    await verifySavedDraftRevisionFollowUpFlow(page, args.baseUrl, args.email, args.outputDir);
    console.log("[google-context-check] ambiguous-draft follow-up");
    await verifyAmbiguousDraftFollowUpFlow(page, args.baseUrl, args.email, args.outputDir);
    console.log("[google-context-check] saved-draft send follow-up");
    await verifySavedDraftSendFollowUpFlow(page, args.baseUrl, args.email, args.outputDir);
    console.log("[google-context-check] recent-calendar follow-up");
    await verifyRecentCalendarFollowUpFlow(page, args.baseUrl, args.email, args.outputDir);
    console.log("[google-context-check] manual draft editor");
    await verifyManualDraftEditorFlow(page, args.baseUrl, args.email, args.outputDir);
    console.log("[google-context-check] manual calendar editor");
    await verifyManualCalendarEditorFlow(page, args.baseUrl, args.email, args.outputDir);

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

async function verifyComposeForRecipientPhrasingFlow(
  page: Page,
  baseUrl: string,
  outputDir: string,
): Promise<void> {
  const conversationId = await resolveActiveConversationId(page, baseUrl);
  const beforeMessages = await fetchConversationMessages(page, baseUrl, conversationId);
  const previousAssistantCount = beforeMessages.filter(
    (message) => message.sender === "assistant",
  ).length;

  await page
    .getByTestId("input-message")
    .fill("okay lets create an email for contact@cheickdiakite.com");
  await page.getByTestId("input-message").press("Enter");

  const clarifyReply = await waitForLatestAssistantReply({
    page,
    baseUrl,
    conversationId,
    previousAssistantCount,
    timeoutMs: 45_000,
  });
  assert.match(
    clarifyReply,
    /what should the email say|i can draft that to contact@cheickdiakite\.com/i,
    'Expected "create an email for ..." phrasing to stay in the structured compose flow',
  );

  const composeSessionCard = page.locator('[data-testid="google-compose-session-card"]').last();
  await composeSessionCard.waitFor({ state: "visible", timeout: 20_000 });
  assert.equal(
    await composeSessionCard.getAttribute("data-compose-status"),
    "awaiting_body",
    "Expected recipient-only phrasing to create an awaiting_body compose session",
  );
  assert.match(
    await composeSessionCard.innerText(),
    /contact@cheickdiakite\.com/i,
    "Expected the compose session card to carry the provided recipient",
  );

  await page.screenshot({
    path: resolve(outputDir, "google-personal-context-compose-for-phrasing.png"),
    fullPage: true,
  });
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

  await page
    .getByTestId("input-message")
    .fill("create an email draft to alex@example.com");
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

  await page
    .getByTestId("input-message")
    .fill("ask if he is free to hang out on march 12th");
  await page.getByTestId("input-message").press("Enter");

  const revisionReply = await waitForLatestAssistantReply({
    page,
    baseUrl,
    conversationId,
    previousAssistantCount,
    timeoutMs: 45_000,
  });
  assert.match(
    revisionReply,
    /updated the draft preview|review it and approve/i,
    "Draft follow-up edits should update the existing Gmail preview instead of falling back to companion chat",
  );
  assert.doesNotMatch(
    revisionReply,
    /calendar for today|totally clear schedule/i,
    "Draft follow-up edits should not fall back into unrelated companion context",
  );

  const revisedUnifiedCard = page.locator('[data-testid="agent-unified-task-card"]').last();
  await revisedUnifiedCard.waitFor({ state: "visible", timeout: 20_000 });
  assert.equal(
    (await revisedUnifiedCard.getAttribute("data-agent-task-id")) ?? null,
    taskId,
    "Draft follow-up edits should stay attached to the same pending Gmail task",
  );
  const revisedPreviewCard = page.locator('[data-testid="google-email-preview-card"]').last();
  await revisedPreviewCard.waitFor({ state: "visible", timeout: 20_000 });
  assert.match(
    await revisedPreviewCard.innerText(),
    /march 12|hang out/i,
    "Expected the revised Gmail preview to reflect the follow-up edit request",
  );

  const revisedTaskMessages = await fetchConversationMessages(
    page,
    baseUrl,
    conversationId,
  );
  const revisedAssistantCount = revisedTaskMessages.filter(
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
    previousAssistantCount: revisedAssistantCount,
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

async function verifyCalendarClarificationCardFlow(
  page: Page,
  baseUrl: string,
  outputDir: string,
): Promise<void> {
  const conversationId = await resolveActiveConversationId(page, baseUrl);
  const beforeMessages = await fetchConversationMessages(page, baseUrl, conversationId);
  const beforeAssistantCount = beforeMessages.filter(
    (message) => message.sender === "assistant",
  ).length;

  await page
    .getByTestId("input-message")
    .fill("can you add a calendar event lunch with alex on my calendar?");
  await page.getByTestId("input-message").press("Enter");

  const clarifyReply = await waitForLatestAssistantReply({
    page,
    baseUrl,
    conversationId,
    previousAssistantCount: beforeAssistantCount,
    timeoutMs: 45_000,
  });
  assert.match(
    clarifyReply,
    /(when the event should happen|tomorrow at 1pm|what time)/i,
    "Calendar create without a time should ask for timing details",
  );

  const sessionCard = page.locator('[data-testid="google-calendar-session-card"]').last();
  await sessionCard.waitFor({ state: "visible", timeout: 20_000 });
  assert.match(
    await sessionCard.innerText(),
    /lunch with alex|time tbd|waiting/i,
    "Expected a dedicated calendar clarification card in text chat",
  );

  const afterClarifyMessages = await fetchConversationMessages(page, baseUrl, conversationId);
  const afterClarifyAssistantCount = afterClarifyMessages.filter(
    (message) => message.sender === "assistant",
  ).length;

  await page.getByTestId("input-message").fill("saturday at 1pm");
  await page.getByTestId("input-message").press("Enter");

  await waitForLatestAssistantReply({
    page,
    baseUrl,
    conversationId,
    previousAssistantCount: afterClarifyAssistantCount,
    timeoutMs: 45_000,
  });

  const calendarCard = page.locator('[data-google-calendar-card="true"]').last();
  await calendarCard.waitFor({ state: "visible", timeout: 20_000 });
  const calendarCardText = await calendarCard.innerText();
  assert.match(
    calendarCardText,
    /lunch with alex/i,
    "Expected the time follow-up to produce a real calendar approval card",
  );
  assert.match(
    calendarCardText,
    /(needs approval|create event|create calendar event|approve)/i,
    "Expected the resolved calendar approval card to show approval-backed preview controls",
  );
  assert.equal(
    await calendarCard.getAttribute("data-agent-task-status"),
    "approval_required",
    "Expected the clarification follow-up to resolve into an approval-required calendar task card",
  );

  const primaryAction = calendarCard
    .getByTestId("button-google-calendar-primary-action")
    .last();
  await primaryAction.waitFor({ state: "visible", timeout: 10_000 });
  assert.match(
    (await primaryAction.innerText()).trim(),
    /create event|create calendar event|update event/i,
    "Expected the resolved calendar card to expose a primary approval action",
  );

  await page.screenshot({
    path: resolve(outputDir, "google-personal-context-calendar-clarification-card.png"),
    fullPage: true,
  });
}

async function verifySavedDraftSendFollowUpFlow(
  page: Page,
  baseUrl: string,
  email: string,
  outputDir: string,
): Promise<void> {
  const conversationId = await resolveActiveConversationId(page, baseUrl);
  await seedPendingDraftApprovalFixture(email, conversationId);
  await seedSavedDraftTaskFixture(email, conversationId);
  await page.reload({ waitUntil: "networkidle" });

  const unifiedCard = page.locator('[data-testid="agent-unified-task-card"]').last();
  await unifiedCard.waitFor({ state: "visible", timeout: 20_000 });
  assert.match(
    await unifiedCard.innerText(),
    /team@soulnests\.com/i,
    "Expected the seeded Gmail draft card to reflect the latest saved recipient",
  );
  assert.match(
    await unifiedCard.innerText(),
    /draft saved/i,
    "Expected the seeded Gmail task to appear as a saved draft",
  );

  const beforeSendPromptMessages = await fetchConversationMessages(
    page,
    baseUrl,
    conversationId,
  );
  const beforeSendPromptAssistantCount = beforeSendPromptMessages.filter(
    (message) => message.sender === "assistant",
  ).length;
  const beforeSendComposeCardCount = await page
    .locator('[data-testid="google-compose-session-card"]')
    .count();

  await page.getByTestId("input-message").fill("can we send the email please?");
  await page.getByTestId("input-message").press("Enter");

  const sendFollowUpReply = await waitForLatestAssistantReply({
    page,
    baseUrl,
    conversationId,
    previousAssistantCount: beforeSendPromptAssistantCount,
    timeoutMs: 45_000,
  });

  assert.doesNotMatch(
    sendFollowUpReply,
    /who should i send it to/i,
    "Saved draft follow-up should not fall back into a fresh recipient prompt",
  );
  assert.match(
    sendFollowUpReply,
    /which email|which one/i,
    "Multiple draft candidates should require an explicit send ambiguity choice instead of guessing",
  );

  const ambiguityCard = page.locator('[data-testid="google-email-ambiguity-card"]').last();
  await ambiguityCard.waitFor({ state: "visible", timeout: 20_000 });
  assert.equal(
    await ambiguityCard.getAttribute("data-ambiguity-action"),
    "send",
    "Expected the send follow-up ambiguity card to stay in send mode",
  );
  assert.match(
    await ambiguityCard.innerText(),
    /team@soulnests\.com/i,
    "Expected send ambiguity card to include the latest saved draft recipient",
  );

  const ambiguityChoice = ambiguityCard
    .locator('[data-testid^="button-google-email-ambiguity-"]')
    .filter({ hasText: "team@soulnests.com" })
    .first();
  await ambiguityChoice.waitFor({ state: "visible", timeout: 20_000 });
  await ambiguityChoice.evaluate((button) => {
    (button as HTMLButtonElement).click();
  });
  await page.waitForTimeout(600);

  const resolvedSendReply = await waitForLatestAssistantReply({
    page,
    baseUrl,
    conversationId,
    previousAssistantCount: beforeSendPromptAssistantCount + 1,
    timeoutMs: 45_000,
  });
  assert.match(
    resolvedSendReply,
    /send email|review it and approve|approve if you want me to apply it/i,
    "Choosing a draft from the send ambiguity card should continue the send approval flow",
  );

  const sendUnifiedCard = page.locator('[data-testid="agent-unified-task-card"]').last();
  await sendUnifiedCard.waitFor({ state: "visible", timeout: 20_000 });
  const sendButton = page.getByTestId("button-google-email-primary-action").last();
  await sendButton.waitFor({ state: "visible", timeout: 20_000 });
  assert.match(
    (await sendButton.innerText()).trim(),
    /send email/i,
    "Expected follow-up send intent to surface a send approval action",
  );
  assert.equal(
    await page.locator('[data-testid="google-compose-session-card"]').count(),
    beforeSendComposeCardCount,
    "Saved draft follow-up should not create a new compose-session card",
  );

  await page.screenshot({
    path: resolve(outputDir, "google-personal-context-send-follow-up.png"),
    fullPage: true,
  });
}

async function verifySavedDraftRevisionFollowUpFlow(
  page: Page,
  baseUrl: string,
  email: string,
  outputDir: string,
): Promise<void> {
  const conversationId = await resolveActiveConversationId(page, baseUrl);
  await seedSavedDraftTaskFixture(email, conversationId);
  await page.reload({ waitUntil: "networkidle" });

  const seededCard = page.locator('[data-testid="agent-unified-task-card"]').last();
  await seededCard.waitFor({ state: "visible", timeout: 20_000 });
  assert.match(
    await seededCard.innerText(),
    /team@soulnests\.com/i,
    "Expected the seeded Gmail draft card to render before revision follow-up",
  );

  const beforeMessages = await fetchConversationMessages(page, baseUrl, conversationId);
  const previousAssistantCount = beforeMessages.filter(
    (message) => message.sender === "assistant",
  ).length;
  const previousComposeCardCount = await page
    .locator('[data-testid="google-compose-session-card"]')
    .count();

  await page
    .getByTestId("input-message")
    .fill("ask if he is free to hang out on march 12th");
  await page.getByTestId("input-message").press("Enter");

  const revisionReply = await waitForLatestAssistantReply({
    page,
    baseUrl,
    conversationId,
    previousAssistantCount,
    timeoutMs: 45_000,
  });

  let revisionAssistantCount = previousAssistantCount;
  if (/which email should i update|which email did you mean/i.test(revisionReply)) {
    const ambiguityCard = page.locator('[data-testid="google-email-ambiguity-card"]').last();
    await ambiguityCard.waitFor({ state: "visible", timeout: 20_000 });
    const ambiguityChoice = ambiguityCard
      .locator('[data-testid^="button-google-email-ambiguity-"]')
      .filter({ hasText: "team@soulnests.com" })
      .first();
    await ambiguityChoice.waitFor({ state: "visible", timeout: 20_000 });
    await ambiguityChoice.evaluate((button) => {
      (button as HTMLButtonElement).click();
    });
    await page.waitForTimeout(600);
    revisionAssistantCount = previousAssistantCount + 1;
  } else {
    assert.match(
      revisionReply,
      /updated the saved draft preview|updated the draft preview|review it and approve/i,
      "Saved draft follow-up edits should create a revised approval flow",
    );
  }

  const latestRevisionReply = await waitForLatestAssistantReply({
    page,
    baseUrl,
    conversationId,
    previousAssistantCount: revisionAssistantCount,
    timeoutMs: 45_000,
  });
  assert.match(
    latestRevisionReply,
    /updated the saved draft preview|updated the draft preview|review it and approve/i,
    "Saved draft follow-up edits should create a revised approval flow",
  );
  assert.doesNotMatch(
    latestRevisionReply,
    /who should i send it to|what should the email say/i,
    "Saved draft follow-up edits should not fall back into compose-session clarification",
  );
  assert.equal(
    await page.locator('[data-testid="google-compose-session-card"]').count(),
    previousComposeCardCount,
    "Saved draft follow-up edits should not create a new compose-session card",
  );

  const revisedUnifiedCard = page.locator('[data-testid="agent-unified-task-card"]').last();
  await revisedUnifiedCard.waitFor({ state: "visible", timeout: 20_000 });
  assert.match(
    await revisedUnifiedCard.innerText(),
    /needs draft approval|draft preview/i,
    "Expected saved draft revision to surface a new approval card",
  );
  assert.match(
    await revisedUnifiedCard.innerText(),
    /march 12|hang out/i,
    "Expected the revised saved draft preview to reflect the follow-up edit request",
  );

  const viewFullDraftButton = page
    .getByTestId("google-email-preview-card-toggle-body")
    .last();
  await viewFullDraftButton.waitFor({ state: "visible", timeout: 20_000 });
  assert.match(
    (await viewFullDraftButton.innerText()).trim(),
    /view full draft/i,
    "Expected long Gmail previews to expose a full draft toggle",
  );
  await viewFullDraftButton.evaluate((button) => {
    (button as HTMLButtonElement).click();
  });
  await page.waitForTimeout(200);
  assert.match(
    (await viewFullDraftButton.innerText()).trim(),
    /show less/i,
    "Expected the Gmail draft toggle to expand into a full-view state",
  );

  const taskId = await revisedUnifiedCard.getAttribute("data-agent-task-id");
  assert.ok(taskId, "Expected revised saved draft card to expose a task id");

  const revisedMessages = await fetchConversationMessages(page, baseUrl, conversationId);
  const revisedAssistantCount = revisedMessages.filter(
    (message) => message.sender === "assistant",
  ).length;

  const denyResponse = await page.request.post(
    `${baseUrl}/api/agent/tasks/${taskId}/approve`,
    {
      data: {
        approve: false,
        reason: "Denied saved draft revision from Playwright",
      },
    },
  );
  assert.equal(
    denyResponse.ok(),
    true,
    "Expected saved draft revision denial request to succeed",
  );

  const denialReply = await waitForLatestAssistantReply({
    page,
    baseUrl,
    conversationId,
    previousAssistantCount: revisedAssistantCount,
    timeoutMs: 45_000,
  });
  assert.match(
    denialReply,
    /(canceled that task|canceled|cancelled)/i,
    "Denying the revised saved draft should cancel cleanly",
  );

  await page.screenshot({
    path: resolve(outputDir, "google-personal-context-saved-draft-revision-follow-up.png"),
    fullPage: true,
  });
}

async function verifyExistingDraftSelectionFlow(
  page: Page,
  baseUrl: string,
  email: string,
  outputDir: string,
): Promise<void> {
  const conversationId = await resolveActiveConversationId(page, baseUrl);
  await seedCustomSavedDraftTaskFixture({
    email,
    conversationId,
    recipient: "zorovt18@gmail.com",
    subject: "Catch up on the 15th?",
    bodyText: "Hey, can we catch up on the 15th?",
  });
  await seedCustomSavedDraftTaskFixture({
    email,
    conversationId,
    recipient: "zorovt18@gmail.com",
    subject: "Quick hello",
    bodyText: "Just wanted to say hello.",
  });
  await page.reload({ waitUntil: "networkidle" });

  const beforeMessages = await fetchConversationMessages(page, baseUrl, conversationId);
  const previousAssistantCount = beforeMessages.filter(
    (message) => message.sender === "assistant",
  ).length;

  await page
    .getByTestId("input-message")
    .fill("yeah lets do the catch up on the 15th one we were working on");
  await page.getByTestId("input-message").press("Enter");

  const selectionReply = await waitForLatestAssistantReply({
    page,
    baseUrl,
    conversationId,
    previousAssistantCount,
    timeoutMs: 45_000,
  });
  assert.match(
    selectionReply,
    /pulled up that draft|review, edit, or send it|review it and approve/i,
    "Selecting an existing draft by subject should surface a real Gmail card",
  );

  const selectedCard = page.locator('[data-google-email-card="true"]').last();
  await selectedCard.waitFor({ state: "visible", timeout: 20_000 });
  const selectedCardText = await selectedCard.innerText();
  assert.match(
    selectedCardText,
    /zorovt18@gmail\.com/i,
    "Expected the selected draft card to target the matching recipient",
  );
  assert.match(
    selectedCardText,
    /catch up on the 15th/i,
    "Expected the selected draft card to match the requested saved draft",
  );

  await page.screenshot({
    path: resolve(outputDir, "google-personal-context-existing-draft-selection.png"),
    fullPage: true,
  });
}

async function verifyFreshComposeOverridesHistoryFlow(
  page: Page,
  baseUrl: string,
  email: string,
  outputDir: string,
): Promise<void> {
  const conversationId = await resolveActiveConversationId(page, baseUrl);
  await seedPendingDraftApprovalFixture(email, conversationId);
  await seedCustomSavedDraftTaskFixture({
    email,
    conversationId,
    recipient: "zorovt18@gmail.com",
    subject: "Catch up on the 15th?",
    bodyText: "Hey, can we catch up on the 15th?",
  });
  await page.reload({ waitUntil: "networkidle" });

  let messages = await fetchConversationMessages(page, baseUrl, conversationId);
  let previousAssistantCount = messages.filter(
    (message) => message.sender === "assistant",
  ).length;

  await page.getByTestId("input-message").fill("send it");
  await page.getByTestId("input-message").press("Enter");

  const staleAmbiguityReply = await waitForLatestAssistantReply({
    page,
    baseUrl,
    conversationId,
    previousAssistantCount,
    timeoutMs: 45_000,
  });
  assert.match(
    staleAmbiguityReply,
    /which email did you mean|which email could i send/i,
    "Multiple older draft candidates should trigger ambiguity before we start a fresh compose flow",
  );

  const staleAmbiguityCard = page.locator('[data-testid="google-email-ambiguity-card"]').last();
  await staleAmbiguityCard.waitFor({ state: "visible", timeout: 20_000 });

  messages = await fetchConversationMessages(page, baseUrl, conversationId);
  previousAssistantCount = messages.filter((message) => message.sender === "assistant").length;

  await page
    .getByTestId("input-message")
    .fill("lets draft an email to cheick@soulnests.com");
  await page.getByTestId("input-message").press("Enter");

  const bareLetsComposeReply = await waitForLatestAssistantReply({
    page,
    baseUrl,
    conversationId,
    previousAssistantCount,
    timeoutMs: 45_000,
  });
  assert.match(
    bareLetsComposeReply,
    /what should the email say|i can draft that to cheick@soulnests\.com/i,
    "Bare `lets draft an email to ...` should enter the structured compose flow",
  );
  assert.doesNotMatch(
    bareLetsComposeReply,
    /keep that same wording|which email did you mean|catch up on the 15th/i,
    "A new compose request should not get hijacked by older drafts or stale ambiguity",
  );

  let composeSessionCard = page.locator('[data-testid="google-compose-session-card"]').last();
  await composeSessionCard.waitFor({ state: "visible", timeout: 20_000 });
  assert.equal(
    await composeSessionCard.getAttribute("data-compose-status"),
    "awaiting_body",
    "Expected bare `lets draft...` phrasing to preserve the recipient and ask for the body",
  );
  assert.match(
    await composeSessionCard.innerText(),
    /cheick@soulnests\.com/i,
    "Expected the compose session to preserve the provided recipient",
  );

  messages = await fetchConversationMessages(page, baseUrl, conversationId);
  previousAssistantCount = messages.filter((message) => message.sender === "assistant").length;

  await page.getByTestId("input-message").fill("create a new email");
  await page.getByTestId("input-message").press("Enter");

  const freshComposeReply = await waitForLatestAssistantReply({
    page,
    baseUrl,
    conversationId,
    previousAssistantCount,
    timeoutMs: 45_000,
  });
  assert.match(
    freshComposeReply,
    /who should i send it to|share the recipient email address/i,
    "A fresh compose request should open a new compose session instead of reviving an older draft",
  );
  assert.doesNotMatch(
    freshComposeReply,
    /keep that same wording|approval button|catch up on the 15th/i,
    "Fresh compose should not free-chat about an older draft",
  );

  composeSessionCard = page.locator('[data-testid="google-compose-session-card"]').last();
  await composeSessionCard.waitFor({ state: "visible", timeout: 20_000 });
  assert.equal(
    await composeSessionCard.getAttribute("data-compose-status"),
    "awaiting_recipient",
    "Expected `create a new email` to open a fresh compose session",
  );

  messages = await fetchConversationMessages(page, baseUrl, conversationId);
  previousAssistantCount = messages.filter((message) => message.sender === "assistant").length;

  await page
    .getByTestId("input-message")
    .fill("okay lets create an email for zorovt18@gmail.com");
  await page.getByTestId("input-message").press("Enter");

  const recipientComposeReply = await waitForLatestAssistantReply({
    page,
    baseUrl,
    conversationId,
    previousAssistantCount,
    timeoutMs: 45_000,
  });
  assert.match(
    recipientComposeReply,
    /what should the email say|i can draft that to zorovt18@gmail\.com/i,
    "Fresh compose with a recipient should move into the structured awaiting_body state",
  );
  assert.doesNotMatch(
    recipientComposeReply,
    /keep that same wording|approval button|catch up on the 15th/i,
    "Fresh compose with a recipient should not revive the prior draft copy",
  );

  composeSessionCard = page.locator('[data-testid="google-compose-session-card"]').last();
  await composeSessionCard.waitFor({ state: "visible", timeout: 20_000 });
  assert.equal(
    await composeSessionCard.getAttribute("data-compose-status"),
    "awaiting_body",
    "Expected recipient-aware fresh compose to ask for the body next",
  );
  assert.match(
    await composeSessionCard.innerText(),
    /zorovt18@gmail\.com/i,
    "Expected the fresh compose session to preserve the provided recipient",
  );

  messages = await fetchConversationMessages(page, baseUrl, conversationId);
  previousAssistantCount = messages.filter((message) => message.sender === "assistant").length;

  await page
    .getByTestId("input-message")
    .fill("ask if he is free any time in april");
  await page.getByTestId("input-message").press("Enter");

  const bodyFollowUpReply = await waitForLatestAssistantReply({
    page,
    baseUrl,
    conversationId,
    previousAssistantCount,
    timeoutMs: 45_000,
  });
  assert.doesNotMatch(
    bodyFollowUpReply,
    /which email did you mean|which email should i update/i,
    "An active compose session should consume the body follow-up instead of reopening older draft ambiguity",
  );
  assert.match(
    bodyFollowUpReply,
    /create an email draft to zorovt18@gmail\.com|approve if you want me to apply it|preview ready/i,
    "Body follow-up during an active compose session should produce a real Gmail preview",
  );

  const followUpDraftCard = page.locator('[data-testid="agent-unified-task-card"]').last();
  await followUpDraftCard.waitFor({ state: "visible", timeout: 20_000 });
  assert.match(
    await followUpDraftCard.innerText(),
    /zorovt18@gmail\.com/i,
    "Expected the body follow-up preview to stay bound to the active compose recipient",
  );

  messages = await fetchConversationMessages(page, baseUrl, conversationId);
  previousAssistantCount = messages.filter((message) => message.sender === "assistant").length;

  await page.getByTestId("input-message").fill("never mind");
  await page.getByTestId("input-message").press("Enter");

  const cancelReply = await waitForLatestAssistantReply({
    page,
    baseUrl,
    conversationId,
    previousAssistantCount,
    timeoutMs: 45_000,
  });
  assert.match(
    cancelReply,
    /dropped that draft idea|okay, i dropped that draft idea|canceled that google action|understood\. i canceled/i,
    "Expected the fresh compose cleanup to cancel cleanly",
  );

  await page.screenshot({
    path: resolve(outputDir, "google-personal-context-fresh-compose-overrides-history.png"),
    fullPage: true,
  });
}

async function verifyAiComposeRecipientCorrectionFlow(
  page: Page,
  baseUrl: string,
  outputDir: string,
): Promise<void> {
  const conversationId = await resolveActiveConversationId(page, baseUrl);
  await page.reload({ waitUntil: "networkidle" });

  let messages = await fetchConversationMessages(page, baseUrl, conversationId);
  let previousAssistantCount = messages.filter(
    (message) => message.sender === "assistant",
  ).length;

  await page
    .getByTestId("input-message")
    .fill("draft an email to zorovt18@gmail.com");
  await page.getByTestId("input-message").press("Enter");

  const composeReply = await waitForLatestAssistantReply({
    page,
    baseUrl,
    conversationId,
    previousAssistantCount,
    timeoutMs: 45_000,
  });
  assert.match(
    composeReply,
    /what should the email say|i can draft that to zorovt18@gmail\.com/i,
    "Expected the draft request to open an awaiting-body compose session",
  );

  let composeSessionCard = page.locator('[data-testid="google-compose-session-card"]').last();
  await composeSessionCard.waitFor({ state: "visible", timeout: 20_000 });
  assert.match(
    await composeSessionCard.innerText(),
    /zorovt18@gmail\.com/i,
    "Expected the compose session to start with the original recipient",
  );

  messages = await fetchConversationMessages(page, baseUrl, conversationId);
  previousAssistantCount = messages.filter((message) => message.sender === "assistant").length;

  await page
    .getByTestId("input-message")
    .fill("actually make that to cheick@soulnests.com instead");
  await page.getByTestId("input-message").press("Enter");

  const recipientCorrectionReply = await waitForLatestAssistantReply({
    page,
    baseUrl,
    conversationId,
    previousAssistantCount,
    timeoutMs: 45_000,
  });
  assert.match(
    recipientCorrectionReply,
    /what should the email say|i can draft that to cheick@soulnests\.com/i,
    "Expected the active compose session to update the recipient instead of treating it as body text",
  );
  assert.doesNotMatch(
    recipientCorrectionReply,
    /zorovt18@gmail\.com/i,
    "Expected the recipient correction to replace the original recipient in the active draft",
  );

  composeSessionCard = page.locator('[data-testid="google-compose-session-card"]').last();
  await composeSessionCard.waitFor({ state: "visible", timeout: 20_000 });
  assert.equal(
    await composeSessionCard.getAttribute("data-compose-status"),
    "awaiting_body",
    "Expected recipient correction to keep the draft in awaiting-body state",
  );
  const composeSessionText = await composeSessionCard.innerText();
  assert.match(
    composeSessionText,
    /cheick@soulnests\.com/i,
    "Expected the corrected recipient to be reflected in the active compose session card",
  );
  assert.doesNotMatch(
    composeSessionText,
    /zorovt18@gmail\.com/i,
    "Expected the original recipient to be replaced in the compose session card",
  );

  messages = await fetchConversationMessages(page, baseUrl, conversationId);
  previousAssistantCount = messages.filter((message) => message.sender === "assistant").length;

  await page.getByTestId("input-message").fill("never mind");
  await page.getByTestId("input-message").press("Enter");

  await waitForLatestAssistantReply({
    page,
    baseUrl,
    conversationId,
    previousAssistantCount,
    timeoutMs: 45_000,
  });

  await page.screenshot({
    path: resolve(outputDir, "google-personal-context-ai-compose-recipient-correction.png"),
    fullPage: true,
  });
}

async function verifyAmbiguousDraftFollowUpFlow(
  page: Page,
  baseUrl: string,
  email: string,
  outputDir: string,
): Promise<void> {
  const conversationId = await resolveActiveConversationId(page, baseUrl);
  await seedPendingDraftApprovalFixture(email, conversationId);
  await seedSavedDraftTaskFixture(email, conversationId);
  await page.reload({ waitUntil: "networkidle" });

  const beforeMessages = await fetchConversationMessages(page, baseUrl, conversationId);
  const previousAssistantCount = beforeMessages.filter(
    (message) => message.sender === "assistant",
  ).length;

  await page
    .getByTestId("input-message")
    .fill("ask if he is free to hang out on march 12th");
  await page.getByTestId("input-message").press("Enter");

  const ambiguityReply = await waitForLatestAssistantReply({
    page,
    baseUrl,
    conversationId,
    previousAssistantCount,
    timeoutMs: 45_000,
  });
  assert.match(
    ambiguityReply,
    /which email|which one/i,
    "Multiple draft candidates should trigger an ambiguity question instead of guessing",
  );

  const ambiguityCard = page.locator('[data-testid="google-email-ambiguity-card"]').last();
  await ambiguityCard.waitFor({ state: "visible", timeout: 20_000 });
  assert.equal(
    await ambiguityCard.getAttribute("data-ambiguity-action"),
    "revise",
    "Expected the draft-follow-up ambiguity card to stay in revise mode",
  );
  const ambiguityText = await ambiguityCard.innerText();
  assert.match(
    ambiguityText,
    /team@soulnests\.com/i,
    "Expected the ambiguity card to list the latest saved draft",
  );
  assert.match(
    ambiguityText,
    /stale@example\.com/i,
    "Expected the ambiguity card to list the older pending draft",
  );

  const ambiguityChoice = ambiguityCard
    .locator('[data-testid^="button-google-email-ambiguity-"]')
    .filter({ hasText: "team@soulnests.com" })
    .first();
  await ambiguityChoice.waitFor({ state: "visible", timeout: 20_000 });
  await ambiguityChoice.evaluate((element) => {
    (element as HTMLButtonElement).click();
  });
  await page.waitForTimeout(600);

  const revisedUnifiedCard = page.locator('[data-testid="agent-unified-task-card"]').last();
  await revisedUnifiedCard.waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForFunction(() => {
    const cards = Array.from(
      document.querySelectorAll('[data-testid="agent-unified-task-card"]'),
    );
    const latestCard = cards[cards.length - 1];
    const text = latestCard?.textContent ?? "";
    return /team@soulnests\.com/i.test(text) && /march 12|hang out/i.test(text);
  });
  const revisedCardText = await revisedUnifiedCard.innerText();
  assert.match(
    revisedCardText,
    /team@soulnests\.com/i,
    "Expected the ambiguity choice to target the selected saved draft",
  );
  assert.match(
    revisedCardText,
    /march 12|hang out/i,
    "Expected the selected draft to reflect the requested follow-up edit",
  );

  const assistantMessages = await fetchConversationMessages(page, baseUrl, conversationId);
  const latestRelevantAssistantText =
    [...assistantMessages]
      .reverse()
      .find(
        (message) =>
          message.sender === "assistant" &&
          typeof message.text === "string" &&
          message.text.trim().length > 0 &&
          /updated the (saved )?draft preview|review it and approve/i.test(
            message.text,
          ),
      )?.text ?? "";
  assert.match(
    latestRelevantAssistantText,
    /updated the (saved )?draft preview|review it and approve/i,
    "Choosing a draft from the ambiguity card should continue the Gmail revision flow",
  );

  await page.screenshot({
    path: resolve(outputDir, "google-personal-context-email-ambiguity-card.png"),
    fullPage: true,
  });
}

async function verifyRecentCalendarFollowUpFlow(
  page: Page,
  baseUrl: string,
  email: string,
  outputDir: string,
): Promise<void> {
  const conversationId = await resolveActiveConversationId(page, baseUrl);
  await seedRecentCalendarTaskFixture(email, conversationId);
  await page.reload({ waitUntil: "networkidle" });

  const seededCalendarCard = page.locator('[data-google-calendar-card="true"]').last();
  await seededCalendarCard.waitFor({ state: "visible", timeout: 20_000 });
  assert.match(
    await seededCalendarCard.innerText(),
    /lunch with alex/i,
    "Expected the seeded calendar card to reflect the recent event title",
  );
  assert.match(
    await seededCalendarCard.innerText(),
    /event created/i,
    "Expected the seeded calendar task to appear as a created event",
  );

  const beforeMessages = await fetchConversationMessages(page, baseUrl, conversationId);
  const previousAssistantCount = beforeMessages.filter(
    (message) => message.sender === "assistant",
  ).length;

  await page.getByTestId("input-message").fill("add location blue bottle");
  await page.getByTestId("input-message").press("Enter");

  const followUpReply = await waitForLatestAssistantReply({
    page,
    baseUrl,
    conversationId,
    previousAssistantCount,
    timeoutMs: 45_000,
  });

  if (/which one should i update|which event did you mean/i.test(followUpReply)) {
    const ambiguityCard = page.locator('[data-testid="google-email-ambiguity-card"]').last();
    await ambiguityCard.waitFor({ state: "visible", timeout: 20_000 });
    assert.equal(
      await ambiguityCard.getAttribute("data-ambiguity-action"),
      "update",
      "Expected the calendar follow-up ambiguity card to stay in update mode",
    );
    const ambiguityChoice = ambiguityCard
      .locator('[data-testid^="button-google-email-ambiguity-"]')
      .filter({ hasText: /lunch with alex/i })
      .first();
    await ambiguityChoice.waitFor({ state: "visible", timeout: 20_000 });
    await ambiguityChoice.evaluate((element) => {
      (element as HTMLButtonElement).click();
    });
    await page.waitForTimeout(600);
  } else {
    assert.doesNotMatch(
      followUpReply,
      /tell me which calendar event/i,
      "Recent calendar follow-up should not ask the user to restate the event target",
    );
  }

  const updateCalendarCard = page.locator('[data-google-calendar-card="true"]').last();
  await updateCalendarCard.waitFor({ state: "visible", timeout: 20_000 });
  assert.match(
    await updateCalendarCard.innerText(),
    /blue bottle/i,
    "Expected the calendar follow-up preview to carry the requested location update",
  );
  const applyChangeButton = page
    .getByTestId("button-google-calendar-primary-action")
    .last();
  await applyChangeButton.waitFor({ state: "visible", timeout: 20_000 });
  assert.match(
    (await applyChangeButton.innerText()).trim(),
    /apply change/i,
    "Expected the calendar follow-up to surface an approval-gated update action",
  );

  await page.screenshot({
    path: resolve(outputDir, "google-personal-context-calendar-follow-up.png"),
    fullPage: true,
  });
}

async function verifyManualDraftEditorFlow(
  page: Page,
  baseUrl: string,
  email: string,
  outputDir: string,
): Promise<void> {
  const conversationId = await resolveActiveConversationId(page, baseUrl);
  await seedPendingDraftApprovalFixture(email, conversationId);
  await seedSavedDraftTaskFixture(email, conversationId);
  await page.reload({ waitUntil: "networkidle" });

  const seededCard = page.locator('[data-testid="agent-unified-task-card"]').last();
  await seededCard.waitFor({ state: "visible", timeout: 20_000 });
  assert.match(
    await seededCard.innerText(),
    /team@soulnests\.com/i,
    "Expected a saved Gmail draft before opening the manual editor",
  );

  const beforeMessages = await fetchConversationMessages(page, baseUrl, conversationId);
  const previousAssistantCount = beforeMessages.filter(
    (message) => message.sender === "assistant",
  ).length;

  const openDraftButton = page.getByTestId("button-google-email-open-draft").last();
  await openDraftButton.waitFor({ state: "visible", timeout: 20_000 });
  await openDraftButton.evaluate((button) => {
    (button as HTMLButtonElement).click();
  });

  const draftDialog = page.getByTestId("google-email-draft-dialog");
  await draftDialog.waitFor({ state: "visible", timeout: 20_000 });
  assert.match(
    await draftDialog.innerText(),
    /team@soulnests\.com/i,
    "Expected the draft dialog to show the saved recipient",
  );

  const editButton = page.getByTestId("button-google-email-edit-draft");
  await editButton.waitFor({ state: "visible", timeout: 20_000 });
  await editButton.evaluate((button) => {
    (button as HTMLButtonElement).click();
  });

  const toInput = page.getByTestId("input-google-email-draft-to");
  await toInput.waitFor({ state: "visible", timeout: 20_000 });
  await toInput.fill("contact@cheickdiakite.com");

  const subjectInput = page.getByTestId("input-google-email-draft-subject");
  await subjectInput.waitFor({ state: "visible", timeout: 20_000 });
  await subjectInput.fill("March 12 hangout?");

  const bodyInput = page.getByTestId("textarea-google-email-draft-body");
  await bodyInput.fill(
    "Hi team,\n\nAre you free to hang out on March 12th? I would love to catch up.\n\nBest,\nZorro",
  );

  const saveButton = page.getByTestId("button-google-email-save-draft-edit");
  await saveButton.waitFor({ state: "visible", timeout: 20_000 });
  await saveButton.evaluate((button) => {
    (button as HTMLButtonElement).click();
  });

  const saveReply = await waitForLatestAssistantReply({
    page,
    baseUrl,
    conversationId,
    previousAssistantCount,
    timeoutMs: 45_000,
  });
  assert.match(
    saveReply,
    /saved your draft edits|saved your edits into a fresh draft preview|review it and approve/i,
    "Saving manual Gmail edits should surface an updated approval preview",
  );

  const revisedCard = page.locator('[data-testid="agent-unified-task-card"]').last();
  await revisedCard.waitFor({ state: "visible", timeout: 20_000 });
  const revisedCardText = await revisedCard.innerText();
  assert.match(
    revisedCardText,
    /contact@cheickdiakite\.com/i,
    "Expected the manually edited recipient to appear in the updated Gmail card",
  );
  assert.match(
    revisedCardText,
    /march 12 hangout\?/i,
    "Expected the manually edited subject to appear in the updated Gmail card",
  );
  assert.match(
    revisedCardText,
    /would love to catch up|march 12th/i,
    "Expected the manually edited body to appear in the updated Gmail card",
  );

  const beforeSendMessages = await fetchConversationMessages(page, baseUrl, conversationId);
  const beforeSendAssistantCount = beforeSendMessages.filter(
    (message) => message.sender === "assistant",
  ).length;

  await page.getByTestId("input-message").fill("okay lets send");
  await page.getByTestId("input-message").press("Enter");

  const sendReply = await waitForLatestAssistantReply({
    page,
    baseUrl,
    conversationId,
    previousAssistantCount: beforeSendAssistantCount,
    timeoutMs: 45_000,
  });
  assert.doesNotMatch(
    sendReply,
    /which email did you mean/i,
    "Sending immediately after manual draft save should stay bound to the edited draft",
  );
  assert.match(
    sendReply,
    /send email|review it and approve|approve if you want me to apply it/i,
    "Manual draft save should keep the edited draft active for the next send follow-up",
  );

  await page.screenshot({
    path: resolve(outputDir, "google-personal-context-manual-draft-editor.png"),
    fullPage: true,
  });
}

async function verifyManualCalendarEditorFlow(
  page: Page,
  baseUrl: string,
  email: string,
  outputDir: string,
): Promise<void> {
  const conversationId = await resolveActiveConversationId(page, baseUrl);
  await seedRecentCalendarTaskFixture(email, conversationId);
  await page.reload({ waitUntil: "networkidle" });

  const seededCard = page.locator('[data-google-calendar-card="true"]').last();
  await seededCard.waitFor({ state: "visible", timeout: 20_000 });
  assert.match(
    await seededCard.innerText(),
    /lunch with alex/i,
    "Expected a recent calendar card before opening the manual editor",
  );

  const beforeMessages = await fetchConversationMessages(page, baseUrl, conversationId);
  const previousAssistantCount = beforeMessages.filter(
    (message) => message.sender === "assistant",
  ).length;

  const openEventButton = page.getByTestId("button-google-calendar-open-event").last();
  await openEventButton.waitFor({ state: "visible", timeout: 20_000 });
  await openEventButton.evaluate((button) => {
    (button as HTMLButtonElement).click();
  });

  const eventDialog = page.getByTestId("google-calendar-event-dialog");
  await eventDialog.waitFor({ state: "visible", timeout: 20_000 });
  assert.match(
    await eventDialog.innerText(),
    /lunch with alex/i,
    "Expected the calendar dialog to show the existing event title",
  );

  const editButton = page.getByTestId("button-google-calendar-edit-event");
  await editButton.waitFor({ state: "visible", timeout: 20_000 });
  await editButton.evaluate((button) => {
    (button as HTMLButtonElement).click();
  });

  const titleInput = page.getByTestId("input-google-calendar-title");
  await titleInput.waitFor({ state: "visible", timeout: 20_000 });
  await titleInput.fill("Lunch with Alex at Blue Bottle");

  const locationInput = page.getByTestId("input-google-calendar-location");
  await locationInput.fill("Blue Bottle");

  const descriptionInput = page.getByTestId("textarea-google-calendar-description");
  await descriptionInput.fill("Talk about launch plans and next week's schedule.");

  const saveButton = page.getByTestId("button-google-calendar-save-event-edit");
  await saveButton.waitFor({ state: "visible", timeout: 20_000 });
  await saveButton.evaluate((button) => {
    (button as HTMLButtonElement).click();
  });

  const saveReply = await waitForLatestAssistantReply({
    page,
    baseUrl,
    conversationId,
    previousAssistantCount,
    timeoutMs: 45_000,
  });
  assert.match(
    saveReply,
    /saved your event edits|saved your edits into a fresh calendar preview|review it and approve/i,
    "Saving manual calendar edits should surface an updated approval preview",
  );

  const revisedCard = page.locator('[data-google-calendar-card="true"]').last();
  await revisedCard.waitFor({ state: "visible", timeout: 20_000 });
  const revisedCardText = await revisedCard.innerText();
  assert.match(
    revisedCardText,
    /lunch with alex at blue bottle/i,
    "Expected the manually edited event title to appear in the updated calendar card",
  );
  assert.match(
    revisedCardText,
    /blue bottle/i,
    "Expected the manually edited event location to appear in the updated calendar card",
  );
  assert.match(
    revisedCardText,
    /launch plans|needs approval|event preview/i,
    "Expected the manually edited event notes to flow into the updated calendar preview",
  );

  await page.screenshot({
    path: resolve(outputDir, "google-personal-context-manual-calendar-editor.png"),
    fullPage: true,
  });
}

async function seedSavedDraftTaskFixture(
  email: string,
  conversationId: string,
): Promise<void> {
  await seedCustomSavedDraftTaskFixture({
    email,
    conversationId,
    recipient: "team@soulnests.com",
    subject: "Quick note",
    bodyText: "hi team just wanted to say hello",
  });
}

async function seedCustomSavedDraftTaskFixture(params: {
  email: string;
  conversationId: string;
  recipient: string;
  subject: string;
  bodyText: string;
}): Promise<void> {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, params.email))
    .limit(1);
  assert.ok(user?.id, `Expected to find user for ${params.email}`);

  const prompt = `draft an email to ${params.recipient} saying ${params.bodyText}`;
  const preview = {
    kind: "email_compose" as const,
    title: "Create email draft",
    summary: `Create an email draft to ${params.recipient}.`,
    connector: "gmail" as const,
    requiresWriteAccess: true,
    proposedEmail: {
      to: [params.recipient],
      cc: [],
      subject: params.subject,
      bodyPreview: params.bodyText,
      sendAfterApproval: false,
    },
  };
  const plan = {
    version: "google_action_v1" as const,
    preview,
    execution: {
      kind: "email_compose" as const,
      sendAfterApproval: false,
      to: [params.recipient],
      cc: [],
      subject: params.subject,
      bodyText: params.bodyText,
    },
  };
  const completedAt = new Date();

  const task = await storage.createAgentTask({
    userId: user.id,
    conversationId: params.conversationId,
    status: "completed",
    riskLevel: "high",
    taskKind: "google_action",
    prompt,
    requestedByMessageId: randomUUID(),
    plan,
    completedAt,
  });

  await storage.createMessage({
    conversationId: params.conversationId,
    sender: "assistant",
    text: `Created a Gmail draft to ${params.recipient}.`,
    partIndex: 0,
    uiPayload: {
      kind: "agent_task_status",
      task: {
        id: task.id,
        conversationId: task.conversationId,
        status: task.status,
        riskLevel: task.riskLevel,
        taskKind: task.taskKind,
        prompt: task.prompt,
        errorMessage: task.errorMessage ?? null,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        completedAt: task.completedAt,
      },
      text: "Completed",
      googleActionPreview: preview,
      googleActionResult: {
        kind: "email_compose",
        connector: "gmail",
        status: "draft_created",
        summary: `Created a Gmail draft to ${params.recipient}.`,
        draftId: `fixture-draft-${task.id}`,
        messageId: `fixture-message-${task.id}`,
        threadId: null,
      },
      googleContext: {
        connector: "gmail",
        action: "revise",
        actionableTargetId: task.id,
        candidateTargetIds: [task.id],
        sourceTurnId: null,
        selectionReason: "latest_actionable",
        surfaceKey: null,
        selectionMode: null,
      },
    },
  });
}

async function seedPendingDraftApprovalFixture(
  email: string,
  conversationId: string,
): Promise<void> {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  assert.ok(user?.id, `Expected to find user for ${email}`);

  const prompt = "draft an email to stale@example.com saying quick hello";
  const preview = {
    kind: "email_compose" as const,
    title: "Create email draft",
    summary: "Create an email draft to stale@example.com.",
    connector: "gmail" as const,
    requiresWriteAccess: true,
    proposedEmail: {
      to: ["stale@example.com"],
      cc: [],
      subject: "Quick hello",
      bodyPreview: "quick hello",
      sendAfterApproval: false,
    },
  };
  const plan = {
    version: "google_action_v1" as const,
    preview,
    execution: {
      kind: "email_compose" as const,
      sendAfterApproval: false,
      to: ["stale@example.com"],
      cc: [],
      subject: "Quick hello",
      bodyText: "quick hello",
    },
  };

  const task = await storage.createAgentTask({
    userId: user.id,
    conversationId,
    status: "approval_required",
    riskLevel: "high",
    taskKind: "google_action",
    prompt,
    requestedByMessageId: randomUUID(),
    plan,
  });
  const approval = await storage.createAgentApproval({
    taskId: task.id,
    status: "pending",
    requestedAction: preview.summary,
    reason: null,
  });

  await storage.createMessage({
    conversationId,
    sender: "assistant",
    text: preview.summary,
    partIndex: 0,
    uiPayload: {
      kind: "agent_task_status",
      task: {
        id: task.id,
        conversationId: task.conversationId,
        status: task.status,
        riskLevel: task.riskLevel,
        taskKind: task.taskKind,
        prompt: task.prompt,
        errorMessage: task.errorMessage ?? null,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        completedAt: task.completedAt,
      },
      text: "Preview ready",
      googleActionPreview: preview,
      googleContext: {
        connector: "gmail",
        action: "revise",
        actionableTargetId: task.id,
        candidateTargetIds: [task.id],
        sourceTurnId: null,
        selectionReason: "latest_actionable",
        surfaceKey: null,
        selectionMode: null,
      },
    },
  });

  await storage.createMessage({
    conversationId,
    sender: "assistant",
    text: "I prepared this Google action. Approve if you want me to apply it.",
    partIndex: 0,
    uiPayload: {
      kind: "agent_approval",
      taskId: task.id,
      approval: {
        id: approval.id,
        taskId: approval.taskId,
        status: approval.status,
        reason: approval.reason,
        requestedAction: approval.requestedAction,
        createdAt: approval.createdAt,
        respondedAt: approval.respondedAt,
      },
      text: "Approval needed",
      googleActionPreview: preview,
      googleContext: {
        connector: "gmail",
        action: "revise",
        actionableTargetId: task.id,
        candidateTargetIds: [task.id],
        sourceTurnId: null,
        selectionReason: "latest_actionable",
        surfaceKey: null,
        selectionMode: null,
      },
    },
  });
}

async function seedRecentCalendarTaskFixture(
  email: string,
  conversationId: string,
): Promise<void> {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  assert.ok(user?.id, `Expected to find user for ${email}`);

  const startTime = new Date(Date.now() + 24 * 60 * 60 * 1000);
  startTime.setHours(13, 0, 0, 0);
  const endTime = new Date(startTime.getTime() + 60 * 60 * 1000);
  const prompt = "create calendar event lunch with alex tomorrow at 1pm";
  const preview = {
    kind: "calendar_create" as const,
    title: "Create calendar event",
    summary: 'Create "Lunch with Alex" on your calendar.',
    connector: "calendar" as const,
    requiresWriteAccess: true,
    proposedCalendar: {
      title: "Lunch with Alex",
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      location: null,
      descriptionPreview: null,
    },
  };
  const plan = {
    version: "google_action_v1" as const,
    preview,
    execution: {
      kind: "calendar_create" as const,
      timezone: "America/New_York",
      title: "Lunch with Alex",
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      location: null,
      description: null,
    },
  };
  const completedAt = new Date();

  const task = await storage.createAgentTask({
    userId: user.id,
    conversationId,
    status: "completed",
    riskLevel: "high",
    taskKind: "google_action",
    prompt,
    requestedByMessageId: randomUUID(),
    plan,
    completedAt,
  });

  await storage.createMessage({
    conversationId,
    sender: "assistant",
    text: 'Created "Lunch with Alex" on your calendar.',
    partIndex: 0,
    uiPayload: {
      kind: "agent_task_status",
      task: {
        id: task.id,
        conversationId: task.conversationId,
        status: task.status,
        riskLevel: task.riskLevel,
        taskKind: task.taskKind,
        prompt: task.prompt,
        errorMessage: task.errorMessage ?? null,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        completedAt: task.completedAt,
      },
      text: "Completed",
      googleActionPreview: preview,
      googleActionResult: {
        kind: "calendar_create",
        connector: "calendar",
        status: "event_created",
        summary: 'Created "Lunch with Alex" on your calendar.',
        eventId: `fixture-event-${task.id}`,
      },
    },
  });
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
