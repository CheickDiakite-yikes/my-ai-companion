import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export type ToolNetworkPolicy =
  | {
      mode: "deny_all";
    }
  | {
      mode: "allowlist";
      hosts: string[];
      allowLocalNetwork?: boolean;
    };

export type SandboxToolRiskLevel = "low" | "high";

export interface SandboxToolPolicy {
  toolName: string;
  category: "build" | "qa" | "connector";
  riskLevel: SandboxToolRiskLevel;
  requiresApproval: boolean;
  approvalReason?: string;
  network: ToolNetworkPolicy;
  timeoutMs: number;
}

const TOOL_POLICIES: Record<string, SandboxToolPolicy> = {
  mini_game_generator: {
    toolName: "mini_game_generator",
    category: "build",
    riskLevel: "low",
    requiresApproval: false,
    network: { mode: "deny_all" },
    timeoutMs: 45_000,
  },
  web_build_generator: {
    toolName: "web_build_generator",
    category: "build",
    riskLevel: "low",
    requiresApproval: false,
    network: { mode: "deny_all" },
    timeoutMs: 45_000,
  },
  doc_generator: {
    toolName: "doc_generator",
    category: "build",
    riskLevel: "low",
    requiresApproval: false,
    network: { mode: "deny_all" },
    timeoutMs: 30_000,
  },
  playwright_smoke: {
    toolName: "playwright_smoke",
    category: "qa",
    riskLevel: "low",
    requiresApproval: false,
    network: { mode: "deny_all" },
    timeoutMs: 40_000,
  },
  code_worker: {
    toolName: "code_worker",
    category: "build",
    riskLevel: "low",
    requiresApproval: false,
    network: {
      mode: "allowlist",
      hosts: ["registry.npmjs.org", "api.npmjs.org"],
    },
    timeoutMs: 90_000,
  },
  gmail_read: {
    toolName: "gmail_read",
    category: "connector",
    riskLevel: "high",
    requiresApproval: true,
    approvalReason: "Reading mailbox data requires explicit consent.",
    network: {
      mode: "allowlist",
      hosts: ["gmail.googleapis.com", "www.googleapis.com"],
    },
    timeoutMs: 30_000,
  },
  gmail_send: {
    toolName: "gmail_send",
    category: "connector",
    riskLevel: "high",
    requiresApproval: true,
    approvalReason: "Sending external email is irreversible and user-facing.",
    network: {
      mode: "allowlist",
      hosts: ["gmail.googleapis.com", "www.googleapis.com"],
    },
    timeoutMs: 30_000,
  },
  google_drive_read: {
    toolName: "google_drive_read",
    category: "connector",
    riskLevel: "high",
    requiresApproval: true,
    approvalReason: "Reading cloud documents may expose sensitive data.",
    network: {
      mode: "allowlist",
      hosts: ["www.googleapis.com"],
    },
    timeoutMs: 30_000,
  },
  google_drive_write: {
    toolName: "google_drive_write",
    category: "connector",
    riskLevel: "high",
    requiresApproval: true,
    approvalReason: "Writing cloud documents modifies user-owned assets.",
    network: {
      mode: "allowlist",
      hosts: ["www.googleapis.com"],
    },
    timeoutMs: 30_000,
  },
  browser_automation_connector: {
    toolName: "browser_automation_connector",
    category: "connector",
    riskLevel: "high",
    requiresApproval: true,
    approvalReason: "Browser automation can trigger external side effects.",
    network: {
      mode: "allowlist",
      hosts: [],
    },
    timeoutMs: 45_000,
  },
  network_device_control: {
    toolName: "network_device_control",
    category: "connector",
    riskLevel: "high",
    requiresApproval: true,
    approvalReason: "Controlling local devices requires explicit permission.",
    network: {
      mode: "allowlist",
      hosts: [],
      allowLocalNetwork: true,
    },
    timeoutMs: 30_000,
  },
};

export interface EphemeralSandboxJob {
  id: string;
  taskId: string;
  rootDir: string;
  createdAt: Date;
}

export function getSandboxToolPolicy(
  toolName: string,
): SandboxToolPolicy | undefined {
  return TOOL_POLICIES[toolName];
}

export function listSandboxToolPolicies(): SandboxToolPolicy[] {
  return Object.values(TOOL_POLICIES);
}

export type CodeWorkerRecipe = "install" | "build" | "test" | "playwright_smoke";

interface CodeWorkerRecipePolicy {
  recipe: CodeWorkerRecipe;
  riskLevel: SandboxToolRiskLevel;
  requiresApproval: boolean;
  approvalReason?: string;
  timeoutMs: number;
  requestedHosts: string[];
}

const CODE_WORKER_RECIPE_POLICIES: Record<CodeWorkerRecipe, CodeWorkerRecipePolicy> =
  {
    install: {
      recipe: "install",
      riskLevel: "high",
      requiresApproval: true,
      approvalReason:
        "Installing dependencies may trigger external network actions and supply-chain risk.",
      timeoutMs: 120_000,
      requestedHosts: ["registry.npmjs.org", "api.npmjs.org"],
    },
    build: {
      recipe: "build",
      riskLevel: "low",
      requiresApproval: false,
      timeoutMs: 30_000,
      requestedHosts: [],
    },
    test: {
      recipe: "test",
      riskLevel: "low",
      requiresApproval: false,
      timeoutMs: 30_000,
      requestedHosts: [],
    },
    playwright_smoke: {
      recipe: "playwright_smoke",
      riskLevel: "low",
      requiresApproval: false,
      timeoutMs: 60_000,
      requestedHosts: [],
    },
  };

export interface RunCodeWorkerRecipeParams {
  job: EphemeralSandboxJob;
  recipe: CodeWorkerRecipe;
  approved?: boolean;
  inlineScript?: string;
  timeoutMs?: number;
}

export type CodeWorkerRecipeResult =
  | { ok: true; stdout: string; stderr: string; exitCode: number }
  | { ok: false; stdout: string; stderr: string; exitCode: number };

export function listCodeWorkerRecipes(): CodeWorkerRecipe[] {
  return Object.keys(CODE_WORKER_RECIPE_POLICIES) as CodeWorkerRecipe[];
}

export function getCodeWorkerRecipePolicy(
  recipe: CodeWorkerRecipe,
): CodeWorkerRecipePolicy {
  return CODE_WORKER_RECIPE_POLICIES[recipe];
}

export function getCodeWorkerRecipeApprovalMessage(
  recipe: CodeWorkerRecipe,
): string | null {
  const policy = CODE_WORKER_RECIPE_POLICIES[recipe];
  if (!policy.requiresApproval) return null;
  const reason = policy.approvalReason ?? "This recipe requires explicit approval.";
  return `Approval required for code_worker:${recipe}: ${reason}`;
}

export async function runCodeWorkerRecipe(
  params: RunCodeWorkerRecipeParams,
): Promise<CodeWorkerRecipeResult> {
  const policy = getCodeWorkerRecipePolicy(params.recipe);
  if (policy.requiresApproval && params.approved !== true) {
    const message =
      getCodeWorkerRecipeApprovalMessage(params.recipe) ??
      "Approval required for this code worker recipe.";
    return {
      ok: false,
      stdout: "",
      stderr: message,
      exitCode: 1,
    };
  }

  const invocation = buildCodeWorkerInvocation({
    recipe: params.recipe,
    inlineScript: params.inlineScript,
  });

  return runSandboxCommand({
    job: params.job,
    toolName: "code_worker",
    command: invocation.command,
    args: invocation.args,
    requestedHosts:
      invocation.requestedHosts.length > 0
        ? invocation.requestedHosts
        : undefined,
    timeoutMs: params.timeoutMs ?? policy.timeoutMs,
  });
}

function buildCodeWorkerInvocation(params: {
  recipe: CodeWorkerRecipe;
  inlineScript?: string;
}): {
  command: string;
  args: string[];
  requestedHosts: string[];
} {
  if (params.recipe === "install") {
    return {
      command: "npm",
      args: ["install", "--ignore-scripts", "--no-audit", "--no-fund"],
      requestedHosts: getCodeWorkerRecipePolicy("install").requestedHosts,
    };
  }

  const inlineScript = params.inlineScript?.trim();
  if (!inlineScript) {
    throw new Error(`code_worker:${params.recipe} requires an inlineScript`);
  }

  return {
    command: "node",
    args: ["-e", inlineScript],
    requestedHosts: [],
  };
}

export function getSandboxToolApprovalMessage(toolName: string): string | null {
  const policy = TOOL_POLICIES[toolName];
  if (!policy || !policy.requiresApproval) return null;
  const reason = policy.approvalReason ?? "This tool requires explicit approval.";
  return `Approval required for ${toolName}: ${reason}`;
}

export function assertSandboxToolAccess(params: {
  toolName: string;
  requestedHosts?: string[];
}): SandboxToolPolicy {
  const policy = TOOL_POLICIES[params.toolName];
  if (!policy) {
    throw new Error(`Tool access denied by default: ${params.toolName}`);
  }

  const requestedHosts = (params.requestedHosts ?? [])
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host.length > 0);

  if (policy.network.mode === "deny_all" && requestedHosts.length > 0) {
    throw new Error(
      `Tool ${params.toolName} does not allow network access (requested: ${requestedHosts.join(", ")})`,
    );
  }

  if (policy.network.mode === "allowlist") {
    const allowed = new Set(policy.network.hosts.map((host) => host.toLowerCase()));
    const allowLocalNetwork = policy.network.allowLocalNetwork === true;
    const denied = requestedHosts.filter((host) => {
      if (allowed.has(host)) return false;
      if (allowLocalNetwork && isLikelyLocalNetworkHost(host)) {
        return false;
      }
      return true;
    });
    if (denied.length > 0) {
      throw new Error(
        `Tool ${params.toolName} blocked network egress to: ${denied.join(", ")}`,
      );
    }
  }

  return policy;
}

export async function createEphemeralSandboxJob(
  taskId: string,
): Promise<EphemeralSandboxJob> {
  const prefix = `zee-agent-${taskId.slice(0, 8)}-`;
  const rootDir = await mkdtemp(join(tmpdir(), prefix));

  return {
    id: randomUUID(),
    taskId,
    rootDir,
    createdAt: new Date(),
  };
}

export async function cleanupEphemeralSandboxJob(
  job: EphemeralSandboxJob,
): Promise<void> {
  await rm(job.rootDir, { recursive: true, force: true });
}

export async function writeSandboxFile(params: {
  job: EphemeralSandboxJob;
  toolName: string;
  relativePath: string;
  content: string;
  requestedHosts?: string[];
}): Promise<string> {
  assertSandboxToolAccess({
    toolName: params.toolName,
    requestedHosts: params.requestedHosts,
  });

  const absolutePath = resolveSandboxPath(params.job.rootDir, params.relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, params.content, "utf8");
  return absolutePath;
}

export async function readSandboxFile(params: {
  job: EphemeralSandboxJob;
  toolName: string;
  relativePath: string;
  requestedHosts?: string[];
}): Promise<string> {
  assertSandboxToolAccess({
    toolName: params.toolName,
    requestedHosts: params.requestedHosts,
  });

  const absolutePath = resolveSandboxPath(params.job.rootDir, params.relativePath);
  const bytes = await readFile(absolutePath);
  return bytes.toString("utf8");
}

export async function runSandboxCommand(params: {
  job: EphemeralSandboxJob;
  toolName: string;
  command: string;
  args?: string[];
  timeoutMs?: number;
  requestedHosts?: string[];
}): Promise<
  | { ok: true; stdout: string; stderr: string; exitCode: number }
  | { ok: false; stdout: string; stderr: string; exitCode: number }
> {
  const policy = assertSandboxToolAccess({
    toolName: params.toolName,
    requestedHosts: params.requestedHosts,
  });

  const args = params.args ?? [];
  const timeoutMs = params.timeoutMs ?? policy.timeoutMs;

  try {
    const result = await execFileAsync(params.command, args, {
      cwd: params.job.rootDir,
      timeout: timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR,
        NODE_ENV: process.env.NODE_ENV,
      },
    });

    return {
      ok: true,
      stdout: result.stdout?.toString() ?? "",
      stderr: result.stderr?.toString() ?? "",
      exitCode: 0,
    };
  } catch (error) {
    const asObj = error as {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      code?: number;
      message?: string;
    };

    return {
      ok: false,
      stdout:
        typeof asObj.stdout === "string"
          ? asObj.stdout
          : asObj.stdout
            ? asObj.stdout.toString()
            : "",
      stderr:
        typeof asObj.stderr === "string"
          ? asObj.stderr
          : asObj.stderr
            ? asObj.stderr.toString()
            : asObj.message ?? "Command failed",
      exitCode: typeof asObj.code === "number" ? asObj.code : 1,
    };
  }
}

function resolveSandboxPath(rootDir: string, relativePath: string): string {
  const absolutePath = resolve(rootDir, relativePath);
  const normalizedRoot = rootDir.endsWith("/") ? rootDir : `${rootDir}/`;
  if (!absolutePath.startsWith(normalizedRoot) && absolutePath !== rootDir) {
    throw new Error("Sandbox path escape blocked");
  }
  return absolutePath;
}

function isLikelyLocalNetworkHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  if (!normalized) return false;

  if (normalized === "localhost") return true;
  if (normalized === "::1") return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalized)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalized)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(normalized)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(normalized)) {
    return true;
  }
  return normalized.endsWith(".local");
}
