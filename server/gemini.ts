import {
  ActivityHandling,
  EndSensitivity,
  GoogleGenAI,
  Modality,
  StartSensitivity,
  TurnCoverage,
  type GenerateContentResponseUsageMetadata,
} from "@google/genai";
import { execFile } from "child_process";
import { readFile } from "fs/promises";
import { resolve } from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

type Persona = "Zee";
export type LiveVoiceName = "Aoede" | "Kore" | "Charon" | "Fenrir";
export type ResponseStylePreset =
  | "concise"
  | "balanced"
  | "expressive"
  | "playful";
export type LiveMemoryPolicy = "safe_selective" | "remember_everything";

export interface TextPersonalizationProfile {
  displayName?: string | null;
  bio?: string | null;
  location?: string | null;
  age?: number | null;
  profession?: string | null;
  gender?: string | null;
  genderOther?: string | null;
  responseStylePreset?: ResponseStylePreset | null;
  responseStyleNote?: string | null;
}

export const DEFAULT_PERSONA: Persona = "Zee";
export const LIVE_VOICE_NAMES: readonly LiveVoiceName[] = [
  "Aoede",
  "Kore",
  "Charon",
  "Fenrir",
] as const;
export const DEFAULT_LIVE_VOICE: LiveVoiceName = "Aoede";
export const ZEE_SPLIT_TOKEN = "[[ZEE_SPLIT]]";
const MAX_MULTIPART_SEGMENTS = 3;

interface ConversationAttachmentMessage {
  mimeType: string;
  inlineDataBase64?: string;
  summaryText?: string;
}

interface ConversationMessage {
  sender: string;
  text: string;
  attachments?: ConversationAttachmentMessage[];
}

interface TokenUsageSnapshot {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

const DEFAULT_TEXT_MODEL = "gemini-3-flash-preview";
const DEFAULT_LIVE_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025";
const DEFAULT_AGENT_GAME_MODEL = "gemini-3-flash-preview";
const DEFAULT_AGENT_DOC_MODEL = "gemini-3-flash-preview";
const DEFAULT_AGENT_PRESENTATION_IMAGE_MODEL = "gemini-3-pro-image-preview";
const DEFAULT_ZEE_PROMPT_FALLBACK = [
  "You are Zee, a warm, emotionally intelligent AI companion.",
  "Stay helpful, grounded, and conversational.",
  "When unclear, ask a brief clarifying question before assuming details.",
  "Keep responses concise unless the user asks for depth.",
].join(" ");

let geminiClient: GoogleGenAI | null = null;
let geminiAlphaClient: GoogleGenAI | null = null;
let zeePromptCache: string | null = null;
let promptFallbackWarningLogged = false;

const STYLE_PRESET_INSTRUCTIONS: Record<ResponseStylePreset, string> = {
  concise:
    "Prefer compact, punchy replies. Use short messages often and avoid unnecessary detail.",
  balanced:
    "Balance warmth and brevity. Keep replies natural, useful, and moderately short.",
  expressive:
    "Be emotionally vivid and conversational while staying grounded and clear.",
  playful:
    "Use light humor and friendly playful tone when context allows, but stay respectful.",
};

interface SanitizedAssistantText {
  text: string;
  awaitingToolPrefix: boolean;
}

function requireGeminiApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("GEMINI_API_KEY is not configured");
  }
  return key;
}

function normalizeModelId(model: string): string {
  return model.replace(/^models\//, "");
}

function resolveTextModel(): string {
  return normalizeModelId(process.env.GEMINI_TEXT_MODEL ?? DEFAULT_TEXT_MODEL);
}

function resolveLiveModel(): string {
  return normalizeModelId(process.env.GEMINI_LIVE_MODEL ?? DEFAULT_LIVE_MODEL);
}

function resolveAgentGameModel(): string {
  return normalizeModelId(
    process.env.AGENT_GAME_MODEL ?? DEFAULT_AGENT_GAME_MODEL,
  );
}

function resolveAgentDocModel(): string {
  return normalizeModelId(
    process.env.AGENT_DOC_MODEL ??
      process.env.AGENT_GAME_MODEL ??
      DEFAULT_AGENT_DOC_MODEL,
  );
}

function resolveAgentPresentationImageModel(): string {
  return normalizeModelId(
    process.env.AGENT_PRESENTATION_IMAGE_MODEL ??
      DEFAULT_AGENT_PRESENTATION_IMAGE_MODEL,
  );
}

function resolveLiveModelCandidates(): string[] {
  const primary = resolveLiveModel();
  const configuredFallbacks = (process.env.GEMINI_LIVE_MODEL_FALLBACKS ?? "")
    .split(",")
    .map((value) => normalizeModelId(value.trim()))
    .filter((value) => value.length > 0);

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const candidate of [primary, ...configuredFallbacks]) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    deduped.push(candidate);
  }
  return deduped;
}

function getGeminiClient(): GoogleGenAI {
  if (!geminiClient) {
    geminiClient = new GoogleGenAI({ apiKey: requireGeminiApiKey() });
  }
  return geminiClient;
}

function getGeminiAlphaClient(): GoogleGenAI {
  if (!geminiAlphaClient) {
    geminiAlphaClient = new GoogleGenAI({
      apiKey: requireGeminiApiKey(),
      apiVersion: "v1alpha",
    });
  }
  return geminiAlphaClient;
}

function parsePositiveInt(input: string | undefined, fallback: number): number {
  if (!input) return fallback;
  const parsed = Number.parseInt(input, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseOptionalPositiveInt(input: string | undefined): number | undefined {
  if (!input) return undefined;
  const parsed = Number.parseInt(input, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseNonNegativeInt(input: string | undefined, fallback: number): number {
  if (!input) return fallback;
  const parsed = Number.parseInt(input, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function resolveStartSensitivity(): StartSensitivity {
  const raw = (process.env.GEMINI_LIVE_VAD_START_SENSITIVITY ?? "LOW")
    .trim()
    .toUpperCase();
  return raw === "LOW"
    ? StartSensitivity.START_SENSITIVITY_LOW
    : StartSensitivity.START_SENSITIVITY_HIGH;
}

function resolveEndSensitivity(): EndSensitivity {
  const raw = (process.env.GEMINI_LIVE_VAD_END_SENSITIVITY ?? "HIGH")
    .trim()
    .toUpperCase();
  return raw === "LOW"
    ? EndSensitivity.END_SENSITIVITY_LOW
    : EndSensitivity.END_SENSITIVITY_HIGH;
}

function resolveTurnCoverage(): TurnCoverage {
  const raw = (process.env.GEMINI_LIVE_TURN_COVERAGE ?? "TURN_INCLUDES_ONLY_ACTIVITY")
    .trim()
    .toUpperCase();
  return raw === "TURN_INCLUDES_ALL_INPUT" || raw === "ALL_INPUT"
    ? TurnCoverage.TURN_INCLUDES_ALL_INPUT
    : TurnCoverage.TURN_INCLUDES_ONLY_ACTIVITY;
}

function resolveActivityHandling(
  isMobileDevice: boolean,
): ActivityHandling {
  const fallback = isMobileDevice
    ? "NO_INTERRUPTION"
    : "START_OF_ACTIVITY_INTERRUPTS";
  const raw = (process.env.GEMINI_LIVE_ACTIVITY_HANDLING ?? fallback)
    .trim()
    .toUpperCase();
  return raw === "NO_INTERRUPTION"
    ? ActivityHandling.NO_INTERRUPTION
    : ActivityHandling.START_OF_ACTIVITY_INTERRUPTS;
}

function parseBoundedNumber(
  input: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!input) return fallback;
  const parsed = Number.parseFloat(input);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function compactUsage(
  usage: GenerateContentResponseUsageMetadata | undefined,
): TokenUsageSnapshot | undefined {
  if (!usage) return undefined;
  return {
    promptTokenCount: usage.promptTokenCount,
    candidatesTokenCount: usage.candidatesTokenCount,
    totalTokenCount: usage.totalTokenCount,
  };
}

function parseBooleanFlag(input: string | undefined, fallback: boolean): boolean {
  if (typeof input !== "string") return fallback;
  const normalized = input.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function cleanTextInput(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function clampPromptBlock(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 13)).trim()}\n[truncated]`;
}

function buildProfileContext(profile: TextPersonalizationProfile | null | undefined): string {
  if (!profile) return "";

  const lines: string[] = [];

  const displayName = cleanTextInput(profile.displayName);
  if (displayName) lines.push(`- Preferred name: ${displayName}`);

  const location = cleanTextInput(profile.location);
  if (location) lines.push(`- Location: ${location}`);

  if (typeof profile.age === "number" && Number.isFinite(profile.age)) {
    lines.push(`- Age: ${profile.age}`);
  }

  const profession = cleanTextInput(profile.profession);
  if (profession) lines.push(`- Profession: ${profession}`);

  const gender = cleanTextInput(profile.gender);
  if (gender) lines.push(`- Gender identity: ${gender}`);

  const genderOther = cleanTextInput(profile.genderOther);
  if (genderOther) lines.push(`- Gender detail: ${genderOther}`);

  const bio = cleanTextInput(profile.bio);
  if (bio) lines.push(`- Bio: ${bio}`);

  if (lines.length === 0) return "";
  return `USER PROFILE CONTEXT (optional fields user shared):\n${lines.join("\n")}`;
}

function resolveResponseStyle(
  profile: TextPersonalizationProfile | null | undefined,
): ResponseStylePreset {
  const style = profile?.responseStylePreset;
  if (style && style in STYLE_PRESET_INSTRUCTIONS) {
    return style;
  }
  return "balanced";
}

function buildTextPromptAdditions(params: {
  profileContext?: TextPersonalizationProfile | null;
  memoryContextBlock?: string | null;
  memoryPolicy?: LiveMemoryPolicy;
  enableMultipart: boolean;
}): string {
  const sections: string[] = [];
  const memoryPolicy = params.memoryPolicy ?? "safe_selective";

  const profileBlock = buildProfileContext(params.profileContext ?? null);
  if (profileBlock) {
    sections.push(profileBlock);
  }

  const style = resolveResponseStyle(params.profileContext ?? null);
  const styleLines = [
    `TEXT STYLE PREFERENCE: ${style.toUpperCase()}`,
    `- ${STYLE_PRESET_INSTRUCTIONS[style]}`,
  ];
  const styleNote = cleanTextInput(params.profileContext?.responseStyleNote);
  if (styleNote) {
    styleLines.push(`- User custom note: ${styleNote}`);
  }
  sections.push(styleLines.join("\n"));

  sections.push(
    [
      "TEXT CONVERSATION BEHAVIOR:",
      "- Sound like natural human texting and keep pacing dynamic.",
      "- Many turns should be short. Use one-liners when that feels right.",
      "- Default to one assistant message per turn.",
      "- You may occasionally send 2 short messages when the user's tone is emotional/casual and a reaction + follow-up feels natural.",
      "- If the user asks to double text, return exactly 2 messages. If they ask to triple/tripple text, return exactly 3 messages.",
      "- For casual banter, keep reactions concise in the same message unless split mode is requested.",
      "- If the user mentions a need (for example: 'I need to write an email') but does not directly ask you to create something, stay conversational first and ask a short consent question before proposing or starting any task.",
      params.enableMultipart
        ? `- For multi-message turns, separate each message with ${ZEE_SPLIT_TOKEN}.`
        : "- Return one assistant message per turn.",
      `- Never produce more than ${MAX_MULTIPART_SEGMENTS} messages for a single turn.`,
      "- Avoid overlong replies unless the user explicitly asks for depth.",
      "- Use emojis naturally when they improve tone.",
    ].join("\n"),
  );

  sections.push(
    [
      "GROUNDING AND MEMORY SAFETY:",
      "- Only reference facts that appear in conversation history or the user profile context above.",
      "- If uncertain whether a memory is real, ask a brief clarifying question.",
      "- Do not invent memories, journal entries, previous events, or private details.",
      `- Memory mode for this turn: ${memoryPolicy}.`,
      memoryPolicy === "safe_selective"
        ? "- In safe_selective mode, avoid replaying sensitive identifiers and prioritize relevant continuity."
        : "- In remember_everything mode, preserve broad continuity while still avoiding hallucinated claims.",
    ].join("\n"),
  );

  const memoryBlock = cleanTextInput(params.memoryContextBlock);
  if (memoryBlock) {
    sections.push(
      [
        "LIVE + TEXT MEMORY CONTEXT:",
        clampPromptBlock(memoryBlock, 12_000),
      ].join("\n"),
    );
  }

  return sections.join("\n\n");
}

export interface SplitDiagnostics {
  parts: string[];
  rawLength: number;
  delimiterCount: number;
  rawDelimiterPositions: number[];
  partLengths: number[];
  wasCapped: boolean;
  endsAbruptly: boolean;
}

export function splitAssistantReplyParts(
  replyText: string,
  maxParts = MAX_MULTIPART_SEGMENTS,
): string[] {
  return splitAssistantReplyPartsWithDiagnostics(replyText, maxParts).parts;
}

export function splitAssistantReplyPartsWithDiagnostics(
  replyText: string,
  maxParts = MAX_MULTIPART_SEGMENTS,
): SplitDiagnostics {
  const normalized = replyText.trim();
  if (!normalized) return { parts: [], rawLength: 0, delimiterCount: 0, rawDelimiterPositions: [], partLengths: [], wasCapped: false, endsAbruptly: false };

  const rawDelimiterPositions: number[] = [];
  let searchStart = 0;
  while (true) {
    const idx = normalized.indexOf(ZEE_SPLIT_TOKEN, searchStart);
    if (idx === -1) break;
    rawDelimiterPositions.push(idx);
    searchStart = idx + ZEE_SPLIT_TOKEN.length;
  }

  const pieces = normalized
    .split(ZEE_SPLIT_TOKEN)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  const endsAbruptly = /[a-zA-Z,;:]\s*$/.test(normalized) && !normalized.endsWith(".");

  let parts: string[];
  let wasCapped = false;
  if (pieces.length === 0) {
    parts = [normalized];
  } else if (pieces.length <= maxParts) {
    parts = pieces;
  } else {
    wasCapped = true;
    const head = pieces.slice(0, maxParts - 1);
    const tail = pieces.slice(maxParts - 1).join(" ");
    parts = [...head, tail];
  }

  return {
    parts,
    rawLength: normalized.length,
    delimiterCount: rawDelimiterPositions.length,
    rawDelimiterPositions,
    partLengths: parts.map((p) => p.length),
    wasCapped,
    endsAbruptly,
  };
}

function buildGroundingSnapshot(params: {
  messages: ConversationMessage[];
  profileContext?: TextPersonalizationProfile | null;
}): string {
  const messageText = params.messages
    .map((message) => message.text?.trim() ?? "")
    .filter((text) => text.length > 0)
    .join("\n")
    .toLowerCase();

  const profileText = [
    params.profileContext?.displayName,
    params.profileContext?.bio,
    params.profileContext?.location,
    params.profileContext?.profession,
    params.profileContext?.gender,
    params.profileContext?.genderOther,
    params.profileContext?.responseStyleNote,
  ]
    .map((value) => cleanTextInput(value ?? null))
    .filter((value): value is string => Boolean(value))
    .join("\n")
    .toLowerCase();

  return `${messageText}\n${profileText}`;
}

function detectUngroundedSignals(replyText: string, groundingSnapshot: string): string[] {
  const normalized = replyText.toLowerCase();
  const flagged: string[] = [];

  const signalChecks: Array<{ label: string; phrase: string }> = [
    { label: "journal_reference", phrase: "journal" },
    { label: "focus_scores_reference", phrase: "focus score" },
    { label: "stagnant_reference", phrase: "stagnant" },
    { label: "other_day_reference", phrase: "the other day" },
    { label: "you_mentioned_reference", phrase: "you mentioned" },
  ];

  for (const signal of signalChecks) {
    if (!normalized.includes(signal.phrase)) continue;
    if (!groundingSnapshot.includes(signal.phrase)) {
      flagged.push(signal.label);
    }
  }

  return flagged;
}

async function loadZeePrompt(): Promise<string> {
  const usePromptCache = process.env.NODE_ENV === "production";
  if (usePromptCache && zeePromptCache) return zeePromptCache;
  const filePath = resolve(process.cwd(), "zee-persona.md");

  try {
    const rawPrompt = await readFile(filePath, "utf8");
    const cleanedPrompt = rawPrompt
      .replace(/^\$\{chainOfThoughtInstructions\}\s*$/gm, "")
      .replace(/^\$\{outputFormatInstructions\}\s*$/gm, "")
      .trim();

    const resolvedPrompt =
      cleanedPrompt.length > 0 ? cleanedPrompt : DEFAULT_ZEE_PROMPT_FALLBACK;
    if (usePromptCache) {
      zeePromptCache = resolvedPrompt;
    }
    return resolvedPrompt;
  } catch (error) {
    if (usePromptCache) {
      zeePromptCache = DEFAULT_ZEE_PROMPT_FALLBACK;
    }
    if (!promptFallbackWarningLogged) {
      promptFallbackWarningLogged = true;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[gemini] Failed to load zee-persona.md; using fallback prompt. reason=${message}`,
      );
    }
    return DEFAULT_ZEE_PROMPT_FALLBACK;
  }
}

export async function getPersonaPrompt(persona: Persona): Promise<string> {
  const basePrompt = await loadZeePrompt();

  return `${basePrompt}

OUTPUT SAFETY RULES:
- Return only user-facing assistant text.
- Never output JSON objects for tools or function calls.
- Never include internal fields like action, action_input, thought, tool, function_call, or arguments.`;
}

async function getTextPersonaPrompt(params: {
  persona: Persona;
  profileContext?: TextPersonalizationProfile | null;
  memoryContextBlock?: string | null;
  memoryPolicy?: LiveMemoryPolicy;
  enableMultipart: boolean;
}): Promise<string> {
  const basePrompt = await loadZeePrompt();
  const additions = buildTextPromptAdditions({
    profileContext: params.profileContext,
    memoryContextBlock: params.memoryContextBlock,
    memoryPolicy: params.memoryPolicy,
    enableMultipart: params.enableMultipart,
  });

  return `${basePrompt}

${additions}

OUTPUT SAFETY RULES:
- Return only user-facing assistant text.
- Never output JSON objects for tools or function calls.
- Never include internal fields like action, action_input, thought, tool, function_call, or arguments.
- Do not include the delimiter token in final visible text unless splitting multi-message turns.`;
}

function findLeadingJsonObjectEnd(value: string): number | null {
  if (!value.startsWith("{")) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
  }

  return null;
}

function isToolMetadataObject(candidate: string): boolean {
  try {
    const parsed = JSON.parse(candidate);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return false;
    }

    const keys = new Set(
      Object.keys(parsed as Record<string, unknown>).map((key) => key.toLowerCase()),
    );

    if (keys.has("thought")) return true;
    if (keys.has("action_input")) return true;
    if (keys.has("function_call")) return true;
    if (keys.has("tool") || keys.has("tool_name")) return true;
    if (keys.has("name") && keys.has("arguments")) return true;
    if (keys.has("action") && (keys.has("input") || keys.has("args"))) return true;

    return false;
  } catch {
    return false;
  }
}

function sanitizeAssistantReplyText(rawText: string): SanitizedAssistantText {
  if (!rawText) {
    return { text: "", awaitingToolPrefix: false };
  }

  const leadingWhitespaceLength = rawText.match(/^\s*/)?.[0].length ?? 0;
  let remaining = rawText.slice(leadingWhitespaceLength);
  let strippedPrefix = false;

  while (remaining.startsWith("{")) {
    const objectEnd = findLeadingJsonObjectEnd(remaining);
    if (objectEnd === null) {
      // Hold streaming output until we know whether the leading object is tool metadata.
      return { text: "", awaitingToolPrefix: true };
    }

    const candidate = remaining.slice(0, objectEnd);
    if (!isToolMetadataObject(candidate)) {
      return {
        text: strippedPrefix ? remaining.trimStart() : rawText,
        awaitingToolPrefix: false,
      };
    }

    strippedPrefix = true;
    remaining = remaining
      .slice(objectEnd)
      .replace(/^```(?:json)?\s*/i, "")
      .trimStart();
  }

  return {
    text: strippedPrefix ? remaining : rawText,
    awaitingToolPrefix: false,
  };
}

function toGeminiRole(sender: string): "user" | "model" {
  return sender === "user" ? "user" : "model";
}

function buildConversationContents(messages: ConversationMessage[]) {
  const recentWindow = parsePositiveInt(
    process.env.GEMINI_TEXT_MEMORY_WINDOW_MESSAGES,
    40,
  );

  const clipped = messages.slice(-recentWindow);

  return clipped
    .map((msg) => {
      const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
      const text = msg.text.trim();
      if (text.length > 0) {
        parts.push({ text });
      }

      for (const attachment of msg.attachments ?? []) {
        if (attachment.inlineDataBase64) {
          parts.push({
            inlineData: {
              mimeType: attachment.mimeType,
              data: attachment.inlineDataBase64,
            },
          });
          continue;
        }
        if (attachment.summaryText && attachment.summaryText.trim().length > 0) {
          parts.push({ text: `[Image memory] ${attachment.summaryText.trim()}` });
        }
      }

      if (parts.length === 0) {
        return null;
      }

      return {
        role: toGeminiRole(msg.sender),
        parts,
      };
    })
    .filter((content): content is { role: "user" | "model"; parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> } => Boolean(content));
}

export interface EnforceGroundedReplyInput {
  persona: Persona;
  messages: ConversationMessage[];
  replyText: string;
  profileContext?: TextPersonalizationProfile | null;
}

export interface EnforceGroundedReplyResult {
  replyText: string;
  rewritten: boolean;
  signals: string[];
}

export async function enforceGroundedReply(
  input: EnforceGroundedReplyInput,
): Promise<EnforceGroundedReplyResult> {
  const originalReply = input.replyText.trim();
  if (!originalReply) {
    return {
      replyText: "",
      rewritten: false,
      signals: [],
    };
  }

  const groundingSnapshot = buildGroundingSnapshot({
    messages: input.messages,
    profileContext: input.profileContext,
  });
  const signals = detectUngroundedSignals(originalReply, groundingSnapshot);
  if (signals.length === 0) {
    return {
      replyText: originalReply,
      rewritten: false,
      signals: [],
    };
  }

  const ai = getGeminiClient();
  const model = resolveTextModel();
  const basePrompt = await loadZeePrompt();

  try {
    const rewrite = await ai.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: [
                "Rewrite the assistant reply so it stays natural, warm, and grounded.",
                "Remove any claim that is not directly supported by the provided context.",
                "Keep the user's language style preference in mind.",
                "Do not add new facts.",
                "",
                `Context:\n${groundingSnapshot.slice(0, 3000)}`,
                "",
                `Original reply:\n${originalReply}`,
              ].join("\n"),
            },
          ],
        },
      ],
      config: {
        systemInstruction: `${basePrompt}

GROUNDING ENFORCEMENT:
- Keep the rewrite faithful to known context only.
- If context is missing for a claimed memory, remove that memory claim.
- Preserve conversational tone and empathy.`,
        temperature: 0.35,
        topP: 0.9,
        maxOutputTokens: parsePositiveInt(
          process.env.GEMINI_TEXT_MAX_OUTPUT_TOKENS,
          1024,
        ),
      },
    });

    const sanitized = sanitizeAssistantReplyText(rewrite.text ?? "");
    const rewrittenText = sanitized.text.trim();
    if (!rewrittenText) {
      return {
        replyText: originalReply,
        rewritten: false,
        signals,
      };
    }

    return {
      replyText: rewrittenText,
      rewritten: true,
      signals,
    };
  } catch {
    return {
      replyText: originalReply,
      rewritten: false,
      signals,
    };
  }
}

export interface CreateLiveTokenInput {
  persona: Persona;
  responseModality?: "AUDIO" | "TEXT";
  voiceName?: LiveVoiceName;
  memoryContextBlock?: string;
  profileContext?: TextPersonalizationProfile | null;
  memoryPolicy?: LiveMemoryPolicy;
  deviceClass?: "mobile" | "desktop" | "unknown";
}

export interface LiveTokenConfigSummary {
  lowLatencyMode: boolean;
  activityHandling: "START_OF_ACTIVITY_INTERRUPTS" | "NO_INTERRUPTION";
  vadStartSensitivity: "HIGH" | "LOW";
  vadEndSensitivity: "HIGH" | "LOW";
  forceAlwaysRespond: boolean;
  vadPrefixPaddingMs: number;
  vadSilenceMs: number;
  turnCoverage: "TURN_INCLUDES_ONLY_ACTIVITY" | "TURN_INCLUDES_ALL_INPUT";
  affectiveDialog: boolean;
  proactiveAudio: boolean;
  thinkingBudget: number | null;
  includeThoughts: boolean;
  temperature: number;
  topP: number;
  topK: number | null;
  maxOutputTokens: number;
  deviceClass: "mobile" | "desktop" | "unknown";
}

export interface CreateLiveTokenResult {
  tokenName: string;
  model: string;
  responseModality: "AUDIO" | "TEXT";
  voiceName: LiveVoiceName;
  expireTime: string;
  newSessionExpireTime: string;
  generatedAt: string;
  uses: number;
  configSummary: LiveTokenConfigSummary;
}

function composeLiveSystemInstruction(params: {
  personaPrompt: string;
  memoryContextBlock?: string;
  profileContext?: TextPersonalizationProfile | null;
  memoryPolicy: LiveMemoryPolicy;
}): string {
  const sections: string[] = [params.personaPrompt];

  const profileBlock = buildProfileContext(params.profileContext ?? null);
  if (profileBlock) {
    sections.push(profileBlock);
  }

  sections.push(
    [
      "LIVE MEMORY BEHAVIOR:",
      `- Memory mode: ${params.memoryPolicy}.`,
      "- Prioritize continuity with the current conversation first, then relevant cross-chat context.",
      "- If a memory is uncertain or ambiguous, ask a brief clarifying question before treating it as fact.",
      params.memoryPolicy === "safe_selective"
        ? "- Treat sensitive identifiers carefully. Avoid repeating highly sensitive details unless the user explicitly asks."
        : "- User opted into broad continuity. Keep recall natural, precise, and context-appropriate.",
      "- Keep replies grounded in provided memory context and current user signals.",
    ].join("\n"),
  );

  const memoryBlock = cleanTextInput(params.memoryContextBlock);
  if (memoryBlock) {
    sections.push(`LIVE MEMORY CONTEXT:\n${memoryBlock}`);
  }

  return sections.join("\n\n");
}

export async function createLiveToken(
  input: CreateLiveTokenInput,
): Promise<CreateLiveTokenResult> {
  const ai = getGeminiAlphaClient();
  const modelCandidates = resolveLiveModelCandidates();
  const personaPrompt = await getPersonaPrompt(input.persona);
  const responseModality = input.responseModality ?? "AUDIO";
  const voiceName = input.voiceName ?? DEFAULT_LIVE_VOICE;
  const memoryPolicy = input.memoryPolicy ?? "safe_selective";
  const deviceClass = input.deviceClass ?? "unknown";
  const isMobileDevice = deviceClass === "mobile";
  const systemInstruction = composeLiveSystemInstruction({
    personaPrompt,
    memoryContextBlock: input.memoryContextBlock,
    profileContext: input.profileContext ?? null,
    memoryPolicy,
  });

  const now = Date.now();
  const expireInMs = parsePositiveInt(
    process.env.GEMINI_LIVE_TOKEN_EXPIRE_MS,
    30 * 60 * 1000,
  );
  const newSessionExpireInMs = parsePositiveInt(
    process.env.GEMINI_LIVE_NEW_SESSION_EXPIRE_MS,
    60 * 1000,
  );
  const uses = parsePositiveInt(process.env.GEMINI_LIVE_TOKEN_USES, 1);
  const lowLatencyMode = parseBooleanFlag(
    process.env.GEMINI_LIVE_LOW_LATENCY_MODE,
    true,
  );
  const activityHandling = resolveActivityHandling(isMobileDevice);
  const vadStartSensitivity = resolveStartSensitivity();
  const vadEndSensitivity = resolveEndSensitivity();
  const vadPrefixPaddingMs = parsePositiveInt(
    process.env.GEMINI_LIVE_VAD_PREFIX_PADDING_MS,
    isMobileDevice
      ? lowLatencyMode
        ? 40
        : 60
      : lowLatencyMode
        ? 60
        : 80,
  );
  const vadSilenceMs = parsePositiveInt(
    process.env.GEMINI_LIVE_VAD_SILENCE_MS,
    isMobileDevice
      ? lowLatencyMode
        ? 140
        : 220
      : lowLatencyMode
        ? 180
        : 320,
  );
  const turnCoverage = resolveTurnCoverage();
  const enableAffectiveDialog = parseBooleanFlag(
    process.env.GEMINI_LIVE_ENABLE_AFFECTIVE_DIALOG,
    true,
  );
  const proactiveAudio = parseBooleanFlag(
    process.env.GEMINI_LIVE_PROACTIVE_AUDIO,
    false,
  );
  const forceAlwaysRespond = parseBooleanFlag(
    process.env.GEMINI_LIVE_FORCE_ALWAYS_RESPOND,
    true,
  );
  const effectiveProactiveAudio =
    responseModality === "AUDIO" && !forceAlwaysRespond && proactiveAudio;
  const useThinkingConfig = parseBooleanFlag(
    process.env.GEMINI_LIVE_USE_THINKING_CONFIG,
    true,
  );
  const allowZeroThinkingBudget = parseBooleanFlag(
    process.env.GEMINI_LIVE_ALLOW_ZERO_THINKING_BUDGET,
    false,
  );
  let thinkingBudgetValue = parseNonNegativeInt(
    process.env.GEMINI_LIVE_THINKING_BUDGET,
    isMobileDevice
      ? lowLatencyMode
        ? 24
        : 64
      : lowLatencyMode
        ? 32
        : 96,
  );
  if (!allowZeroThinkingBudget && thinkingBudgetValue === 0) {
    thinkingBudgetValue = isMobileDevice ? 24 : 32;
  }
  const includeThoughts = parseBooleanFlag(
    process.env.GEMINI_LIVE_INCLUDE_THOUGHTS,
    false,
  );
  const liveTemperature = parseBoundedNumber(
    process.env.GEMINI_LIVE_TEMPERATURE,
    lowLatencyMode ? 0.45 : 0.55,
    0,
    2,
  );
  const liveTopP = parseBoundedNumber(
    process.env.GEMINI_LIVE_TOP_P,
    lowLatencyMode ? 0.85 : 0.9,
    0,
    1,
  );
  const liveTopK =
    parseOptionalPositiveInt(process.env.GEMINI_LIVE_TOP_K) ??
    (lowLatencyMode ? 24 : 32);
  const liveMaxOutputTokens = parsePositiveInt(
    process.env.GEMINI_LIVE_MAX_OUTPUT_TOKENS,
    isMobileDevice
      ? lowLatencyMode
        ? 180
        : 180
      : lowLatencyMode
        ? 220
        : 280,
  );
  const minVadPrefixPaddingMs = parsePositiveInt(
    process.env.GEMINI_LIVE_MIN_VAD_PREFIX_PADDING_MS,
    50,
  );
  const minVadSilenceMs = parsePositiveInt(
    process.env.GEMINI_LIVE_MIN_VAD_SILENCE_MS,
    180,
  );
  const effectiveVadPrefixPaddingMs = Math.max(
    minVadPrefixPaddingMs,
    vadPrefixPaddingMs,
  );
  const effectiveVadSilenceMs = Math.max(minVadSilenceMs, vadSilenceMs);
  const thinkingConfig = useThinkingConfig
    ? {
        thinkingBudget: thinkingBudgetValue,
        includeThoughts,
      }
    : undefined;
  const configSummary: LiveTokenConfigSummary = {
    lowLatencyMode,
    activityHandling:
      activityHandling === ActivityHandling.NO_INTERRUPTION
        ? "NO_INTERRUPTION"
        : "START_OF_ACTIVITY_INTERRUPTS",
    vadStartSensitivity:
      vadStartSensitivity === StartSensitivity.START_SENSITIVITY_LOW
        ? "LOW"
        : "HIGH",
    vadEndSensitivity:
      vadEndSensitivity === EndSensitivity.END_SENSITIVITY_LOW ? "LOW" : "HIGH",
    forceAlwaysRespond,
    vadPrefixPaddingMs: effectiveVadPrefixPaddingMs,
    vadSilenceMs: effectiveVadSilenceMs,
    turnCoverage:
      turnCoverage === TurnCoverage.TURN_INCLUDES_ALL_INPUT
        ? "TURN_INCLUDES_ALL_INPUT"
        : "TURN_INCLUDES_ONLY_ACTIVITY",
    affectiveDialog: responseModality === "AUDIO" ? enableAffectiveDialog : false,
    proactiveAudio: effectiveProactiveAudio,
    thinkingBudget: thinkingConfig ? thinkingBudgetValue : null,
    includeThoughts: thinkingConfig ? includeThoughts : false,
    temperature: liveTemperature,
    topP: liveTopP,
    topK: liveTopK ?? null,
    maxOutputTokens: liveMaxOutputTokens,
    deviceClass,
  };

  const expireTime = new Date(now + expireInMs).toISOString();
  const newSessionExpireTime = new Date(now + newSessionExpireInMs).toISOString();
  const lockAdditionalFields = [
    "responseModalities",
    "systemInstruction",
    ...(responseModality === "AUDIO" ? ["speechConfig"] : []),
    "realtimeInputConfig",
    "inputAudioTranscription",
    "outputAudioTranscription",
  ];

  let lastError: unknown = null;
  let resolvedModel = modelCandidates[0];
  let token:
    | Awaited<ReturnType<GoogleGenAI["authTokens"]["create"]>>
    | null = null;

  for (let index = 0; index < modelCandidates.length; index += 1) {
    const model = modelCandidates[index];
    resolvedModel = model;
    try {
      token = await ai.authTokens.create({
        config: {
          uses,
          expireTime,
          newSessionExpireTime,
          liveConnectConstraints: {
            model,
            config: {
              responseModalities: [
                responseModality === "TEXT" ? Modality.TEXT : Modality.AUDIO,
              ],
              systemInstruction,
              temperature: liveTemperature,
              topP: liveTopP,
              topK: liveTopK,
              maxOutputTokens: liveMaxOutputTokens,
              enableAffectiveDialog:
                responseModality === "AUDIO" ? enableAffectiveDialog : undefined,
              thinkingConfig,
              speechConfig:
                responseModality === "AUDIO"
                  ? {
                      voiceConfig: {
                        prebuiltVoiceConfig: {
                          voiceName,
                        },
                      },
                    }
                  : undefined,
              // These defaults prioritize natural turn-taking and low interruption latency.
              realtimeInputConfig: {
                activityHandling,
                turnCoverage,
                automaticActivityDetection: {
                  startOfSpeechSensitivity: vadStartSensitivity,
                  endOfSpeechSensitivity: vadEndSensitivity,
                  prefixPaddingMs: effectiveVadPrefixPaddingMs,
                  silenceDurationMs: effectiveVadSilenceMs,
                },
              },
              proactivity:
                effectiveProactiveAudio
                  ? { proactiveAudio: true }
                  : undefined,
              inputAudioTranscription: {},
              outputAudioTranscription: {},
            },
          },
          lockAdditionalFields,
        },
      });
      break;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      const status =
        typeof (error as { status?: unknown } | null)?.status === "number"
          ? (error as { status: number }).status
          : typeof (error as { statusCode?: unknown } | null)?.statusCode === "number"
            ? (error as { statusCode: number }).statusCode
            : undefined;
      const isModelSelectionFailure =
        status === 400 ||
        status === 404 ||
        (status === 403 && message.includes("model")) ||
        message.includes("model") ||
        message.includes("unsupported") ||
        message.includes("not found") ||
        message.includes("invalid argument");

      if (!isModelSelectionFailure || index >= modelCandidates.length - 1) {
        break;
      }
    }
  }

  if (!token) {
    if (lastError && typeof lastError === "object" && lastError !== null) {
      (lastError as Record<string, unknown>).triedLiveModels = modelCandidates;
    }
    throw (lastError ?? new Error("Gemini did not return a live auth token"));
  }

  if (!token.name) {
    throw new Error("Gemini did not return an ephemeral token name");
  }

  return {
    tokenName: token.name,
    model: resolvedModel,
    responseModality,
    voiceName,
    expireTime,
    newSessionExpireTime,
    generatedAt: new Date(now).toISOString(),
    uses,
    configSummary,
  };
}

export interface GenerateTextReplyInput {
  persona: Persona;
  messages: ConversationMessage[];
  profileContext?: TextPersonalizationProfile | null;
  memoryContextBlock?: string | null;
  memoryPolicy?: LiveMemoryPolicy;
  enableMultipart?: boolean;
}

export interface GenerateTextReplyResult {
  model: string;
  replyText: string;
  responseId?: string;
  usage?: TokenUsageSnapshot;
}

export interface GenerateTextReplyStreamChunk {
  textDelta: string;
  responseId?: string;
  usage?: TokenUsageSnapshot;
}

export interface GenerateTextReplyStreamResult {
  model: string;
  stream: AsyncGenerator<GenerateTextReplyStreamChunk>;
}

export interface GenerateAgentPlannerDraftInput {
  prompt: string;
  hasImage: boolean;
  inferredTaskKind: "mini_game" | "doc_markdown" | "mixed";
  inferredRiskLevel: "low" | "high";
}

export interface GenerateAgentPlannerDraftResult {
  model: string;
  rawJson: string;
  responseId?: string;
  usage?: TokenUsageSnapshot;
}

export type GameProjectFormat = "single_file" | "multi_file";
export type GameProjectEngine = "canvas_dom" | "threejs_light";
export type DocOutputFormat = "document" | "presentation";

export interface GeneratedGameProjectFile {
  path: string;
  content: string;
}

export interface GeneratedGameProjectDraft {
  title: string;
  summary: string;
  format: GameProjectFormat;
  engine: GameProjectEngine;
  mechanics: string[];
  entryPath: string;
  files: GeneratedGameProjectFile[];
}

export interface GenerateGameProjectDraftInput {
  prompt: string;
  imageHints: string[];
  preferredFormat: GameProjectFormat;
  allowLight3d: boolean;
}

export interface RepairGameProjectDraftInput {
  prompt: string;
  imageHints: string[];
  preferredFormat: GameProjectFormat;
  allowLight3d: boolean;
  previousDraft: GeneratedGameProjectDraft;
  qaFailures: string[];
  attempt: number;
}

export interface GenerateGameProjectDraftResult {
  model: string;
  draft: GeneratedGameProjectDraft;
  rawJson: string;
  responseId?: string;
  usage?: TokenUsageSnapshot;
}

export interface GeneratedDocDraft {
  title: string;
  summary: string;
  markdown: string;
  format: DocOutputFormat;
  sections: string[];
}

export interface GenerateDocDraftInput {
  prompt: string;
  imageHints: string[];
}

export interface RepairDocDraftInput {
  prompt: string;
  imageHints: string[];
  previousDraft: GeneratedDocDraft;
  qaFailures: string[];
  attempt: number;
}

export interface GenerateDocDraftResult {
  model: string;
  draft: GeneratedDocDraft;
  rawJson: string;
  responseId?: string;
  usage?: TokenUsageSnapshot;
}

export interface GeneratedPresentationSlideImage {
  index: number;
  prompt: string;
  mimeType: string;
  imageBase64: string;
}

export interface GeneratePresentationSlideImagesInput {
  title: string;
  slidePrompts: string[];
}

export interface GeneratePresentationSlideImagesResult {
  model: string;
  slides: GeneratedPresentationSlideImage[];
}

export async function generateAgentPlannerDraft(
  input: GenerateAgentPlannerDraftInput,
): Promise<GenerateAgentPlannerDraftResult> {
  const ai = getGeminiClient();
  const model = resolveTextModel();

  const prompt = [
    "Build an execution plan for an AI companion task.",
    "Return JSON only with this exact schema:",
    "{",
    '  "title": string,',
    '  "taskKind": "mini_game" | "doc_markdown" | "mixed",',
    '  "riskLevel": "low" | "high",',
    '  "steps": [',
    '    { "key": string, "title": string, "detail": string }',
    "  ]",
    "}",
    "Rules:",
    "- Produce 3-6 steps in chronological order.",
    '- Keys must be short snake_case identifiers (for example: "plan", "build", "qa", "publish").',
    "- Keep details concise and implementation-oriented.",
    "- If uncertain, prefer conservative low-risk build/test workflow without external side effects.",
    "",
    "Task input:",
    `- Prompt: ${input.prompt}`,
    `- Has image input: ${input.hasImage ? "yes" : "no"}`,
    `- Inferred task kind baseline: ${input.inferredTaskKind}`,
    `- Inferred risk baseline: ${input.inferredRiskLevel}`,
  ].join("\n");

  const response = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      systemInstruction:
        "You are a reliable planning engine for a sandboxed AI runtime. Output valid JSON only.",
      temperature: 0.2,
      maxOutputTokens: 600,
      responseMimeType: "application/json",
    },
  });

  const rawJson = stripJsonCodeFence((response.text ?? "").trim());
  if (!rawJson) {
    throw new Error("Gemini returned an empty planner draft");
  }

  return {
    model,
    rawJson,
    responseId: response.responseId,
    usage: compactUsage(response.usageMetadata),
  };
}

export async function generateGameProjectDraft(
  input: GenerateGameProjectDraftInput,
): Promise<GenerateGameProjectDraftResult> {
  const ai = getGeminiClient();
  const model = resolveAgentGameModel();
  const prompt = buildGenerateGameProjectPrompt(input);

  const response = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      systemInstruction:
        "You are a deterministic code generator for sandboxed browser mini-games. Output strict JSON only.",
      temperature: 0.35,
      maxOutputTokens: 6400,
      responseMimeType: "application/json",
    },
  });

  const rawJson = stripJsonCodeFence((response.text ?? "").trim());
  if (!rawJson) {
    throw new Error("Gemini returned an empty game project draft");
  }

  const draft = parseGameProjectDraft(rawJson, {
    allowLight3d: input.allowLight3d,
  });

  return {
    model,
    draft,
    rawJson,
    responseId: response.responseId,
    usage: compactUsage(response.usageMetadata),
  };
}

export async function generateGameProjectDraftViaGeminiCli(
  input: GenerateGameProjectDraftInput,
): Promise<GenerateGameProjectDraftResult> {
  const model = resolveAgentGameModel();
  const prompt = buildGenerateGameProjectPrompt(input);
  const rawOutput = await runGeminiCliJsonPrompt({
    prompt,
    model,
  });

  const rawJson = stripJsonCodeFence(rawOutput);
  if (!rawJson) {
    throw new Error("Gemini CLI returned an empty game project draft");
  }

  const draft = parseGameProjectDraft(rawJson, {
    allowLight3d: input.allowLight3d,
  });

  return {
    model: `${model}:gemini_cli`,
    draft,
    rawJson,
  };
}

export async function repairGameProjectDraft(
  input: RepairGameProjectDraftInput,
): Promise<GenerateGameProjectDraftResult> {
  const ai = getGeminiClient();
  const model = resolveAgentGameModel();
  const prompt = buildRepairGameProjectPrompt(input);

  const response = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      systemInstruction:
        "You repair browser game projects for a sandboxed runtime. Output strict JSON only.",
      temperature: 0.2,
      maxOutputTokens: 7000,
      responseMimeType: "application/json",
    },
  });

  const rawJson = stripJsonCodeFence((response.text ?? "").trim());
  if (!rawJson) {
    throw new Error("Gemini returned an empty repaired game project draft");
  }

  const draft = parseGameProjectDraft(rawJson, {
    allowLight3d: input.allowLight3d,
  });

  return {
    model,
    draft,
    rawJson,
    responseId: response.responseId,
    usage: compactUsage(response.usageMetadata),
  };
}

export async function repairGameProjectDraftViaGeminiCli(
  input: RepairGameProjectDraftInput,
): Promise<GenerateGameProjectDraftResult> {
  const model = resolveAgentGameModel();
  const prompt = buildRepairGameProjectPrompt(input);
  const rawOutput = await runGeminiCliJsonPrompt({
    prompt,
    model,
  });

  const rawJson = stripJsonCodeFence(rawOutput);
  if (!rawJson) {
    throw new Error("Gemini CLI returned an empty repaired game project draft");
  }

  const draft = parseGameProjectDraft(rawJson, {
    allowLight3d: input.allowLight3d,
  });

  return {
    model: `${model}:gemini_cli`,
    draft,
    rawJson,
  };
}

export async function generateDocDraft(
  input: GenerateDocDraftInput,
): Promise<GenerateDocDraftResult> {
  const ai = getGeminiClient();
  const model = resolveAgentDocModel();
  const prompt = buildGenerateDocDraftPrompt(input);

  const response = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      systemInstruction:
        "You are a deterministic document generator for a sandboxed AI runtime. Output strict JSON only.",
      temperature: 0.35,
      maxOutputTokens: 4800,
      responseMimeType: "application/json",
    },
  });

  const rawJson = stripJsonCodeFence((response.text ?? "").trim());
  if (!rawJson) {
    throw new Error("Gemini returned an empty doc draft");
  }

  const draft = parseDocDraft(rawJson);

  return {
    model,
    draft,
    rawJson,
    responseId: response.responseId,
    usage: compactUsage(response.usageMetadata),
  };
}

export async function generateDocDraftViaGeminiCli(
  input: GenerateDocDraftInput,
): Promise<GenerateDocDraftResult> {
  const model = resolveAgentDocModel();
  const prompt = buildGenerateDocDraftPrompt(input);
  const rawOutput = await runGeminiCliJsonPrompt({
    prompt,
    model,
  });
  const rawJson = stripJsonCodeFence(rawOutput);
  if (!rawJson) {
    throw new Error("Gemini CLI returned an empty doc draft");
  }
  const draft = parseDocDraft(rawJson);
  return {
    model: `${model}:gemini_cli`,
    draft,
    rawJson,
  };
}

export async function repairDocDraft(
  input: RepairDocDraftInput,
): Promise<GenerateDocDraftResult> {
  const ai = getGeminiClient();
  const model = resolveAgentDocModel();
  const prompt = buildRepairDocDraftPrompt(input);

  const response = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      systemInstruction:
        "You repair markdown documents for a sandboxed AI runtime. Output strict JSON only.",
      temperature: 0.2,
      maxOutputTokens: 5200,
      responseMimeType: "application/json",
    },
  });

  const rawJson = stripJsonCodeFence((response.text ?? "").trim());
  if (!rawJson) {
    throw new Error("Gemini returned an empty repaired doc draft");
  }

  const draft = parseDocDraft(rawJson);

  return {
    model,
    draft,
    rawJson,
    responseId: response.responseId,
    usage: compactUsage(response.usageMetadata),
  };
}

export async function repairDocDraftViaGeminiCli(
  input: RepairDocDraftInput,
): Promise<GenerateDocDraftResult> {
  const model = resolveAgentDocModel();
  const prompt = buildRepairDocDraftPrompt(input);
  const rawOutput = await runGeminiCliJsonPrompt({
    prompt,
    model,
  });

  const rawJson = stripJsonCodeFence(rawOutput);
  if (!rawJson) {
    throw new Error("Gemini CLI returned an empty repaired doc draft");
  }
  const draft = parseDocDraft(rawJson);
  return {
    model: `${model}:gemini_cli`,
    draft,
    rawJson,
  };
}

export async function generatePresentationSlideImages(
  input: GeneratePresentationSlideImagesInput,
): Promise<GeneratePresentationSlideImagesResult> {
  const ai = getGeminiClient();
  const model = resolveAgentPresentationImageModel();
  const prompts = input.slidePrompts
    .map((prompt) => prompt.trim())
    .filter((prompt) => prompt.length > 0)
    .slice(0, 5);

  if (prompts.length === 0) {
    throw new Error("No slide prompts provided");
  }

  const slides: GeneratedPresentationSlideImage[] = [];
  for (let index = 0; index < prompts.length; index += 1) {
    const prompt = prompts[index];
    const imagePrompt = [
      "Create a polished single presentation slide image (16:9).",
      "The slide should be complete with professional layout, headings, and clean visual hierarchy.",
      "Include readable text and include a chart/diagram only when relevant to the prompt.",
      "Avoid watermarks, logos, and tiny unreadable text.",
      `Deck context: ${input.title}`,
      `Slide ${index + 1} brief: ${prompt}`,
    ].join("\n");

    const response = await ai.models.generateImages({
      model,
      prompt: imagePrompt,
      config: {
        numberOfImages: 1,
        aspectRatio: "16:9",
        outputMimeType: "image/png",
      },
    });

    const generated = response.generatedImages?.[0]?.image as
      | { imageBytes?: string | Uint8Array; mimeType?: string }
      | undefined;
    const rawBytes = generated?.imageBytes;
    const imageBase64 =
      typeof rawBytes === "string"
        ? rawBytes.trim()
        : rawBytes instanceof Uint8Array
          ? Buffer.from(rawBytes).toString("base64")
          : "";
    if (!imageBase64) {
      throw new Error(`Slide ${index + 1} image generation returned empty output`);
    }

    slides.push({
      index: index + 1,
      prompt,
      mimeType: generated?.mimeType?.trim() || "image/png",
      imageBase64,
    });
  }

  return {
    model,
    slides,
  };
}

function buildGenerateGameProjectPrompt(
  input: GenerateGameProjectDraftInput,
): string {
  const imageHints = input.imageHints.length
    ? input.imageHints.map((hint) => `- ${hint}`).join("\n")
    : "- none";

  return [
    "Generate a runnable browser mini-game project.",
    "Return JSON only, with this exact schema:",
    "{",
    '  "title": string,',
    '  "summary": string,',
    '  "format": "single_file" | "multi_file",',
    '  "engine": "canvas_dom" | "threejs_light",',
    '  "mechanics": string[],',
    '  "entryPath": string,',
    '  "files": [{ "path": string, "content": string }]',
    "}",
    "",
    "Hard rules:",
    "- Files must be self-contained and browser-runnable with no build step.",
    "- Do not use external CDNs, network fetches, or remote assets.",
    "- Keep game mechanics clear and playable with keyboard/mouse/touch input.",
    "- If the prompt explicitly requests a named genre (for example: snake), implement that genre's core mechanics and controls. Do not substitute with a different style of game.",
    "- Ensure the entry file is HTML and references only files included in files[].",
    "- Avoid dynamic imports and runtime bundlers.",
    "- Keep total generated source concise (target <= 80KB total file content).",
    "",
    "Task request:",
    `- Prompt: ${input.prompt}`,
    `- Preferred format: ${input.preferredFormat}`,
    `- Light 3D allowed: ${input.allowLight3d ? "yes" : "no"}`,
    "- Image hints:",
    imageHints,
  ].join("\n");
}

function buildRepairGameProjectPrompt(input: RepairGameProjectDraftInput): string {
  const imageHints = input.imageHints.length
    ? input.imageHints.map((hint) => `- ${hint}`).join("\n")
    : "- none";
  const qaFailures = input.qaFailures.length
    ? input.qaFailures.map((failure) => `- ${failure}`).join("\n")
    : "- unknown";

  return [
    "Repair the provided game project draft to pass QA.",
    "Return strict JSON with the exact schema previously defined.",
    "",
    `Attempt: ${input.attempt}`,
    `Preferred format: ${input.preferredFormat}`,
    `Light 3D allowed: ${input.allowLight3d ? "yes" : "no"}`,
    "",
    "Original user prompt:",
    input.prompt,
    "",
    "Image hints:",
    imageHints,
    "",
    "QA failures to fix:",
    qaFailures,
    "",
    "Current project draft JSON:",
    JSON.stringify(input.previousDraft),
    "",
    "Hard rules:",
    "- Preserve core intent and fun mechanics.",
    "- If the prompt explicitly requests a named genre (for example: snake), keep that exact genre and repair mechanics to match it.",
    "- Keep output browser-runnable with no build step.",
    "- Do not rely on external network assets or CDNs.",
    "- Keep entryPath present in files[] and valid.",
  ].join("\n");
}

function buildGenerateDocDraftPrompt(input: GenerateDocDraftInput): string {
  const imageHints = input.imageHints.length
    ? input.imageHints.map((hint) => `- ${hint}`).join("\n")
    : "- none";
  return [
    "Generate a polished markdown document for a personal AI companion workflow.",
    "Return strict JSON only with this exact schema:",
    "{",
    '  "title": string,',
    '  "summary": string,',
    '  "format": "document" | "presentation",',
    '  "sections": string[],',
    '  "markdown": string',
    "}",
    "",
    "Hard rules:",
    "- markdown must begin with a top-level heading (# ...).",
    "- markdown must include section headings (## ...).",
    "- markdown must include formatting richness: use bold/italics and bullet or numbered lists where appropriate.",
    "- Keep content practical, concrete, and immediately usable.",
    "- Use concise structure with clear sections and bullet lists when helpful.",
    "- If the user asks for slides/presentation, use format='presentation' and produce 3-5 slide-style sections (for example: ## Slide 1: ...).",
    "- Do not include HTML in markdown output.",
    "",
    "Task request:",
    `- Prompt: ${input.prompt}`,
    "- Image hints:",
    imageHints,
  ].join("\n");
}

function buildRepairDocDraftPrompt(input: RepairDocDraftInput): string {
  const imageHints = input.imageHints.length
    ? input.imageHints.map((hint) => `- ${hint}`).join("\n")
    : "- none";
  const qaFailures = input.qaFailures.length
    ? input.qaFailures.map((failure) => `- ${failure}`).join("\n")
    : "- unknown";
  return [
    "Repair the provided markdown document draft to satisfy QA.",
    "Return strict JSON using the exact schema defined previously.",
    "",
    `Attempt: ${input.attempt}`,
    "",
    "Original user prompt:",
    input.prompt,
    "",
    "Image hints:",
    imageHints,
    "",
    "QA failures to fix:",
    qaFailures,
    "",
    "Current doc draft JSON:",
    JSON.stringify(input.previousDraft),
    "",
    "Hard rules:",
    "- markdown must start with a top-level heading.",
    "- markdown must include section headings (## ...).",
    "- markdown must include formatting richness: use bold/italics and bullet or numbered lists.",
    "- If format='presentation', keep 3-5 slide sections and do not exceed 5.",
    "- Ensure actionable content and non-trivial depth (not empty template stubs).",
    "- Keep formatting valid markdown with no HTML tags.",
  ].join("\n");
}

async function runGeminiCliJsonPrompt(params: {
  prompt: string;
  model: string;
}): Promise<string> {
  const cli = resolveGeminiCliCommand();
  const timeoutMs = resolveGeminiCliTimeoutMs();

  const result = await execFileAsync(cli.command, [
    ...cli.baseArgs,
    "--model",
    params.model,
    "--prompt",
    params.prompt,
  ], {
    timeout: timeoutMs,
    maxBuffer: 2 * 1024 * 1024,
    env: {
      ...process.env,
      GEMINI_API_KEY: requireGeminiApiKey(),
    },
  });

  const stdout = result.stdout?.toString().trim() ?? "";
  if (!stdout) {
    throw new Error("Gemini CLI returned empty output");
  }
  return extractLikelyJsonPayload(stdout);
}

function resolveGeminiCliCommand(): { command: string; baseArgs: string[] } {
  const raw = (process.env.AGENT_GEMINI_CLI_COMMAND ?? "gemini")
    .trim()
    .replace(/\s+/g, " ");
  if (!raw) {
    throw new Error("AGENT_GEMINI_CLI_COMMAND is empty");
  }
  const [command, ...baseArgs] = raw.split(" ").filter(Boolean);
  return { command, baseArgs };
}

function resolveGeminiCliTimeoutMs(): number {
  const fallback = 75_000;
  const parsed = Number.parseInt(
    process.env.AGENT_GEMINI_CLI_TIMEOUT_MS ?? `${fallback}`,
    10,
  );
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, 5_000), 180_000);
}

function extractLikelyJsonPayload(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1).trim();
  }

  return trimmed;
}

function buildTextGenerationConfig(personaPrompt: string) {
  return {
    systemInstruction: personaPrompt,
    temperature: parseBoundedNumber(process.env.GEMINI_TEXT_TEMPERATURE, 0.85, 0, 2),
    topP: parseBoundedNumber(process.env.GEMINI_TEXT_TOP_P, 0.95, 0, 1),
    maxOutputTokens: parsePositiveInt(
      process.env.GEMINI_TEXT_MAX_OUTPUT_TOKENS,
      1024,
    ),
  };
}

export async function generateTextReply(
  input: GenerateTextReplyInput,
): Promise<GenerateTextReplyResult> {
  const ai = getGeminiClient();
  const model = resolveTextModel();
  const enableMultipart =
    input.enableMultipart ??
    parseBooleanFlag(process.env.ENABLE_MULTIPART_TEXT, true);
  const personaPrompt = await getTextPersonaPrompt({
    persona: input.persona,
    profileContext: input.profileContext,
    memoryContextBlock: input.memoryContextBlock,
    memoryPolicy: input.memoryPolicy,
    enableMultipart,
  });
  const contents = buildConversationContents(input.messages);

  if (contents.length === 0) {
    throw new Error("Conversation is empty. No content to generate a reply from.");
  }

  const response = await ai.models.generateContent({
    model,
    contents,
    config: buildTextGenerationConfig(personaPrompt),
  });

  const sanitized = sanitizeAssistantReplyText(response.text ?? "");
  const replyText = sanitized.text.trim();
  if (!replyText) {
    throw new Error("Gemini returned an empty response");
  }

  return {
    model,
    replyText,
    responseId: response.responseId,
    usage: compactUsage(response.usageMetadata),
  };
}

function stripJsonCodeFence(input: string): string {
  const trimmed = input.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }

  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (!fenceMatch) {
    return trimmed;
  }

  return fenceMatch[1].trim();
}

function parseGameProjectDraft(
  rawJson: string,
  options: { allowLight3d: boolean },
): GeneratedGameProjectDraft {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Game project JSON parse failed: ${message}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Game project must be a JSON object");
  }

  const record = parsed as Record<string, unknown>;
  const title = coerceRequiredString(record.title, "title", 140);
  const summary = coerceRequiredString(record.summary, "summary", 400);
  const format = coerceGameProjectFormat(record.format);
  const engine = coerceGameProjectEngine(record.engine, options.allowLight3d);
  const mechanics = coerceMechanics(record.mechanics);
  const entryPath = coerceRequiredString(record.entryPath, "entryPath", 180);
  const files = coerceFiles(record.files);

  if (!files.some((file) => file.path === entryPath)) {
    throw new Error("Game project entryPath must match a file path in files[]");
  }
  if (!entryPath.toLowerCase().endsWith(".html")) {
    throw new Error("Game project entryPath must reference an .html file");
  }
  if (format === "single_file" && files.length !== 1) {
    throw new Error("single_file format requires exactly one file");
  }

  return {
    title,
    summary,
    format,
    engine,
    mechanics,
    entryPath,
    files,
  };
}

function parseDocDraft(rawJson: string): GeneratedDocDraft {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Doc draft JSON parse failed: ${message}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Doc draft must be a JSON object");
  }

  const record = parsed as Record<string, unknown>;
  const title = coerceRequiredString(record.title, "title", 160);
  const summary = coerceRequiredString(record.summary, "summary", 500);
  const format = coerceDocOutputFormat(record.format);
  const sections = coerceDocSections(record.sections);
  const markdown = coerceRequiredString(record.markdown, "markdown", 120_000);

  if (!/^#\s+/m.test(markdown)) {
    throw new Error('Doc draft field "markdown" must include a top-level heading');
  }
  if (markdown.trim().length < 120) {
    throw new Error('Doc draft field "markdown" is too short');
  }
  if (!/^##\s+/m.test(markdown)) {
    throw new Error('Doc draft field "markdown" must include section headings');
  }
  const hasRichFormattingSignal =
    /(^[-*]\s+.+$)|(^\d+\.\s+.+$)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)/m.test(markdown);
  if (!hasRichFormattingSignal) {
    throw new Error(
      'Doc draft field "markdown" must include lists or emphasis formatting',
    );
  }
  if (format === "presentation") {
    const slideHeadingCount = (
      markdown.match(/^##\s+(?:Slide\s+\d+[:\s-].*|.+)$/gim) ?? []
    ).length;
    if (slideHeadingCount < 1) {
      throw new Error(
        'Presentation markdown must include "## Slide ..." sections',
      );
    }
    if (slideHeadingCount > 5) {
      throw new Error("Presentation slide count exceeds 5");
    }
  }

  return {
    title,
    summary,
    markdown,
    format,
    sections,
  };
}

function coerceRequiredString(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  if (typeof value !== "string") {
    throw new Error(`Game project field "${field}" must be a string`);
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`Game project field "${field}" cannot be empty`);
  }
  return normalized.slice(0, maxLength);
}

function coerceGameProjectFormat(value: unknown): GameProjectFormat {
  if (value === "single_file" || value === "multi_file") {
    return value;
  }
  throw new Error('Game project field "format" must be "single_file" or "multi_file"');
}

function coerceGameProjectEngine(
  value: unknown,
  allowLight3d: boolean,
): GameProjectEngine {
  if (value === "canvas_dom") {
    return value;
  }
  if (value === "threejs_light") {
    if (!allowLight3d) {
      throw new Error("threejs_light engine is disabled by runtime policy");
    }
    return value;
  }
  throw new Error(
    'Game project field "engine" must be "canvas_dom" or "threejs_light"',
  );
}

function coerceMechanics(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error('Game project field "mechanics" must be an array of strings');
  }
  const mechanics = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 8);
  if (mechanics.length === 0) {
    throw new Error('Game project field "mechanics" must include at least one item');
  }
  return mechanics;
}

function coerceDocOutputFormat(value: unknown): DocOutputFormat {
  if (value === "document" || value === "presentation") {
    return value;
  }
  return "document";
}

function coerceDocSections(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 16);
}

function coerceFiles(value: unknown): GeneratedGameProjectFile[] {
  if (!Array.isArray(value)) {
    throw new Error('Game project field "files" must be an array');
  }
  const files: GeneratedGameProjectFile[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const path = coerceRequiredString(record.path, "files[].path", 220);
    const content = coerceRequiredString(record.content, "files[].content", 500_000);
    files.push({ path, content });
  }

  if (files.length === 0) {
    throw new Error('Game project field "files" must include at least one file');
  }
  return files;
}

export async function generateTextReplyStream(
  input: GenerateTextReplyInput,
): Promise<GenerateTextReplyStreamResult> {
  const ai = getGeminiClient();
  const model = resolveTextModel();
  const enableMultipart =
    input.enableMultipart ??
    parseBooleanFlag(process.env.ENABLE_MULTIPART_TEXT, true);
  const personaPrompt = await getTextPersonaPrompt({
    persona: input.persona,
    profileContext: input.profileContext,
    memoryContextBlock: input.memoryContextBlock,
    memoryPolicy: input.memoryPolicy,
    enableMultipart,
  });
  const contents = buildConversationContents(input.messages);

  if (contents.length === 0) {
    throw new Error("Conversation is empty. No content to generate a reply from.");
  }

  const responseStream = await ai.models.generateContentStream({
    model,
    contents,
    config: buildTextGenerationConfig(personaPrompt),
  });

  async function* streamChunks(): AsyncGenerator<GenerateTextReplyStreamChunk> {
    let rawText = "";
    let emittedLength = 0;

    for await (const chunk of responseStream) {
      rawText += chunk.text ?? "";

      const sanitized = sanitizeAssistantReplyText(rawText);
      const stableText = sanitized.awaitingToolPrefix ? "" : sanitized.text;
      let textDelta = "";

      if (stableText.length >= emittedLength) {
        textDelta = stableText.slice(emittedLength);
        emittedLength = stableText.length;
      } else {
        emittedLength = stableText.length;
      }

      yield {
        textDelta,
        responseId: chunk.responseId,
        usage: compactUsage(chunk.usageMetadata),
      };
    }
  }

  return {
    model,
    stream: streamChunks(),
  };
}

export interface SummarizeImageForMemoryInput {
  persona: Persona;
  mimeType: string;
  inlineDataBase64: string;
  userText?: string;
}

export async function summarizeImageForMemory(
  input: SummarizeImageForMemoryInput,
): Promise<string> {
  const ai = getGeminiClient();
  const model = resolveTextModel();

  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              "Summarize this image for long-term conversation memory in 1-2 concise sentences. Focus on visual facts and likely user intent. Avoid style flourishes. " +
              (input.userText
                ? `Related user text: ${input.userText}`
                : "No related user text provided."),
          },
          {
            inlineData: {
              mimeType: input.mimeType,
              data: input.inlineDataBase64,
            },
          },
        ],
      },
    ],
    config: {
      temperature: 0.2,
      maxOutputTokens: 140,
    },
  });

  const summary = response.text?.trim();
  if (!summary) {
    throw new Error("Gemini returned an empty image summary");
  }

  return summary.slice(0, 500);
}
