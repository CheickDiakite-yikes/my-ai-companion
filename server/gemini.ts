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

type Persona = "Maya" | "Zarra" | "Ore";

interface ConversationMessage {
  sender: string;
  text: string;
}

interface TokenUsageSnapshot {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

const DEFAULT_TEXT_MODEL = "gemini-3-flash-preview";
const DEFAULT_LIVE_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025";

const FALLBACK_PERSONA_PROMPTS: Record<Exclude<Persona, "Maya">, string> = {
  Zarra:
    "You are Zarra, a confident and caring companion. Stay warm, direct, practical, and human.",
  Ore:
    "You are Ore, a thoughtful and grounded companion. Be supportive, curious, and concise.",
};

let geminiClient: GoogleGenAI | null = null;
let geminiAlphaClient: GoogleGenAI | null = null;
let mayaPromptCache: string | null = null;

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

async function loadMayaPrompt(): Promise<string> {
  if (mayaPromptCache) return mayaPromptCache;
  const filePath = resolve(process.cwd(), "maya-persona.md");
  mayaPromptCache = await readFile(filePath, "utf8");
  return mayaPromptCache;
}

export async function getPersonaPrompt(persona: Persona): Promise<string> {
  if (persona === "Maya") {
    return loadMayaPrompt();
  }
  return FALLBACK_PERSONA_PROMPTS[persona];
}

function toGeminiRole(sender: string): "user" | "model" {
  return sender === "user" ? "user" : "model";
}

function buildConversationContents(messages: ConversationMessage[]) {
  const recentWindow = parsePositiveInt(
    process.env.GEMINI_TEXT_MEMORY_WINDOW_MESSAGES,
    40,
  );
  const clipped = messages
    .filter((msg) => msg.text && msg.text.trim().length > 0)
    .slice(-recentWindow);

  return clipped.map((msg) => ({
    role: toGeminiRole(msg.sender),
    parts: [{ text: msg.text }],
  }));
}

export interface CreateLiveTokenInput {
  persona: Persona;
  responseModality?: "AUDIO" | "TEXT";
}

export interface CreateLiveTokenResult {
  tokenName: string;
  model: string;
  responseModality: "AUDIO" | "TEXT";
  expireTime: string;
  newSessionExpireTime: string;
  generatedAt: string;
  uses: number;
}

export async function createLiveToken(
  input: CreateLiveTokenInput,
): Promise<CreateLiveTokenResult> {
  const ai = getGeminiAlphaClient();
  const model = resolveLiveModel();
  const personaPrompt = await getPersonaPrompt(input.persona);
  const responseModality = input.responseModality ?? "AUDIO";

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

  const token = await ai.authTokens.create({
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
      lockAdditionalFields: [
        "responseModalities",
        "systemInstruction",
        "realtimeInputConfig",
        "inputAudioTranscription",
        "outputAudioTranscription",
      ],
    },
  });

  if (!token.name) {
    throw new Error("Gemini did not return an ephemeral token name");
  }

  return {
    tokenName: token.name,
    model,
    responseModality,
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
    config: {
      systemInstruction: personaPrompt,
      temperature: parseBoundedNumber(
        process.env.GEMINI_TEXT_TEMPERATURE,
        0.85,
        0,
        2,
      ),
      topP: parseBoundedNumber(process.env.GEMINI_TEXT_TOP_P, 0.95, 0, 1),
      maxOutputTokens: parsePositiveInt(
        process.env.GEMINI_TEXT_MAX_OUTPUT_TOKENS,
        1024,
      ),
    },
  });

  const replyText = response.text?.trim();
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

