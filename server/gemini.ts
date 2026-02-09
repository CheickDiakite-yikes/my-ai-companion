import {
  ActivityHandling,
  EndSensitivity,
  GoogleGenAI,
  Modality,
  StartSensitivity,
  type GenerateContentResponseUsageMetadata,
} from "@google/genai";
import { readFile } from "fs/promises";
import { resolve } from "path";

type Persona = "Zee";
export type LiveVoiceName = "Aoede" | "Kore" | "Charon" | "Fenrir";

export const DEFAULT_PERSONA: Persona = "Zee";
export const LIVE_VOICE_NAMES: readonly LiveVoiceName[] = [
  "Aoede",
  "Kore",
  "Charon",
  "Fenrir",
] as const;
export const DEFAULT_LIVE_VOICE: LiveVoiceName = "Aoede";

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

async function loadZeePrompt(): Promise<string> {
  if (zeePromptCache) return zeePromptCache;
  const filePath = resolve(process.cwd(), "zee-persona.md");

  try {
    const rawPrompt = await readFile(filePath, "utf8");
    const cleanedPrompt = rawPrompt
      .replace(/^\$\{chainOfThoughtInstructions\}\s*$/gm, "")
      .replace(/^\$\{outputFormatInstructions\}\s*$/gm, "")
      .trim();

    zeePromptCache =
      cleanedPrompt.length > 0 ? cleanedPrompt : DEFAULT_ZEE_PROMPT_FALLBACK;
  } catch (error) {
    zeePromptCache = DEFAULT_ZEE_PROMPT_FALLBACK;
    if (!promptFallbackWarningLogged) {
      promptFallbackWarningLogged = true;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[gemini] Failed to load zee-persona.md; using fallback prompt. reason=${message}`,
      );
    }
  }

  return zeePromptCache;
}

export async function getPersonaPrompt(persona: Persona): Promise<string> {
  const basePrompt = await loadZeePrompt();

  return `${basePrompt}

OUTPUT SAFETY RULES:
- Return only user-facing assistant text.
- Never output JSON objects for tools or function calls.
- Never include internal fields like action, action_input, thought, tool, function_call, or arguments.`;
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

export interface CreateLiveTokenInput {
  persona: Persona;
  responseModality?: "AUDIO" | "TEXT";
  voiceName?: LiveVoiceName;
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
}

export async function createLiveToken(
  input: CreateLiveTokenInput,
): Promise<CreateLiveTokenResult> {
  const ai = getGeminiAlphaClient();
  const modelCandidates = resolveLiveModelCandidates();
  const personaPrompt = await getPersonaPrompt(input.persona);
  const responseModality = input.responseModality ?? "AUDIO";
  const voiceName = input.voiceName ?? DEFAULT_LIVE_VOICE;

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
              systemInstruction: personaPrompt,
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
                activityHandling: ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
                automaticActivityDetection: {
                  startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_HIGH,
                  endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_LOW,
                  prefixPaddingMs: parsePositiveInt(
                    process.env.GEMINI_LIVE_VAD_PREFIX_PADDING_MS,
                    120,
                  ),
                  silenceDurationMs: parsePositiveInt(
                    process.env.GEMINI_LIVE_VAD_SILENCE_MS,
                    650,
                  ),
                },
              },
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
  };
}

export interface GenerateTextReplyInput {
  persona: Persona;
  messages: ConversationMessage[];
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
  const personaPrompt = await getPersonaPrompt(input.persona);
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

export async function generateTextReplyStream(
  input: GenerateTextReplyInput,
): Promise<GenerateTextReplyStreamResult> {
  const ai = getGeminiClient();
  const model = resolveTextModel();
  const personaPrompt = await getPersonaPrompt(input.persona);
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
