import { GoogleGenAI, Modality, type LiveServerMessage, type Session } from "@google/genai";

type TranscriptSender = "user" | "assistant";
type CameraFacingMode = "user" | "environment";
type LiveTranscriptionPayload = {
  text?: string;
  finished?: boolean;
};

export interface LiveTranscriptEvent {
  sender: TranscriptSender;
  text: string;
}

export type LiveWebSearchStatus = "searching" | "grounded" | "idle";

export interface GeminiLiveVoiceSessionCallbacks {
  onTranscript?: (event: LiveTranscriptEvent) => void;
  onWebSearch?: (event: { status: LiveWebSearchStatus; label?: string }) => void;
  onMorningBriefDigest?: (event: { text: string }) => void;
  onError?: (error: Error) => void;
  onClosed?: (reason?: string) => void;
  onDebug?: (message: string, metadata?: Record<string, unknown>) => void;
}

export interface GeminiLiveVoiceSessionStartParams {
  ephemeralToken: string;
  model: string;
  conversationId: string;
  preAcquiredMicStream?: MediaStream;
  googleSearchGroundingEnabled?: boolean;
  morningBriefFunctionCallingEnabled?: boolean;
  googlePersonalContextFunctionCallingEnabled?: boolean;
}

const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;
const VIDEO_FRAME_INTERVAL_MS = 1000;
const VIDEO_MAX_EDGE = 640;
const VIDEO_PERMISSION_TIMEOUT_MS = 12000;
const TRANSCRIPT_DUPLICATE_WINDOW_MS = 1500;
const TRANSCRIPT_FLUSH_DEBOUNCE_MS = 900;
const TRANSCRIPT_OVERLAP_MIN_CHARS = 6;

function parseClientPositiveInt(
  value: unknown,
  fallback: number,
): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value !== "string") return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseClientBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function parseClientBoundedNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(Math.max(value, min), max);
  }
  if (typeof value !== "string") return fallback;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

type LiveAudioCompatibilityProfile = {
  isAndroid: boolean;
  androidMajor: number | null;
  isLegacyAndroid: boolean;
  microphonePermissionTimeoutMs: number;
  connectionTimeoutMs: number;
};

type MicCaptureAttemptFailure = {
  attempt: number;
  label: string;
  errorName: string | null;
  errorMessage: string;
};

function resolveAndroidMajorVersion(userAgent: string): number | null {
  const match = userAgent.match(/Android\s+(\d+)/i);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveLiveAudioCompatibilityProfile(): LiveAudioCompatibilityProfile {
  const userAgent =
    typeof navigator !== "undefined" && typeof navigator.userAgent === "string"
      ? navigator.userAgent
      : "";
  const isAndroid = /android/i.test(userAgent);
  const androidMajor = isAndroid ? resolveAndroidMajorVersion(userAgent) : null;
  const isLegacyAndroid =
    isAndroid && typeof androidMajor === "number" && androidMajor <= 10;
  const microphonePermissionTimeoutMs = parseClientPositiveInt(
    liveClientEnv.VITE_LIVE_MICROPHONE_PERMISSION_TIMEOUT_MS,
    isLegacyAndroid ? 25000 : isAndroid ? 18000 : 12000,
  );
  const connectionTimeoutMs = parseClientPositiveInt(
    liveClientEnv.VITE_LIVE_CONNECTION_TIMEOUT_MS,
    isLegacyAndroid ? 30000 : isAndroid ? 22000 : 15000,
  );
  return {
    isAndroid,
    androidMajor,
    isLegacyAndroid,
    microphonePermissionTimeoutMs,
    connectionTimeoutMs,
  };
}

const liveClientEnv = (import.meta.env as Record<string, unknown>) ?? {};
const PROCESSOR_BUFFER_SIZE = (() => {
  const parsed = parseClientPositiveInt(
    liveClientEnv.VITE_LIVE_AUDIO_PROCESSOR_BUFFER_SIZE,
    512,
  );
  return [256, 512, 1024, 2048, 4096].includes(parsed) ? parsed : 512;
})();
const ENABLE_AUDIO_NOISE_GATE = parseClientBoolean(
  liveClientEnv.VITE_LIVE_AUDIO_NOISE_GATE_ENABLED,
  false,
);
const AUDIO_NOISE_GATE_RMS_THRESHOLD = parseClientBoundedNumber(
  liveClientEnv.VITE_LIVE_AUDIO_NOISE_GATE_RMS_THRESHOLD,
  0.006,
  0.001,
  0.08,
);
const AUDIO_NOISE_GATE_HANGOVER_FRAMES = parseClientPositiveInt(
  liveClientEnv.VITE_LIVE_AUDIO_NOISE_GATE_HANGOVER_FRAMES,
  3,
);
const ENABLE_AUDIO_NOISE_GATE_FAIL_OPEN = parseClientBoolean(
  liveClientEnv.VITE_LIVE_AUDIO_NOISE_GATE_FAILOPEN_ENABLED,
  false,
);
const AUDIO_NOISE_GATE_FAILOPEN_AFTER_DROPS = parseClientPositiveInt(
  liveClientEnv.VITE_LIVE_AUDIO_NOISE_GATE_FAILOPEN_AFTER_DROPS,
  120,
);
const AUDIO_NOISE_GATE_FAILOPEN_FRAMES = parseClientPositiveInt(
  liveClientEnv.VITE_LIVE_AUDIO_NOISE_GATE_FAILOPEN_FRAMES,
  60,
);
const AUDIO_NOISE_GATE_ASSISTANT_SPEECH_MULTIPLIER = parseClientBoundedNumber(
  liveClientEnv.VITE_LIVE_AUDIO_NOISE_GATE_ASSISTANT_SPEECH_MULTIPLIER,
  1.45,
  1,
  3,
);
const SUPPRESS_INPUT_WHILE_ASSISTANT_SPEAKING = parseClientBoolean(
  liveClientEnv.VITE_LIVE_AUDIO_SUPPRESS_INPUT_WHILE_ASSISTANT_SPEAKING,
  true,
);
const SUPPRESS_INPUT_COOLDOWN_MS = parseClientPositiveInt(
  liveClientEnv.VITE_LIVE_AUDIO_SUPPRESS_INPUT_COOLDOWN_MS,
  240,
);
const ASSISTANT_TURN_RELEASE_GRACE_MS = parseClientPositiveInt(
  liveClientEnv.VITE_LIVE_ASSISTANT_TURN_RELEASE_GRACE_MS,
  Math.max(360, SUPPRESS_INPUT_COOLDOWN_MS + 140),
);
const SUPPRESS_USER_TRANSCRIPT_DURING_ASSISTANT_SPEECH = parseClientBoolean(
  liveClientEnv.VITE_LIVE_AUDIO_SUPPRESS_USER_TRANSCRIPT_DURING_ASSISTANT_SPEECH,
  true,
);
const LIVE_WEB_SEARCH_SIGNAL_PATTERN =
  /\b(search|look up|google|latest|current|today|news|headline|what happened|updates?|did you see|last super bowl|super\s*bowl|score|standings?|who won)\b/i;
const LIVE_EMAIL_SIGNAL_PATTERN = /\b(email|emails|inbox|unread|mail|gmail)\b/i;
const LIVE_CALENDAR_SIGNAL_PATTERN =
  /\b(calendar|meeting|meetings|schedule|event|events|appointment|appointments)\b/i;
const LIVE_CALENDAR_FOLLOWUP_TIME_PATTERN =
  /\b(tomorrow|tomor+ow|tomore|tmrw|rest\s+of\s+the\s+week|later\s+this\s+week|this\s+week|next\s+week|next\s+7\s+days|next\s+few\s+days|weekend)\b/i;
const LIVE_CALENDAR_FOLLOWUP_REQUEST_PATTERN =
  /\b(how\s+about|what\s+about|check(\s+again)?|look(\s+again)?|can\s+you\s+check|what\s+do\s+i\s+have|do\s+i\s+have|am\s+i\s+free|anything\s+on)\b/i;
const ENABLE_MORNING_BRIEF_VOICE_MODE = parseClientBoolean(
  liveClientEnv.VITE_ENABLE_MORNING_BRIEF_VOICE_MODE,
  false,
);
const ENABLE_GOOGLE_PERSONAL_CONTEXT_VOICE_MODE = parseClientBoolean(
  liveClientEnv.VITE_ENABLE_GOOGLE_PERSONAL_CONTEXT_VOICE,
  false,
);

const LIVE_MORNING_BRIEF_FUNCTION_DECLARATIONS = [
  {
    name: "get_morning_brief",
    description:
      "Retrieve a grounded morning briefing with top headlines and markets, optionally including inbox highlights.",
    parameters: {
      type: "object",
      properties: {
        includeInbox: { type: "boolean" },
        refresh: { type: "boolean" },
        timezone: { type: "string" },
      },
    },
  },
  {
    name: "get_inbox_digest",
    description: "Retrieve a concise read-only inbox digest for the current user.",
    parameters: {
      type: "object",
      properties: {
        refresh: { type: "boolean" },
        maxThreads: { type: "integer" },
      },
    },
  },
];

const LIVE_GOOGLE_PERSONAL_CONTEXT_FUNCTION_DECLARATIONS = [
  {
    name: "get_user_emails",
    description:
      "Retrieve the user's recent Gmail inbox messages. Only works if user has connected their Google account.",
    parameters: {
      type: "object",
      properties: {
        maxThreads: { type: "integer" },
        sinceDays: { type: "integer" },
        refresh: { type: "boolean" },
      },
    },
  },
  {
    name: "get_calendar_events",
    description:
      "Retrieve the user's upcoming Google Calendar events for a specific time range. Only works if user has connected their Google account.",
    parameters: {
      type: "object",
      properties: {
        timeRange: {
          type: "string",
          enum: ["today", "tomorrow", "this_week", "next_7_days"],
        },
        timezone: { type: "string" },
        maxEvents: { type: "integer" },
        refresh: { type: "boolean" },
      },
      required: ["timeRange", "timezone"],
    },
  },
];

function normalizeText(input: string | undefined): string {
  return (input ?? "").replace(/\s+/g, " ").trim();
}

function isLikelyLiveWebSearchQuery(text: string): boolean {
  return LIVE_WEB_SEARCH_SIGNAL_PATTERN.test(text);
}

type LivePersonalContextIntent = "email" | "calendar" | "both";
type CalendarNudgeTimeRange = "today" | "tomorrow" | "this_week" | "next_7_days";

function classifyLivePersonalContextIntent(
  text: string,
): LivePersonalContextIntent | null {
  const hasEmailIntent = LIVE_EMAIL_SIGNAL_PATTERN.test(text);
  const hasCalendarIntent =
    LIVE_CALENDAR_SIGNAL_PATTERN.test(text) ||
    (LIVE_CALENDAR_FOLLOWUP_TIME_PATTERN.test(text) &&
      LIVE_CALENDAR_FOLLOWUP_REQUEST_PATTERN.test(text));
  if (hasEmailIntent && hasCalendarIntent) return "both";
  if (hasEmailIntent) return "email";
  if (hasCalendarIntent) return "calendar";
  return null;
}

function inferCalendarTimeRangeForNudge(text: string): CalendarNudgeTimeRange {
  const normalized = normalizeText(text).toLowerCase();
  if (
    /\b(tomorrow|tomor+ow|tomore|tmrw)\b/.test(normalized)
  ) {
    return "tomorrow";
  }
  if (
    /\b(next\s+week|next\s+7\s+days|next\s+few\s+days)\b/.test(normalized)
  ) {
    return "next_7_days";
  }
  if (
    /\b(rest\s+of\s+the\s+week|later\s+this\s+week|this\s+week|weekend)\b/.test(
      normalized,
    )
  ) {
    return "this_week";
  }
  return "today";
}

function buildPersonalContextToolInstruction(
  query: string,
  intent: LivePersonalContextIntent,
): string {
  const calendarTimeRange = inferCalendarTimeRangeForNudge(query);
  if (intent === "both") {
    return `Call get_user_emails with {"refresh": true} and get_calendar_events with {"timeRange":"${calendarTimeRange}","timezone":"user_local","refresh": true} before answering.`;
  }
  if (intent === "calendar") {
    return `Call get_calendar_events with {"timeRange":"${calendarTimeRange}","timezone":"user_local","refresh": true} before answering.`;
  }
  return 'Call get_user_emails with {"refresh": true} before answering.';
}

function extractToolCallNames(toolCallPayload: unknown): string[] {
  const functionCalls =
    (
      toolCallPayload as {
        functionCalls?: Array<{ name?: unknown }>;
      }
    )?.functionCalls ?? [];
  if (!Array.isArray(functionCalls) || functionCalls.length === 0) {
    return [];
  }
  return functionCalls
    .map((call) => (typeof call?.name === "string" ? call.name : null))
    .filter((name): name is string => Boolean(name));
}

function findTranscriptOverlap(prefix: string, suffix: string): number {
  const maxOverlap = Math.min(prefix.length, suffix.length);
  for (let overlap = maxOverlap; overlap >= TRANSCRIPT_OVERLAP_MIN_CHARS; overlap -= 1) {
    if (
      prefix.slice(-overlap).toLowerCase() ===
      suffix.slice(0, overlap).toLowerCase()
    ) {
      return overlap;
    }
  }
  return 0;
}

function mergeTranscriptText(previous: string, incoming: string): string {
  const existing = normalizeText(previous);
  const next = normalizeText(incoming);

  if (!existing) return next;
  if (!next) return existing;

  if (existing === next) return existing;
  if (next.startsWith(existing)) return next;
  if (existing.startsWith(next)) return existing;
  if (existing.endsWith(next)) return existing;

  const overlap = findTranscriptOverlap(existing, next);
  const merged =
    overlap > 0
      ? `${existing} ${next.slice(overlap).trimStart()}`
      : `${existing} ${next}`;

  return normalizeText(merged);
}

function calculateRms(input: Float32Array): number {
  if (input.length === 0) return 0;
  let sumSquares = 0;
  for (let index = 0; index < input.length; index += 1) {
    const sample = input[index];
    sumSquares += sample * sample;
  }
  return Math.sqrt(sumSquares / input.length);
}

function downsampleFloat32Buffer(
  input: Float32Array,
  inputSampleRate: number,
  targetSampleRate: number,
): Float32Array {
  if (targetSampleRate >= inputSampleRate) return input;

  const sampleRateRatio = inputSampleRate / targetSampleRate;
  const outputLength = Math.round(input.length / sampleRateRatio);
  const output = new Float32Array(outputLength);

  let outputIndex = 0;
  let inputOffset = 0;

  while (outputIndex < outputLength) {
    const nextInputOffset = Math.round((outputIndex + 1) * sampleRateRatio);
    let accumulator = 0;
    let count = 0;

    for (let i = inputOffset; i < nextInputOffset && i < input.length; i += 1) {
      accumulator += input[i];
      count += 1;
    }

    output[outputIndex] = count > 0 ? accumulator / count : 0;
    outputIndex += 1;
    inputOffset = nextInputOffset;
  }

  return output;
}

function float32ToInt16(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, input[i]));
    output[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return output;
}

function int16ToFloat32(input: Int16Array): Float32Array {
  const output = new Float32Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    output[i] = input[i] / 0x8000;
  }
  return output;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    for (let j = 0; j < chunk.length; j += 1) {
      binary += String.fromCharCode(chunk[j]);
    }
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function pcm16ToBase64(input: Float32Array, inputSampleRate: number): string {
  const mono16k = downsampleFloat32Buffer(input, inputSampleRate, INPUT_SAMPLE_RATE);
  const int16 = float32ToInt16(mono16k);
  const bytes = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength);
  return bytesToBase64(bytes);
}

function base64ToPcm16(base64: string): Int16Array {
  const bytes = base64ToBytes(base64);
  return new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
}

function getAudioContextConstructor(): typeof AudioContext {
  const win = window as Window & {
    webkitAudioContext?: typeof AudioContext;
  };
  const AudioContextCtor =
    (globalThis as { AudioContext?: typeof AudioContext }).AudioContext ??
    win.webkitAudioContext;
  if (!AudioContextCtor) {
    throw new Error("Web Audio API is not supported in this browser");
  }
  return AudioContextCtor;
}

function createAudioContext(options?: AudioContextOptions): AudioContext {
  const AudioContextCtor = getAudioContextConstructor();
  if (!options) {
    return new AudioContextCtor();
  }
  try {
    return new AudioContextCtor(options);
  } catch {
    // Older Android WebView/Chrome builds can reject explicit sample-rate configs.
    return new AudioContextCtor();
  }
}

function chooseVideoSize(video: HTMLVideoElement): { width: number; height: number } {
  const srcWidth = video.videoWidth || 640;
  const srcHeight = video.videoHeight || 360;
  const maxEdge = Math.max(srcWidth, srcHeight);
  if (maxEdge <= VIDEO_MAX_EDGE) {
    return { width: srcWidth, height: srcHeight };
  }

  const scale = VIDEO_MAX_EDGE / maxEdge;
  return {
    width: Math.max(2, Math.round(srcWidth * scale)),
    height: Math.max(2, Math.round(srcHeight * scale)),
  };
}

async function getUserMediaWithTimeout(
  constraints: MediaStreamConstraints,
  timeoutMs = VIDEO_PERMISSION_TIMEOUT_MS,
): Promise<MediaStream> {
  if (!window.isSecureContext) {
    throw new Error("Live voice requires a secure HTTPS connection");
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Media capture API is not available in this browser");
  }

  let timeoutId: number | undefined;
  try {
    return await Promise.race([
      navigator.mediaDevices.getUserMedia(constraints),
      new Promise<MediaStream>((_, reject) => {
        timeoutId = window.setTimeout(() => {
          reject(new Error("Camera permission request timed out"));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
    }
  }
}

async function getMicrophonePermissionState():
  Promise<"granted" | "denied" | "prompt" | "unsupported" | "error"> {
  try {
    if (!navigator.permissions?.query) {
      return "unsupported";
    }
    const status = await navigator.permissions.query({
      name: "microphone" as PermissionName,
    });
    if (
      status.state === "granted" ||
      status.state === "denied" ||
      status.state === "prompt"
    ) {
      return status.state;
    }
    return "unsupported";
  } catch {
    return "error";
  }
}

export async function collectMediaCaptureDebugContext(): Promise<Record<string, unknown>> {
  const permissionState = await getMicrophonePermissionState();
  let audioInputDeviceCount: number | null = null;
  let mediaDeviceCount: number | null = null;
  if (navigator.mediaDevices?.enumerateDevices) {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      mediaDeviceCount = devices.length;
      audioInputDeviceCount = devices.filter(
        (device) => device.kind === "audioinput",
      ).length;
    } catch {
      mediaDeviceCount = null;
      audioInputDeviceCount = null;
    }
  }

  return {
    secureContext: window.isSecureContext,
    pageVisibility: document.visibilityState ?? null,
    locationProtocol: window.location?.protocol ?? null,
    locationHost: window.location?.host ?? null,
    mediaDevicesAvailable: Boolean(navigator.mediaDevices),
    getUserMediaAvailable: Boolean(navigator.mediaDevices?.getUserMedia),
    enumerateDevicesAvailable: Boolean(navigator.mediaDevices?.enumerateDevices),
    microphonePermissionState: permissionState,
    mediaDeviceCount,
    audioInputDeviceCount,
  };
}

export async function getMicrophoneStreamWithFallback(): Promise<MediaStream> {
  const compatibility = resolveLiveAudioCompatibilityProfile();
  const attemptConstraints: Array<{
    label: string;
    constraints: MediaStreamConstraints;
  }> = [
    {
      label: "processed_mono",
      constraints: {
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      },
    },
    {
      label: "mono_only",
      constraints: {
        audio: {
          channelCount: 1,
        },
        video: false,
      },
    },
    {
      label: "basic_audio",
      constraints: {
        audio: true,
        video: false,
      },
    },
  ];

  let lastError: unknown = null;
  const attemptFailures: MicCaptureAttemptFailure[] = [];
  for (let index = 0; index < attemptConstraints.length; index += 1) {
    try {
      return await getUserMediaWithTimeout(
        attemptConstraints[index].constraints,
        compatibility.microphonePermissionTimeoutMs,
      );
    } catch (error) {
      lastError = error;
      attemptFailures.push({
        attempt: index + 1,
        label: attemptConstraints[index].label,
        errorName:
          typeof (error as { name?: unknown })?.name === "string"
            ? ((error as { name: string }).name ?? null)
            : null,
        errorMessage:
          error instanceof Error ? error.message : String(error ?? "unknown"),
      });
    }
  }

  const message =
    lastError instanceof Error
      ? lastError.message
      : "Microphone permission was denied or unavailable";
  const wrapped = new Error(message) as Error & {
    attemptFailures?: MicCaptureAttemptFailure[];
    compatibility?: LiveAudioCompatibilityProfile;
  };
  wrapped.attemptFailures = attemptFailures;
  wrapped.compatibility = compatibility;
  throw wrapped;
}

export class GeminiLiveVoiceSession {
  private readonly callbacks: GeminiLiveVoiceSessionCallbacks;

  private session: Session | null = null;
  private outputContext: AudioContext | null = null;
  private inputContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private mediaSourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private mutedGainNode: GainNode | null = null;

  private videoStream: MediaStream | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private videoCanvas: HTMLCanvasElement | null = null;
  private videoCaptureInterval: number | null = null;
  private videoFrameInFlight = false;
  private preferredFacingMode: CameraFacingMode = "user";

  private scheduledPlaybackTime = 0;
  private activePlaybackNodes = new Set<AudioBufferSourceNode>();
  private playbackNodeEndTimes = new Map<AudioBufferSourceNode, number>();
  private audioContextKeepAliveInterval: number | null = null;
  private audioNoiseGateHangoverFrames = 0;
  private audioNoiseGateConsecutiveDrops = 0;
  private audioNoiseGateFailOpenFramesRemaining = 0;
  private assistantTurnActive = false;
  private assistantPlaybackTailUntilMs = 0;
  private assistantSpeechWindowStartMs = 0;
  private assistantTurnReleaseAtMs = 0;
  private interruptPending = false;
  private conversationId: string | null = null;
  private liveGoogleSearchEnabled = false;
  private liveMorningBriefFunctionCallingEnabled = false;
  private liveGooglePersonalContextFunctionCallingEnabled = false;
  private liveFunctionCallingEnabled = false;
  private pendingWebSearchTurn = false;
  private pendingPersonalContextTurn = false;
  private personalContextToolCalledThisTurn = false;
  private personalContextNudgeSentThisTurn = false;
  private webSearchGroundedThisTurn = false;
  private webSearchNudgeSentThisTurn = false;
  private pendingTranscriptBySender: Record<TranscriptSender, string> = {
    user: "",
    assistant: "",
  };
  private transcriptFlushTimeoutBySender: Record<TranscriptSender, number | null> = {
    user: null,
    assistant: null,
  };
  private lastTranscriptBySender: Record<
    TranscriptSender,
    { text: string; at: number } | null
  > = {
    user: null,
    assistant: null,
  };
  private readonly handleVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      this.ensureAudioContextsRunning();
    }
  };
  private readonly handleWindowFocus = () => {
    this.ensureAudioContextsRunning();
  };

  constructor(callbacks: GeminiLiveVoiceSessionCallbacks = {}) {
    this.callbacks = callbacks;
  }

  async start(params: GeminiLiveVoiceSessionStartParams): Promise<void> {
    if (this.session) {
      throw new Error("Live voice session is already running");
    }

    const reportError = (event: string, data: Record<string, any>) => {
      try {
        fetch("/api/live/client-error", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ event, data: { ...data, userAgent: navigator.userAgent } }),
        }).catch(() => {});
      } catch {}
    };

    const ai = new GoogleGenAI({
      apiKey: params.ephemeralToken,
      apiVersion: "v1alpha",
    });

    this.outputContext = createAudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
    await this.outputContext.resume();
    this.scheduledPlaybackTime = this.outputContext.currentTime;

    this.startAudioContextKeepAlive();
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    window.addEventListener("focus", this.handleWindowFocus);

    this.pendingTranscriptBySender = {
      user: "",
      assistant: "",
    };
    this.clearTranscriptFlushTimeout("user");
    this.clearTranscriptFlushTimeout("assistant");
    this.lastTranscriptBySender = {
      user: null,
      assistant: null,
    };
    this.audioNoiseGateHangoverFrames = 0;
    this.audioNoiseGateConsecutiveDrops = 0;
    this.audioNoiseGateFailOpenFramesRemaining = 0;
    this.assistantTurnActive = false;
    this.assistantPlaybackTailUntilMs = 0;
    this.conversationId = params.conversationId;
    const googleSearchGroundingEnabled = Boolean(
      params.googleSearchGroundingEnabled,
    );
    const tokenMorningBriefFunctionCallingEnabled = Boolean(
      params.morningBriefFunctionCallingEnabled,
    );
    const tokenGooglePersonalContextFunctionCallingEnabled = Boolean(
      params.googlePersonalContextFunctionCallingEnabled,
    );
    const morningBriefFunctionCallingEnabled =
      tokenMorningBriefFunctionCallingEnabled && ENABLE_MORNING_BRIEF_VOICE_MODE;
    const googlePersonalContextFunctionCallingEnabled =
      tokenGooglePersonalContextFunctionCallingEnabled;
    this.liveGoogleSearchEnabled = googleSearchGroundingEnabled;
    this.liveMorningBriefFunctionCallingEnabled =
      morningBriefFunctionCallingEnabled;
    this.liveGooglePersonalContextFunctionCallingEnabled =
      googlePersonalContextFunctionCallingEnabled;
    this.liveFunctionCallingEnabled =
      morningBriefFunctionCallingEnabled ||
      googlePersonalContextFunctionCallingEnabled;
    this.pendingWebSearchTurn = false;
    this.pendingPersonalContextTurn = false;
    this.personalContextToolCalledThisTurn = false;
    this.personalContextNudgeSentThisTurn = false;
    this.webSearchGroundedThisTurn = false;
    this.webSearchNudgeSentThisTurn = false;
    this.debug("live.feature_gates", {
      tokenMorningBriefFunctionCallingEnabled,
      tokenGooglePersonalContextFunctionCallingEnabled,
      clientMorningBriefVoiceEnabled: ENABLE_MORNING_BRIEF_VOICE_MODE,
      clientGooglePersonalContextVoiceEnabled:
        ENABLE_GOOGLE_PERSONAL_CONTEXT_VOICE_MODE,
      effectiveMorningBriefFunctionCallingEnabled:
        morningBriefFunctionCallingEnabled,
      effectiveGooglePersonalContextFunctionCallingEnabled:
        googlePersonalContextFunctionCallingEnabled,
      effectiveLiveFunctionCallingEnabled: this.liveFunctionCallingEnabled,
    });
    if (
      tokenMorningBriefFunctionCallingEnabled &&
      !morningBriefFunctionCallingEnabled
    ) {
      this.debug("live.feature_gate.blocked", {
        feature: "morning_brief_voice",
        reason: "client_flag_disabled",
        envVar: "VITE_ENABLE_MORNING_BRIEF_VOICE_MODE",
      });
    }

    const compatibilityProfile = resolveLiveAudioCompatibilityProfile();
    const CONNECTION_TIMEOUT_MS = compatibilityProfile.connectionTimeoutMs;
    this.debug("live.audio.compatibility_profile", compatibilityProfile);
    let connectionOpened = false;
    let timedOut = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const connectPromise = ai.live.connect({
      model: params.model,
      config: {
        responseModalities: [Modality.AUDIO],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        tools: (() => {
          const tools: Array<Record<string, unknown>> = [];
          if (googleSearchGroundingEnabled) {
            tools.push({ googleSearch: {} });
          }
          if (morningBriefFunctionCallingEnabled) {
            tools.push({
              functionDeclarations: LIVE_MORNING_BRIEF_FUNCTION_DECLARATIONS,
            });
          }
          if (googlePersonalContextFunctionCallingEnabled) {
            tools.push({
              functionDeclarations:
                LIVE_GOOGLE_PERSONAL_CONTEXT_FUNCTION_DECLARATIONS,
            });
          }
          return tools.length > 0 ? tools : undefined;
        })(),
      },
      callbacks: {
        onopen: () => {
          connectionOpened = true;
          if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
            timeoutId = undefined;
          }
          this.debug("live.session.open", {
            model: params.model,
            googleSearchGroundingEnabled,
            morningBriefFunctionCallingEnabled,
            googlePersonalContextFunctionCallingEnabled,
            toolGroupCount: (() => {
              let count = 0;
              if (googleSearchGroundingEnabled) count++;
              if (morningBriefFunctionCallingEnabled) count++;
              if (googlePersonalContextFunctionCallingEnabled) count++;
              return count;
            })(),
            personalContextTools: googlePersonalContextFunctionCallingEnabled
              ? LIVE_GOOGLE_PERSONAL_CONTEXT_FUNCTION_DECLARATIONS.map(
                  (d) => d.name,
                )
              : [],
          });
        },
        onmessage: (message) => {
          if (!timedOut) this.handleServerMessage(message);
        },
        onerror: (event) => {
          reportError("live.ws.error", { message: event.message, model: params.model });
          if (timedOut) return;
          const error = new Error(event.message || "Gemini Live session error");
          this.emitError(error);
        },
        onclose: (event) => {
          if (!connectionOpened) {
            reportError("live.ws.closed_before_open", { reason: event.reason, model: params.model });
          }
          if (timedOut) return;
          this.debug("live.session.closed", { reason: event.reason || "unknown" });
          this.callbacks.onClosed?.(event.reason || undefined);
        },
      },
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        if (!connectionOpened) {
          timedOut = true;
          reportError("live.ws.connection_timeout", { model: params.model, timeoutMs: CONNECTION_TIMEOUT_MS });
          connectPromise.then((session) => {
            try { session.close(); } catch {}
          }).catch(() => {});
          reject(new Error("Connection timed out. Please check your network and try again."));
        }
      }, CONNECTION_TIMEOUT_MS);
    });

    try {
      this.session = await Promise.race([connectPromise, timeoutPromise]);
    } catch (err) {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }
      reportError("live.ws.start_failed", { error: (err as any)?.message, model: params.model });
      throw err;
    }

    this.debug("live.audio.capture_config", {
      processorBufferSize: PROCESSOR_BUFFER_SIZE,
      noiseGateEnabled: ENABLE_AUDIO_NOISE_GATE,
      noiseGateRmsThreshold: AUDIO_NOISE_GATE_RMS_THRESHOLD,
      noiseGateHangoverFrames: AUDIO_NOISE_GATE_HANGOVER_FRAMES,
      noiseGateFailOpenEnabled: ENABLE_AUDIO_NOISE_GATE_FAIL_OPEN,
      noiseGateAssistantSpeechMultiplier:
        AUDIO_NOISE_GATE_ASSISTANT_SPEECH_MULTIPLIER,
      noiseGateFailOpenAfterDrops: AUDIO_NOISE_GATE_FAILOPEN_AFTER_DROPS,
      noiseGateFailOpenFrames: AUDIO_NOISE_GATE_FAILOPEN_FRAMES,
      suppressInputWhileAssistantSpeaking:
        SUPPRESS_INPUT_WHILE_ASSISTANT_SPEAKING,
      suppressInputCooldownMs: SUPPRESS_INPUT_COOLDOWN_MS,
      suppressUserTranscriptDuringAssistantSpeech:
        SUPPRESS_USER_TRANSCRIPT_DURING_ASSISTANT_SPEECH,
    });

    await this.startMicrophoneStream(params.preAcquiredMicStream);
  }

  async stop(): Promise<void> {
    this.flushPendingTranscript("user", "turn_complete");
    this.flushPendingTranscript("assistant", "turn_complete");

    try {
      this.session?.sendRealtimeInput({ audioStreamEnd: true });
    } catch {
      // Ignore cleanup error.
    }

    try {
      this.session?.close();
    } catch {
      // Ignore cleanup error.
    }

    this.session = null;
    this.pendingTranscriptBySender = {
      user: "",
      assistant: "",
    };
    this.clearTranscriptFlushTimeout("user");
    this.clearTranscriptFlushTimeout("assistant");
    this.lastTranscriptBySender = {
      user: null,
      assistant: null,
    };
    this.audioNoiseGateHangoverFrames = 0;
    this.audioNoiseGateConsecutiveDrops = 0;
    this.audioNoiseGateFailOpenFramesRemaining = 0;
    this.assistantTurnActive = false;
    this.assistantPlaybackTailUntilMs = 0;
    this.assistantSpeechWindowStartMs = 0;
    this.assistantTurnReleaseAtMs = 0;
    this.interruptPending = false;
    this.conversationId = null;
    this.liveGoogleSearchEnabled = false;
    this.liveMorningBriefFunctionCallingEnabled = false;
    this.liveGooglePersonalContextFunctionCallingEnabled = false;
    this.liveFunctionCallingEnabled = false;
    this.pendingWebSearchTurn = false;
    this.pendingPersonalContextTurn = false;
    this.personalContextToolCalledThisTurn = false;
    this.personalContextNudgeSentThisTurn = false;
    this.webSearchGroundedThisTurn = false;
    this.webSearchNudgeSentThisTurn = false;
    this.clearPlaybackQueue();
    this.stopAudioContextKeepAlive();
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    window.removeEventListener("focus", this.handleWindowFocus);
    await this.stopVideo();

    if (this.processorNode) {
      this.processorNode.onaudioprocess = null;
      this.processorNode.disconnect();
      this.processorNode = null;
    }
    if (this.mediaSourceNode) {
      this.mediaSourceNode.disconnect();
      this.mediaSourceNode = null;
    }
    if (this.mutedGainNode) {
      this.mutedGainNode.disconnect();
      this.mutedGainNode = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.inputContext) {
      await this.inputContext.close().catch(() => {});
      this.inputContext = null;
    }

    if (this.outputContext) {
      await this.outputContext.close().catch(() => {});
      this.outputContext = null;
    }
  }

  async startVideo(params: { facingMode?: CameraFacingMode } = {}): Promise<MediaStream> {
    if (!this.session) {
      throw new Error("Cannot start camera stream without an active live session");
    }

    const facingMode = params.facingMode ?? this.preferredFacingMode;
    this.preferredFacingMode = facingMode;

    await this.stopVideo();

    const oppositeFacingMode: CameraFacingMode =
      facingMode === "user" ? "environment" : "user";
    const attemptConstraints: MediaStreamConstraints[] = [
      {
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      },
      {
        video: {
          facingMode: { ideal: oppositeFacingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      },
      {
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      },
    ];

    let lastError: unknown = null;
    try {
      for (let index = 0; index < attemptConstraints.length; index += 1) {
        try {
          this.videoStream = await getUserMediaWithTimeout(attemptConstraints[index]);
          break;
        } catch (attemptError) {
          lastError = attemptError;
          this.debug("live.video.camera_attempt_failed", {
            attempt: index + 1,
            message:
              attemptError instanceof Error
                ? attemptError.message
                : String(attemptError),
          });
        }
      }
    } catch (error) {
      lastError = error;
    }

    if (!this.videoStream) {
      this.emitError(new Error("Camera permission was denied or unavailable"));
      throw (lastError ?? new Error("Camera permission was denied or unavailable"));
    }

    this.videoElement = document.createElement("video");
    this.videoElement.muted = true;
    this.videoElement.playsInline = true;
    this.videoElement.autoplay = true;
    this.videoElement.srcObject = this.videoStream;
    await this.videoElement.play();

    this.videoCanvas = document.createElement("canvas");
    this.startVideoCaptureLoop();

    const resolvedFacingMode = this.videoStream
      .getVideoTracks()
      .at(0)
      ?.getSettings()
      .facingMode;
    if (resolvedFacingMode === "user" || resolvedFacingMode === "environment") {
      this.preferredFacingMode = resolvedFacingMode;
    }

    this.debug("live.video.started", {
      facingMode: this.preferredFacingMode,
      requestedFacingMode: facingMode,
      width: this.videoElement.videoWidth,
      height: this.videoElement.videoHeight,
    });

    return this.videoStream;
  }

  async stopVideo(): Promise<void> {
    if (this.videoCaptureInterval !== null) {
      window.clearInterval(this.videoCaptureInterval);
      this.videoCaptureInterval = null;
    }

    this.videoFrameInFlight = false;

    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.srcObject = null;
      this.videoElement = null;
    }

    if (this.videoStream) {
      this.videoStream.getTracks().forEach((track) => track.stop());
      this.videoStream = null;
    }

    this.videoCanvas = null;
    this.debug("live.video.stopped");
  }

  async flipCamera(): Promise<CameraFacingMode> {
    this.preferredFacingMode =
      this.preferredFacingMode === "user" ? "environment" : "user";

    if (this.videoStream) {
      await this.startVideo({ facingMode: this.preferredFacingMode });
    }

    this.debug("live.video.flipped", {
      facingMode: this.preferredFacingMode,
    });

    return this.preferredFacingMode;
  }

  getVideoStream(): MediaStream | null {
    return this.videoStream;
  }

  isVideoEnabled(): boolean {
    return Boolean(this.videoStream && this.videoCaptureInterval !== null);
  }

  getFacingMode(): CameraFacingMode {
    return this.preferredFacingMode;
  }

  interruptAssistantPlayback(reason = "user_request"): boolean {
    if (!this.session) {
      return false;
    }

    const hasInterruptibleOutput =
      this.assistantTurnActive ||
      this.isAssistantAudioLikelyActive() ||
      Date.now() < this.assistantPlaybackTailUntilMs;
    if (!hasInterruptibleOutput) {
      return false;
    }

    // Persist whatever Zee has already said before yielding the floor back.
    this.flushPendingTranscript("assistant", "idle_timeout");
    this.assistantTurnActive = false;
    this.assistantPlaybackTailUntilMs = 0;
    this.assistantSpeechWindowStartMs = 0;
    this.assistantTurnReleaseAtMs = 0;
    this.interruptPending = true;
    this.clearPlaybackQueue();

    try {
      this.session.sendClientContent({
        turnComplete: false,
      });
      this.debug("live.assistant.interrupt_requested", {
        reason,
      });
    } catch (error) {
      this.interruptPending = false;
      this.debug("live.assistant.interrupt_failed", {
        reason,
        message: error instanceof Error ? error.message : String(error),
      });
      return false;
    }

    return true;
  }

  private startVideoCaptureLoop(): void {
    if (!this.videoElement || !this.videoCanvas) {
      return;
    }

    const renderFrame = () => {
      if (
        !this.session ||
        !this.videoElement ||
        !this.videoCanvas ||
        this.videoFrameInFlight
      ) {
        return;
      }

      if (this.videoElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        return;
      }

      const { width, height } = chooseVideoSize(this.videoElement);
      this.videoCanvas.width = width;
      this.videoCanvas.height = height;

      const ctx = this.videoCanvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(this.videoElement, 0, 0, width, height);

      this.videoFrameInFlight = true;
      try {
        if (!this.session) {
          this.debug("live.video.frame_dropped", {
            reason: "session_missing",
          });
          return;
        }

        const dataUrl = this.videoCanvas.toDataURL("image/jpeg", 0.72);
        const base64 = dataUrl.split(",")[1];
        if (!base64) {
          this.debug("live.video.frame_dropped", {
            reason: "encode_failed",
          });
          return;
        }

        this.session.sendRealtimeInput({
          video: {
            data: base64,
            mimeType: "image/jpeg",
          },
        });
        this.debug("live.video.frame_sent", {
          bytes: Math.floor((base64.length * 3) / 4),
          mimeType: "image/jpeg",
          width,
          height,
        });
      } finally {
        this.videoFrameInFlight = false;
      }
    };

    renderFrame();
    this.videoCaptureInterval = window.setInterval(renderFrame, VIDEO_FRAME_INTERVAL_MS);
  }

  private startAudioContextKeepAlive(): void {
    this.stopAudioContextKeepAlive();
    this.audioContextKeepAliveInterval = window.setInterval(() => {
      this.ensureAudioContextsRunning();
      this.pruneStalePlaybackNodes();
    }, 2000);
  }

  private stopAudioContextKeepAlive(): void {
    if (this.audioContextKeepAliveInterval !== null) {
      clearInterval(this.audioContextKeepAliveInterval);
      this.audioContextKeepAliveInterval = null;
    }
  }

  private ensureAudioContextsRunning(): void {
    if (this.outputContext && this.outputContext.state === "suspended") {
      this.debug("live.audio.output_context_resuming");
      this.outputContext.resume().catch(() => {});
    }
    if (this.inputContext && this.inputContext.state === "suspended") {
      this.debug("live.audio.input_context_resuming");
      this.inputContext.resume().catch(() => {});
    }
  }

  private static readonly MAX_SPEECH_SUPPRESSION_MS = 8000;

  private pruneStalePlaybackNodes(): void {
    if (!this.outputContext || this.playbackNodeEndTimes.size === 0) return;
    const now = this.outputContext.currentTime;
    const staleThreshold = 0.5;
    let pruned = 0;
    this.playbackNodeEndTimes.forEach((endTime, node) => {
      if (now > endTime + staleThreshold) {
        this.activePlaybackNodes.delete(node);
        this.playbackNodeEndTimes.delete(node);
        try { node.disconnect(); } catch {}
        pruned += 1;
      }
    });
    if (pruned > 0) {
      this.debug("live.audio.stale_nodes_pruned", {
        pruned,
        remaining: this.activePlaybackNodes.size,
      });
    }
  }

  private isAssistantAudioLikelyActive(): boolean {
    if (!this.outputContext) return false;
    return (
      this.activePlaybackNodes.size > 0 ||
      this.scheduledPlaybackTime > this.outputContext.currentTime + 0.04
    );
  }

  private scheduleAssistantTurnRelease(reason: string): void {
    const releaseAt = Date.now() + ASSISTANT_TURN_RELEASE_GRACE_MS;
    if (releaseAt <= this.assistantTurnReleaseAtMs) {
      return;
    }
    this.assistantTurnReleaseAtMs = releaseAt;
    this.debug("live.assistant.turn_release_scheduled", {
      reason,
      releaseDelayMs: ASSISTANT_TURN_RELEASE_GRACE_MS,
    });
  }

  private releaseAssistantTurn(reason: string): boolean {
    if (!this.assistantTurnActive) {
      this.assistantTurnReleaseAtMs = 0;
      return false;
    }
    if (this.interruptPending) {
      return false;
    }
    if (this.isAssistantAudioLikelyActive()) {
      return false;
    }
    if (Date.now() < this.assistantPlaybackTailUntilMs) {
      return false;
    }

    this.assistantTurnActive = false;
    this.assistantSpeechWindowStartMs = 0;
    this.assistantTurnReleaseAtMs = 0;
    this.flushPendingTranscript("assistant", "idle_timeout");
    this.debug("live.assistant.turn_released", {
      reason,
    });
    return true;
  }

  private isAssistantSpeechWindowActive(): boolean {
    if (!SUPPRESS_INPUT_WHILE_ASSISTANT_SPEAKING) return false;
    if (
      this.assistantTurnReleaseAtMs > 0 &&
      Date.now() >= this.assistantTurnReleaseAtMs
    ) {
      this.releaseAssistantTurn("release_deadline");
    }
    const windowActive =
      this.assistantTurnActive ||
      this.isAssistantAudioLikelyActive() ||
      Date.now() < this.assistantPlaybackTailUntilMs;
    if (!windowActive) {
      this.assistantSpeechWindowStartMs = 0;
      this.assistantTurnReleaseAtMs = 0;
      return false;
    }
    if (this.assistantSpeechWindowStartMs === 0) {
      this.assistantSpeechWindowStartMs = Date.now();
    }
    if (Date.now() - this.assistantSpeechWindowStartMs > GeminiLiveVoiceSession.MAX_SPEECH_SUPPRESSION_MS) {
      this.debug("live.audio.suppression_guard_triggered", {
        durationMs: Date.now() - this.assistantSpeechWindowStartMs,
        activePlaybackNodes: this.activePlaybackNodes.size,
        assistantTurnActive: this.assistantTurnActive,
      });
      this.assistantTurnActive = false;
      this.assistantPlaybackTailUntilMs = 0;
      this.assistantSpeechWindowStartMs = 0;
      this.assistantTurnReleaseAtMs = 0;
      this.clearPlaybackQueue();
      return false;
    }
    return true;
  }

  private async startMicrophoneStream(preAcquiredStream?: MediaStream): Promise<void> {
    if (!this.session) {
      throw new Error("Cannot start microphone stream without a live session");
    }

    try {
      this.mediaStream = preAcquiredStream ?? await getMicrophoneStreamWithFallback();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Microphone permission was denied or unavailable";
      const micAttemptFailures = Array.isArray(
        (error as { attemptFailures?: unknown })?.attemptFailures,
      )
        ? (((error as { attemptFailures?: unknown[] }).attemptFailures ??
            []) as unknown[])
        : [];
      const compatibility = (
        error as { compatibility?: LiveAudioCompatibilityProfile | null }
      )?.compatibility;
      this.debug("live.audio.capture_failed", {
        message,
        errorName:
          typeof (error as { name?: unknown })?.name === "string"
            ? (error as { name: string }).name
            : null,
        micAttemptFailures,
        compatibility: compatibility ?? null,
      });
      this.emitError(new Error(message));
      throw error;
    }

    this.inputContext = createAudioContext();
    await this.inputContext.resume();

    this.mediaSourceNode = this.inputContext.createMediaStreamSource(this.mediaStream);
    this.processorNode = this.inputContext.createScriptProcessor(
      PROCESSOR_BUFFER_SIZE,
      1,
      1,
    );
    this.mutedGainNode = this.inputContext.createGain();
    this.mutedGainNode.gain.value = 0;

    this.mediaSourceNode.connect(this.processorNode);
    this.processorNode.connect(this.mutedGainNode);
    this.mutedGainNode.connect(this.inputContext.destination);

    this.processorNode.onaudioprocess = (event) => {
      if (!this.session || !this.inputContext) return;
      if (this.inputContext.state === "suspended") {
        this.inputContext.resume().catch(() => {});
        return;
      }
      if (this.isAssistantSpeechWindowActive()) {
        this.audioNoiseGateConsecutiveDrops = 0;
        this.audioNoiseGateFailOpenFramesRemaining = 0;
        return;
      }
      const inputSamples = event.inputBuffer.getChannelData(0);
      if (ENABLE_AUDIO_NOISE_GATE) {
        const rms = calculateRms(inputSamples);
        const assistantAudioActive = this.isAssistantAudioLikelyActive();
        const effectiveThreshold = assistantAudioActive
          ? AUDIO_NOISE_GATE_RMS_THRESHOLD *
            AUDIO_NOISE_GATE_ASSISTANT_SPEECH_MULTIPLIER
          : AUDIO_NOISE_GATE_RMS_THRESHOLD;
        const isActiveSpeech = rms >= effectiveThreshold;

        if (isActiveSpeech) {
          this.audioNoiseGateHangoverFrames = AUDIO_NOISE_GATE_HANGOVER_FRAMES;
          this.audioNoiseGateConsecutiveDrops = 0;
          this.audioNoiseGateFailOpenFramesRemaining = 0;
        } else if (this.audioNoiseGateHangoverFrames > 0) {
          this.audioNoiseGateHangoverFrames -= 1;
        }

        const hasHangover = this.audioNoiseGateHangoverFrames > 0;
        const failOpenActive = this.audioNoiseGateFailOpenFramesRemaining > 0;

        if (!isActiveSpeech && !hasHangover && !failOpenActive) {
          this.audioNoiseGateConsecutiveDrops += 1;
          if (
            ENABLE_AUDIO_NOISE_GATE_FAIL_OPEN &&
            this.audioNoiseGateConsecutiveDrops >=
            AUDIO_NOISE_GATE_FAILOPEN_AFTER_DROPS
          ) {
            this.audioNoiseGateConsecutiveDrops = 0;
            this.audioNoiseGateFailOpenFramesRemaining =
              AUDIO_NOISE_GATE_FAILOPEN_FRAMES;
            this.debug("live.audio.noise_gate.fail_open", {
              rms,
              threshold: effectiveThreshold,
              failOpenFrames: AUDIO_NOISE_GATE_FAILOPEN_FRAMES,
            });
          }
          return;
        }

        this.audioNoiseGateConsecutiveDrops = 0;
        if (!isActiveSpeech && !hasHangover && this.audioNoiseGateFailOpenFramesRemaining > 0) {
          this.audioNoiseGateFailOpenFramesRemaining -= 1;
        }
      }
      const pcmBase64 = pcm16ToBase64(
        inputSamples,
        this.inputContext.sampleRate,
      );
      try {
        this.session.sendRealtimeInput({
          audio: {
            data: pcmBase64,
            mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}`,
          },
        });
      } catch (error) {
        this.debug("live.audio.send_failed", {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    };
  }

  private handleServerMessage(message: LiveServerMessage): void {
    const serverContent = message.serverContent;
    const toolCallPayload = (
      message as LiveServerMessage & {
        toolCall?: unknown;
      }
    ).toolCall;
    const hasToolCall = Boolean(toolCallPayload);
    const toolCallNames = hasToolCall
      ? extractToolCallNames(toolCallPayload)
      : [];
    const hasPersonalContextToolCall = toolCallNames.some(
      (name) => name === "get_user_emails" || name === "get_calendar_events",
    );

    if (hasPersonalContextToolCall) {
      this.personalContextToolCalledThisTurn = true;
      this.pendingPersonalContextTurn = false;
      this.debug("live.google_context.tool_call_detected", {
        toolCallNames,
      });
    }

    if (hasToolCall && !this.liveFunctionCallingEnabled) {
      this.debug("live.tool_call.ignored", {
        reason: "live_function_calling_disabled",
        toolCallNames,
        liveMorningBriefFunctionCallingEnabled:
          this.liveMorningBriefFunctionCallingEnabled,
        liveGooglePersonalContextFunctionCallingEnabled:
          this.liveGooglePersonalContextFunctionCallingEnabled,
      });
    }

    if (hasToolCall && this.liveFunctionCallingEnabled) {
      void this.handleToolCall(toolCallPayload);
    }

    if (!serverContent) {
      if (
        this.liveGoogleSearchEnabled &&
        hasToolCall &&
        this.pendingWebSearchTurn &&
        !this.webSearchGroundedThisTurn
      ) {
        this.webSearchGroundedThisTurn = true;
        this.pendingWebSearchTurn = false;
        this.emitWebSearchStatus("grounded");
        this.debug("live.web_search.grounded", {
          source: "tool_call",
        });
      }
      return;
    }
    const hasGroundingMetadata = Boolean(
      (
        serverContent as typeof serverContent & {
          groundingMetadata?: unknown;
        }
      ).groundingMetadata,
    );
    const hasUrlContextMetadata = Boolean(
      (
        serverContent as typeof serverContent & {
          urlContextMetadata?: unknown;
        }
      ).urlContextMetadata,
    );

    const modelParts = serverContent.modelTurn?.parts ?? [];
    const audioPartCount = modelParts.reduce((count, part) => {
      return part.inlineData?.data ? count + 1 : count;
    }, 0);
    const shouldLogServerContent =
      Boolean(serverContent.interrupted) ||
      Boolean(serverContent.generationComplete) ||
      Boolean(serverContent.turnComplete) ||
      audioPartCount > 0 ||
      Boolean(serverContent.inputTranscription?.text) ||
      Boolean(serverContent.outputTranscription?.text);
    if (shouldLogServerContent) {
      this.debug("live.server.content", {
        interrupted: Boolean(serverContent.interrupted),
        generationComplete: Boolean(serverContent.generationComplete),
        turnComplete: Boolean(serverContent.turnComplete),
        waitingForInput: Boolean(serverContent.waitingForInput),
        audioPartCount,
        hasInputTranscription: Boolean(serverContent.inputTranscription?.text),
        hasOutputTranscription: Boolean(serverContent.outputTranscription?.text),
        hasGroundingMetadata,
        hasUrlContextMetadata,
        hasToolCall,
        toolCallNames,
      });
    }

    if (
      this.liveGoogleSearchEnabled &&
      (hasGroundingMetadata || hasUrlContextMetadata || hasToolCall) &&
      !this.webSearchGroundedThisTurn
    ) {
      this.webSearchGroundedThisTurn = true;
      this.pendingWebSearchTurn = false;
      this.emitWebSearchStatus("grounded");
      this.debug("live.web_search.grounded", {
        source: hasGroundingMetadata
          ? "grounding_metadata"
          : hasUrlContextMetadata
            ? "url_context_metadata"
            : "tool_call",
      });
    }

    if (audioPartCount > 0 || Boolean(serverContent.outputTranscription?.text)) {
      this.assistantTurnActive = true;
      this.assistantPlaybackTailUntilMs = Math.max(
        this.assistantPlaybackTailUntilMs,
        Date.now() + SUPPRESS_INPUT_COOLDOWN_MS,
      );
    }

    if (
      this.assistantTurnActive &&
      !this.interruptPending &&
      (serverContent.generationComplete ||
        serverContent.waitingForInput ||
        serverContent.outputTranscription?.finished)
    ) {
      this.scheduleAssistantTurnRelease(
        serverContent.waitingForInput
          ? "waiting_for_input"
          : serverContent.generationComplete
            ? "generation_complete"
            : "output_transcription_finished",
      );
    }

    if (serverContent.interrupted) {
      this.debug("live.server.interrupted");
      if (this.interruptPending) {
        this.debug("live.assistant.interrupt_acknowledged", {
          source: "server_interrupted",
        });
      }
      this.interruptPending = false;
      this.assistantTurnActive = false;
      this.assistantTurnReleaseAtMs = 0;
      this.assistantPlaybackTailUntilMs = Math.max(
        this.assistantPlaybackTailUntilMs,
        Date.now() + SUPPRESS_INPUT_COOLDOWN_MS,
      );
      this.clearPlaybackQueue();
    }

    const shouldDropAssistantOutput = this.interruptPending;
    if (shouldDropAssistantOutput && (audioPartCount > 0 || Boolean(serverContent.outputTranscription?.text))) {
      this.debug("live.assistant.output_dropped_after_interrupt", {
        audioPartCount,
        hasOutputTranscription: Boolean(serverContent.outputTranscription?.text),
      });
    } else {
      for (const part of modelParts) {
        const audioData = part.inlineData?.data;
        if (audioData) {
          this.enqueueAudio(audioData);
        }
      }
    }

    this.captureTranscript("user", serverContent.inputTranscription);
    if (!shouldDropAssistantOutput) {
      this.captureTranscript("assistant", serverContent.outputTranscription);
    }

    if (serverContent.turnComplete) {
      if (this.interruptPending) {
        this.debug("live.assistant.interrupt_acknowledged", {
          source: "turn_complete",
        });
      }
      this.interruptPending = false;
      this.assistantTurnReleaseAtMs = 0;
      if (this.pendingPersonalContextTurn && !this.personalContextToolCalledThisTurn) {
        this.debug("live.google_context.no_tool_call", {
          liveGooglePersonalContextFunctionCallingEnabled:
            this.liveGooglePersonalContextFunctionCallingEnabled,
          liveFunctionCallingEnabled: this.liveFunctionCallingEnabled,
          personalContextNudgeSentThisTurn:
            this.personalContextNudgeSentThisTurn,
          hint: !this.liveGooglePersonalContextFunctionCallingEnabled
            ? "tools_not_registered_in_session"
            : !this.liveFunctionCallingEnabled
              ? "function_calling_disabled"
              : this.personalContextNudgeSentThisTurn
                ? "model_ignored_nudge_and_tools"
                : "model_did_not_use_available_tools",
        });
        this.emitWebSearchStatus("idle");
      }
      if (
        this.liveGoogleSearchEnabled &&
        this.pendingWebSearchTurn &&
        !this.webSearchGroundedThisTurn
      ) {
        this.emitWebSearchStatus("idle");
      }
      this.pendingWebSearchTurn = false;
      this.pendingPersonalContextTurn = false;
      this.personalContextToolCalledThisTurn = false;
      this.personalContextNudgeSentThisTurn = false;
      this.webSearchGroundedThisTurn = false;
      this.webSearchNudgeSentThisTurn = false;
      this.assistantTurnActive = false;
      this.assistantPlaybackTailUntilMs = Math.max(
        this.assistantPlaybackTailUntilMs,
        Date.now() + SUPPRESS_INPUT_COOLDOWN_MS,
      );
      this.flushPendingTranscript("user", "turn_complete");
      this.flushPendingTranscript("assistant", "turn_complete");
    }
  }

  private enqueueAudio(base64Audio: string): void {
    if (!this.outputContext) return;

    if (this.outputContext.state === "suspended") {
      this.outputContext.resume().catch(() => {});
    }

    this.pruneStalePlaybackNodes();

    const int16 = base64ToPcm16(base64Audio);
    if (int16.length === 0) return;

    const float32 = int16ToFloat32(int16);
    const audioBuffer = this.outputContext.createBuffer(
      1,
      float32.length,
      OUTPUT_SAMPLE_RATE,
    );
    audioBuffer.copyToChannel(float32, 0);

    const source = this.outputContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.outputContext.destination);

    const now = this.outputContext.currentTime;
    if (this.scheduledPlaybackTime < now) {
      this.scheduledPlaybackTime = now + 0.02;
    }

    source.start(this.scheduledPlaybackTime);
    const nodeEndTime = this.scheduledPlaybackTime + audioBuffer.duration;
    this.scheduledPlaybackTime = nodeEndTime;
    this.activePlaybackNodes.add(source);
    this.playbackNodeEndTimes.set(source, nodeEndTime);
    this.assistantPlaybackTailUntilMs = Math.max(
      this.assistantPlaybackTailUntilMs,
      Date.now() + Math.round(audioBuffer.duration * 1000) + SUPPRESS_INPUT_COOLDOWN_MS,
    );

    source.onended = () => {
      this.activePlaybackNodes.delete(source);
      this.playbackNodeEndTimes.delete(source);
    };
  }

  private clearPlaybackQueue(): void {
    this.activePlaybackNodes.forEach((node) => {
      try {
        node.stop();
      } catch {
        // Ignore already-ended nodes.
      }
      node.disconnect();
    });
    this.activePlaybackNodes.clear();
    this.playbackNodeEndTimes.clear();
    if (this.outputContext) {
      this.scheduledPlaybackTime = this.outputContext.currentTime + 0.02;
    }
  }

  private captureTranscript(
    sender: TranscriptSender,
    transcript: LiveTranscriptionPayload | undefined,
  ): void {
    if (!transcript) return;

    const text = normalizeText(transcript.text);
    if (!text) return;
    const personalContextIntent = classifyLivePersonalContextIntent(text);

    if (
      sender === "user" &&
      this.liveGooglePersonalContextFunctionCallingEnabled &&
      personalContextIntent &&
      !this.pendingPersonalContextTurn
    ) {
      this.pendingPersonalContextTurn = true;
      this.personalContextToolCalledThisTurn = false;
      this.emitWebSearchStatus(
        "searching",
        personalContextIntent === "both"
          ? "Retrieving your emails and calendar…"
          : personalContextIntent === "calendar"
            ? "Retrieving your calendar…"
            : "Retrieving your emails…",
      );
      this.debug("live.google_context.searching", {
        textLength: text.length,
        intent: personalContextIntent,
        detectedText: text.slice(0, 120),
      });
    }

    if (
      sender === "user" &&
      this.liveGooglePersonalContextFunctionCallingEnabled &&
      personalContextIntent &&
      transcript.finished &&
      !this.personalContextNudgeSentThisTurn
    ) {
      this.personalContextNudgeSentThisTurn = true;
      this.sendPersonalContextToolNudge(text, personalContextIntent);
    }
    if (
      sender === "user" &&
      !this.liveGooglePersonalContextFunctionCallingEnabled &&
      personalContextIntent &&
      transcript.finished
    ) {
      this.debug("live.google_context.intent_blocked", {
        intent: personalContextIntent,
        reason: "google_personal_context_function_calling_disabled",
        detectedText: text.slice(0, 120),
        liveGooglePersonalContextFunctionCallingEnabled:
          this.liveGooglePersonalContextFunctionCallingEnabled,
        liveFunctionCallingEnabled: this.liveFunctionCallingEnabled,
      });
    }

    if (
      sender === "user" &&
      this.liveGoogleSearchEnabled &&
      isLikelyLiveWebSearchQuery(text) &&
      !this.pendingWebSearchTurn
    ) {
      this.pendingWebSearchTurn = true;
      this.webSearchGroundedThisTurn = false;
      this.emitWebSearchStatus("searching");
      this.debug("live.web_search.searching", {
        textLength: text.length,
      });
    }

    if (
      sender === "user" &&
      this.liveGoogleSearchEnabled &&
      isLikelyLiveWebSearchQuery(text) &&
      transcript.finished &&
      !this.webSearchNudgeSentThisTurn
    ) {
      this.webSearchNudgeSentThisTurn = true;
      this.sendWebSearchNudge(text);
    }

    if (
      sender === "user" &&
      SUPPRESS_USER_TRANSCRIPT_DURING_ASSISTANT_SPEECH &&
      this.isAssistantSpeechWindowActive()
    ) {
      this.debug("live.transcript.user_suppressed_during_assistant_speech", {
        textLength: text.length,
      });
      return;
    }

    const mergedText = mergeTranscriptText(
      this.pendingTranscriptBySender[sender],
      text,
    );
    this.pendingTranscriptBySender[sender] = mergedText;
    this.debug("live.transcript.received", {
      sender,
      textLength: text.length,
      mergedTextLength: mergedText.length,
      finished: Boolean(transcript.finished),
    });

    if (transcript.finished) {
      this.scheduleTranscriptFlush(sender);
    }
  }

  private flushPendingTranscript(
    sender: TranscriptSender,
    reason: "finished" | "turn_complete" | "idle_timeout",
  ): void {
    this.clearTranscriptFlushTimeout(sender);
    const pendingText = this.pendingTranscriptBySender[sender];
    if (!pendingText) return;
    this.pendingTranscriptBySender[sender] = "";
    this.emitTranscript(sender, pendingText, reason);
  }

  private scheduleTranscriptFlush(sender: TranscriptSender): void {
    this.clearTranscriptFlushTimeout(sender);
    this.transcriptFlushTimeoutBySender[sender] = window.setTimeout(() => {
      this.transcriptFlushTimeoutBySender[sender] = null;
      this.flushPendingTranscript(sender, "finished");
    }, TRANSCRIPT_FLUSH_DEBOUNCE_MS);
  }

  private clearTranscriptFlushTimeout(sender: TranscriptSender): void {
    const timeout = this.transcriptFlushTimeoutBySender[sender];
    if (timeout !== null) {
      window.clearTimeout(timeout);
      this.transcriptFlushTimeoutBySender[sender] = null;
    }
  }

  private emitTranscript(
    sender: TranscriptSender,
    rawText: string | undefined,
    reason: "finished" | "turn_complete" | "idle_timeout",
  ): void {
    const text = normalizeText(rawText);
    if (!text) return;

    const now = Date.now();
    const last = this.lastTranscriptBySender[sender];
    if (last && last.text === text && now - last.at < TRANSCRIPT_DUPLICATE_WINDOW_MS) {
      this.debug("live.transcript.duplicate_skipped", {
        sender,
        textLength: text.length,
        reason,
      });
      return;
    }
    this.lastTranscriptBySender[sender] = { text, at: now };

    this.callbacks.onTranscript?.({ sender, text });
  }

  private async handleToolCall(toolCallPayload: unknown): Promise<void> {
    if (!this.session || !this.conversationId) return;

    const functionCalls =
      (
        toolCallPayload as {
          functionCalls?: Array<{ id?: unknown; name?: unknown; args?: unknown }>;
        }
      )?.functionCalls ?? [];
    if (!Array.isArray(functionCalls) || functionCalls.length === 0) return;

    const normalizedCalls = functionCalls
      .map((call) => {
        const id = typeof call.id === "string" ? call.id : "";
        const name = typeof call.name === "string" ? call.name : "";
        if (!id || !name) return null;
        return {
          id,
          name,
          args: call.args,
        };
      })
      .filter((call): call is { id: string; name: string; args: unknown } =>
        Boolean(call),
      );

    if (normalizedCalls.length === 0) return;

    const callDebugSummary = normalizedCalls.map((call) => {
      let parsedArgs: unknown = call.args;
      if (typeof parsedArgs === "string") {
        try {
          parsedArgs = JSON.parse(parsedArgs);
        } catch {
          parsedArgs = null;
        }
      }
      const argKeys =
        parsedArgs && typeof parsedArgs === "object" && !Array.isArray(parsedArgs)
          ? Object.keys(parsedArgs as Record<string, unknown>)
          : [];
      return {
        id: call.id,
        name: call.name,
        argKeys,
      };
    });

    const hasEmailCall = normalizedCalls.some(
      (call) => call.name === "get_user_emails" || call.name === "get_inbox_digest",
    );
    const hasInboxCall = normalizedCalls.some(
      (call) => call.name === "get_inbox_digest" || call.name === "get_user_emails",
    );
    const hasCalendarCall = normalizedCalls.some(
      (call) => call.name === "get_calendar_events",
    );
    this.emitWebSearchStatus(
      "searching",
      hasEmailCall && hasCalendarCall
        ? "Retrieving your emails and calendar…"
        : hasCalendarCall
          ? "Retrieving your calendar…"
          : hasInboxCall
            ? "Retrieving your emails…"
            : "Searching live sources…",
    );

    const toolCallStartedAt = Date.now();
    this.debug("live.tool_call.received", {
      functionCount: normalizedCalls.length,
      calls: callDebugSummary,
    });

    try {
      this.debug("live.tool_call.forwarding", {
        endpoint: "/api/live/tool-response",
        conversationId: this.conversationId,
        functionNames: normalizedCalls.map((c) => c.name),
        hasEmailCall,
        hasCalendarCall,
      });
      const response = await fetch("/api/live/tool-response", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversationId: this.conversationId,
          functionCalls: normalizedCalls,
          clientTimeZone:
            Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
        }),
      });

      if (!response.ok) {
        let failureMessage = `Live tool-response request failed (${response.status})`;
        try {
          const errorPayload = (await response.json()) as {
            message?: unknown;
            traceId?: unknown;
          };
          const message =
            typeof errorPayload.message === "string"
              ? errorPayload.message
              : null;
          const traceId =
            typeof errorPayload.traceId === "string"
              ? errorPayload.traceId
              : null;
          this.debug("live.tool_call.http_failed", {
            status: response.status,
            traceId,
            message,
          });
          if (message) {
            failureMessage = `${failureMessage}: ${message}`;
          }
        } catch {
          // no-op: preserve base failure message
        }
        throw new Error(failureMessage);
      }

      const payload = (await response.json()) as {
        traceId?: unknown;
        functionResponses?: unknown;
        chatDigests?: unknown;
        webSearchEvents?: unknown;
      };

      const functionResponses = Array.isArray(payload.functionResponses)
        ? payload.functionResponses
        : [];
      const functionResponseSummary = functionResponses.map((entry) => {
        const responseObject =
          entry && typeof entry === "object"
            ? (entry as { response?: unknown; name?: unknown; id?: unknown })
            : null;
        const errorObject =
          responseObject?.response &&
          typeof responseObject.response === "object" &&
          (responseObject.response as { error?: unknown }).error &&
          typeof (responseObject.response as { error?: unknown }).error ===
            "object"
            ? ((responseObject.response as {
                error: { code?: unknown; message?: unknown };
              }).error ?? null)
            : null;
        return {
          id: typeof responseObject?.id === "string" ? responseObject.id : null,
          name:
            typeof responseObject?.name === "string" ? responseObject.name : null,
          status: errorObject ? "error" : "ok",
          code: typeof errorObject?.code === "string" ? errorObject.code : null,
          message:
            typeof errorObject?.message === "string" ? errorObject.message : null,
        };
      });
      if (functionResponses.length > 0 && this.session) {
        const sessionWithTools = this.session as Session & {
          sendToolResponse?: (payload: {
            functionResponses: Array<Record<string, unknown>>;
          }) => void;
        };
        if (typeof sessionWithTools.sendToolResponse === "function") {
          sessionWithTools.sendToolResponse({
            functionResponses: functionResponses as Array<Record<string, unknown>>,
          });
        }
      }

      if (Array.isArray(payload.chatDigests)) {
        for (const digest of payload.chatDigests) {
          const text =
            digest &&
            typeof digest === "object" &&
            typeof (digest as { text?: unknown }).text === "string"
              ? ((digest as { text: string }).text ?? "").trim()
              : "";
          if (!text) continue;
          this.callbacks.onMorningBriefDigest?.({ text });
        }
      }

      if (Array.isArray(payload.webSearchEvents)) {
        for (const event of payload.webSearchEvents) {
          const status =
            event &&
            typeof event === "object" &&
            typeof (event as { status?: unknown }).status === "string"
              ? ((event as { status: string }).status as
                  | "searching"
                  | "grounded"
                  | "idle")
              : null;
          const label =
            event &&
            typeof event === "object" &&
            typeof (event as { label?: unknown }).label === "string"
              ? (event as { label: string }).label
              : undefined;
          if (!status) continue;
          this.emitWebSearchStatus(status, label);
        }
      } else {
        const hasError = functionResponseSummary.some(
          (entry) => entry.status === "error",
        );
        this.emitWebSearchStatus(
          "grounded",
          hasError ? "Completed with issues" : "Context ready",
        );
      }

      this.debug("live.tool_call.responded", {
        functionCount: normalizedCalls.length,
        traceId: typeof payload.traceId === "string" ? payload.traceId : null,
        responses: functionResponseSummary,
        chatDigestCount: Array.isArray(payload.chatDigests)
          ? payload.chatDigests.length
          : 0,
        webSearchEventCount: Array.isArray(payload.webSearchEvents)
          ? payload.webSearchEvents.length
          : 0,
        elapsedMs: Date.now() - toolCallStartedAt,
      });
    } catch (error) {
      this.debug("live.tool_call.failed", {
        message: error instanceof Error ? error.message : String(error),
        functionNames: normalizedCalls.map((call) => call.name),
        elapsedMs: Date.now() - toolCallStartedAt,
      });
      this.emitWebSearchStatus("idle");
    }
  }

  private emitError(error: Error): void {
    this.callbacks.onError?.(error);
  }

  private emitWebSearchStatus(status: LiveWebSearchStatus, label?: string): void {
    this.callbacks.onWebSearch?.({ status, label });
  }

  private sendWebSearchNudge(userTranscript: string): void {
    if (!this.session) return;
    const query = normalizeText(userTranscript);
    if (!query) return;
    try {
      (
        this.session as Session & {
          sendClientContent?: (payload: {
            turns: string;
            turnComplete: boolean;
          }) => void;
        }
      ).sendClientContent?.({
        turns: `Use Google Search grounding for this latest user request and answer with current verified facts: ${query}`,
        turnComplete: true,
      });
      this.debug("live.web_search.nudge_sent", {
        textLength: query.length,
      });
    } catch (error) {
      this.debug("live.web_search.nudge_failed", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private sendPersonalContextToolNudge(
    userTranscript: string,
    intent: LivePersonalContextIntent,
  ): void {
    if (!this.session) return;
    const query = normalizeText(userTranscript);
    if (!query) return;

    const toolInstruction = buildPersonalContextToolInstruction(query, intent);

    try {
      (
        this.session as Session & {
          sendClientContent?: (payload: {
            turns: string;
            turnComplete: boolean;
          }) => void;
        }
      ).sendClientContent?.({
        turns: `For this latest user request, you MUST use the connected Google personal context function tools before giving any natural-language answer. ${toolInstruction} Do not answer from memory or earlier tool results. Fetch fresh data now. Never invent email or calendar details. User request: ${query}`,
        turnComplete: true,
      });
      this.debug("live.google_context.nudge_sent", {
        textLength: query.length,
        intent,
      });
    } catch (error) {
      this.debug("live.google_context.nudge_failed", {
        message: error instanceof Error ? error.message : String(error),
        intent,
      });
    }
  }

  private debug(message: string, metadata?: Record<string, unknown>): void {
    this.callbacks.onDebug?.(message, metadata);
  }
}
