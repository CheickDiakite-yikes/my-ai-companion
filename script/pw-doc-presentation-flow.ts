import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, request, type APIRequestContext, type Browser, type Page } from "playwright";

interface CliArgs {
  baseUrl: string;
  email: string;
  password: string;
  outputDir: string;
}

type ArtifactListItem = {
  id: string;
  title: string;
  type: string;
  markdownContent: string | null;
  metadata?: { generation?: { format?: string } };
};

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
      "Usage: tsx /tmp/pw_doc_presentation_flow.ts --base-url <url> --email <email> --password <password> --output-dir <dir>",
    );
  }

  return { baseUrl, email, password, outputDir: resolve(outputDir) };
}

async function launchBrowser(): Promise<Browser> {
  const runHeaded = ["1", "true", "yes"].includes(
    (process.env.PLAYWRIGHT_HEADED ?? "").trim().toLowerCase(),
  );
  try {
    return await chromium.launch({
      channel: "chrome",
      headless: !runHeaded,
      slowMo: runHeaded ? 120 : 0,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
  } catch {
    return chromium.launch({
      headless: !runHeaded,
      slowMo: runHeaded ? 120 : 0,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
  }
}

async function dismissOnboardingIfPresent(page: Page): Promise<void> {
  const skip = page.getByTestId("button-skip-onboarding");
  if (await skip.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await skip.click();
    await page.waitForTimeout(250);
  }
}

async function loginOrRegister(page: Page, args: CliArgs): Promise<void> {
  const waitForAuthenticatedApp = async () => {
    const input = page.getByTestId("input-message");
    const skip = page.getByTestId("button-skip-onboarding");
    for (let attempt = 0; attempt < 25; attempt += 1) {
      if (await input.isVisible({ timeout: 500 }).catch(() => false)) {
        return;
      }
      if (await skip.isVisible({ timeout: 500 }).catch(() => false)) {
        await skip.click();
      }
      await page.waitForTimeout(300);
    }
    throw new Error("Authenticated app shell did not become visible");
  };

  await page.goto(args.baseUrl, { waitUntil: "networkidle" });
  await page.getByTestId("button-sign-in").click();
  await page.getByTestId("input-login-email").fill(args.email);
  await page.getByTestId("input-login-password").fill(args.password);
  await page.getByTestId("button-login-submit").click();

  try {
    await waitForAuthenticatedApp();
    return;
  } catch {
    // Continue to register flow.
  }

  const switchToRegisterVisible = await page
    .getByTestId("button-switch-to-register")
    .isVisible({ timeout: 5_000 })
    .catch(() => false);
  if (switchToRegisterVisible) {
    await page.getByTestId("button-switch-to-register").click();
  } else {
    const onRegisterPage = await page
      .getByTestId("input-register-email")
      .isVisible({ timeout: 2_000 })
      .catch(() => false);
    if (!onRegisterPage) {
      throw new Error("Unable to reach register flow after login attempt");
    }
  }

  await page.getByTestId("input-register-firstname").fill("Playwright");
  await page.getByTestId("input-register-lastname").fill("Tester");
  await page.getByTestId("input-register-email").fill(args.email);
  await page.getByTestId("input-register-password").fill(args.password);
  await page.getByTestId("input-register-confirm-password").fill(args.password);
  await page.getByTestId("button-register-submit").click();
  await waitForAuthenticatedApp();
}

async function ensureTextMode(page: Page): Promise<void> {
  const openTextChat = page.getByTestId("button-open-text-chat");
  const getOpenButtonTop = async () => {
    const box = await openTextChat.boundingBox().catch(() => null);
    return box?.y ?? Number.POSITIVE_INFINITY;
  };
  const isTextModeLayout = async () => (await getOpenButtonTop()) < 500;

  if (await isTextModeLayout()) return;

  await openTextChat.click({ force: true }).catch(() => undefined);
  await page.waitForTimeout(250);
  if (await isTextModeLayout()) return;

  const box = await openTextChat.boundingBox().catch(() => null);
  if (box) {
    const startX = box.x + box.width / 2;
    const startY = box.y + Math.min(box.height / 2, 20);
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX, Math.max(40, startY - 220), { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(300);
  }
  if (await isTextModeLayout()) return;

  await page.evaluate(() => {
    const button = document.querySelector(
      '[data-testid="button-open-text-chat"]',
    ) as HTMLElement | null;
    button?.click();
  });
  await page.waitForTimeout(250);
  if (!(await isTextModeLayout())) {
    throw new Error("Unable to switch from voice view to text chat view");
  }
}

async function sendMessage(page: Page, text: string): Promise<void> {
  await ensureTextMode(page);
  const input = page.getByTestId("input-message");
  const send = page.getByTestId("button-send-message");
  await input.waitFor({ state: "visible", timeout: 20_000 });
  await input.fill(text);
  await input.press("Enter").catch(() => undefined);
  await page.waitForTimeout(150);
  if ((await input.inputValue()).trim().length > 0) {
    await send.click({ force: true });
  }
}

async function waitForPendingOffer(
  page: Page,
  timeoutMs = 30_000,
): Promise<void> {
  await ensureTextMode(page);
  await page
    .locator('[data-testid="agent-offer-card"][data-agent-offer-status="pending"]')
    .last()
    .waitFor({ state: "visible", timeout: timeoutMs });
}

async function acceptLatestPendingOffer(page: Page): Promise<void> {
  await page.evaluate(() => {
    const buttons = Array.from(
      document.querySelectorAll('[data-testid="button-agent-offer-accept"]'),
    );
    const latest = buttons[buttons.length - 1];
    if (!(latest instanceof HTMLElement)) {
      throw new Error("Pending offer accept button not found");
    }
    latest.click();
  });
}

async function waitForCompletedTaskCardsAtLeast(
  page: Page,
  expectedCount: number,
): Promise<void> {
  await ensureTextMode(page);
  await page.waitForFunction(
    (count) =>
      Array.from(document.querySelectorAll('[data-testid="agent-unified-task-card"]'))
        .filter((el) => {
          if (el.getAttribute("data-agent-task-status") !== "completed") return false;
          const element = el as HTMLElement;
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            style.opacity !== "0" &&
            rect.width > 0 &&
            rect.height > 0 &&
            rect.top < window.innerHeight &&
            rect.bottom > 0
          );
        }).length >= count,
    expectedCount,
    { timeout: 240_000 },
  );
}

async function getVisibleCompletedTaskCardCount(page: Page): Promise<number> {
  await ensureTextMode(page);
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="agent-unified-task-card"]'))
      .filter((el) => {
        if (el.getAttribute("data-agent-task-status") !== "completed") return false;
        const element = el as HTMLElement;
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          style.opacity !== "0" &&
          rect.width > 0 &&
          rect.height > 0 &&
          rect.top < window.innerHeight &&
          rect.bottom > 0
        );
      }).length,
  );
}

async function createAuthedApiContext(page: Page, baseUrl: string): Promise<APIRequestContext> {
  const storageState = await page.context().storageState();
  return request.newContext({
    baseURL: baseUrl,
    storageState,
    extraHTTPHeaders: {
      "x-trace-id": `pw-doc-pres-${Date.now()}`,
    },
  });
}

async function listArtifacts(api: APIRequestContext): Promise<ArtifactListItem[]> {
  const artifactsRes = await api.get("/api/agent/artifacts?includeArchived=1");
  assert.equal(artifactsRes.status(), 200, "Expected artifacts list to return 200");
  const artifactsJson = (await artifactsRes.json()) as { artifacts: ArtifactListItem[] };
  return artifactsJson.artifacts ?? [];
}

async function waitForNewArtifacts(params: {
  api: APIRequestContext;
  existingIds: Set<string>;
  minimumNewCount: number;
  timeoutMs: number;
}): Promise<ArtifactListItem[]> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < params.timeoutMs) {
    const artifacts = await listArtifacts(params.api);
    const next = artifacts.filter((artifact) => !params.existingIds.has(artifact.id));
    if (next.length >= params.minimumNewCount) {
      return next;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error("Timed out waiting for new artifacts");
}

async function waitForPresentationArtifact(params: {
  api: APIRequestContext;
  existingIds: Set<string>;
  timeoutMs: number;
}): Promise<ArtifactListItem> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < params.timeoutMs) {
    const artifacts = await listArtifacts(params.api);
    const candidate = artifacts.find(
      (artifact) =>
        !params.existingIds.has(artifact.id) &&
        artifact.type === "doc_markdown" &&
        artifact.metadata?.generation?.format === "presentation",
    );
    if (candidate) {
      return candidate;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error("Timed out waiting for presentation artifact");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(args.outputDir, { recursive: true });

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

    await loginOrRegister(page, args);
    await dismissOnboardingIfPresent(page);
    await page.getByTestId("input-message").waitFor({ state: "visible", timeout: 30_000 });

    const bootstrapApi = await createAuthedApiContext(page, args.baseUrl);
    await bootstrapApi.post("/api/conversations", { data: {} });
    await bootstrapApi.dispose();
    await page.reload({ waitUntil: "networkidle" });
    await dismissOnboardingIfPresent(page);
    await page.getByTestId("input-message").waitFor({ state: "visible", timeout: 30_000 });
    await ensureTextMode(page);

    const initialCompletedCount = await getVisibleCompletedTaskCardCount(page);
    const api = await createAuthedApiContext(page, args.baseUrl);
    const initialArtifacts = await listArtifacts(api);

    // 1) Doc opportunity => offer => explicit accept => artifact
    await sendMessage(
      page,
      "i need to write a polished follow-up email to an investor about today's roadmap decisions and next steps",
    );
    await waitForPendingOffer(page, 60_000);
    await page.screenshot({
      path: resolve(args.outputDir, "doc-offer-pending.png"),
      fullPage: true,
    });

    await acceptLatestPendingOffer(page);
    await waitForCompletedTaskCardsAtLeast(page, initialCompletedCount + 1).catch(
      () => undefined,
    );
    const postDocArtifacts = await waitForNewArtifacts({
      api,
      existingIds: new Set(initialArtifacts.map((artifact) => artifact.id)),
      minimumNewCount: 1,
      timeoutMs: 240_000,
    });
    await page.screenshot({
      path: resolve(args.outputDir, "doc-task-completed.png"),
      fullPage: true,
    });

    // 2) Presentation opportunity => offer => explicit accept => PDF export ready
    await sendMessage(
      page,
      "i need a short 5 slide investor presentation about an ai-powered food startup with market, problem, solution, go to market, and financial snapshot",
    );
    let presentationOfferShown = false;
    try {
      await waitForPendingOffer(page, 25_000);
      presentationOfferShown = true;
      await page.screenshot({
        path: resolve(args.outputDir, "presentation-offer-pending.png"),
        fullPage: true,
      });
      await acceptLatestPendingOffer(page);
    } catch {
      await page.screenshot({
        path: resolve(args.outputDir, "presentation-no-offer-fallback.png"),
        fullPage: true,
      });
    }
    await waitForCompletedTaskCardsAtLeast(page, initialCompletedCount + 2).catch(
      () => undefined,
    );
    const presentationArtifact = await waitForPresentationArtifact({
      api,
      existingIds: new Set(
        initialArtifacts.concat(postDocArtifacts).map((artifact) => artifact.id),
      ),
      timeoutMs: 240_000,
    });
    await page.screenshot({
      path: resolve(args.outputDir, "presentation-task-completed.png"),
      fullPage: true,
    });
    console.log(`presentation_offer_shown=${presentationOfferShown}`);

    // API-level assertions for formatting + PDF export
    const artifacts = await listArtifacts(api);
    const docArtifact = artifacts.find(
      (a) => a.type === "doc_markdown" && a.metadata?.generation?.format !== "presentation",
    );

    assert.ok(docArtifact, "Expected a document artifact");
    assert.ok(presentationArtifact, "Expected a presentation artifact");

    const docDetailRes = await api.get(`/api/agent/artifacts/${docArtifact!.id}`);
    assert.equal(docDetailRes.status(), 200, "Expected doc artifact detail to return 200");
    const docDetailJson = (await docDetailRes.json()) as {
      artifact: { markdownContent: string | null };
    };
    const markdown = docDetailJson.artifact.markdownContent ?? "";
    assert.ok(/^#\s+/m.test(markdown), "Doc markdown should include top-level heading");
    assert.ok(/^##\s+/m.test(markdown), "Doc markdown should include section headings");
    assert.ok(
      /(^[-*]\s+.+$)|(^\d+\.\s+.+$)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)/m.test(markdown),
      "Doc markdown should include list/emphasis formatting",
    );

    const pdfRes = await api.get(`/api/agent/artifacts/${presentationArtifact!.id}/export.pdf`);
    assert.equal(pdfRes.status(), 200, "Expected presentation PDF export to return 200");
    const contentType = pdfRes.headers()["content-type"] ?? "";
    assert.ok(contentType.includes("application/pdf"), "Expected PDF content type");
    const pdfBuffer = await pdfRes.body();
    assert.ok(pdfBuffer.byteLength > 1000, "Expected non-trivial PDF payload");

    await api.dispose();

    console.log("playwright doc/presentation flow: PASS");
    console.log(`artifacts_dir=${args.outputDir}`);
  } finally {
    await browser.close();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
