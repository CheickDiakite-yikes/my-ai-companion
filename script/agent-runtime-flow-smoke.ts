import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { MessageAttachment } from "../shared/schema.ts";

const DEFAULT_DATABASE_URL =
  "postgresql://postgres@127.0.0.1:5432/my_ai_companion_local";

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = DEFAULT_DATABASE_URL;
}
if (!process.env.ENABLE_AGENT_MODEL_GAME_GENERATOR) {
  process.env.ENABLE_AGENT_MODEL_GAME_GENERATOR = "false";
}

function assertSnakeMechanics(html: string): void {
  const checks = [
    /\bsnake\b/i,
    /\bfood\b|\bapple\b|\bpellet\b/i,
    /\bsegments?\b|\bbody\b/i,
    /\bcollision\b|game over|out of bounds|self hit/i,
    /\bdirection\b|arrow(left|right|up|down)\b/i,
  ];
  const matched = checks.filter((pattern) => pattern.test(html)).length;
  assert.ok(
    matched >= 3,
    `Expected snake-specific mechanics markers in output, got ${matched}/5`,
  );
}

async function run(): Promise<void> {
  const [{ storage }, runtime, { db }, { agentToolCalls }] = await Promise.all([
    import("../server/storage.ts"),
    import("../server/agent-runtime.ts"),
    import("../server/db.ts"),
    import("../shared/schema.ts"),
  ]);

  const lowRiskUserId = `agent-smoke-low-${randomUUID()}`;
  const lowRiskConversation = await storage.createConversation({
    userId: lowRiskUserId,
    persona: "Zee",
    title: "Agent Smoke Low Risk",
  });
  const lowRiskUserMessage = await storage.createUserTurnMessage({
    conversationId: lowRiskConversation.id,
    text: "Can you make a mini game from my sketch?",
  });

  const lowRiskAttachment: MessageAttachment = {
    id: `att-${randomUUID()}`,
    conversationId: lowRiskConversation.id,
    messageId: lowRiskUserMessage.id,
    userId: lowRiskUserId,
    status: "bound",
    storageProvider: "local",
    objectKey: "smoke/attachment.png",
    mimeType: "image/png",
    byteSize: 1,
    width: null,
    height: null,
    sha256: "smoke",
    summaryText: "A cute basket drawing with little fruits.",
    createdAt: new Date(),
  };

  const lowRiskEvents: string[] = [];
  const lowRiskRun = await runtime.startAgentTaskRun({
    userId: lowRiskUserId,
    conversationId: lowRiskConversation.id,
    prompt: "Create a cute mini game from this art sketch so we can play together",
    requestedByMessageId: lowRiskUserMessage.id,
    attachments: [lowRiskAttachment],
    onEvent: (event) => {
      lowRiskEvents.push(event.type);
    },
  });

  assert.equal(
    lowRiskRun.awaitingApproval,
    false,
    "Low-risk game flow should not require approval",
  );
  assert.ok(
    lowRiskEvents[0] === "task_created",
    "Low-risk flow should emit task_created first",
  );
  assert.ok(
    lowRiskEvents.includes("task_step"),
    "Low-risk flow should emit task steps",
  );
  assert.ok(
    lowRiskEvents.includes("task_artifact_ready"),
    "Low-risk flow should emit task_artifact_ready",
  );

  const lowRiskTask = await storage.getAgentTaskWithDetails(lowRiskRun.task.id);
  assert.ok(lowRiskTask, "Low-risk task should exist");
  assert.equal(
    lowRiskTask?.status,
    "completed",
    "Low-risk task should complete automatically",
  );
  assert.ok(
    lowRiskTask?.artifacts.some((artifact) => artifact.type === "mini_game"),
    "Low-risk flow should produce a mini-game artifact",
  );
  const firstGameArtifact = lowRiskTask?.artifacts.find(
    (artifact) => artifact.type === "mini_game",
  );
  assert.ok(firstGameArtifact?.htmlContent, "First mini-game artifact should include html");

  const variantUserId = `agent-smoke-variant-${randomUUID()}`;
  const variantConversation = await storage.createConversation({
    userId: variantUserId,
    persona: "Zee",
    title: "Agent Smoke Variant Game",
  });
  const variantMessage = await storage.createUserTurnMessage({
    conversationId: variantConversation.id,
    text: "Make a 3D-style orbit dodging mini game",
  });
  const variantRun = await runtime.startAgentTaskRun({
    userId: variantUserId,
    conversationId: variantConversation.id,
    prompt: "Create a 3D mini game where we dodge stars in a neon tunnel",
    requestedByMessageId: variantMessage.id,
    attachments: [],
  });
  assert.equal(
    variantRun.awaitingApproval,
    false,
    "Variant game flow should not require approval",
  );
  const variantTask = await storage.getAgentTaskWithDetails(variantRun.task.id);
  assert.equal(variantTask?.status, "completed", "Variant game task should complete");
  const variantGameArtifact = variantTask?.artifacts.find(
    (artifact) => artifact.type === "mini_game",
  );
  assert.ok(
    variantGameArtifact?.htmlContent,
    "Variant mini-game artifact should include html",
  );
  assert.notEqual(
    variantGameArtifact?.htmlContent,
    firstGameArtifact?.htmlContent,
    "Different game prompts should produce materially different game output",
  );

  const snakeUserId = `agent-smoke-snake-${randomUUID()}`;
  const snakeConversation = await storage.createConversation({
    userId: snakeUserId,
    persona: "Zee",
    title: "Agent Smoke Snake Game",
  });
  const snakeMessage = await storage.createUserTurnMessage({
    conversationId: snakeConversation.id,
    text: "Create another snake game please",
  });
  const snakeRun = await runtime.startAgentTaskRun({
    userId: snakeUserId,
    conversationId: snakeConversation.id,
    prompt: "Create another snake game please",
    requestedByMessageId: snakeMessage.id,
    attachments: [],
  });
  assert.equal(
    snakeRun.awaitingApproval,
    false,
    "Snake game flow should not require approval",
  );
  const snakeTask = await storage.getAgentTaskWithDetails(snakeRun.task.id);
  assert.equal(snakeTask?.status, "completed", "Snake game task should complete");
  const snakeArtifact = snakeTask?.artifacts.find((artifact) => artifact.type === "mini_game");
  const snakeHtml = snakeArtifact?.htmlContent ?? "";
  assert.ok(snakeHtml, "Snake game artifact should include html");
  assertSnakeMechanics(snakeHtml);

  const lowRiskPlanTrace = (lowRiskTask?.plan as { audit?: { traceId?: string } })
    ?.audit?.traceId;
  assert.ok(
    typeof lowRiskPlanTrace === "string" && lowRiskPlanTrace.length > 0,
    "Low-risk task plan should contain audit traceId",
  );

  const lowRiskToolCalls = await db
    .select()
    .from(agentToolCalls)
    .where(eq(agentToolCalls.taskId, lowRiskRun.task.id));
  assert.ok(lowRiskToolCalls.length > 0, "Low-risk task should record tool calls");
  assert.ok(
    lowRiskToolCalls.some((call) => call.toolName === "code_worker"),
    "Low-risk mini-game flow should record code_worker tool call audit",
  );
  for (const call of lowRiskToolCalls) {
    const traceId = (call.argsRedacted as { traceId?: string } | null)?.traceId;
    assert.equal(
      traceId,
      lowRiskPlanTrace,
      "Tool call traceId should match task audit traceId",
    );
  }

  const lowRiskGameArtifact = lowRiskTask?.artifacts.find(
    (artifact) => artifact.type === "mini_game",
  );
  const lowRiskGenerationMetadata = (lowRiskGameArtifact?.metadata as {
    generation?: {
      backend?: string;
      attempts?: number;
    };
  } | null)?.generation;
  assert.ok(
    typeof lowRiskGenerationMetadata?.backend === "string",
    "Mini-game artifact should persist generation backend telemetry",
  );
  assert.ok(
    typeof lowRiskGenerationMetadata?.attempts === "number",
    "Mini-game artifact should persist generation attempts telemetry",
  );

  const highRiskUserId = `agent-smoke-high-${randomUUID()}`;
  const highRiskConversation = await storage.createConversation({
    userId: highRiskUserId,
    persona: "Zee",
    title: "Agent Smoke High Risk",
  });
  const highRiskUserMessage = await storage.createUserTurnMessage({
    conversationId: highRiskConversation.id,
    text: "Draft this and send by email",
  });

  const highRiskEvents: string[] = [];
  const highRiskRun = await runtime.startAgentTaskRun({
    userId: highRiskUserId,
    conversationId: highRiskConversation.id,
    prompt: "Write a project brief and send it by email to my team",
    requestedByMessageId: highRiskUserMessage.id,
    attachments: [],
    onEvent: (event) => {
      highRiskEvents.push(event.type);
    },
  });

  assert.equal(
    highRiskRun.awaitingApproval,
    true,
    "High-risk flow should require approval before execution",
  );
  assert.equal(
    highRiskRun.task.status,
    "approval_required",
    "High-risk task should remain in approval_required status",
  );
  assert.ok(
    highRiskEvents.includes("task_approval_required"),
    "High-risk flow should emit approval request event",
  );
  assert.ok(
    !highRiskEvents.includes("task_artifact_ready"),
    "High-risk flow should not publish artifacts before approval",
  );

  const resumedEvents: string[] = [];
  const resumed = await runtime.approveAndContinueAgentTask({
    taskId: highRiskRun.task.id,
    userId: highRiskUserId,
    onEvent: (event) => {
      resumedEvents.push(event.type);
    },
  });

  assert.equal(resumed.status, "completed", "Approved task should complete");
  assert.ok(
    resumedEvents.includes("task_artifact_ready"),
    "Approved task should emit artifact ready event",
  );

  const highRiskTask = await storage.getAgentTaskWithDetails(highRiskRun.task.id);
  assert.ok(highRiskTask, "High-risk task should exist after resume");
  assert.ok(
    highRiskTask?.approvals.some((approval) => approval.status === "approved"),
    "High-risk flow should persist approval resolution",
  );
  assert.ok(
    highRiskTask?.artifacts.some((artifact) => artifact.type === "doc_markdown"),
    "High-risk resume flow should publish a doc artifact",
  );

  console.log("agent-runtime flow smoke checks passed");
}

void run().catch((error) => {
  console.error(error);
  process.exit(1);
});
