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
const MICROPHONE_PERMISSION_TIMEOUT_MS = 12000;
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
const SUPPRESS_USER_TRANSCRIPT_DURING_ASSISTANT_SPEECH = parseClientBoolean(
  liveClientEnv.VITE_LIVE_AUDIO_SUPPRESS_USER_TRANSCRIPT_DURING_ASSISTANT_SPEECH,
  true,
);
const LIVE_WEB_SEARCH_SIGNAL_PATTERN =
  /\b(search|look up|google|latest|current|today|news|headline|what happened|updates?|did you see|last super bowl|super\s*bowl|score|standings?|who won)\b/i;
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
  return new AudioContextCtor(options);
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

export async function getMicrophoneStreamWithFallback(): Promise<MediaStream> {
  const attemptConstraints: MediaStreamConstraints[] = [
    {
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    },
    {
      audio: {
        channelCount: 1,
      },
      video: false,
    },
    {
      audio: true,
      video: false,
    },
  ];

  let lastError: unknown = null;
  for (let index = 0; index < attemptConstraints.length; index += 1) {
    try {
      return await getUserMediaWithTimeout(
        attemptConstraints[index],
        MICROPHONE_PERMISSION_TIMEOUT_MS,
      );
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("Microphone permission was denied or unavailable");
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
  private audioContextKeepAliveInterval: number | null = null;
  private audioNoiseGateHangoverFrames = 0;
  private audioNoiseGateConsecutiveDrops = 0;
  private audioNoiseGateFailOpenFramesRemaining = 0;
  private assistantTurnActive = false;
  private assistantPlaybackTailUntilMs = 0;
  private conversationId: string | null = null;
  private liveGoogleSearchEnabled = false;
  private liveMorningBriefFunctionCallingEnabled = false;
  private liveGooglePersonalContextFunctionCallingEnabled = false;
  private liveFunctionCallingEnabled = false;
  private pendingWebSearchTurn = false;
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
    const morningBriefFunctionCallingEnabled = Boolean(
      params.morningBriefFunctionCallingEnabled,
    ) && ENABLE_MORNING_BRIEF_VOICE_MODE;
    const googlePersonalContextFunctionCallingEnabled = Boolean(
      params.googlePersonalContextFunctionCallingEnabled,
    ) && ENABLE_GOOGLE_PERSONAL_CONTEXT_VOICE_MODE;
    this.liveGoogleSearchEnabled = googleSearchGroundingEnabled;
    this.liveMorningBriefFunctionCallingEnabled =
      morningBriefFunctionCallingEnabled;
    this.liveGooglePersonalContextFunctionCallingEnabled =
      googlePersonalContextFunctionCallingEnabled;
    this.liveFunctionCallingEnabled =
      morningBriefFunctionCallingEnabled ||
      googlePersonalContextFunctionCallingEnabled;
    this.pendingWebSearchTurn = false;
    this.webSearchGroundedThisTurn = false;
    this.webSearchNudgeSentThisTurn = false;

    const CONNECTION_TIMEOUT_MS = 15_000;
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
    this.conversationId = null;
    this.liveGoogleSearchEnabled = false;
    this.liveMorningBriefFunctionCallingEnabled = false;
    this.liveGooglePersonalContextFunctionCallingEnabled = false;
    this.liveFunctionCallingEnabled = false;
    this.pendingWebSearchTurn = false;
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

  private isAssistantAudioLikelyActive(): boolean {
    if (!this.outputContext) return false;
    return (
      this.activePlaybackNodes.size > 0 ||
      this.scheduledPlaybackTime > this.outputContext.currentTime + 0.04
    );
  }

  private isAssistantSpeechWindowActive(): boolean {
    if (!SUPPRESS_INPUT_WHILE_ASSISTANT_SPEAKING) return false;
    return (
      this.assistantTurnActive ||
      this.isAssistantAudioLikelyActive() ||
      Date.now() < this.assistantPlaybackTailUntilMs
    );
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
        audioPartCount,
        hasInputTranscription: Boolean(serverContent.inputTranscription?.text),
        hasOutputTranscription: Boolean(serverContent.outputTranscription?.text),
        hasGroundingMetadata,
        hasUrlContextMetadata,
        hasToolCall,
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

    if (serverContent.interrupted) {
      this.debug("live.server.interrupted");
      this.assistantTurnActive = false;
      this.assistantPlaybackTailUntilMs = Math.max(
        this.assistantPlaybackTailUntilMs,
        Date.now() + SUPPRESS_INPUT_COOLDOWN_MS,
      );
      this.clearPlaybackQueue();
    }

    for (const part of modelParts) {
      const audioData = part.inlineData?.data;
      if (audioData) {
        this.enqueueAudio(audioData);
      }
    }

    this.captureTranscript("user", serverContent.inputTranscription);
    this.captureTranscript("assistant", serverContent.outputTranscription);

    if (serverContent.turnComplete) {
      if (
        this.liveGoogleSearchEnabled &&
        this.pendingWebSearchTurn &&
        !this.webSearchGroundedThisTurn
      ) {
        this.emitWebSearchStatus("idle");
      }
      this.pendingWebSearchTurn = false;
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
    this.scheduledPlaybackTime += audioBuffer.duration;
    this.activePlaybackNodes.add(source);
    this.assistantPlaybackTailUntilMs = Math.max(
      this.assistantPlaybackTailUntilMs,
      Date.now() + Math.round(audioBuffer.duration * 1000) + SUPPRESS_INPUT_COOLDOWN_MS,
    );

    source.onended = () => {
      this.activePlaybackNodes.delete(source);
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

    const hasInboxCall = normalizedCalls.some(
      (call) => call.name === "get_inbox_digest" || call.name === "get_user_emails",
    );
    const hasCalendarCall = normalizedCalls.some(
      (call) => call.name === "get_calendar_events",
    );
    this.emitWebSearchStatus(
      "searching",
      hasCalendarCall
        ? "Checking your calendar…"
        : hasInboxCall
          ? "Checking your inbox…"
          : "Searching live sources…",
    );

    this.debug("live.tool_call.received", {
      functionCount: normalizedCalls.length,
      names: normalizedCalls.map((call) => call.name),
    });

    try {
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
        throw new Error(
          `Live tool-response request failed (${response.status})`,
        );
      }

      const payload = (await response.json()) as {
        functionResponses?: unknown;
        chatDigests?: unknown;
        webSearchEvents?: unknown;
      };

      const functionResponses = Array.isArray(payload.functionResponses)
        ? payload.functionResponses
        : [];
      const sendToolResponse = (
        this.session as Session & {
          sendToolResponse?: (payload: {
            functionResponses: Array<Record<string, unknown>>;
          }) => void;
        }
      ).sendToolResponse;

      if (functionResponses.length > 0 && sendToolResponse) {
        sendToolResponse({
          functionResponses: functionResponses as Array<Record<string, unknown>>,
        });
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
        this.emitWebSearchStatus("grounded", "Done.");
      }

      this.debug("live.tool_call.responded", {
        functionCount: normalizedCalls.length,
      });
    } catch (error) {
      this.debug("live.tool_call.failed", {
        message: error instanceof Error ? error.message : String(error),
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

  private debug(message: string, metadata?: Record<string, unknown>): void {
    this.callbacks.onDebug?.(message, metadata);
  }
}
