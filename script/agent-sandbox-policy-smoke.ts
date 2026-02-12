import assert from "node:assert/strict";
import {
  assertSandboxToolAccess,
  cleanupEphemeralSandboxJob,
  createEphemeralSandboxJob,
  listCodeWorkerRecipes,
  getSandboxToolApprovalMessage,
  getSandboxToolPolicy,
  listSandboxToolPolicies,
  runCodeWorkerRecipe,
} from "../server/agent-sandbox.ts";

async function run(): Promise<void> {
  const policies = listSandboxToolPolicies();
  assert.ok(policies.length >= 6, "Expected expanded sandbox tool policy set");

  const gmailSend = getSandboxToolPolicy("gmail_send");
  assert.ok(gmailSend, "gmail_send policy should exist");
  assert.equal(gmailSend?.riskLevel, "high", "gmail_send should be high risk");
  assert.equal(
    gmailSend?.requiresApproval,
    true,
    "gmail_send should require approval",
  );
  assert.ok(
    getSandboxToolApprovalMessage("gmail_send")?.includes("Approval required"),
    "gmail_send should expose approval message",
  );

  assert.throws(
    () =>
      assertSandboxToolAccess({
        toolName: "gmail_send",
        requestedHosts: ["example.com"],
      }),
    /blocked network egress/,
    "gmail_send should deny unallowlisted hosts",
  );

  assert.doesNotThrow(
    () =>
      assertSandboxToolAccess({
        toolName: "gmail_send",
        requestedHosts: ["gmail.googleapis.com", "www.googleapis.com"],
      }),
    "gmail_send should allow Gmail API hosts",
  );

  assert.doesNotThrow(
    () =>
      assertSandboxToolAccess({
        toolName: "network_device_control",
        requestedHosts: ["192.168.1.10", "livingroom-tv.local"],
      }),
    "network_device_control should allow local network targets",
  );

  assert.throws(
    () =>
      assertSandboxToolAccess({
        toolName: "network_device_control",
        requestedHosts: ["api.thirdparty.com"],
      }),
    /blocked network egress/,
    "network_device_control should block non-local hosts by default",
  );

  assert.throws(
    () =>
      assertSandboxToolAccess({
        toolName: "unknown_tool",
      }),
    /denied by default/,
    "Unknown tools should be denied by default",
  );

  const codeWorker = getSandboxToolPolicy("code_worker");
  assert.ok(codeWorker, "code_worker policy should exist");
  assert.equal(
    codeWorker?.network.mode,
    "allowlist",
    "code_worker should use allowlist network policy",
  );
  assert.ok(
    listCodeWorkerRecipes().includes("playwright_smoke"),
    "code_worker recipes should include playwright_smoke",
  );

  const sandboxJob = await createEphemeralSandboxJob("sandbox-policy-smoke");
  try {
    const buildRecipe = await runCodeWorkerRecipe({
      job: sandboxJob,
      recipe: "build",
      inlineScript: "process.stdout.write('ok')",
    });
    assert.equal(buildRecipe.ok, true, "code_worker build recipe should execute");

    const installWithoutApproval = await runCodeWorkerRecipe({
      job: sandboxJob,
      recipe: "install",
      approved: false,
    });
    assert.equal(
      installWithoutApproval.ok,
      false,
      "code_worker install should require explicit approval",
    );
    assert.match(
      installWithoutApproval.stderr,
      /Approval required/,
      "approval error should be explicit",
    );
  } finally {
    await cleanupEphemeralSandboxJob(sandboxJob);
  }

  console.log("agent-sandbox policy smoke checks passed");
}

void run();
