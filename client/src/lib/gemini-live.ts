import {
  ActivityHandling,
  GoogleGenAI,
  Modality,
  TurnCoverage,
  type LiveServerMessage,
  type Session,
} from "@google/genai";
import {
  analyzeTranscriptScript,
  evaluateUserTranscriptPersistence,
  resolveExpectedScriptFamilyForLanguage,
  shouldFlagTranscriptLanguageMismatch,
  type TranscriptScriptFamily,
} from "@shared/live-language";
import {
  resolveLiveAudioCompatibilityProfile as resolveSharedLiveAudioCompatibilityProfile,
  resolveLiveSpeechDetectionProfile,
  type LiveAudioCompatibilityProfile,
  type LiveSpeechDetectionProfile,
} from "@shared/live-audio-compatibility";

type TranscriptSender = "user" | "assistant";
type CameraFacingMode = "user" | "environment";
type LiveRealtimeInputPayload = Parameters<Session["sendRealtimeInput"]>[0];
export type LiveSpeechState =
  | "idle"
  | "candidate_user_speech"
  | "user_speaking"
  | "assistant_speaking"
  | "cooldown";
export type LiveInterruptTrigger = "none" | "button" | "speech_detector";
export type LiveSocketState =
  | "connecting"
  | "open"
  | "closing"
  | "closed"
  | "unavailable";
type LiveTranscriptionPayload = {
  text?: string;
  finished?: boolean;
};

export interface LiveTranscriptEvent {
  sender: TranscriptSender;
  text: string;
}

export type LiveWebSearchStatus = "searching" | "grounded" | "idle";

export interface LiveVoiceDebugState {
  speechState: LiveSpeechState;
  currentRms: number;
  ambientRms: number;
  activeThreshold: number;
  candidateThreshold: number;
  speechCandidateFrames: number;
  speechCandidatePeakRms: number;
  speechCandidateAverageRms: number;
  speechCandidateMs: number;
  speechCandidateSilenceMs: number;
  speechCandidateClearTargetMs: number;
  speechSilenceMs: number;
  speechEndSilenceTargetMs: number;
  activeUserSpeechWindowId: number | null;
  pendingTranscriptWindows: number;
  manualActivityActive: boolean;
  assistantTurnActive: boolean;
  interruptPending: boolean;
  interruptTrigger: LiveInterruptTrigger;
  lastInterruptReason: string | null;
  lastInterruptRequestedAt: number | null;
  manualInterruptWatchdogExpiresAt: number | null;
  sessionReadyForRealtimeInput: boolean;
  socketState: LiveSocketState;
  analyzerKind: "audio_worklet" | "script_processor";
  trackSettings: Record<string, unknown> | null;
  trackCapabilities: Record<string, unknown> | null;
  sessionResumptionHandle: string | null;
  sessionResumptionUpdatedAt: number | null;
  goAwayTimeLeft: string | null;
  goAwayReceivedAt: number | null;
  compatibilityPlatform: "desktop" | "android" | "ios";
  compatibilityIsMobile: boolean;
  compatibilityIsStandalonePwa: boolean;
  speechProfileMode: "desktop_default" | "mobile_relaxed";
  speechProfileThresholdScale: number;
  pendingGoogleReadVoiceSummarySource: "immediate" | "fallback" | null;
  pendingGoogleReadVoiceSummaryToolNames: string[];
  pendingGoogleReadVoiceSummarySentAt: number | null;
  pendingGoogleReadVoiceSummaryDeadlineAt: number | null;
  lastGoogleReadVoiceSummaryTimeoutAt: number | null;
}

export interface LiveSessionResumptionEvent {
  handle: string | null;
  resumable: boolean;
  lastConsumedClientMessageIndex: string | null;
  at: number;
}

export interface LiveGoAwayEvent {
  timeLeft: string | null;
  at: number;
}

export interface GeminiLiveVoiceSessionCallbacks {
  onTranscript?: (event: LiveTranscriptEvent) => void;
  onWebSearch?: (event: { status: LiveWebSearchStatus; label?: string }) => void;
  onMorningBriefDigest?: (event: { text: string }) => void;
  onError?: (error: Error) => void;
  onClosed?: (reason?: string) => void;
  onDebug?: (message: string, metadata?: Record<string, unknown>) => void;
  onDebugState?: (state: LiveVoiceDebugState) => void;
  onSessionResumption?: (event: LiveSessionResumptionEvent) => void;
  onGoAway?: (event: LiveGoAwayEvent) => void;
  getGoogleActionContext?: () => {
    connector?: "gmail" | "calendar";
    action?: string | null;
    actionableTargetId?: string | null;
    candidateTargetIds?: string[];
    sourceTurnId?: string | null;
    selectionReason?: string | null;
    surfaceKey?: string | null;
    selectionMode?: "auto" | "manual" | "dismissed";
  } | null;
  onConversationMutated?: (event: {
    conversationId: string;
    source: "live_tool_response";
  }) => void;
}

export interface GeminiLiveVoiceSessionStartParams {
  ephemeralToken: string;
  model: string;
  conversationId: string;
  sessionResumptionHandle?: string | null;
  preAcquiredMicStream?: MediaStream;
  expectedLanguageHint?: string | null;
  googleSearchGroundingEnabled?: boolean;
  morningBriefFunctionCallingEnabled?: boolean;
  googlePersonalContextFunctionCallingEnabled?: boolean;
}

type LiveGoogleActionContextHint = ReturnType<
  NonNullable<GeminiLiveVoiceSessionCallbacks["getGoogleActionContext"]>
>;

type PendingGoogleReadVoiceSummary = {
  digestTexts: string[];
  toolNames: string[];
  source: "immediate" | "fallback";
  sentAtMs: number;
  deadlineAtMs: number;
  assistantActivitySnapshotAtMs: number;
};

const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;
const VIDEO_FRAME_INTERVAL_MS = 1000;
const VIDEO_MAX_EDGE = 640;
const VIDEO_PERMISSION_TIMEOUT_MS = 12000;
const TRANSCRIPT_DUPLICATE_WINDOW_MS = 1500;
const TRANSCRIPT_FLUSH_DEBOUNCE_MS = 900;
const TRANSCRIPT_OVERLAP_MIN_CHARS = 6;
const GOOGLE_READ_VOICE_SUMMARY_ACK_TIMEOUT_MS = 5000;

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

type MicCaptureAttemptFailure = {
  attempt: number;
  label: string;
  errorName: string | null;
  errorMessage: string;
};

const liveClientEnv = (import.meta.env as Record<string, unknown>) ?? {};

function resolveLiveAudioCompatibilityProfile(): LiveAudioCompatibilityProfile {
  const userAgent =
    typeof navigator !== "undefined" && typeof navigator.userAgent === "string"
      ? navigator.userAgent
      : "";
  const maxTouchPoints =
    typeof navigator !== "undefined" &&
    typeof navigator.maxTouchPoints === "number"
      ? navigator.maxTouchPoints
      : 0;
  const isStandalonePwa =
    (typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(display-mode: standalone)").matches) ||
    (typeof navigator !== "undefined" &&
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone));

  const baseline = resolveSharedLiveAudioCompatibilityProfile({
    userAgent,
    maxTouchPoints,
    isStandalonePwa,
    legacyAndroidMaxMajor: parseClientPositiveInt(
      liveClientEnv.VITE_LIVE_ANDROID_LEGACY_MAX_MAJOR,
      10,
    ),
  });

  return {
    ...baseline,
    microphonePermissionTimeoutMs: parseClientPositiveInt(
      liveClientEnv.VITE_LIVE_MICROPHONE_PERMISSION_TIMEOUT_MS,
      baseline.microphonePermissionTimeoutMs,
    ),
    connectionTimeoutMs: parseClientPositiveInt(
      liveClientEnv.VITE_LIVE_CONNECTION_TIMEOUT_MS,
      baseline.connectionTimeoutMs,
    ),
  };
}
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
  260,
);
const ASSISTANT_TURN_RELEASE_GRACE_MS = parseClientPositiveInt(
  liveClientEnv.VITE_LIVE_ASSISTANT_TURN_RELEASE_GRACE_MS,
  Math.max(360, SUPPRESS_INPUT_COOLDOWN_MS + 140),
);
const ASSISTANT_TURN_STALL_TIMEOUT_MS = parseClientPositiveInt(
  liveClientEnv.VITE_LIVE_ASSISTANT_TURN_STALL_TIMEOUT_MS,
  12000,
);
const ASSISTANT_TURN_IDLE_RELEASE_MS = parseClientPositiveInt(
  liveClientEnv.VITE_LIVE_ASSISTANT_TURN_IDLE_RELEASE_MS,
  1200,
);
const ENABLE_ASSISTANT_BARGE_IN = parseClientBoolean(
  liveClientEnv.VITE_LIVE_AUDIO_BARGE_IN_ENABLED,
  true,
);
const ASSISTANT_BARGE_IN_RMS_THRESHOLD = parseClientBoundedNumber(
  liveClientEnv.VITE_LIVE_AUDIO_BARGE_IN_RMS_THRESHOLD,
  0.02,
  0.008,
  0.08,
);
const ASSISTANT_BARGE_IN_CONSECUTIVE_FRAMES = parseClientPositiveInt(
  liveClientEnv.VITE_LIVE_AUDIO_BARGE_IN_CONSECUTIVE_FRAMES,
  5,
);
const ASSISTANT_BARGE_IN_AMBIENT_MULTIPLIER = parseClientBoundedNumber(
  liveClientEnv.VITE_LIVE_AUDIO_BARGE_IN_AMBIENT_MULTIPLIER,
  2.2,
  1.2,
  8,
);
const ASSISTANT_BARGE_IN_MAX_RMS_THRESHOLD = parseClientBoundedNumber(
  liveClientEnv.VITE_LIVE_AUDIO_BARGE_IN_MAX_RMS_THRESHOLD,
  0.045,
  0.012,
  0.12,
);
const ASSISTANT_BARGE_IN_MIN_GAP_MS = parseClientPositiveInt(
  liveClientEnv.VITE_LIVE_AUDIO_BARGE_IN_MIN_GAP_MS,
  1400,
);
const ASSISTANT_IDLE_RELEASE_USER_SPEECH_RMS_THRESHOLD = parseClientBoundedNumber(
  liveClientEnv.VITE_LIVE_AUDIO_ASSISTANT_IDLE_RELEASE_USER_SPEECH_RMS_THRESHOLD,
  0.007,
  0.004,
  0.05,
);
const ASSISTANT_IDLE_RELEASE_AMBIENT_MULTIPLIER = parseClientBoundedNumber(
  liveClientEnv.VITE_LIVE_AUDIO_ASSISTANT_IDLE_RELEASE_AMBIENT_MULTIPLIER,
  1.2,
  1,
  4,
);
const SUPPRESS_USER_TRANSCRIPT_DURING_ASSISTANT_SPEECH = parseClientBoolean(
  liveClientEnv.VITE_LIVE_AUDIO_SUPPRESS_USER_TRANSCRIPT_DURING_ASSISTANT_SPEECH,
  true,
);
const USER_SPEECH_START_RMS_THRESHOLD = parseClientBoundedNumber(
  liveClientEnv.VITE_LIVE_AUDIO_USER_SPEECH_RMS_THRESHOLD,
  0.008,
  0.003,
  0.08,
);
const USER_SPEECH_ASSISTANT_RMS_THRESHOLD = parseClientBoundedNumber(
  liveClientEnv.VITE_LIVE_AUDIO_USER_SPEECH_ASSISTANT_RMS_THRESHOLD,
  Math.max(USER_SPEECH_START_RMS_THRESHOLD, ASSISTANT_BARGE_IN_RMS_THRESHOLD),
  0.004,
  0.08,
);
const USER_SPEECH_AMBIENT_MULTIPLIER = parseClientBoundedNumber(
  liveClientEnv.VITE_LIVE_AUDIO_USER_SPEECH_AMBIENT_MULTIPLIER,
  1.6,
  1,
  6,
);
const USER_SPEECH_ASSISTANT_AMBIENT_MULTIPLIER = parseClientBoundedNumber(
  liveClientEnv.VITE_LIVE_AUDIO_USER_SPEECH_ASSISTANT_AMBIENT_MULTIPLIER,
  Math.max(1.8, ASSISTANT_BARGE_IN_AMBIENT_MULTIPLIER),
  1,
  8,
);
const USER_SPEECH_ASSISTANT_MAX_RMS_THRESHOLD = parseClientBoundedNumber(
  liveClientEnv.VITE_LIVE_AUDIO_USER_SPEECH_ASSISTANT_MAX_RMS_THRESHOLD,
  Math.min(ASSISTANT_BARGE_IN_MAX_RMS_THRESHOLD, 0.04),
  0.01,
  0.09,
);
const USER_SPEECH_IDLE_MAX_RMS_THRESHOLD = parseClientBoundedNumber(
  liveClientEnv.VITE_LIVE_AUDIO_USER_SPEECH_IDLE_MAX_RMS_THRESHOLD,
  Math.min(USER_SPEECH_ASSISTANT_MAX_RMS_THRESHOLD, 0.024),
  0.006,
  0.09,
);
const USER_SPEECH_START_CONSECUTIVE_FRAMES = parseClientPositiveInt(
  liveClientEnv.VITE_LIVE_AUDIO_USER_SPEECH_START_CONSECUTIVE_FRAMES,
  3,
);
const USER_SPEECH_ASSISTANT_CONSECUTIVE_FRAMES = parseClientPositiveInt(
  liveClientEnv.VITE_LIVE_AUDIO_USER_SPEECH_ASSISTANT_CONSECUTIVE_FRAMES,
  5,
);
const USER_SPEECH_END_SILENCE_FRAMES = parseClientPositiveInt(
  liveClientEnv.VITE_LIVE_AUDIO_USER_SPEECH_END_SILENCE_FRAMES,
  18,
);
const USER_SPEECH_PREFIX_FRAMES = parseClientPositiveInt(
  liveClientEnv.VITE_LIVE_AUDIO_USER_SPEECH_PREFIX_FRAMES,
  8,
);
const USER_SPEECH_COOLDOWN_MS = parseClientPositiveInt(
  liveClientEnv.VITE_LIVE_AUDIO_USER_SPEECH_COOLDOWN_MS,
  220,
);
const USER_SPEECH_CANDIDATE_HYSTERESIS_MULTIPLIER = parseClientBoundedNumber(
  liveClientEnv.VITE_LIVE_AUDIO_USER_SPEECH_CANDIDATE_HYSTERESIS_MULTIPLIER,
  0.72,
  0.5,
  1,
);
const USER_SPEECH_CANDIDATE_MIN_RMS_THRESHOLD = parseClientBoundedNumber(
  liveClientEnv.VITE_LIVE_AUDIO_USER_SPEECH_CANDIDATE_MIN_RMS_THRESHOLD,
  0.0055,
  0.003,
  0.02,
);
const USER_SPEECH_CANDIDATE_CLEAR_SILENCE_MS = parseClientPositiveInt(
  liveClientEnv.VITE_LIVE_AUDIO_USER_SPEECH_CANDIDATE_CLEAR_SILENCE_MS,
  48,
);
const USER_SPEECH_AMBIENT_FLOOR_RISE_SMOOTHING = parseClientBoundedNumber(
  liveClientEnv.VITE_LIVE_AUDIO_USER_SPEECH_AMBIENT_FLOOR_RISE_SMOOTHING,
  0.02,
  0.001,
  0.2,
);
const USER_SPEECH_AMBIENT_FLOOR_FALL_SMOOTHING = parseClientBoundedNumber(
  liveClientEnv.VITE_LIVE_AUDIO_USER_SPEECH_AMBIENT_FLOOR_FALL_SMOOTHING,
  0.12,
  0.01,
  0.4,
);
const USER_SPEECH_AMBIENT_FLOOR_SPEECH_SPIKE_GUARD = parseClientBoundedNumber(
  liveClientEnv.VITE_LIVE_AUDIO_USER_SPEECH_AMBIENT_FLOOR_SPEECH_SPIKE_GUARD,
  1.35,
  1,
  4,
);
const USER_SPEECH_REFERENCE_FRAME_DURATION_MS =
  (PROCESSOR_BUFFER_SIZE / INPUT_SAMPLE_RATE) * 1000;
const USER_SPEECH_START_MIN_DURATION_MS =
  USER_SPEECH_START_CONSECUTIVE_FRAMES * USER_SPEECH_REFERENCE_FRAME_DURATION_MS;
const USER_SPEECH_ASSISTANT_MIN_DURATION_MS =
  USER_SPEECH_ASSISTANT_CONSECUTIVE_FRAMES *
  USER_SPEECH_REFERENCE_FRAME_DURATION_MS;
const USER_SPEECH_END_SILENCE_MIN_DURATION_MS =
  USER_SPEECH_END_SILENCE_FRAMES * USER_SPEECH_REFERENCE_FRAME_DURATION_MS;
const MANUAL_INTERRUPT_IDLE_TIMEOUT_MS = parseClientPositiveInt(
  liveClientEnv.VITE_LIVE_AUDIO_MANUAL_INTERRUPT_IDLE_TIMEOUT_MS,
  1400,
);
const USER_SPEECH_TRANSCRIPT_EXPECTATION_TIMEOUT_MS = parseClientPositiveInt(
  liveClientEnv.VITE_LIVE_AUDIO_TRANSCRIPT_EXPECTATION_TIMEOUT_MS,
  2200,
);
const MOBILE_USER_SPEECH_THRESHOLD_SCALE = parseClientBoundedNumber(
  liveClientEnv.VITE_LIVE_AUDIO_MOBILE_THRESHOLD_SCALE,
  0.84,
  0.5,
  1,
);
const MOBILE_USER_SPEECH_ASSISTANT_THRESHOLD_SCALE = parseClientBoundedNumber(
  liveClientEnv.VITE_LIVE_AUDIO_MOBILE_ASSISTANT_THRESHOLD_SCALE,
  0.88,
  0.5,
  1.2,
);
const MOBILE_USER_SPEECH_AMBIENT_MULTIPLIER_SCALE = parseClientBoundedNumber(
  liveClientEnv.VITE_LIVE_AUDIO_MOBILE_AMBIENT_MULTIPLIER_SCALE,
  0.82,
  0.5,
  1.5,
);
const MOBILE_USER_SPEECH_IDLE_MAX_RMS_CAP = parseClientBoundedNumber(
  liveClientEnv.VITE_LIVE_AUDIO_MOBILE_IDLE_MAX_RMS_CAP,
  0.02,
  0.006,
  0.08,
);
const MOBILE_USER_SPEECH_ASSISTANT_MAX_RMS_CAP = parseClientBoundedNumber(
  liveClientEnv.VITE_LIVE_AUDIO_MOBILE_ASSISTANT_MAX_RMS_CAP,
  0.03,
  0.01,
  0.09,
);
const MOBILE_USER_SPEECH_START_MIN_DURATION_MULTIPLIER = parseClientBoundedNumber(
  liveClientEnv.VITE_LIVE_AUDIO_MOBILE_START_MIN_DURATION_MULTIPLIER,
  0.85,
  0.5,
  1.5,
);
const MOBILE_USER_SPEECH_ASSISTANT_MIN_DURATION_MULTIPLIER = parseClientBoundedNumber(
  liveClientEnv.VITE_LIVE_AUDIO_MOBILE_ASSISTANT_MIN_DURATION_MULTIPLIER,
  0.88,
  0.5,
  1.5,
);
const MOBILE_USER_SPEECH_END_SILENCE_MULTIPLIER = parseClientBoundedNumber(
  liveClientEnv.VITE_LIVE_AUDIO_MOBILE_END_SILENCE_MULTIPLIER,
  1.35,
  1,
  3,
);
const MOBILE_USER_SPEECH_CANDIDATE_CLEAR_MULTIPLIER = parseClientBoundedNumber(
  liveClientEnv.VITE_LIVE_AUDIO_MOBILE_CANDIDATE_CLEAR_MULTIPLIER,
  2.1,
  1,
  4,
);
const MOBILE_USER_SPEECH_MIN_CANDIDATE_CLEAR_MS = parseClientPositiveInt(
  liveClientEnv.VITE_LIVE_AUDIO_MOBILE_MIN_CANDIDATE_CLEAR_MS,
  96,
);
const MOBILE_USER_SPEECH_MIN_END_SILENCE_MS = parseClientPositiveInt(
  liveClientEnv.VITE_LIVE_AUDIO_MOBILE_MIN_END_SILENCE_MS,
  760,
);
const MOBILE_ASSISTANT_BARGE_IN_MIN_DURATION_MS = parseClientPositiveInt(
  liveClientEnv.VITE_LIVE_AUDIO_MOBILE_ASSISTANT_BARGE_IN_MIN_DURATION_MS,
  320,
);
const MOBILE_ASSISTANT_BARGE_IN_MIN_PEAK_RMS = parseClientBoundedNumber(
  liveClientEnv.VITE_LIVE_AUDIO_MOBILE_ASSISTANT_BARGE_IN_MIN_PEAK_RMS,
  0.034,
  0.01,
  0.1,
);
const MOBILE_ASSISTANT_BARGE_IN_PEAK_THRESHOLD_MULTIPLIER = parseClientBoundedNumber(
  liveClientEnv.VITE_LIVE_AUDIO_MOBILE_ASSISTANT_BARGE_IN_PEAK_THRESHOLD_MULTIPLIER,
  1.65,
  1,
  3,
);
const MOBILE_ASSISTANT_BARGE_IN_MIN_AVG_RMS = parseClientBoundedNumber(
  liveClientEnv.VITE_LIVE_AUDIO_MOBILE_ASSISTANT_BARGE_IN_MIN_AVG_RMS,
  0.023,
  0.008,
  0.08,
);
const MOBILE_ASSISTANT_BARGE_IN_AVG_THRESHOLD_MULTIPLIER = parseClientBoundedNumber(
  liveClientEnv.VITE_LIVE_AUDIO_MOBILE_ASSISTANT_BARGE_IN_AVG_THRESHOLD_MULTIPLIER,
  1.15,
  1,
  3,
);
const MOBILE_ASSISTANT_BARGE_IN_REQUIRE_THRESHOLD_FRAME = parseClientBoolean(
  liveClientEnv.VITE_LIVE_AUDIO_MOBILE_ASSISTANT_BARGE_IN_REQUIRE_THRESHOLD_FRAME,
  true,
);
const MOBILE_ASSISTANT_BARGE_IN_DISABLE_HYSTERESIS = parseClientBoolean(
  liveClientEnv.VITE_LIVE_AUDIO_MOBILE_ASSISTANT_BARGE_IN_DISABLE_HYSTERESIS,
  true,
);
const MOBILE_ASSISTANT_CANDIDATE_CLEAR_TARGET_MS = parseClientPositiveInt(
  liveClientEnv.VITE_LIVE_AUDIO_MOBILE_ASSISTANT_CANDIDATE_CLEAR_TARGET_MS,
  72,
);
const LIVE_DEBUG_STATE_EMIT_MIN_INTERVAL_MS = parseClientPositiveInt(
  liveClientEnv.VITE_LIVE_DEBUG_STATE_EMIT_MIN_INTERVAL_MS,
  160,
);
const LIVE_WEB_SEARCH_SIGNAL_PATTERN =
  /\b(search|look up|google|latest|current|today|news|headline|what happened|updates?|did you see|last super bowl|super\s*bowl|score|standings?|who won)\b/i;
const LIVE_EMAIL_SIGNAL_PATTERN = /\b(email|emails|inbox|unread|mail|gmail)\b/i;
const LIVE_EMAIL_ACTION_PATTERN =
  /\b(reply|respond|draft|write|send|edit|change|update|revise|rewrite|short(?:en|er)?|lengthen|longer|warmer|friendlier|recipient|subject)\b/i;
const LIVE_EMAIL_DETAIL_PATTERN =
  /\b(full|thread|details?|detail|read more|show me|before i reply)\b/i;
const LIVE_CALENDAR_SIGNAL_PATTERN =
  /\b(calendar|meeting|meetings|schedule|event|events|appointment|appointments)\b/i;
const LIVE_CALENDAR_ACTION_PATTERN =
  /\b(schedule|create|add|put|book|block(?:\s+off)?|hold|mark|move|reschedule|change|update)\b/i;
const LIVE_CALENDAR_DETAIL_PATTERN =
  /\b(details?|detail|description|location|attendees|what changed|invite|read me)\b/i;
const LIVE_CALENDAR_FOLLOWUP_TIME_PATTERN =
  /\b(tomorrow|tomor+ow|tomore|tmrw|rest\s+of\s+the\s+week|later\s+this\s+week|this\s+week|next\s+week|next\s+7\s+days|next\s+few\s+days|weekend)\b/i;
const LIVE_CALENDAR_FOLLOWUP_REQUEST_PATTERN =
  /\b(how\s+about|what\s+about|check(\s+again)?|look(\s+again)?|can\s+you\s+check|what\s+do\s+i\s+have|do\s+i\s+have|am\s+i\s+free|anything\s+on)\b/i;
const LIVE_EMAIL_CONTEXT_FOLLOWUP_PATTERN =
  /\b(send(?:\s+it|\s+that|\s+this)?|approve|looks\s+good|go\s+ahead|make\s+it|edit|change|update|revise|rewrite|short(?:en|er)?|lengthen|longer|warmer|friendlier|recipient|subject|to\s+field|email\s+address|send\s+to|change\s+the\s+to)\b|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const LIVE_CALENDAR_CONTEXT_FOLLOWUP_PATTERN =
  /\b(book|put|add|create|schedule|hold|block(?:\s+off)?|move|reschedule|change|update|location|title|call\s+it|notes?|description|time|that\s+time|that\s+meeting|that\s+event|today|tomor+ow|tomore|tmrw|this\s+week|next\s+week|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december)\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i;
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
    name: "get_email_thread_detail",
    description:
      "Retrieve a detailed Gmail thread view, including latest message content and participants, for a user-referenced email.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
      },
      required: ["query"],
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
  {
    name: "get_calendar_event_detail",
    description:
      "Retrieve a detailed Google Calendar event, including attendees, location, and description, for a user-referenced event.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        timeRange: {
          type: "string",
          enum: ["today", "tomorrow", "this_week", "next_7_days"],
        },
        timezone: { type: "string" },
      },
      required: ["query", "timeRange", "timezone"],
    },
  },
  {
    name: "prepare_google_email_action",
    description:
      "Prepare an approval-gated Gmail draft, reply, or send action from the user's natural-language request.",
    parameters: {
      type: "object",
      properties: {
        request: { type: "string" },
      },
      required: ["request"],
    },
  },
  {
    name: "prepare_google_calendar_action",
    description:
      "Prepare an approval-gated Google Calendar create or update action from the user's natural-language request.",
    parameters: {
      type: "object",
      properties: {
        request: { type: "string" },
        timezone: { type: "string" },
      },
      required: ["request", "timezone"],
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
  activeGoogleActionContext?: LiveGoogleActionContextHint | null,
): LivePersonalContextIntent | null {
  const hasEmailIntent = LIVE_EMAIL_SIGNAL_PATTERN.test(text);
  const hasCalendarIntent =
    LIVE_CALENDAR_SIGNAL_PATTERN.test(text) ||
    (LIVE_CALENDAR_FOLLOWUP_TIME_PATTERN.test(text) &&
      LIVE_CALENDAR_FOLLOWUP_REQUEST_PATTERN.test(text));
  if (hasEmailIntent && hasCalendarIntent) return "both";
  if (hasEmailIntent) return "email";
  if (hasCalendarIntent) return "calendar";
  if (activeGoogleActionContext?.connector === "gmail") {
    return LIVE_EMAIL_CONTEXT_FOLLOWUP_PATTERN.test(text) ? "email" : null;
  }
  if (activeGoogleActionContext?.connector === "calendar") {
    return LIVE_CALENDAR_CONTEXT_FOLLOWUP_PATTERN.test(text)
      ? "calendar"
      : null;
  }
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

function inferEmailLookupLoadingLabel(query: string): string {
  const normalized = normalizeText(query).toLowerCase();
  if (LIVE_EMAIL_ACTION_PATTERN.test(query)) {
    return "Preparing your email action…";
  }
  if (LIVE_EMAIL_DETAIL_PATTERN.test(query)) {
    return "Retrieving email details…";
  }
  if (/\bunread\b/.test(normalized)) {
    return "Checking unread emails…";
  }
  if (/\b(recent|latest|last\s+(day|few\s+days|week)|today)\b/.test(normalized)) {
    return "Checking recent emails…";
  }
  return "Checking your inbox…";
}

function inferCalendarLookupLoadingLabel(query: string): string {
  const normalized = normalizeText(query).toLowerCase();
  if (LIVE_CALENDAR_ACTION_PATTERN.test(query)) {
    return "Preparing your calendar action…";
  }
  if (LIVE_CALENDAR_DETAIL_PATTERN.test(query)) {
    return "Retrieving calendar details…";
  }
  if (/\btomorrow\b/.test(normalized)) {
    return "Checking tomorrow's calendar…";
  }
  if (/\b(this\s+week|later\s+this\s+week|weekend)\b/.test(normalized)) {
    return "Checking this week's calendar…";
  }
  if (/\b(next\s+week|next\s+7\s+days|next\s+few\s+days)\b/.test(normalized)) {
    return "Checking upcoming calendar events…";
  }
  return "Checking your calendar…";
}

function inferPersonalContextLoadingLabel(
  query: string,
  intent: LivePersonalContextIntent,
): string {
  if (intent === "both") {
    return "Checking your inbox and calendar…";
  }
  if (intent === "email") {
    return inferEmailLookupLoadingLabel(query);
  }
  return inferCalendarLookupLoadingLabel(query);
}

function buildPersonalContextToolInstruction(
  query: string,
  intent: LivePersonalContextIntent,
  activeGoogleActionContext?: LiveGoogleActionContextHint | null,
): string {
  const calendarTimeRange = inferCalendarTimeRangeForNudge(query);
  const hasEmailActionIntent =
    LIVE_EMAIL_ACTION_PATTERN.test(query) ||
    (activeGoogleActionContext?.connector === "gmail" &&
      LIVE_EMAIL_CONTEXT_FOLLOWUP_PATTERN.test(query));
  const hasCalendarActionIntent =
    LIVE_CALENDAR_ACTION_PATTERN.test(query) ||
    (activeGoogleActionContext?.connector === "calendar" &&
      LIVE_CALENDAR_CONTEXT_FOLLOWUP_PATTERN.test(query));
  if (intent === "both") {
    return `Call get_user_emails with {"refresh": true} and get_calendar_events with {"timeRange":"${calendarTimeRange}","timezone":"user_local","refresh": true} before answering.`;
  }
  if (intent === "email" && hasEmailActionIntent) {
    return activeGoogleActionContext?.connector === "gmail"
      ? 'Call prepare_google_email_action with {"request":"<full user request>"} before answering. This follow-up refers to the current Zee Mail draft/card, so do not answer conversationally or start a fresh draft unless the tool says more info is needed.'
      : 'Call prepare_google_email_action with {"request":"<full user request>"} before answering. Do not answer conversationally instead of using the Gmail action tool.';
  }
  if (intent === "email" && LIVE_EMAIL_DETAIL_PATTERN.test(query)) {
    return 'Call get_email_thread_detail with {"query":"<full user request>"} before answering.';
  }
  if (intent === "calendar" && hasCalendarActionIntent) {
    return activeGoogleActionContext?.connector
      ? 'Call prepare_google_calendar_action with {"request":"<full user request>","timezone":"user_local"} before answering. This may be a follow-up to the current task context, so do not answer conversationally instead of using the calendar action tool.'
      : 'Call prepare_google_calendar_action with {"request":"<full user request>","timezone":"user_local"} before answering. Do not answer conversationally instead of using the calendar action tool.';
  }
  if (intent === "calendar" && LIVE_CALENDAR_DETAIL_PATTERN.test(query)) {
    return `Call get_calendar_event_detail with {"query":"<full user request>","timeRange":"${calendarTimeRange}","timezone":"user_local"} before answering.`;
  }
  if (intent === "calendar") {
    return `Call get_calendar_events with {"timeRange":"${calendarTimeRange}","timezone":"user_local","refresh": true} before answering.`;
  }
  return 'Call get_user_emails with {"refresh": true} before answering.';
}

function isReadOnlyPersonalContextIntent(
  query: string,
  intent: LivePersonalContextIntent,
  activeGoogleActionContext?: LiveGoogleActionContextHint | null,
): boolean {
  const hasEmailActionIntent =
    LIVE_EMAIL_ACTION_PATTERN.test(query) ||
    (activeGoogleActionContext?.connector === "gmail" &&
      LIVE_EMAIL_CONTEXT_FOLLOWUP_PATTERN.test(query));
  const hasCalendarActionIntent =
    LIVE_CALENDAR_ACTION_PATTERN.test(query) ||
    (activeGoogleActionContext?.connector === "calendar" &&
      LIVE_CALENDAR_CONTEXT_FOLLOWUP_PATTERN.test(query));
  const hasEmailDetailIntent = LIVE_EMAIL_DETAIL_PATTERN.test(query);
  const hasCalendarDetailIntent = LIVE_CALENDAR_DETAIL_PATTERN.test(query);
  if (intent === "both") {
    return !hasEmailActionIntent && !hasCalendarActionIntent;
  }
  if (intent === "email") {
    return !hasEmailActionIntent && !hasEmailDetailIntent;
  }
  return !hasCalendarActionIntent && !hasCalendarDetailIntent;
}

function inferEmailSinceDaysForRead(query: string): number {
  const normalized = normalizeText(query).toLowerCase();
  if (/\b(today|since today|this morning|this afternoon|tonight)\b/.test(normalized)) {
    return 1;
  }
  if (/\b(yesterday|last 2 days|past 2 days)\b/.test(normalized)) {
    return 2;
  }
  if (/\b(this week|week|recent|lately|latest)\b/.test(normalized)) {
    return 7;
  }
  return 3;
}

function buildDirectPersonalContextReadFunctionCalls(
  query: string,
  intent: LivePersonalContextIntent,
): Array<{ id: string; name: string; args: Record<string, unknown> }> {
  const calls: Array<{ id: string; name: string; args: Record<string, unknown> }> = [];
  const normalized = normalizeText(query).toLowerCase();
  if (intent === "email" || intent === "both") {
    calls.push({
      id: crypto.randomUUID(),
      name: "get_user_emails",
      args: {
        refresh: true,
        unreadOnly: /\bunread\b/.test(normalized),
        sinceDays: inferEmailSinceDaysForRead(normalized),
      },
    });
  }
  if (intent === "calendar" || intent === "both") {
    calls.push({
      id: crypto.randomUUID(),
      name: "get_calendar_events",
      args: {
        refresh: true,
        timeRange: inferCalendarTimeRangeForNudge(query),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      },
    });
  }
  return calls;
}

const LIVE_GOOGLE_PERSONAL_CONTEXT_TOOL_NAMES = new Set([
  "get_user_emails",
  "get_email_thread_detail",
  "get_calendar_events",
  "get_calendar_event_detail",
  "prepare_google_email_action",
  "prepare_google_calendar_action",
]);

const LIVE_GOOGLE_PERSONAL_CONTEXT_READ_TOOL_NAMES = new Set([
  "get_user_emails",
  "get_email_thread_detail",
  "get_calendar_events",
  "get_calendar_event_detail",
]);

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

type BufferedAudioFrame = {
  pcmBase64: string;
  at: number;
};

type UserSpeechWindowDiagnostics = {
  id: number;
  trigger: LiveInterruptTrigger;
  reason: string;
  startedAtMs: number;
  endedAtMs: number | null;
  endReason: string | null;
  frameCount: number;
  speechLikeFrameCount: number;
  sumRms: number;
  peakRms: number;
  transcriptReceived: boolean;
  transcriptCharCount: number;
  transcriptReceivedAtMs: number | null;
};

function sanitizeMediaTrackInfo(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const sanitized: Record<string, unknown> = {};
  Object.entries(input as Record<string, unknown>).forEach(([key, value]) => {
    if (value === null) {
      sanitized[key] = null;
      return;
    }
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      sanitized[key] = value;
      return;
    }
    if (Array.isArray(value)) {
      sanitized[key] = value.filter(
        (item) =>
          item === null ||
          typeof item === "string" ||
          typeof item === "number" ||
          typeof item === "boolean",
      );
    }
  });

  return Object.keys(sanitized).length > 0 ? sanitized : null;
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
  const compatibility = resolveLiveAudioCompatibilityProfile();
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
    liveAudioCompatibility: compatibility,
  };
}

export async function getMicrophoneStreamWithFallback(): Promise<MediaStream> {
  const compatibility = resolveLiveAudioCompatibilityProfile();
  const attemptConstraints: Array<{
    label: string;
    constraints: MediaStreamConstraints;
  }> = compatibility.isMobile
    ? [
        {
          label: "mobile_voice_safe",
          constraints: {
            audio: {
              channelCount: 1,
              echoCancellation: true,
              noiseSuppression: false,
              autoGainControl: false,
            },
            video: false,
          },
        },
        {
          label: "mobile_processed_mono",
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
      ]
    : [
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
  private sessionReadyForRealtimeInput = false;
  private outputContext: AudioContext | null = null;
  private inputContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private mediaSourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private analyzerNode: AudioWorkletNode | null = null;
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
  private speechState: LiveSpeechState = "idle";
  private manualActivityActive = false;
  private assistantPlaybackTailUntilMs = 0;
  private assistantSpeechWindowStartMs = 0;
  private assistantTurnReleaseAtMs = 0;
  private assistantTurnIdleReleaseTimeout: number | null = null;
  private speechCooldownTimeout: number | null = null;
  private lastAssistantActivityAtMs = 0;
  private latestInputRms = 0;
  private activeSpeechThreshold = USER_SPEECH_START_RMS_THRESHOLD;
  private candidateSpeechThreshold = USER_SPEECH_START_RMS_THRESHOLD;
  private inputAmbientRms = 0;
  private speechCandidateFrames = 0;
  private speechSilenceFrames = 0;
  private speechCandidateMs = 0;
  private speechCandidateSilenceMs = 0;
  private speechSilenceMs = 0;
  private speechCandidatePeakRms = 0;
  private speechCandidateSumRms = 0;
  private compatibilityProfile: LiveAudioCompatibilityProfile =
    resolveSharedLiveAudioCompatibilityProfile();
  private speechDetectionProfile: LiveSpeechDetectionProfile = {
    mode: "desktop_default",
    thresholdScale: 1,
    assistantThresholdScale: 1,
    ambientMultiplierScale: 1,
    idleMaxRmsCap: null,
    assistantMaxRmsCap: null,
    startMinSpeechDurationMultiplier: 1,
    assistantMinSpeechDurationMultiplier: 1,
    endSilenceDurationMultiplier: 1,
    candidateClearSilenceMultiplier: 1,
    minimumCandidateClearSilenceMs: 0,
    minimumEndSilenceMs: 0,
  };
  private speechCandidateClearTargetMs = USER_SPEECH_CANDIDATE_CLEAR_SILENCE_MS;
  private speechEndSilenceTargetMs = USER_SPEECH_END_SILENCE_MIN_DURATION_MS;
  private speechStartMinDurationMs = USER_SPEECH_START_MIN_DURATION_MS;
  private speechAssistantMinDurationMs = USER_SPEECH_ASSISTANT_MIN_DURATION_MS;
  private candidateClearBurstCount = 0;
  private candidateClearBurstWindowStartAtMs = 0;
  private candidateClearBurstLastAtMs = 0;
  private lastMobileBargeInRejectedAtMs = 0;
  private interruptPending = false;
  private interruptTrigger: LiveInterruptTrigger = "none";
  private lastInterruptReason: string | null = null;
  private lastInterruptRequestedAt: number | null = null;
  private manualInterruptSpeechObserved = false;
  private manualInterruptWatchdogTimeout: number | null = null;
  private manualInterruptWatchdogExpiresAt: number | null = null;
  private bufferedPrefixAudioFrames: BufferedAudioFrame[] = [];
  private analyzerKind: "audio_worklet" | "script_processor" = "script_processor";
  private userSpeechWindowSequence = 0;
  private activeUserSpeechWindow: UserSpeechWindowDiagnostics | null = null;
  private pendingUserSpeechWindows: UserSpeechWindowDiagnostics[] = [];
  private pendingUserSpeechWindowTimeouts = new Map<number, number>();
  private debugStateTrackSettings: Record<string, unknown> | null = null;
  private debugStateTrackCapabilities: Record<string, unknown> | null = null;
  private latestSessionResumptionHandle: string | null = null;
  private latestSessionResumptionUpdatedAt: number | null = null;
  private latestGoAwayTimeLeft: string | null = null;
  private latestGoAwayReceivedAt: number | null = null;
  private lastDebugStateEmittedAtMs = 0;
  private lastDebugStateSnapshot = "";
  private lastSocketNotOpenLogAtMs = 0;
  private conversationId: string | null = null;
  private liveGoogleSearchEnabled = false;
  private liveMorningBriefFunctionCallingEnabled = false;
  private liveGooglePersonalContextFunctionCallingEnabled = false;
  private liveFunctionCallingEnabled = false;
  private pendingWebSearchTurn = false;
  private pendingPersonalContextTurn = false;
  private personalContextToolCalledThisTurn = false;
  private personalContextNudgeSentThisTurn = false;
  private pendingPersonalContextReadFallback:
    | {
        text: string;
        intent: LivePersonalContextIntent;
        activeGoogleActionContext: LiveGoogleActionContextHint | null;
      }
    | null = null;
  private googleReadVoiceFallbackTimeout: number | null = null;
  private googleReadVoiceSummaryAckTimeout: number | null = null;
  private pendingGoogleReadVoiceSummary: PendingGoogleReadVoiceSummary | null = null;
  private lastGoogleReadVoiceSummaryTimeoutAt: number | null = null;
  private webSearchGroundedThisTurn = false;
  private webSearchNudgeSentThisTurn = false;
  private pendingTranscriptBySender: Record<TranscriptSender, string> = {
    user: "",
    assistant: "",
  };
  private expectedLanguageHint: string | null = null;
  private expectedScriptFamily: TranscriptScriptFamily = "unknown";
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
    this.sessionReadyForRealtimeInput = false;

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
    this.clearAssistantTurnIdleReleaseTimeout();
    this.clearSpeechCooldownTimeout();
    this.assistantTurnActive = false;
    this.speechState = "idle";
    this.manualActivityActive = false;
    this.interruptTrigger = "none";
    this.lastInterruptReason = null;
    this.lastInterruptRequestedAt = null;
    this.manualInterruptSpeechObserved = false;
    this.clearManualInterruptWatchdog();
    this.assistantPlaybackTailUntilMs = 0;
    this.assistantSpeechWindowStartMs = 0;
    this.assistantTurnReleaseAtMs = 0;
    this.lastAssistantActivityAtMs = 0;
    this.latestInputRms = 0;
    this.activeSpeechThreshold = USER_SPEECH_START_RMS_THRESHOLD;
    this.candidateSpeechThreshold = USER_SPEECH_START_RMS_THRESHOLD;
    this.inputAmbientRms = 0;
    this.speechCandidateFrames = 0;
    this.speechSilenceFrames = 0;
    this.speechCandidateMs = 0;
    this.speechCandidateSilenceMs = 0;
    this.speechSilenceMs = 0;
    this.speechCandidatePeakRms = 0;
    this.speechCandidateSumRms = 0;
    this.candidateClearBurstCount = 0;
    this.candidateClearBurstWindowStartAtMs = 0;
    this.candidateClearBurstLastAtMs = 0;
    this.lastMobileBargeInRejectedAtMs = 0;
    this.bufferedPrefixAudioFrames = [];
    this.activeUserSpeechWindow = null;
    this.clearPendingUserSpeechWindowTimeouts();
    this.analyzerKind = "script_processor";
    this.debugStateTrackSettings = null;
    this.debugStateTrackCapabilities = null;
    this.latestSessionResumptionHandle = params.sessionResumptionHandle ?? null;
    this.latestSessionResumptionUpdatedAt = null;
    this.latestGoAwayTimeLeft = null;
    this.latestGoAwayReceivedAt = null;
    this.lastDebugStateEmittedAtMs = 0;
    this.lastDebugStateSnapshot = "";
    this.conversationId = params.conversationId;
    this.compatibilityProfile = resolveLiveAudioCompatibilityProfile();
    this.speechDetectionProfile = resolveLiveSpeechDetectionProfile({
      compatibility: this.compatibilityProfile,
      mobileThresholdScale: MOBILE_USER_SPEECH_THRESHOLD_SCALE,
      mobileAssistantThresholdScale:
        MOBILE_USER_SPEECH_ASSISTANT_THRESHOLD_SCALE,
      mobileAmbientMultiplierScale:
        MOBILE_USER_SPEECH_AMBIENT_MULTIPLIER_SCALE,
      mobileIdleMaxRmsCap: MOBILE_USER_SPEECH_IDLE_MAX_RMS_CAP,
      mobileAssistantMaxRmsCap: MOBILE_USER_SPEECH_ASSISTANT_MAX_RMS_CAP,
      mobileStartMinDurationMultiplier:
        MOBILE_USER_SPEECH_START_MIN_DURATION_MULTIPLIER,
      mobileAssistantMinDurationMultiplier:
        MOBILE_USER_SPEECH_ASSISTANT_MIN_DURATION_MULTIPLIER,
      mobileEndSilenceMultiplier: MOBILE_USER_SPEECH_END_SILENCE_MULTIPLIER,
      mobileCandidateClearMultiplier:
        MOBILE_USER_SPEECH_CANDIDATE_CLEAR_MULTIPLIER,
      mobileMinCandidateClearMs: MOBILE_USER_SPEECH_MIN_CANDIDATE_CLEAR_MS,
      mobileMinEndSilenceMs: MOBILE_USER_SPEECH_MIN_END_SILENCE_MS,
    });
    this.speechCandidateClearTargetMs = Math.max(
      USER_SPEECH_CANDIDATE_CLEAR_SILENCE_MS *
        this.speechDetectionProfile.candidateClearSilenceMultiplier,
      this.speechDetectionProfile.minimumCandidateClearSilenceMs,
    );
    this.speechEndSilenceTargetMs = Math.max(
      USER_SPEECH_END_SILENCE_MIN_DURATION_MS *
        this.speechDetectionProfile.endSilenceDurationMultiplier,
      this.speechDetectionProfile.minimumEndSilenceMs,
    );
    this.speechStartMinDurationMs = Math.max(
      USER_SPEECH_REFERENCE_FRAME_DURATION_MS,
      USER_SPEECH_START_MIN_DURATION_MS *
        this.speechDetectionProfile.startMinSpeechDurationMultiplier,
    );
    this.speechAssistantMinDurationMs = Math.max(
      USER_SPEECH_REFERENCE_FRAME_DURATION_MS,
      USER_SPEECH_ASSISTANT_MIN_DURATION_MS *
        this.speechDetectionProfile.assistantMinSpeechDurationMultiplier,
    );
    this.expectedLanguageHint = normalizeText(params.expectedLanguageHint ?? undefined)
      .toLowerCase();
    if (!this.expectedLanguageHint) {
      this.expectedLanguageHint = null;
    }
    this.expectedScriptFamily = resolveExpectedScriptFamilyForLanguage(
      this.expectedLanguageHint,
    );
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
    this.pendingPersonalContextReadFallback = null;
    this.clearGoogleReadVoiceFallbackTimeout();
    this.clearPendingGoogleReadVoiceSummary();
    this.lastGoogleReadVoiceSummaryTimeoutAt = null;
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
      expectedLanguageHint: this.expectedLanguageHint,
      expectedScriptFamily: this.expectedScriptFamily,
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

    const compatibilityProfile = this.compatibilityProfile;
    const CONNECTION_TIMEOUT_MS = compatibilityProfile.connectionTimeoutMs;
    this.debug("live.audio.compatibility_profile", {
      ...compatibilityProfile,
    });
    this.debug("live.audio.speech_profile", {
      ...this.speechDetectionProfile,
      speechCandidateClearTargetMs: this.speechCandidateClearTargetMs,
      speechEndSilenceTargetMs: this.speechEndSilenceTargetMs,
      speechStartMinDurationMs: this.speechStartMinDurationMs,
      speechAssistantMinDurationMs: this.speechAssistantMinDurationMs,
    });
    let connectionOpened = false;
    let timedOut = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const connectPromise = ai.live.connect({
      model: params.model,
      config: {
        realtimeInputConfig: {
          activityHandling: ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
          turnCoverage: TurnCoverage.TURN_INCLUDES_ONLY_ACTIVITY,
          automaticActivityDetection: {
            disabled: true,
          },
        },
        sessionResumption: {
          handle: params.sessionResumptionHandle ?? undefined,
        },
        contextWindowCompression: {
          slidingWindow: {},
        },
      },
      callbacks: {
        onopen: () => {
          connectionOpened = true;
          this.sessionReadyForRealtimeInput = true;
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
            sessionResumptionHandlePresent: Boolean(
              params.sessionResumptionHandle,
            ),
          });
        },
        onmessage: (message) => {
          if (!timedOut) this.handleServerMessage(message);
        },
        onerror: (event) => {
          reportError("live.ws.error", { message: event.message, model: params.model });
          if (timedOut) return;
          this.sessionReadyForRealtimeInput = false;
          this.manualActivityActive = false;
          this.interruptPending = false;
          this.interruptTrigger = "none";
          this.manualInterruptSpeechObserved = false;
          this.clearManualInterruptWatchdog();
          this.activeSpeechThreshold = USER_SPEECH_START_RMS_THRESHOLD;
          this.candidateSpeechThreshold = USER_SPEECH_START_RMS_THRESHOLD;
          this.speechCandidateFrames = 0;
          this.speechSilenceFrames = 0;
          this.speechCandidateMs = 0;
          this.speechCandidateSilenceMs = 0;
          this.speechSilenceMs = 0;
          this.speechCandidatePeakRms = 0;
          this.speechCandidateSumRms = 0;
          this.candidateClearBurstCount = 0;
          this.candidateClearBurstWindowStartAtMs = 0;
          this.candidateClearBurstLastAtMs = 0;
          this.lastMobileBargeInRejectedAtMs = 0;
          this.activeUserSpeechWindow = null;
          this.clearPendingUserSpeechWindowTimeouts();
          this.syncSpeechStateFromActivity("session_error");
          const error = new Error(event.message || "Gemini Live session error");
          this.emitError(error);
        },
        onclose: (event) => {
          if (!connectionOpened) {
            reportError("live.ws.closed_before_open", { reason: event.reason, model: params.model });
          }
          if (timedOut) return;
          this.sessionReadyForRealtimeInput = false;
          this.manualActivityActive = false;
          this.interruptPending = false;
          this.interruptTrigger = "none";
          this.manualInterruptSpeechObserved = false;
          this.clearManualInterruptWatchdog();
          this.activeSpeechThreshold = USER_SPEECH_START_RMS_THRESHOLD;
          this.candidateSpeechThreshold = USER_SPEECH_START_RMS_THRESHOLD;
          this.speechCandidateFrames = 0;
          this.speechSilenceFrames = 0;
          this.speechCandidateMs = 0;
          this.speechCandidateSilenceMs = 0;
          this.speechSilenceMs = 0;
          this.speechCandidatePeakRms = 0;
          this.speechCandidateSumRms = 0;
          this.candidateClearBurstCount = 0;
          this.candidateClearBurstWindowStartAtMs = 0;
          this.candidateClearBurstLastAtMs = 0;
          this.lastMobileBargeInRejectedAtMs = 0;
          this.activeUserSpeechWindow = null;
          this.clearPendingUserSpeechWindowTimeouts();
          this.session = null;
          this.syncSpeechStateFromActivity("session_closed");
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
      assistantBargeInEnabled: ENABLE_ASSISTANT_BARGE_IN,
      assistantBargeInRmsThreshold: ASSISTANT_BARGE_IN_RMS_THRESHOLD,
      assistantBargeInConsecutiveFrames:
        ASSISTANT_BARGE_IN_CONSECUTIVE_FRAMES,
      assistantBargeInAmbientMultiplier:
        ASSISTANT_BARGE_IN_AMBIENT_MULTIPLIER,
      assistantBargeInMaxRmsThreshold: ASSISTANT_BARGE_IN_MAX_RMS_THRESHOLD,
      assistantBargeInMinGapMs: ASSISTANT_BARGE_IN_MIN_GAP_MS,
      assistantIdleReleaseUserSpeechRmsThreshold:
        ASSISTANT_IDLE_RELEASE_USER_SPEECH_RMS_THRESHOLD,
      assistantIdleReleaseAmbientMultiplier:
        ASSISTANT_IDLE_RELEASE_AMBIENT_MULTIPLIER,
      assistantTurnIdleReleaseMs: ASSISTANT_TURN_IDLE_RELEASE_MS,
      userSpeechStartRmsThreshold: USER_SPEECH_START_RMS_THRESHOLD,
      userSpeechAssistantRmsThreshold: USER_SPEECH_ASSISTANT_RMS_THRESHOLD,
      userSpeechAmbientMultiplier: USER_SPEECH_AMBIENT_MULTIPLIER,
      userSpeechAssistantAmbientMultiplier:
        USER_SPEECH_ASSISTANT_AMBIENT_MULTIPLIER,
      userSpeechAssistantMaxRmsThreshold: USER_SPEECH_ASSISTANT_MAX_RMS_THRESHOLD,
      userSpeechIdleMaxRmsThreshold: USER_SPEECH_IDLE_MAX_RMS_THRESHOLD,
      userSpeechStartConsecutiveFrames:
        USER_SPEECH_START_CONSECUTIVE_FRAMES,
      userSpeechAssistantConsecutiveFrames:
        USER_SPEECH_ASSISTANT_CONSECUTIVE_FRAMES,
      userSpeechEndSilenceFrames: USER_SPEECH_END_SILENCE_FRAMES,
      userSpeechCandidateHysteresisMultiplier:
        USER_SPEECH_CANDIDATE_HYSTERESIS_MULTIPLIER,
      userSpeechCandidateMinRmsThreshold:
        USER_SPEECH_CANDIDATE_MIN_RMS_THRESHOLD,
      userSpeechCandidateClearSilenceMs:
        USER_SPEECH_CANDIDATE_CLEAR_SILENCE_MS,
      userSpeechCandidateClearSilenceTargetMs:
        this.speechCandidateClearTargetMs,
      userSpeechAmbientFloorRiseSmoothing:
        USER_SPEECH_AMBIENT_FLOOR_RISE_SMOOTHING,
      userSpeechAmbientFloorFallSmoothing:
        USER_SPEECH_AMBIENT_FLOOR_FALL_SMOOTHING,
      userSpeechAmbientFloorSpeechSpikeGuard:
        USER_SPEECH_AMBIENT_FLOOR_SPEECH_SPIKE_GUARD,
      userSpeechReferenceFrameDurationMs: USER_SPEECH_REFERENCE_FRAME_DURATION_MS,
      userSpeechStartMinDurationMs: USER_SPEECH_START_MIN_DURATION_MS,
      userSpeechStartMinDurationTargetMs: this.speechStartMinDurationMs,
      userSpeechAssistantMinDurationMs: USER_SPEECH_ASSISTANT_MIN_DURATION_MS,
      userSpeechAssistantMinDurationTargetMs: this.speechAssistantMinDurationMs,
      userSpeechEndSilenceMinDurationMs:
        USER_SPEECH_END_SILENCE_MIN_DURATION_MS,
      userSpeechEndSilenceTargetMs: this.speechEndSilenceTargetMs,
      userSpeechPrefixFrames: USER_SPEECH_PREFIX_FRAMES,
      userSpeechCooldownMs: USER_SPEECH_COOLDOWN_MS,
      userSpeechTranscriptExpectationTimeoutMs:
        USER_SPEECH_TRANSCRIPT_EXPECTATION_TIMEOUT_MS,
      manualInterruptIdleTimeoutMs: MANUAL_INTERRUPT_IDLE_TIMEOUT_MS,
      suppressUserTranscriptDuringAssistantSpeech:
        SUPPRESS_USER_TRANSCRIPT_DURING_ASSISTANT_SPEECH,
      compatibilityProfile: this.compatibilityProfile,
      speechDetectionProfile: this.speechDetectionProfile,
      mobileAssistantBargeInMinDurationMs:
        MOBILE_ASSISTANT_BARGE_IN_MIN_DURATION_MS,
      mobileAssistantBargeInMinPeakRms: MOBILE_ASSISTANT_BARGE_IN_MIN_PEAK_RMS,
      mobileAssistantBargeInPeakThresholdMultiplier:
        MOBILE_ASSISTANT_BARGE_IN_PEAK_THRESHOLD_MULTIPLIER,
      mobileAssistantBargeInMinAvgRms: MOBILE_ASSISTANT_BARGE_IN_MIN_AVG_RMS,
      mobileAssistantBargeInAvgThresholdMultiplier:
        MOBILE_ASSISTANT_BARGE_IN_AVG_THRESHOLD_MULTIPLIER,
      mobileAssistantBargeInRequireThresholdFrame:
        MOBILE_ASSISTANT_BARGE_IN_REQUIRE_THRESHOLD_FRAME,
      mobileAssistantBargeInDisableHysteresis:
        MOBILE_ASSISTANT_BARGE_IN_DISABLE_HYSTERESIS,
      mobileAssistantCandidateClearTargetMs:
        MOBILE_ASSISTANT_CANDIDATE_CLEAR_TARGET_MS,
    });

    await this.startMicrophoneStream(params.preAcquiredMicStream);
  }

  async stop(): Promise<void> {
    this.flushPendingTranscript("user", "turn_complete");
    this.flushPendingTranscript("assistant", "turn_complete");

    if (this.manualActivityActive) {
      this.sendRealtimeInputSafely(
        { activityEnd: {} },
        "live.audio.activity_end_failed",
        { reason: "session_stop" },
      );
    }

    try {
      this.session?.close();
    } catch {
      // Ignore cleanup error.
    }

    this.session = null;
    this.sessionReadyForRealtimeInput = false;
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
    this.clearAssistantTurnIdleReleaseTimeout();
    this.clearSpeechCooldownTimeout();
    this.clearManualInterruptWatchdog();
    this.assistantTurnActive = false;
    this.speechState = "idle";
    this.manualActivityActive = false;
    this.interruptPending = false;
    this.interruptTrigger = "none";
    this.lastInterruptReason = null;
    this.lastInterruptRequestedAt = null;
    this.manualInterruptSpeechObserved = false;
    this.assistantPlaybackTailUntilMs = 0;
    this.assistantSpeechWindowStartMs = 0;
    this.assistantTurnReleaseAtMs = 0;
    this.lastAssistantActivityAtMs = 0;
    this.latestInputRms = 0;
    this.activeSpeechThreshold = USER_SPEECH_START_RMS_THRESHOLD;
    this.candidateSpeechThreshold = USER_SPEECH_START_RMS_THRESHOLD;
    this.inputAmbientRms = 0;
    this.speechCandidateFrames = 0;
    this.speechSilenceFrames = 0;
    this.speechCandidateMs = 0;
    this.speechCandidateSilenceMs = 0;
    this.speechSilenceMs = 0;
    this.speechCandidatePeakRms = 0;
    this.speechCandidateSumRms = 0;
    this.candidateClearBurstCount = 0;
    this.candidateClearBurstWindowStartAtMs = 0;
    this.candidateClearBurstLastAtMs = 0;
    this.lastMobileBargeInRejectedAtMs = 0;
    this.bufferedPrefixAudioFrames = [];
    this.activeUserSpeechWindow = null;
    this.clearPendingUserSpeechWindowTimeouts();
    this.interruptPending = false;
    this.analyzerKind = "script_processor";
    this.debugStateTrackSettings = null;
    this.debugStateTrackCapabilities = null;
    this.latestSessionResumptionHandle = null;
    this.latestSessionResumptionUpdatedAt = null;
    this.latestGoAwayTimeLeft = null;
    this.latestGoAwayReceivedAt = null;
    this.lastDebugStateEmittedAtMs = 0;
    this.lastDebugStateSnapshot = "";
    this.conversationId = null;
    this.expectedLanguageHint = null;
    this.expectedScriptFamily = "unknown";
    this.liveGoogleSearchEnabled = false;
    this.liveMorningBriefFunctionCallingEnabled = false;
    this.liveGooglePersonalContextFunctionCallingEnabled = false;
    this.liveFunctionCallingEnabled = false;
    this.pendingWebSearchTurn = false;
    this.pendingPersonalContextTurn = false;
    this.personalContextToolCalledThisTurn = false;
    this.personalContextNudgeSentThisTurn = false;
    this.pendingPersonalContextReadFallback = null;
    this.clearGoogleReadVoiceFallbackTimeout();
    this.clearPendingGoogleReadVoiceSummary();
    this.webSearchGroundedThisTurn = false;
    this.webSearchNudgeSentThisTurn = false;
    this.lastGoogleReadVoiceSummaryTimeoutAt = null;
    this.compatibilityProfile = resolveSharedLiveAudioCompatibilityProfile();
    this.speechDetectionProfile = {
      mode: "desktop_default",
      thresholdScale: 1,
      assistantThresholdScale: 1,
      ambientMultiplierScale: 1,
      idleMaxRmsCap: null,
      assistantMaxRmsCap: null,
      startMinSpeechDurationMultiplier: 1,
      assistantMinSpeechDurationMultiplier: 1,
      endSilenceDurationMultiplier: 1,
      candidateClearSilenceMultiplier: 1,
      minimumCandidateClearSilenceMs: 0,
      minimumEndSilenceMs: 0,
    };
    this.speechCandidateClearTargetMs = USER_SPEECH_CANDIDATE_CLEAR_SILENCE_MS;
    this.speechEndSilenceTargetMs = USER_SPEECH_END_SILENCE_MIN_DURATION_MS;
    this.speechStartMinDurationMs = USER_SPEECH_START_MIN_DURATION_MS;
    this.speechAssistantMinDurationMs = USER_SPEECH_ASSISTANT_MIN_DURATION_MS;
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
    if (this.analyzerNode) {
      this.analyzerNode.port.onmessage = null;
      this.analyzerNode.disconnect();
      this.analyzerNode = null;
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
    const hadActiveVideo =
      this.videoCaptureInterval !== null ||
      this.videoElement !== null ||
      this.videoStream !== null;
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
    if (hadActiveVideo) {
      this.debug("live.video.stopped");
    }
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
    const assistantWindowActive = this.isAssistantSpeechWindowActive();
    this.debug("live.assistant.interrupt_button_pressed", {
      reason,
      assistantWindowActive,
      manualActivityActive: this.manualActivityActive,
      interruptPending: this.interruptPending,
      sessionReadyForRealtimeInput: this.sessionReadyForRealtimeInput,
      socketState: this.getSocketStateLabel(),
    });
    if (!assistantWindowActive) {
      this.debug("live.assistant.interrupt_ignored_no_assistant_audio", {
        reason,
        manualActivityActive: this.manualActivityActive,
        interruptPending: this.interruptPending,
      });
      this.emitDebugState(true);
      return false;
    }
    return this.beginUserSpeech(reason, true, "button");
  }

  private getDebugState(): LiveVoiceDebugState {
    return {
      speechState: this.speechState,
      currentRms: this.latestInputRms,
      ambientRms: this.inputAmbientRms,
      activeThreshold: this.activeSpeechThreshold,
      candidateThreshold: this.candidateSpeechThreshold,
      speechCandidateFrames: this.speechCandidateFrames,
      speechCandidatePeakRms: this.speechCandidatePeakRms,
      speechCandidateAverageRms:
        this.speechCandidateFrames > 0
          ? this.speechCandidateSumRms / this.speechCandidateFrames
          : 0,
      speechCandidateMs: this.speechCandidateMs,
      speechCandidateSilenceMs: this.speechCandidateSilenceMs,
      speechCandidateClearTargetMs: this.speechCandidateClearTargetMs,
      speechSilenceMs: this.speechSilenceMs,
      speechEndSilenceTargetMs: this.speechEndSilenceTargetMs,
      activeUserSpeechWindowId: this.activeUserSpeechWindow?.id ?? null,
      pendingTranscriptWindows: this.pendingUserSpeechWindows.length,
      manualActivityActive: this.manualActivityActive,
      assistantTurnActive: this.assistantTurnActive,
      interruptPending: this.interruptPending,
      interruptTrigger: this.interruptTrigger,
      lastInterruptReason: this.lastInterruptReason,
      lastInterruptRequestedAt: this.lastInterruptRequestedAt,
      manualInterruptWatchdogExpiresAt: this.manualInterruptWatchdogExpiresAt,
      sessionReadyForRealtimeInput: this.sessionReadyForRealtimeInput,
      socketState: this.getSocketStateLabel(),
      analyzerKind: this.analyzerKind,
      trackSettings: this.debugStateTrackSettings,
      trackCapabilities: this.debugStateTrackCapabilities,
      sessionResumptionHandle: this.latestSessionResumptionHandle,
      sessionResumptionUpdatedAt: this.latestSessionResumptionUpdatedAt,
      goAwayTimeLeft: this.latestGoAwayTimeLeft,
      goAwayReceivedAt: this.latestGoAwayReceivedAt,
      compatibilityPlatform: this.compatibilityProfile.platformClass,
      compatibilityIsMobile: this.compatibilityProfile.isMobile,
      compatibilityIsStandalonePwa: this.compatibilityProfile.isStandalonePwa,
      speechProfileMode: this.speechDetectionProfile.mode,
      speechProfileThresholdScale: this.speechDetectionProfile.thresholdScale,
      pendingGoogleReadVoiceSummarySource:
        this.pendingGoogleReadVoiceSummary?.source ?? null,
      pendingGoogleReadVoiceSummaryToolNames:
        this.pendingGoogleReadVoiceSummary?.toolNames ?? [],
      pendingGoogleReadVoiceSummarySentAt:
        this.pendingGoogleReadVoiceSummary?.sentAtMs ?? null,
      pendingGoogleReadVoiceSummaryDeadlineAt:
        this.pendingGoogleReadVoiceSummary?.deadlineAtMs ?? null,
      lastGoogleReadVoiceSummaryTimeoutAt:
        this.lastGoogleReadVoiceSummaryTimeoutAt,
    };
  }

  private emitDebugState(force = false): void {
    const snapshot = JSON.stringify(this.getDebugState());
    const now = Date.now();
    if (
      !force &&
      snapshot === this.lastDebugStateSnapshot &&
      now - this.lastDebugStateEmittedAtMs < LIVE_DEBUG_STATE_EMIT_MIN_INTERVAL_MS
    ) {
      return;
    }
    this.lastDebugStateSnapshot = snapshot;
    this.lastDebugStateEmittedAtMs = now;
    this.callbacks.onDebugState?.(this.getDebugState());
  }

  private setSpeechState(
    nextState: LiveSpeechState,
    metadata?: Record<string, unknown>,
  ): void {
    if (this.speechState === nextState) {
      this.emitDebugState();
      return;
    }
    const previousState = this.speechState;
    this.speechState = nextState;
    this.debug("live.audio.speech_state_changed", {
      previousState,
      nextState,
      ...(metadata ?? {}),
    });
    this.emitDebugState(true);
  }

  private clearSpeechCooldownTimeout(): void {
    if (this.speechCooldownTimeout !== null) {
      window.clearTimeout(this.speechCooldownTimeout);
      this.speechCooldownTimeout = null;
    }
  }

  private clearPendingUserSpeechWindowTimeouts(): void {
    this.pendingUserSpeechWindowTimeouts.forEach((timeout) => {
      window.clearTimeout(timeout);
    });
    this.pendingUserSpeechWindowTimeouts.clear();
    this.pendingUserSpeechWindows = [];
  }

  private startUserSpeechWindow(
    trigger: LiveInterruptTrigger,
    reason: string,
  ): UserSpeechWindowDiagnostics {
    this.userSpeechWindowSequence += 1;
    return {
      id: this.userSpeechWindowSequence,
      trigger,
      reason,
      startedAtMs: Date.now(),
      endedAtMs: null,
      endReason: null,
      frameCount: 0,
      speechLikeFrameCount: 0,
      sumRms: 0,
      peakRms: 0,
      transcriptReceived: false,
      transcriptCharCount: 0,
      transcriptReceivedAtMs: null,
    };
  }

  private finalizeUserSpeechWindow(windowDiag: UserSpeechWindowDiagnostics): void {
    const timeout = window.setTimeout(() => {
      this.pendingUserSpeechWindowTimeouts.delete(windowDiag.id);
      const durationMs =
        typeof windowDiag.endedAtMs === "number"
          ? Math.max(0, windowDiag.endedAtMs - windowDiag.startedAtMs)
          : 0;
      const averageRms =
        windowDiag.frameCount > 0 ? windowDiag.sumRms / windowDiag.frameCount : 0;
      const transcriptLatencyMs =
        typeof windowDiag.transcriptReceivedAtMs === "number"
          ? Math.max(0, windowDiag.transcriptReceivedAtMs - windowDiag.startedAtMs)
          : null;
      this.debug(
        windowDiag.transcriptReceived
          ? "live.audio.activity_window_transcription_received"
          : "live.audio.activity_window_no_input_transcription",
        {
          windowId: windowDiag.id,
          trigger: windowDiag.trigger,
          startReason: windowDiag.reason,
          endReason: windowDiag.endReason,
          durationMs,
          frameCount: windowDiag.frameCount,
          speechLikeFrameCount: windowDiag.speechLikeFrameCount,
          peakRms: windowDiag.peakRms,
          averageRms,
          transcriptReceived: windowDiag.transcriptReceived,
          transcriptCharCount: windowDiag.transcriptCharCount,
          transcriptLatencyMs,
        },
      );
      this.pendingUserSpeechWindows = this.pendingUserSpeechWindows.filter(
        (item) => item.id !== windowDiag.id,
      );
      this.emitDebugState(true);
    }, USER_SPEECH_TRANSCRIPT_EXPECTATION_TIMEOUT_MS);
    this.pendingUserSpeechWindowTimeouts.set(windowDiag.id, timeout);
  }

  private markUserSpeechWindowTranscriptReceived(textLength: number): void {
    if (this.activeUserSpeechWindow) {
      this.activeUserSpeechWindow.transcriptReceived = true;
      this.activeUserSpeechWindow.transcriptCharCount += textLength;
      this.activeUserSpeechWindow.transcriptReceivedAtMs = Date.now();
      return;
    }
    const pendingWindow = this.pendingUserSpeechWindows.find(
      (item) => !item.transcriptReceived,
    );
    if (!pendingWindow) {
      return;
    }
    pendingWindow.transcriptReceived = true;
    pendingWindow.transcriptCharCount += textLength;
    pendingWindow.transcriptReceivedAtMs = Date.now();
  }

  private syncSpeechStateFromActivity(reason: string): void {
    if (this.manualActivityActive) {
      this.setSpeechState("user_speaking", { reason });
      return;
    }
    if (this.isAssistantSpeechWindowActive()) {
      this.setSpeechState("assistant_speaking", { reason });
      return;
    }
    if (this.speechState === "candidate_user_speech") {
      this.setSpeechState("idle", { reason });
      return;
    }
    if (this.speechState === "cooldown") {
      return;
    }
    this.setSpeechState("idle", { reason });
  }

  private enterSpeechCooldown(reason: string): void {
    this.clearSpeechCooldownTimeout();
    this.setSpeechState("cooldown", { reason });
    this.speechCooldownTimeout = window.setTimeout(() => {
      this.speechCooldownTimeout = null;
      this.syncSpeechStateFromActivity("cooldown_elapsed");
    }, USER_SPEECH_COOLDOWN_MS);
  }

  private clearManualInterruptWatchdog(): void {
    if (this.manualInterruptWatchdogTimeout !== null) {
      window.clearTimeout(this.manualInterruptWatchdogTimeout);
      this.manualInterruptWatchdogTimeout = null;
    }
    this.manualInterruptWatchdogExpiresAt = null;
  }

  private scheduleManualInterruptWatchdog(reason: string): void {
    this.clearManualInterruptWatchdog();
    const timeoutMs = MANUAL_INTERRUPT_IDLE_TIMEOUT_MS;
    this.manualInterruptWatchdogExpiresAt = Date.now() + timeoutMs;
    this.debug("live.assistant.interrupt_watchdog_started", {
      reason,
      timeoutMs,
      trigger: this.interruptTrigger,
    });
    this.emitDebugState(true);
    this.manualInterruptWatchdogTimeout = window.setTimeout(() => {
      this.manualInterruptWatchdogTimeout = null;
      this.manualInterruptWatchdogExpiresAt = null;
      if (!this.manualActivityActive || this.interruptTrigger !== "button") {
        return;
      }
      if (this.manualInterruptSpeechObserved) {
        return;
      }
      this.debug("live.assistant.interrupt_watchdog_timeout", {
        reason,
        timeoutMs,
      });
      this.endUserSpeech("manual_interrupt_idle_timeout");
    }, timeoutMs);
  }

  private bufferPrefixAudioFrame(pcmBase64: string): void {
    this.bufferedPrefixAudioFrames.push({
      pcmBase64,
      at: Date.now(),
    });
    if (this.bufferedPrefixAudioFrames.length > USER_SPEECH_PREFIX_FRAMES) {
      this.bufferedPrefixAudioFrames.splice(
        0,
        this.bufferedPrefixAudioFrames.length - USER_SPEECH_PREFIX_FRAMES,
      );
    }
  }

  private getSessionSocketReadyState(): number | null {
    if (!this.session) {
      return null;
    }
    const maybeConnection = (this.session as { conn?: unknown }).conn as
      | {
          ws?: { readyState?: number };
          socket?: { readyState?: number };
          webSocket?: { readyState?: number; ws?: { readyState?: number } };
          _ws?: { readyState?: number };
        }
      | undefined;
    const candidates = [
      maybeConnection?.ws?.readyState,
      maybeConnection?.socket?.readyState,
      maybeConnection?.webSocket?.readyState,
      maybeConnection?.webSocket?.ws?.readyState,
      maybeConnection?._ws?.readyState,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "number") {
        return candidate;
      }
    }
    return null;
  }

  private getSocketStateLabel(): LiveSocketState {
    const readyState = this.getSessionSocketReadyState();
    if (readyState === null) {
      return "unavailable";
    }
    switch (readyState) {
      case 0:
        return "connecting";
      case 1:
        return "open";
      case 2:
        return "closing";
      case 3:
        return "closed";
      default:
        return "unavailable";
    }
  }

  private sendRealtimeInputSafely(
    payload: LiveRealtimeInputPayload,
    failureEvent:
      | "live.audio.send_failed"
      | "live.assistant.interrupt_failed"
      | "live.audio.activity_end_failed"
      | "live.video.frame_send_failed",
    failureMetadata: Record<string, unknown> = {},
  ): boolean {
    if (!this.isSessionSocketReadyForSend(failureMetadata)) {
      return false;
    }
    const activeSession = this.session;
    if (!activeSession) {
      return false;
    }
    try {
      activeSession.sendRealtimeInput(payload);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const websocketClosed =
        /WebSocket.+(CONNECTING|CLOSING|CLOSED)|not open|closed|Still in CONNECTING/i.test(
          message,
        );
      if (websocketClosed) {
        this.sessionReadyForRealtimeInput = false;
        this.manualActivityActive = false;
        this.interruptPending = false;
        this.interruptTrigger = "none";
        this.manualInterruptSpeechObserved = false;
        this.clearManualInterruptWatchdog();
        this.activeUserSpeechWindow = null;
        this.clearPendingUserSpeechWindowTimeouts();
        this.session = null;
        this.syncSpeechStateFromActivity("socket_send_failed");
      }
      this.debug(failureEvent, {
        ...failureMetadata,
        message,
        websocketClosed,
      });
      return false;
    }
  }

  private isSessionSocketReadyForSend(
    failureMetadata: Record<string, unknown> = {},
  ): boolean {
    if (!this.session || !this.sessionReadyForRealtimeInput) {
      return false;
    }
    const socketReadyState = this.getSessionSocketReadyState();
    if (
      typeof socketReadyState === "number" &&
      socketReadyState !== WebSocket.OPEN
    ) {
      this.sessionReadyForRealtimeInput = false;
      this.manualActivityActive = false;
      this.interruptPending = false;
      this.interruptTrigger = "none";
      this.manualInterruptSpeechObserved = false;
      this.clearManualInterruptWatchdog();
      this.activeUserSpeechWindow = null;
      this.clearPendingUserSpeechWindowTimeouts();
      if (socketReadyState === WebSocket.CLOSING || socketReadyState === WebSocket.CLOSED) {
        this.session = null;
        this.syncSpeechStateFromActivity("socket_not_open");
      }
      const now = Date.now();
      if (now - this.lastSocketNotOpenLogAtMs > 1500) {
        this.lastSocketNotOpenLogAtMs = now;
        this.debug("live.session.send_skipped_socket_not_open", {
          ...failureMetadata,
          socketReadyState,
        });
      }
      return false;
    }
    return true;
  }

  private sendToolResponseSafely(
    functionResponses: Array<Record<string, unknown>>,
  ): boolean {
    if (!this.isSessionSocketReadyForSend({ source: "tool_response" })) {
      this.debug("live.tool_call.response_skipped_session_not_ready", {
        functionResponseCount: functionResponses.length,
      });
      return false;
    }
    const activeSession = this.session;
    if (!activeSession) {
      return false;
    }
    const sessionWithTools = activeSession as Session & {
      sendToolResponse?: (payload: {
        functionResponses: Array<Record<string, unknown>>;
      }) => void;
    };
    if (typeof sessionWithTools.sendToolResponse !== "function") {
      return false;
    }
    try {
      sessionWithTools.sendToolResponse({ functionResponses });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const websocketClosed =
        /WebSocket.+(CONNECTING|CLOSING|CLOSED)|not open|closed|Still in CONNECTING/i.test(
          message,
        );
      if (websocketClosed) {
        this.sessionReadyForRealtimeInput = false;
        this.manualActivityActive = false;
        this.interruptPending = false;
        this.interruptTrigger = "none";
        this.manualInterruptSpeechObserved = false;
        this.clearManualInterruptWatchdog();
        this.activeUserSpeechWindow = null;
        this.clearPendingUserSpeechWindowTimeouts();
        this.session = null;
        this.syncSpeechStateFromActivity("tool_response_socket_send_failed");
      }
      this.debug("live.tool_call.send_response_failed", {
        message,
        websocketClosed,
        functionResponseCount: functionResponses.length,
      });
      return false;
    }
  }

  private clearGoogleReadVoiceFallbackTimeout(): void {
    if (this.googleReadVoiceFallbackTimeout !== null) {
      window.clearTimeout(this.googleReadVoiceFallbackTimeout);
      this.googleReadVoiceFallbackTimeout = null;
    }
  }

  private clearGoogleReadVoiceSummaryAckTimeout(): void {
    if (this.googleReadVoiceSummaryAckTimeout !== null) {
      window.clearTimeout(this.googleReadVoiceSummaryAckTimeout);
      this.googleReadVoiceSummaryAckTimeout = null;
    }
  }

  private clearPendingGoogleReadVoiceSummary(reason?: string): void {
    const hadPendingSummary = Boolean(this.pendingGoogleReadVoiceSummary);
    this.clearGoogleReadVoiceSummaryAckTimeout();
    this.pendingGoogleReadVoiceSummary = null;
    if (hadPendingSummary && reason) {
      this.debug("live.google_context.voice_read_summary_cleared", {
        reason,
      });
    }
    if (hadPendingSummary) {
      this.emitDebugState(true);
    }
  }

  private reportClientError(event: string, data: Record<string, unknown>): void {
    try {
      fetch("/api/live/client-error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          event,
          data: {
            ...data,
            conversationId: this.conversationId,
            userAgent:
              typeof navigator !== "undefined" ? navigator.userAgent : null,
          },
        }),
      }).catch(() => {});
    } catch {
      // Best-effort only.
    }
  }

  private describeGoogleReadVoiceSummaryScope(toolNames: string[]): string {
    const hasEmailScope = toolNames.some((name) =>
      ["get_user_emails", "get_email_thread_detail"].includes(name),
    );
    const hasCalendarScope = toolNames.some((name) =>
      ["get_calendar_events", "get_calendar_event_detail"].includes(name),
    );
    if (hasEmailScope && hasCalendarScope) {
      return "your inbox and calendar";
    }
    if (hasEmailScope) {
      return "your inbox";
    }
    if (hasCalendarScope) {
      return "your calendar";
    }
    return "your Google info";
  }

  private startGoogleReadVoiceSummaryWatchdog(params: {
    digestTexts: string[];
    toolNames: string[];
    source: "immediate" | "fallback";
    assistantActivitySnapshotAtMs: number;
  }): void {
    this.clearGoogleReadVoiceSummaryAckTimeout();
    const now = Date.now();
    const pendingSummary: PendingGoogleReadVoiceSummary = {
      digestTexts: params.digestTexts,
      toolNames: params.toolNames,
      source: params.source,
      sentAtMs: now,
      deadlineAtMs: now + GOOGLE_READ_VOICE_SUMMARY_ACK_TIMEOUT_MS,
      assistantActivitySnapshotAtMs: params.assistantActivitySnapshotAtMs,
    };
    this.pendingGoogleReadVoiceSummary = pendingSummary;
    this.debug("live.google_context.voice_read_summary_watchdog_started", {
      source: params.source,
      toolNames: params.toolNames,
      digestCount: params.digestTexts.length,
      deadlineAtMs: pendingSummary.deadlineAtMs,
    });
    this.emitDebugState(true);
    this.googleReadVoiceSummaryAckTimeout = window.setTimeout(() => {
      this.googleReadVoiceSummaryAckTimeout = null;
      const activeSummary = this.pendingGoogleReadVoiceSummary;
      if (!activeSummary || activeSummary.sentAtMs !== pendingSummary.sentAtMs) {
        return;
      }
      if (
        this.assistantTurnActive ||
        this.lastAssistantActivityAtMs > activeSummary.assistantActivitySnapshotAtMs
      ) {
        this.debug("live.google_context.voice_read_summary_timeout_skipped_assistant_active", {
          source: activeSummary.source,
          toolNames: activeSummary.toolNames,
          assistantTurnActive: this.assistantTurnActive,
          lastAssistantActivityAtMs: this.lastAssistantActivityAtMs,
          assistantActivitySnapshotAtMs:
            activeSummary.assistantActivitySnapshotAtMs,
        });
        this.clearPendingGoogleReadVoiceSummary(
          "assistant_activity_detected_before_timeout",
        );
        return;
      }

      const scope = this.describeGoogleReadVoiceSummaryScope(
        activeSummary.toolNames,
      );
      const preview = activeSummary.digestTexts.join(" ").trim().slice(0, 280);
      this.lastGoogleReadVoiceSummaryTimeoutAt = Date.now();
      this.debug("live.google_context.voice_read_summary_timeout", {
        source: activeSummary.source,
        toolNames: activeSummary.toolNames,
        digestCount: activeSummary.digestTexts.length,
        digestPreview: preview,
        socketState: this.getSessionSocketReadyState(),
        sessionReadyForRealtimeInput: this.sessionReadyForRealtimeInput,
        assistantTurnActive: this.assistantTurnActive,
        speechState: this.speechState,
        lastAssistantActivityAtMs: this.lastAssistantActivityAtMs,
      });
      this.reportClientError("live.google_context.voice_read_summary_timeout", {
        source: activeSummary.source,
        toolNames: activeSummary.toolNames,
        digestCount: activeSummary.digestTexts.length,
        digestPreview: preview,
        socketState: this.getSessionSocketReadyState(),
        sessionReadyForRealtimeInput: this.sessionReadyForRealtimeInput,
        assistantTurnActive: this.assistantTurnActive,
        speechState: this.speechState,
        lastAssistantActivityAtMs: this.lastAssistantActivityAtMs,
      });
      this.emitWebSearchStatus("grounded", "Summary ready in chat");
      this.emitError(
        new Error(
          `I checked ${scope}, but my voice reply stalled. Swipe up to see the summary in chat.`,
        ),
      );
      this.clearPendingGoogleReadVoiceSummary("timed_out_without_assistant_output");
    }, GOOGLE_READ_VOICE_SUMMARY_ACK_TIMEOUT_MS);
  }

  private acknowledgeGoogleReadVoiceSummary(
    source: "audio" | "transcript",
    metadata: {
      audioPartCount: number;
      hasOutputTranscription: boolean;
    },
  ): void {
    if (!this.pendingGoogleReadVoiceSummary) {
      return;
    }
    this.debug("live.google_context.voice_read_summary_acknowledged", {
      source: this.pendingGoogleReadVoiceSummary.source,
      toolNames: this.pendingGoogleReadVoiceSummary.toolNames,
      via: source,
      ...metadata,
    });
    this.clearPendingGoogleReadVoiceSummary(
      source === "audio" ? "assistant_audio_received" : "assistant_transcript_received",
    );
  }

  private sendGoogleReadVoiceSummary(params: {
    digestTexts: string[];
    toolNames: string[];
    source: "immediate" | "fallback";
  }): boolean {
    const spokenSummary = params.digestTexts.join(" ").trim();
    if (!spokenSummary) {
      return false;
    }
    const sent = this.sendClientContentSafely(
      {
        turns: `Using the verified Google results you just received, respond out loud right now in 1 to 3 short sentences. Start speaking immediately, do not call tools again, and do not ask the user to wait. Verified summary: ${spokenSummary}`,
        turnComplete: true,
      },
      "live.google_context.nudge_failed",
      {
        source:
          params.source === "immediate"
            ? "google_read_voice_immediate"
            : "google_read_voice_fallback",
        toolNames: params.toolNames,
      },
    );
    this.debug(
      sent
        ? params.source === "immediate"
          ? "live.google_context.voice_read_summary_sent"
          : "live.google_context.voice_fallback_sent"
        : params.source === "immediate"
          ? "live.google_context.voice_read_summary_send_failed"
          : "live.google_context.voice_fallback_send_failed",
      {
        toolNames: params.toolNames,
        digestCount: params.digestTexts.length,
        spokenSummaryLength: spokenSummary.length,
      },
    );
    if (sent) {
      this.startGoogleReadVoiceSummaryWatchdog({
        digestTexts: params.digestTexts,
        toolNames: params.toolNames,
        source: params.source,
        assistantActivitySnapshotAtMs: this.lastAssistantActivityAtMs,
      });
    }
    return sent;
  }

  private scheduleGoogleReadVoiceFallback(params: {
    digestTexts: string[];
    toolNames: string[];
    assistantActivitySnapshotAtMs: number;
  }): void {
    this.clearGoogleReadVoiceFallbackTimeout();
    if (params.digestTexts.length === 0) return;
    this.googleReadVoiceFallbackTimeout = window.setTimeout(() => {
      this.googleReadVoiceFallbackTimeout = null;
      if (
        this.assistantTurnActive ||
        this.lastAssistantActivityAtMs > params.assistantActivitySnapshotAtMs
      ) {
        this.debug("live.google_context.voice_fallback_skipped_assistant_active", {
          toolNames: params.toolNames,
          assistantTurnActive: this.assistantTurnActive,
          lastAssistantActivityAtMs: this.lastAssistantActivityAtMs,
          assistantActivitySnapshotAtMs: params.assistantActivitySnapshotAtMs,
        });
        return;
      }
      this.sendGoogleReadVoiceSummary({
        digestTexts: params.digestTexts,
        toolNames: params.toolNames,
        source: "fallback",
      });
    }, 1200);
  }

  private async requestLiveToolResponse(
    normalizedCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>,
  ): Promise<{
    traceId?: unknown;
    functionResponses?: unknown;
    resolvedFunctionCalls?: unknown;
    chatDigests?: unknown;
    webSearchEvents?: unknown;
  }> {
    const googleActionContext = this.callbacks.getGoogleActionContext?.() ?? null;
    this.debug("live.tool_call.forwarding", {
      endpoint: "/api/live/tool-response",
      conversationId: this.conversationId,
      functionNames: normalizedCalls.map((c) => c.name),
      googleActionContext,
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
        googleActionContext: googleActionContext ?? undefined,
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
        // Preserve base failure message.
      }
      throw new Error(failureMessage);
    }

    return (await response.json()) as {
      traceId?: unknown;
      functionResponses?: unknown;
      resolvedFunctionCalls?: unknown;
      chatDigests?: unknown;
      webSearchEvents?: unknown;
    };
  }

  private applyLiveToolResponsePayload(params: {
    payload: {
      traceId?: unknown;
      functionResponses?: unknown;
      resolvedFunctionCalls?: unknown;
      chatDigests?: unknown;
      webSearchEvents?: unknown;
    };
    normalizedCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>;
    toolCallStartedAt: number;
    forwardFunctionResponsesToSession: boolean;
    allowGoogleReadVoiceFallback: boolean;
  }): void {
    const functionResponses = Array.isArray(params.payload.functionResponses)
      ? params.payload.functionResponses
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
        typeof (responseObject.response as { error?: unknown }).error === "object"
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
    const resolvedFunctionCalls = Array.isArray(params.payload.resolvedFunctionCalls)
      ? params.payload.resolvedFunctionCalls
          .map((entry) => {
            const record =
              entry && typeof entry === "object"
                ? (entry as {
                    id?: unknown;
                    requestedName?: unknown;
                    effectiveName?: unknown;
                    rerouted?: unknown;
                    rerouteReason?: unknown;
                  })
                : null;
            const id = typeof record?.id === "string" ? record.id : null;
            const requestedName =
              typeof record?.requestedName === "string" ? record.requestedName : null;
            const effectiveName =
              typeof record?.effectiveName === "string" ? record.effectiveName : null;
            if (!id || !requestedName || !effectiveName) {
              return null;
            }
            return {
              id,
              requestedName,
              effectiveName,
              rerouted: record?.rerouted === true,
              rerouteReason:
                typeof record?.rerouteReason === "string"
                  ? record.rerouteReason
                  : null,
            };
          })
          .filter(
            (
              entry,
            ): entry is {
              id: string;
              requestedName: string;
              effectiveName: string;
              rerouted: boolean;
              rerouteReason: string | null;
            } => Boolean(entry),
          )
      : [];
    const effectiveToolNames =
      resolvedFunctionCalls.length > 0
        ? resolvedFunctionCalls.map((entry) => entry.effectiveName)
        : params.normalizedCalls.map((call) => call.name);
    const hasReroutedToolResponse = resolvedFunctionCalls.some(
      (entry) => entry.rerouted && entry.effectiveName !== entry.requestedName,
    );
    const hasReadOnlyGoogleTool = effectiveToolNames.some((name) =>
      LIVE_GOOGLE_PERSONAL_CONTEXT_READ_TOOL_NAMES.has(name),
    );
    const hasGoogleActionTool = effectiveToolNames.some(
      (name) =>
        name === "prepare_google_email_action" ||
        name === "prepare_google_calendar_action",
    );
    if (
      params.forwardFunctionResponsesToSession &&
      functionResponses.length > 0 &&
      !hasReroutedToolResponse
    ) {
      this.sendToolResponseSafely(
        functionResponses as Array<Record<string, unknown>>,
      );
    } else if (
      params.forwardFunctionResponsesToSession &&
      functionResponses.length > 0 &&
      hasReroutedToolResponse
    ) {
      this.debug("live.tool_call.response_not_forwarded", {
        resolvedFunctionCalls,
        hasReadOnlyGoogleTool,
        hasGoogleActionTool,
      });
    }

    const chatDigestTexts: string[] = [];
    if (Array.isArray(params.payload.chatDigests)) {
      for (const digest of params.payload.chatDigests) {
        const text =
          digest &&
          typeof digest === "object" &&
          typeof (digest as { text?: unknown }).text === "string"
            ? ((digest as { text: string }).text ?? "").trim()
            : "";
        if (!text) continue;
        chatDigestTexts.push(text);
        this.callbacks.onMorningBriefDigest?.({ text });
      }
    }

    if (Array.isArray(params.payload.webSearchEvents)) {
      for (const event of params.payload.webSearchEvents) {
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
      const hasError = functionResponseSummary.some((entry) => entry.status === "error");
      this.emitWebSearchStatus(
        "grounded",
        hasError ? "Completed with issues" : "Context ready",
      );
    }

    if (
      params.allowGoogleReadVoiceFallback &&
      hasReadOnlyGoogleTool &&
      chatDigestTexts.length > 0
    ) {
      if (!hasGoogleActionTool && !params.forwardFunctionResponsesToSession) {
        this.sendGoogleReadVoiceSummary({
          digestTexts: chatDigestTexts,
          toolNames: effectiveToolNames,
          source: "immediate",
        });
      }
      this.scheduleGoogleReadVoiceFallback({
        digestTexts: chatDigestTexts,
        toolNames: effectiveToolNames,
        assistantActivitySnapshotAtMs: this.lastAssistantActivityAtMs,
      });
    }

    this.debug("live.tool_call.responded", {
      functionCount: params.normalizedCalls.length,
      traceId:
        typeof params.payload.traceId === "string" ? params.payload.traceId : null,
      responses: functionResponseSummary,
      chatDigestCount: chatDigestTexts.length,
      webSearchEventCount: Array.isArray(params.payload.webSearchEvents)
        ? params.payload.webSearchEvents.length
        : 0,
      elapsedMs: Date.now() - params.toolCallStartedAt,
      forwardedToSession:
        params.forwardFunctionResponsesToSession && !hasReroutedToolResponse,
      resolvedFunctionCalls,
    });
    if (this.conversationId) {
      this.callbacks.onConversationMutated?.({
        conversationId: this.conversationId,
        source: "live_tool_response",
      });
    }
  }

  private async runDirectPersonalContextReadFallback(reason: "model_no_tool_call"): Promise<void> {
    if (!this.pendingPersonalContextReadFallback || !this.conversationId) {
      return;
    }
    const fallback = this.pendingPersonalContextReadFallback;
    if (
      !isReadOnlyPersonalContextIntent(
        fallback.text,
        fallback.intent,
        fallback.activeGoogleActionContext,
      )
    ) {
      return;
    }
    const normalizedCalls = buildDirectPersonalContextReadFunctionCalls(
      fallback.text,
      fallback.intent,
    );
    if (normalizedCalls.length === 0) {
      return;
    }
    const startedAt = Date.now();
    this.debug("live.google_context.direct_fallback_triggered", {
      reason,
      intent: fallback.intent,
      functionNames: normalizedCalls.map((call) => call.name),
      textLength: fallback.text.length,
    });
    try {
      const payload = await this.requestLiveToolResponse(normalizedCalls);
      this.applyLiveToolResponsePayload({
        payload,
        normalizedCalls,
        toolCallStartedAt: startedAt,
        forwardFunctionResponsesToSession: false,
        allowGoogleReadVoiceFallback: true,
      });
    } catch (error) {
      this.debug("live.google_context.direct_fallback_failed", {
        reason,
        message: error instanceof Error ? error.message : String(error),
        functionNames: normalizedCalls.map((call) => call.name),
      });
      this.emitWebSearchStatus("idle");
    }
  }

  private sendClientContentSafely(
    payload: {
      turns: string;
      turnComplete: boolean;
    },
    failureEvent: "live.web_search.nudge_failed" | "live.google_context.nudge_failed",
    failureMetadata: Record<string, unknown> = {},
  ): boolean {
    if (!this.isSessionSocketReadyForSend({ source: "client_content", ...failureMetadata })) {
      return false;
    }
    const activeSession = this.session;
    if (!activeSession) {
      return false;
    }
    const sessionWithClientContent = activeSession as Session & {
      sendClientContent?: (params: {
        turns: string;
        turnComplete: boolean;
      }) => void;
    };
    if (typeof sessionWithClientContent.sendClientContent !== "function") {
      return false;
    }
    try {
      sessionWithClientContent.sendClientContent(payload);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const websocketClosed =
        /WebSocket.+(CONNECTING|CLOSING|CLOSED)|not open|closed|Still in CONNECTING/i.test(
          message,
        );
      if (websocketClosed) {
        this.sessionReadyForRealtimeInput = false;
        this.manualActivityActive = false;
        this.interruptPending = false;
        this.interruptTrigger = "none";
        this.manualInterruptSpeechObserved = false;
        this.clearManualInterruptWatchdog();
        this.activeUserSpeechWindow = null;
        this.clearPendingUserSpeechWindowTimeouts();
        this.session = null;
        this.syncSpeechStateFromActivity("client_content_socket_send_failed");
      }
      this.debug(failureEvent, {
        ...failureMetadata,
        message,
        websocketClosed,
      });
      return false;
    }
  }

  private sendAudioFrame(pcmBase64: string): void {
    this.sendRealtimeInputSafely(
      {
        audio: {
          data: pcmBase64,
          mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}`,
        },
      },
      "live.audio.send_failed",
    );
  }

  private flushBufferedPrefixAudioFrames(): void {
    const frames = this.bufferedPrefixAudioFrames.splice(
      0,
      this.bufferedPrefixAudioFrames.length,
    );
    frames.forEach((frame) => {
      this.sendAudioFrame(frame.pcmBase64);
    });
  }

  private beginUserSpeech(
    reason: string,
    force = false,
    trigger: LiveInterruptTrigger = "speech_detector",
  ): boolean {
    if (!this.session) {
      return false;
    }

    const assistantWindowActive =
      this.assistantTurnActive ||
      this.isAssistantAudioLikelyActive() ||
      Date.now() < this.assistantPlaybackTailUntilMs;

    if (
      !force &&
      assistantWindowActive &&
      trigger === "speech_detector"
    ) {
      if (!ENABLE_ASSISTANT_BARGE_IN) {
        this.debug("live.barge_in.blocked_disabled", { reason });
        return false;
      }
      if (
        this.lastInterruptRequestedAt !== null &&
        Date.now() - this.lastInterruptRequestedAt < ASSISTANT_BARGE_IN_MIN_GAP_MS
      ) {
        this.debug("live.barge_in.blocked_min_gap", {
          reason,
          sinceLastMs: Date.now() - this.lastInterruptRequestedAt,
          minGapMs: ASSISTANT_BARGE_IN_MIN_GAP_MS,
        });
        return false;
      }
    }

    if (
      !force &&
      !assistantWindowActive &&
      this.manualActivityActive
    ) {
      return true;
    }
    if (this.manualActivityActive) {
      this.interruptTrigger = trigger;
      this.setSpeechState("user_speaking", { reason, resumed: true });
      return true;
    }

    this.clearSpeechCooldownTimeout();
    this.flushPendingTranscript("assistant", "idle_timeout");
    this.assistantTurnActive = false;
    this.assistantPlaybackTailUntilMs = 0;
    this.assistantSpeechWindowStartMs = 0;
    this.assistantTurnReleaseAtMs = 0;
    this.clearAssistantTurnIdleReleaseTimeout();
    this.interruptPending = assistantWindowActive;
    this.clearPlaybackQueue();

    const interruptRequestedAt = Date.now();
    const activityStarted = this.sendRealtimeInputSafely(
      { activityStart: {} },
      "live.assistant.interrupt_failed",
      { reason, trigger },
    );
    if (!activityStarted) {
      this.interruptPending = false;
      return false;
    }

    this.manualActivityActive = true;
    this.interruptTrigger = trigger;
    this.lastInterruptReason = reason;
    this.lastInterruptRequestedAt = interruptRequestedAt;
    this.manualInterruptSpeechObserved = false;
    this.speechCandidateFrames = 0;
    this.speechSilenceFrames = 0;
    this.speechCandidateMs = 0;
    this.speechCandidateSilenceMs = 0;
    this.speechSilenceMs = 0;
    this.speechCandidatePeakRms = 0;
    this.speechCandidateSumRms = 0;
    this.candidateClearBurstCount = 0;
    this.candidateClearBurstWindowStartAtMs = 0;
    this.candidateClearBurstLastAtMs = 0;
    this.lastMobileBargeInRejectedAtMs = 0;
    if (!this.activeUserSpeechWindow) {
      this.activeUserSpeechWindow = this.startUserSpeechWindow(trigger, reason);
    }
    this.flushBufferedPrefixAudioFrames();
    if (trigger === "button") {
      this.scheduleManualInterruptWatchdog(reason);
    } else {
      this.clearManualInterruptWatchdog();
    }
    this.debug("live.audio.activity_start_sent", {
      reason,
      trigger,
      assistantWindowActive,
      interruptPending: this.interruptPending,
      sessionReadyForRealtimeInput: this.sessionReadyForRealtimeInput,
      socketState: this.getSocketStateLabel(),
    });
    if (assistantWindowActive) {
      this.debug("live.audio.barge_in_detected", {
        rms: this.latestInputRms,
        ambientRms: this.inputAmbientRms,
        threshold: this.activeSpeechThreshold,
        reason,
      });
    }
    this.debug("live.assistant.interrupt_requested", {
      reason,
      assistantWindowActive,
      source: force ? "manual_control" : "speech_detector",
    });
    this.setSpeechState("user_speaking", {
      reason,
      assistantWindowActive,
    });
    return true;
  }

  private endUserSpeech(reason: string): void {
    if (!this.manualActivityActive) {
      this.syncSpeechStateFromActivity(reason);
      return;
    }
    const activityEnded = this.sendRealtimeInputSafely(
      { activityEnd: {} },
      "live.audio.activity_end_failed",
      { reason },
    );
    this.debug("live.audio.activity_end_sent", {
      reason,
      activityEnded,
      trigger: this.interruptTrigger,
      manualInterruptSpeechObserved: this.manualInterruptSpeechObserved,
      speechSilenceMs: this.speechSilenceMs,
      sessionReadyForRealtimeInput: this.sessionReadyForRealtimeInput,
      socketState: this.getSocketStateLabel(),
    });
    this.manualActivityActive = false;
    this.interruptPending = false;
    this.interruptTrigger = "none";
    this.manualInterruptSpeechObserved = false;
    this.clearManualInterruptWatchdog();
    this.speechCandidateFrames = 0;
    this.speechSilenceFrames = 0;
    this.speechCandidateMs = 0;
    this.speechCandidateSilenceMs = 0;
    this.speechSilenceMs = 0;
    this.speechCandidatePeakRms = 0;
    this.speechCandidateSumRms = 0;
    this.candidateClearBurstCount = 0;
    this.candidateClearBurstWindowStartAtMs = 0;
    this.candidateClearBurstLastAtMs = 0;
    this.lastMobileBargeInRejectedAtMs = 0;
    if (this.activeUserSpeechWindow) {
      this.activeUserSpeechWindow.endedAtMs = Date.now();
      this.activeUserSpeechWindow.endReason = reason;
      this.pendingUserSpeechWindows.push(this.activeUserSpeechWindow);
      this.finalizeUserSpeechWindow(this.activeUserSpeechWindow);
      this.activeUserSpeechWindow = null;
    }
    this.enterSpeechCooldown(reason);
  }

  private computeSpeechThreshold(assistantWindowActive: boolean): {
    threshold: number;
    minSpeechDurationMs: number;
  } {
    const speechProfile = this.speechDetectionProfile;
    const baseThreshold = assistantWindowActive
      ? USER_SPEECH_ASSISTANT_RMS_THRESHOLD
      : USER_SPEECH_START_RMS_THRESHOLD;
    const ambientMultiplierBase = assistantWindowActive
      ? USER_SPEECH_ASSISTANT_AMBIENT_MULTIPLIER
      : USER_SPEECH_AMBIENT_MULTIPLIER;
    const ambientMultiplier =
      ambientMultiplierBase * speechProfile.ambientMultiplierScale;
    const baseMaxThreshold = assistantWindowActive
      ? USER_SPEECH_ASSISTANT_MAX_RMS_THRESHOLD
      : USER_SPEECH_IDLE_MAX_RMS_THRESHOLD;
    const profileMaxCap = assistantWindowActive
      ? speechProfile.assistantMaxRmsCap
      : speechProfile.idleMaxRmsCap;
    const maxThreshold =
      typeof profileMaxCap === "number"
        ? Math.min(baseMaxThreshold, profileMaxCap)
        : baseMaxThreshold;
    const thresholdScale = assistantWindowActive
      ? speechProfile.assistantThresholdScale
      : speechProfile.thresholdScale;
    const rawThreshold = Math.min(
      maxThreshold,
      Math.max(
        baseThreshold,
        this.inputAmbientRms > 0 ? this.inputAmbientRms * ambientMultiplier : 0,
      ),
    );
    const threshold = Math.min(
      maxThreshold,
      Math.max(
        assistantWindowActive
          ? baseThreshold
          : USER_SPEECH_CANDIDATE_MIN_RMS_THRESHOLD,
        rawThreshold * thresholdScale,
      ),
    );
    return {
      threshold,
      minSpeechDurationMs: assistantWindowActive
        ? this.speechAssistantMinDurationMs
        : this.speechStartMinDurationMs,
    };
  }

  private processSpeechInput(rms: number, frameDurationMs?: number): void {
    const effectiveFrameDurationMs =
      typeof frameDurationMs === "number" &&
      Number.isFinite(frameDurationMs) &&
      frameDurationMs > 0
        ? frameDurationMs
        : USER_SPEECH_REFERENCE_FRAME_DURATION_MS;
    this.latestInputRms = rms;

    const assistantWindowActive = this.isAssistantSpeechWindowActive();
    const { threshold, minSpeechDurationMs } =
      this.computeSpeechThreshold(assistantWindowActive);
    const isMobileAssistantWindow =
      assistantWindowActive &&
      this.speechDetectionProfile.mode === "mobile_relaxed";
    const candidateClearTargetMs =
      isMobileAssistantWindow
        ? Math.min(
            this.speechCandidateClearTargetMs,
            MOBILE_ASSISTANT_CANDIDATE_CLEAR_TARGET_MS,
          )
        : this.speechCandidateClearTargetMs;
    const hysteresisMultiplier =
      isMobileAssistantWindow && MOBILE_ASSISTANT_BARGE_IN_DISABLE_HYSTERESIS
        ? 1
        : USER_SPEECH_CANDIDATE_HYSTERESIS_MULTIPLIER;
    const candidateThreshold =
      this.speechState === "candidate_user_speech"
        ? Math.max(
            USER_SPEECH_CANDIDATE_MIN_RMS_THRESHOLD,
            threshold * hysteresisMultiplier,
          )
        : threshold;
    this.activeSpeechThreshold = threshold;
    this.candidateSpeechThreshold = candidateThreshold;

    const isSpeechLike = rms >= candidateThreshold;
    this.updateInputAmbientRms(rms, threshold, isSpeechLike);

    if (this.manualActivityActive) {
      if (this.activeUserSpeechWindow) {
        this.activeUserSpeechWindow.frameCount += 1;
        this.activeUserSpeechWindow.sumRms += rms;
        this.activeUserSpeechWindow.peakRms = Math.max(
          this.activeUserSpeechWindow.peakRms,
          rms,
        );
        if (isSpeechLike) {
          this.activeUserSpeechWindow.speechLikeFrameCount += 1;
        }
      }
      if (isSpeechLike) {
        this.speechCandidateSilenceMs = 0;
        if (
          this.interruptTrigger === "button" &&
          !this.manualInterruptSpeechObserved
        ) {
          this.manualInterruptSpeechObserved = true;
          this.clearManualInterruptWatchdog();
          this.debug("live.assistant.interrupt_watchdog_cleared_user_speech", {
            reason: "speech_detected_after_button_interrupt",
            rms,
            threshold,
          });
        }
        this.speechSilenceFrames = 0;
        this.speechSilenceMs = 0;
        this.setSpeechState("user_speaking", {
          reason: "speech_continues",
          assistantWindowActive,
        });
      } else {
        this.speechSilenceFrames += 1;
        this.speechSilenceMs += effectiveFrameDurationMs;
        if (this.speechSilenceMs >= this.speechEndSilenceTargetMs) {
          this.endUserSpeech("user_silence_detected");
        }
      }
      this.emitDebugState();
      return;
    }

    if (isSpeechLike) {
      this.speechCandidateSilenceMs = 0;
      this.speechCandidateFrames += 1;
      this.speechCandidateMs += effectiveFrameDurationMs;
      this.speechCandidatePeakRms = Math.max(this.speechCandidatePeakRms, rms);
      this.speechCandidateSumRms += rms;
      if (this.speechState !== "candidate_user_speech") {
        this.setSpeechState("candidate_user_speech", {
          threshold,
          candidateThreshold,
          assistantWindowActive,
        });
      }
      if (this.speechCandidateMs >= minSpeechDurationMs) {
        if (isMobileAssistantWindow) {
          const minPeakRms = Math.max(
            MOBILE_ASSISTANT_BARGE_IN_MIN_PEAK_RMS,
            threshold * MOBILE_ASSISTANT_BARGE_IN_PEAK_THRESHOLD_MULTIPLIER,
          );
          const minAvgRms = Math.max(
            MOBILE_ASSISTANT_BARGE_IN_MIN_AVG_RMS,
            threshold * MOBILE_ASSISTANT_BARGE_IN_AVG_THRESHOLD_MULTIPLIER,
          );
          const minBargeInDurationMs = Math.max(
            minSpeechDurationMs,
            MOBILE_ASSISTANT_BARGE_IN_MIN_DURATION_MS,
          );
          const candidateAverageRms =
            this.speechCandidateFrames > 0
              ? this.speechCandidateSumRms / this.speechCandidateFrames
              : 0;
          const meetsDuration = this.speechCandidateMs >= minBargeInDurationMs;
          const meetsPeak = this.speechCandidatePeakRms >= minPeakRms;
          const meetsAverage = candidateAverageRms >= minAvgRms;
          const meetsCurrentThreshold =
            !MOBILE_ASSISTANT_BARGE_IN_REQUIRE_THRESHOLD_FRAME ||
            rms >= threshold;
          if (
            !meetsDuration ||
            !meetsPeak ||
            !meetsAverage ||
            !meetsCurrentThreshold
          ) {
            const now = Date.now();
            if (now - this.lastMobileBargeInRejectedAtMs >= 250) {
              this.lastMobileBargeInRejectedAtMs = now;
              const rejectReasons: string[] = [];
              if (!meetsDuration) {
                rejectReasons.push("candidate_duration_below_mobile_barge_in_min");
              }
              if (!meetsPeak) {
                rejectReasons.push("candidate_peak_below_mobile_barge_in_min");
              }
              if (!meetsAverage) {
                rejectReasons.push("candidate_average_below_mobile_barge_in_min");
              }
              if (!meetsCurrentThreshold) {
                rejectReasons.push("current_frame_below_active_threshold");
              }
              this.debug("live.audio.mobile_barge_in_rejected", {
                candidateMs: this.speechCandidateMs,
                candidatePeakRms: this.speechCandidatePeakRms,
                candidateAverageRms,
                threshold,
                candidateThreshold,
                minBargeInDurationMs,
                minPeakRms,
                minAvgRms,
                currentRms: rms,
                rejectReasons,
              });
            }
            this.emitDebugState();
            return;
          }
        }
        this.beginUserSpeech(
          assistantWindowActive
            ? "detected_user_barge_in"
            : "detected_user_speech",
          false,
          "speech_detector",
        );
      }
      this.emitDebugState();
      return;
    }

    const wasCandidate = this.speechState === "candidate_user_speech";
    if (wasCandidate) {
      this.speechCandidateSilenceMs += effectiveFrameDurationMs;
      if (
        this.speechCandidateSilenceMs <
        candidateClearTargetMs
      ) {
        this.emitDebugState();
        return;
      }
    } else {
      this.speechCandidateSilenceMs = 0;
    }
    const candidateMs = this.speechCandidateMs;
    const candidateFrames = this.speechCandidateFrames;
    const candidateSilenceMs = this.speechCandidateSilenceMs;
    const candidatePeakRms = this.speechCandidatePeakRms;
    const candidateAverageRms =
      this.speechCandidateFrames > 0
        ? this.speechCandidateSumRms / this.speechCandidateFrames
        : 0;
    this.speechCandidateFrames = 0;
    this.speechCandidateMs = 0;
    this.speechCandidateSilenceMs = 0;
    this.speechCandidatePeakRms = 0;
    this.speechCandidateSumRms = 0;
    if (wasCandidate) {
      const now = Date.now();
      if (now - this.candidateClearBurstLastAtMs > 3500) {
        this.candidateClearBurstCount = 0;
        this.candidateClearBurstWindowStartAtMs = now;
      }
      if (this.candidateClearBurstWindowStartAtMs === 0) {
        this.candidateClearBurstWindowStartAtMs = now;
      }
      this.candidateClearBurstCount += 1;
      this.candidateClearBurstLastAtMs = now;
      this.debug("live.audio.candidate_cleared", {
        candidateMs,
        candidateFrames,
        candidateSilenceMs,
        candidateClearTargetMs,
        candidatePeakRms,
        candidateAverageRms,
        currentRms: rms,
        threshold,
        candidateThreshold,
        assistantWindowActive,
        speechProfileMode: this.speechDetectionProfile.mode,
      });
      if (
        this.speechDetectionProfile.mode === "mobile_relaxed" &&
        this.candidateClearBurstCount >= 6
      ) {
        this.debug("live.audio.mobile_candidate_clear_burst", {
          burstCount: this.candidateClearBurstCount,
          burstWindowMs:
            now - this.candidateClearBurstWindowStartAtMs,
          latestThreshold: threshold,
          latestCandidatePeakRms: candidatePeakRms,
          latestCandidateMs: candidateMs,
          latestCurrentRms: rms,
          candidateClearTargetMs,
          endSilenceTargetMs: this.speechEndSilenceTargetMs,
          platform: this.compatibilityProfile.platformClass,
        });
      }
      this.syncSpeechStateFromActivity("candidate_cleared");
    } else {
      this.emitDebugState();
    }
  }

  private async attachAudioAnalyzer(): Promise<boolean> {
    if (!this.inputContext || !this.mediaSourceNode || !this.mutedGainNode) {
      return false;
    }
    if (!("audioWorklet" in this.inputContext)) {
      return false;
    }

    try {
      await this.inputContext.audioWorklet.addModule(
        new URL("./live-rms-processor.worklet.js", import.meta.url),
      );
      this.analyzerNode = new AudioWorkletNode(
        this.inputContext,
        "live-rms-analyzer",
      );
      this.analyzerNode.port.onmessage = (event) => {
        const rms =
          typeof event.data?.rms === "number" && Number.isFinite(event.data.rms)
            ? event.data.rms
            : null;
        if (rms === null) {
          return;
        }
        const sampleCount =
          typeof event.data?.sampleCount === "number" &&
          Number.isFinite(event.data.sampleCount) &&
          event.data.sampleCount > 0
            ? event.data.sampleCount
            : null;
        const analyzerSampleRate = this.inputContext?.sampleRate ?? INPUT_SAMPLE_RATE;
        const frameDurationMs =
          sampleCount !== null && analyzerSampleRate > 0
            ? (sampleCount / analyzerSampleRate) * 1000
            : undefined;
        this.processSpeechInput(rms, frameDurationMs);
      };
      this.mediaSourceNode.connect(this.analyzerNode);
      this.analyzerNode.connect(this.mutedGainNode);
      this.analyzerKind = "audio_worklet";
      this.debug("live.audio.analysis_path", {
        analyzerKind: this.analyzerKind,
      });
      this.emitDebugState(true);
      return true;
    } catch (error) {
      this.analyzerNode = null;
      this.analyzerKind = "script_processor";
      this.debug("live.audio.worklet_unavailable", {
        message: error instanceof Error ? error.message : String(error),
      });
      this.emitDebugState(true);
      return false;
    }
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

        const sent = this.sendRealtimeInputSafely(
          {
            video: {
              data: base64,
              mimeType: "image/jpeg",
            },
          },
          "live.video.frame_send_failed",
        );
        if (!sent) {
          return;
        }
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

  private clearAssistantTurnIdleReleaseTimeout(): void {
    if (this.assistantTurnIdleReleaseTimeout !== null) {
      window.clearTimeout(this.assistantTurnIdleReleaseTimeout);
      this.assistantTurnIdleReleaseTimeout = null;
    }
  }

  private scheduleAssistantTurnIdleRelease(reason: string): void {
    this.clearAssistantTurnIdleReleaseTimeout();
    if (!this.assistantTurnActive || this.interruptPending) {
      return;
    }

    this.assistantTurnIdleReleaseTimeout = window.setTimeout(() => {
      this.assistantTurnIdleReleaseTimeout = null;
      if (!this.assistantTurnActive || this.interruptPending) {
        return;
      }
      if (this.isAssistantAudioLikelyActive()) {
        this.scheduleAssistantTurnIdleRelease(reason);
        return;
      }
      if (Date.now() < this.assistantPlaybackTailUntilMs) {
        this.scheduleAssistantTurnIdleRelease(reason);
        return;
      }
      const lastActivityAgeMs =
        this.lastAssistantActivityAtMs > 0
          ? Date.now() - this.lastAssistantActivityAtMs
          : ASSISTANT_TURN_IDLE_RELEASE_MS;
      if (lastActivityAgeMs < ASSISTANT_TURN_IDLE_RELEASE_MS) {
        this.scheduleAssistantTurnIdleRelease(reason);
        return;
      }
      this.releaseAssistantTurn(reason);
    }, ASSISTANT_TURN_IDLE_RELEASE_MS);
  }

  private releaseAssistantTurn(reason: string): boolean {
    if (!this.assistantTurnActive) {
      this.assistantTurnReleaseAtMs = 0;
      this.clearAssistantTurnIdleReleaseTimeout();
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
    this.clearAssistantTurnIdleReleaseTimeout();
    this.flushPendingTranscript("assistant", "idle_timeout");
    this.debug("live.assistant.turn_released", {
      reason,
    });
    this.syncSpeechStateFromActivity(`assistant_released:${reason}`);
    return true;
  }

  private updateInputAmbientRms(
    rms: number,
    speechThreshold: number,
    isSpeechLike: boolean,
  ): void {
    if (!Number.isFinite(rms) || rms <= 0) {
      return;
    }
    const boundedBaseline = Math.max(
      USER_SPEECH_CANDIDATE_MIN_RMS_THRESHOLD,
      speechThreshold,
    );
    if (this.inputAmbientRms <= 0) {
      this.inputAmbientRms = Math.min(rms, boundedBaseline);
      return;
    }
    const speechSpikeThreshold = Math.max(
      boundedBaseline,
      this.inputAmbientRms * USER_SPEECH_AMBIENT_FLOOR_SPEECH_SPIKE_GUARD,
    );
    if (isSpeechLike || rms >= speechSpikeThreshold) {
      return;
    }
    const smoothingFactor =
      rms > this.inputAmbientRms
        ? USER_SPEECH_AMBIENT_FLOOR_RISE_SMOOTHING
        : USER_SPEECH_AMBIENT_FLOOR_FALL_SMOOTHING;
    this.inputAmbientRms =
      this.inputAmbientRms * (1 - smoothingFactor) + rms * smoothingFactor;
  }

  private isAssistantTurnStalled(): boolean {
    if (!this.assistantTurnActive) {
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
    if (this.lastAssistantActivityAtMs <= 0) {
      return false;
    }
    return Date.now() - this.lastAssistantActivityAtMs >= ASSISTANT_TURN_STALL_TIMEOUT_MS;
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
      if (this.isAssistantTurnStalled()) {
        this.debug("live.audio.suppression_guard_releasing_stalled_turn", {
          durationMs: Date.now() - this.assistantSpeechWindowStartMs,
          lastAssistantActivityAgeMs: Date.now() - this.lastAssistantActivityAtMs,
          stallTimeoutMs: ASSISTANT_TURN_STALL_TIMEOUT_MS,
        });
        this.releaseAssistantTurn("suppression_guard_stalled_turn");
        return false;
      }
      this.debug("live.audio.suppression_guard_extended_for_active_playback", {
        durationMs: Date.now() - this.assistantSpeechWindowStartMs,
        activePlaybackNodes: this.activePlaybackNodes.size,
        assistantTurnActive: this.assistantTurnActive,
      });
      this.assistantSpeechWindowStartMs = Date.now();
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

    const audioTrack = this.mediaStream.getAudioTracks().at(0) ?? null;
    this.debugStateTrackSettings = audioTrack
      ? sanitizeMediaTrackInfo(audioTrack.getSettings())
      : null;
    this.debugStateTrackCapabilities =
      audioTrack && typeof audioTrack.getCapabilities === "function"
        ? sanitizeMediaTrackInfo(audioTrack.getCapabilities())
        : null;
    this.debug("live.audio.track_config_granted", {
      settings: this.debugStateTrackSettings,
      capabilities: this.debugStateTrackCapabilities,
    });
    this.emitDebugState(true);

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
    await this.attachAudioAnalyzer();

    this.processorNode.onaudioprocess = (event) => {
      if (!this.session || !this.inputContext) return;
      if (this.inputContext.state === "suspended") {
        this.inputContext.resume().catch(() => {});
        return;
      }
      const inputSamples = event.inputBuffer.getChannelData(0);
      if (this.analyzerKind === "script_processor") {
        this.processSpeechInput(
          calculateRms(inputSamples),
          this.inputContext.sampleRate > 0
            ? (inputSamples.length / this.inputContext.sampleRate) * 1000
            : undefined,
        );
      }
      const pcmBase64 = pcm16ToBase64(
        inputSamples,
        this.inputContext.sampleRate,
      );
      this.bufferPrefixAudioFrame(pcmBase64);
      if (this.manualActivityActive) {
        this.sendAudioFrame(pcmBase64);
      }
    };
    this.syncSpeechStateFromActivity("microphone_started");
  }

  private handleServerMessage(message: LiveServerMessage): void {
    if (message.sessionResumptionUpdate) {
      const handle =
        typeof message.sessionResumptionUpdate.newHandle === "string"
          ? message.sessionResumptionUpdate.newHandle
          : null;
      const at = Date.now();
      this.latestSessionResumptionHandle = handle;
      this.latestSessionResumptionUpdatedAt = at;
      this.debug("live.session_resumption.updated", {
        resumable: Boolean(message.sessionResumptionUpdate.resumable),
        handlePresent: Boolean(handle),
        lastConsumedClientMessageIndex:
          message.sessionResumptionUpdate.lastConsumedClientMessageIndex ?? null,
      });
      this.callbacks.onSessionResumption?.({
        handle,
        resumable: Boolean(message.sessionResumptionUpdate.resumable),
        lastConsumedClientMessageIndex:
          typeof message.sessionResumptionUpdate
            .lastConsumedClientMessageIndex === "string"
            ? message.sessionResumptionUpdate.lastConsumedClientMessageIndex
            : null,
        at,
      });
      this.emitDebugState(true);
    }

    if (message.goAway) {
      this.latestGoAwayTimeLeft =
        typeof message.goAway.timeLeft === "string"
          ? message.goAway.timeLeft
          : null;
      this.latestGoAwayReceivedAt = Date.now();
      this.debug("live.session.go_away", {
        timeLeft: this.latestGoAwayTimeLeft,
      });
      this.callbacks.onGoAway?.({
        timeLeft: this.latestGoAwayTimeLeft,
        at: this.latestGoAwayReceivedAt,
      });
      this.emitDebugState(true);
    }

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
      (name) => LIVE_GOOGLE_PERSONAL_CONTEXT_TOOL_NAMES.has(name),
    );

    if (hasPersonalContextToolCall) {
      this.personalContextToolCalledThisTurn = true;
      this.pendingPersonalContextTurn = false;
      this.pendingPersonalContextReadFallback = null;
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
      this.clearAssistantTurnIdleReleaseTimeout();
      this.lastAssistantActivityAtMs = Date.now();
      this.assistantTurnActive = true;
      this.assistantPlaybackTailUntilMs = Math.max(
        this.assistantPlaybackTailUntilMs,
        Date.now() + SUPPRESS_INPUT_COOLDOWN_MS,
      );
      if (!this.manualActivityActive) {
        this.setSpeechState("assistant_speaking", {
          reason: "assistant_output_received",
        });
      }
      this.acknowledgeGoogleReadVoiceSummary(
        audioPartCount > 0 ? "audio" : "transcript",
        {
          audioPartCount,
          hasOutputTranscription: Boolean(serverContent.outputTranscription?.text),
        },
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

    const interruptedByClientRequest =
      Boolean(serverContent.interrupted) && this.interruptPending;
    if (serverContent.interrupted) {
      this.debug("live.server.interrupted");
      if (interruptedByClientRequest) {
        this.debug("live.assistant.interrupt_acknowledged", {
          source: "server_interrupted",
        });
      }
      this.interruptPending = false;
      if (!this.manualActivityActive) {
        this.interruptTrigger = "none";
      }
      this.assistantTurnActive = false;
      this.assistantTurnReleaseAtMs = 0;
      this.clearAssistantTurnIdleReleaseTimeout();
      this.assistantPlaybackTailUntilMs = Math.max(
        this.assistantPlaybackTailUntilMs,
        Date.now() + SUPPRESS_INPUT_COOLDOWN_MS,
      );
      if (interruptedByClientRequest) {
        this.clearPlaybackQueue();
      } else {
        this.debug("live.assistant.buffered_audio_preserved_after_unexpected_interrupt", {
          bufferedNodes: this.activePlaybackNodes.size,
        });
      }
      this.syncSpeechStateFromActivity("server_interrupted");
    }

    const shouldDropAssistantOutput =
      this.interruptPending || interruptedByClientRequest;
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
      if (!this.manualActivityActive) {
        this.interruptTrigger = "none";
      }
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
        void this.runDirectPersonalContextReadFallback("model_no_tool_call");
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
      this.pendingPersonalContextReadFallback = null;
      this.webSearchGroundedThisTurn = false;
      this.webSearchNudgeSentThisTurn = false;
      this.assistantTurnActive = false;
      this.assistantPlaybackTailUntilMs = Math.max(
        this.assistantPlaybackTailUntilMs,
        Date.now() + SUPPRESS_INPUT_COOLDOWN_MS,
      );
      this.flushPendingTranscript("user", "turn_complete");
      this.flushPendingTranscript("assistant", "turn_complete");
      this.syncSpeechStateFromActivity("turn_complete");
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
    this.clearAssistantTurnIdleReleaseTimeout();
    this.lastAssistantActivityAtMs = Date.now();
    this.assistantPlaybackTailUntilMs = Math.max(
      this.assistantPlaybackTailUntilMs,
      Date.now() + Math.round(audioBuffer.duration * 1000) + SUPPRESS_INPUT_COOLDOWN_MS,
    );

    source.onended = () => {
      this.activePlaybackNodes.delete(source);
      this.playbackNodeEndTimes.delete(source);
      if (this.assistantTurnReleaseAtMs > 0) {
        this.releaseAssistantTurn("playback_drained");
      } else if (this.activePlaybackNodes.size === 0) {
        this.scheduleAssistantTurnIdleRelease("playback_idle");
        this.syncSpeechStateFromActivity("playback_idle");
      }
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
    this.syncSpeechStateFromActivity("playback_cleared");
  }

  private captureTranscript(
    sender: TranscriptSender,
    transcript: LiveTranscriptionPayload | undefined,
  ): void {
    if (!transcript) return;

    const text = normalizeText(transcript.text);
    if (!text) return;
    if (sender === "user") {
      this.markUserSpeechWindowTranscriptReceived(text.length);
    }
    const activeGoogleActionContext = this.callbacks.getGoogleActionContext?.() ?? null;
    const personalContextIntent = classifyLivePersonalContextIntent(
      text,
      activeGoogleActionContext,
    );

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
        inferPersonalContextLoadingLabel(text, personalContextIntent),
      );
      this.debug("live.google_context.searching", {
        textLength: text.length,
        intent: personalContextIntent,
        detectedText: text.slice(0, 120),
        activeGoogleActionContext,
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
      this.sendPersonalContextToolNudge(
        text,
        personalContextIntent,
        activeGoogleActionContext,
      );
    }
    if (
      sender === "user" &&
      this.liveGooglePersonalContextFunctionCallingEnabled &&
      personalContextIntent &&
      transcript.finished
    ) {
      this.pendingPersonalContextReadFallback = {
        text,
        intent: personalContextIntent,
        activeGoogleActionContext,
      };
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
        activeGoogleActionContext,
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
      !this.manualActivityActive &&
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
    const mergedScriptStats = analyzeTranscriptScript(mergedText);
    this.pendingTranscriptBySender[sender] = mergedText;
    this.debug("live.transcript.received", {
      sender,
      textLength: text.length,
      mergedTextLength: mergedText.length,
      finished: Boolean(transcript.finished),
      scriptFamily: mergedScriptStats.scriptFamily,
      dominantScript: mergedScriptStats.dominantScript,
      lettersAnalyzed: mergedScriptStats.lettersAnalyzed,
      scriptCounts: mergedScriptStats.scriptCounts,
      expectedLanguageHint: this.expectedLanguageHint,
      expectedScriptFamily: this.expectedScriptFamily,
    });

    if (
      sender === "user" &&
      transcript.finished &&
      shouldFlagTranscriptLanguageMismatch({
        expectedScriptFamily: this.expectedScriptFamily,
        observedScriptFamily: mergedScriptStats.scriptFamily,
        dominantScript: mergedScriptStats.dominantScript,
        lettersAnalyzed: mergedScriptStats.lettersAnalyzed,
      })
    ) {
      this.debug("live.transcript.language_mismatch_observed", {
        expectedLanguageHint: this.expectedLanguageHint,
        expectedScriptFamily: this.expectedScriptFamily,
        observedScriptFamily: mergedScriptStats.scriptFamily,
        dominantScript: mergedScriptStats.dominantScript,
        lettersAnalyzed: mergedScriptStats.lettersAnalyzed,
      });
    }

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

    if (sender === "user") {
      const persistenceDecision = evaluateUserTranscriptPersistence({
        text,
        expectedScriptFamily: this.expectedScriptFamily,
        expectedLanguageHint: this.expectedLanguageHint,
      });
      if (persistenceDecision.discard) {
        this.debug("live.transcript.user_discarded_low_signal", {
          reason,
          discardReason: persistenceDecision.reason,
          mismatch: persistenceDecision.mismatch,
          wordCount: persistenceDecision.wordCount,
          scriptFamily: persistenceDecision.scriptStats.scriptFamily,
          dominantScript: persistenceDecision.scriptStats.dominantScript,
          lettersAnalyzed: persistenceDecision.scriptStats.lettersAnalyzed,
          scriptCounts: persistenceDecision.scriptStats.scriptCounts,
          expectedLanguageHint: this.expectedLanguageHint,
          expectedScriptFamily: this.expectedScriptFamily,
          textLength: text.length,
        });
        return;
      }
    }

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

    const hasEmailSummaryCall = normalizedCalls.some(
      (call) => call.name === "get_user_emails" || call.name === "get_inbox_digest",
    );
    const hasEmailDetailCall = normalizedCalls.some(
      (call) => call.name === "get_email_thread_detail",
    );
    const hasEmailActionPrepCall = normalizedCalls.some(
      (call) => call.name === "prepare_google_email_action",
    );
    const hasCalendarSummaryCall = normalizedCalls.some(
      (call) => call.name === "get_calendar_events",
    );
    const hasCalendarDetailCall = normalizedCalls.some(
      (call) => call.name === "get_calendar_event_detail",
    );
    const hasCalendarActionPrepCall = normalizedCalls.some(
      (call) => call.name === "prepare_google_calendar_action",
    );
    const hasEmailCall =
      hasEmailSummaryCall || hasEmailDetailCall || hasEmailActionPrepCall;
    const hasCalendarCall =
      hasCalendarSummaryCall || hasCalendarDetailCall || hasCalendarActionPrepCall;
    this.emitWebSearchStatus(
      "searching",
      hasEmailActionPrepCall && hasCalendarActionPrepCall
        ? "Preparing your email and calendar actions…"
        : hasEmailActionPrepCall
          ? inferEmailLookupLoadingLabel("draft or send email")
          : hasCalendarActionPrepCall
            ? inferCalendarLookupLoadingLabel("schedule or update calendar event")
            : hasEmailDetailCall && hasCalendarDetailCall
              ? "Retrieving email and calendar details…"
              : hasEmailDetailCall
                ? inferEmailLookupLoadingLabel("show email details")
                : hasCalendarDetailCall
                  ? inferCalendarLookupLoadingLabel("show calendar details")
                  : hasEmailCall && hasCalendarCall
                    ? "Checking your inbox and calendar…"
                    : hasCalendarCall
                      ? inferCalendarLookupLoadingLabel("what is on my calendar")
                      : hasEmailCall
                        ? inferEmailLookupLoadingLabel("what emails do i have")
                        : "Searching live sources…",
    );

    const toolCallStartedAt = Date.now();
    this.debug("live.tool_call.received", {
      functionCount: normalizedCalls.length,
      calls: callDebugSummary,
    });

    try {
      const payload = await this.requestLiveToolResponse(normalizedCalls);
      this.applyLiveToolResponsePayload({
        payload,
        normalizedCalls,
        toolCallStartedAt,
        forwardFunctionResponsesToSession: true,
        allowGoogleReadVoiceFallback: true,
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
    const query = normalizeText(userTranscript);
    if (!query) return;
    const sent = this.sendClientContentSafely(
      {
        turns: `Use Google Search grounding for this latest user request and answer with current verified facts: ${query}`,
        turnComplete: true,
      },
      "live.web_search.nudge_failed",
      { textLength: query.length },
    );
    if (sent) {
      this.debug("live.web_search.nudge_sent", {
        textLength: query.length,
      });
    }
  }

  private sendPersonalContextToolNudge(
    userTranscript: string,
    intent: LivePersonalContextIntent,
    activeGoogleActionContext?: LiveGoogleActionContextHint | null,
  ): void {
    const query = normalizeText(userTranscript);
    if (!query) return;

    const toolInstruction = buildPersonalContextToolInstruction(
      query,
      intent,
      activeGoogleActionContext,
    );

    const sent = this.sendClientContentSafely(
      {
        turns: `For this latest user request, you MUST use the connected Google personal context function tools before giving any natural-language answer. ${toolInstruction} Do not answer from memory or earlier tool results. Fetch fresh data now. Never invent email or calendar details. User request: ${query}`,
        turnComplete: true,
      },
      "live.google_context.nudge_failed",
      {
        textLength: query.length,
        intent,
        activeGoogleActionContext,
      },
    );
    if (sent) {
      this.debug("live.google_context.nudge_sent", {
        textLength: query.length,
        intent,
        activeGoogleActionContext,
      });
    }
  }

  private debug(message: string, metadata?: Record<string, unknown>): void {
    this.callbacks.onDebug?.(message, metadata);
  }
}
