import React, {
  useState,
  useEffect,
  useRef,
  useId,
  useMemo,
  useCallback,
  type ReactNode,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mic,
  Video,
  PhoneOff,
  MessageSquare,
  Menu,
  Settings,
  ChevronRight,
  ChevronDown,
  X,
  ArrowLeft,
  Camera,
  LogOut,
  Eye,
  EyeOff,
  ImageIcon,
  Pencil,
  Archive,
  Trash2,
  Play,
  FileText,
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  Clock3,
  Info,
  Loader2,
  Sparkles,
  Terminal,
  Maximize2,
  Globe,
  SwitchCamera,
  VolumeX,
} from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import mayaAvatar from "@/assets/maya-avatar.png";
import zarraAvatar from "@/assets/zarra-avatar.png";
import zeeAvatar from "@/assets/zee-avatar.png";
import zeeAvatarMan1 from "@/assets/zee-avatar-man-1.png";
import zeeAvatarMan2 from "@/assets/zee-avatar-man-2.png";
import leafBg from "@/assets/leaf-bg.png";
import CanvasOrb from "@/components/OnboardingOrb";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getResponseTraceId } from "@/lib/queryClient";
import {
  GeminiLiveVoiceSession,
  collectMediaCaptureDebugContext,
  getMicrophoneStreamWithFallback,
  type LiveVoiceDebugState,
} from "@/lib/gemini-live";
import {
  APP_THEME_OPTIONS,
  DEFAULT_APP_THEME_ID,
  applyAppTheme,
  getAppTheme,
  isAppThemeId,
  type AppThemeId,
} from "@/lib/app-theme";
import type {
  AgentArtifactSummary,
  AgentApprovalSummary,
  ArtifactQualitySummary,
  AgentOfferSummary,
  AgentToolCallSummary,
  AgentMessageUiPayload,
  AgentStepSummary,
  AgentTaskSummary,
  TaskAssumption,
  TaskFailureSummary,
  TaskStateResolvedStatusSource,
  TaskStateVersion,
  UnifiedAgentTaskCardModel,
  UnifiedAgentTaskTimelineItem,
} from "@shared/agent";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { JsonRenderArtifactViewer } from "@/components/artifacts/JsonRenderArtifactViewer";
import MarketingLandingPage from "@/components/MarketingLandingPage";

// --- Types ---
type Mode = "voice" | "text" | "profile";
type Persona = "Maya" | "Zarra" | "Zee";
type LiveVoiceName = "Aoede" | "Kore" | "Charon" | "Fenrir";
type CameraFacingMode = "user" | "environment";
type WebLookupStatus = "searching" | "grounded";
type WebLookupMode = "text" | "voice";

const PERSONA_AVATARS: Record<Persona, string> = {
  Maya: mayaAvatar,
  Zarra: zarraAvatar,
  Zee: zeeAvatar,
};

function getPersonaAvatar(
  persona: Persona | string,
  profile?: UserProfileData,
): string {
  if (persona === "Zee") {
    if (profile?.zeeAvatarUrl) {
      return profile.zeeAvatarUrl;
    }
    return getZeeAvatarPresetSrc(profile?.zeeAvatarPreset);
  }
  return PERSONA_AVATARS[persona as Persona] || zeeAvatar;
}

function normalizeWordSpacing(text: string): string {
  let result = text;
  result = result.replace(/([a-z])([.!?])([A-Z])/g, "$1$2 $3");
  result = result.replace(/([a-z])([.!?])(["'"])([A-Z])/g, "$1$2$3 $4");
  result = result.replace(/([a-z])([a-z])([A-Z][a-z])/g, "$1$2 $3");
  result = result.replace(/([,;:])([A-Z][a-z])/g, "$1 $2");
  result = result.replace(/([a-z])(["'"])([A-Z])/g, "$1$2 $3");
  return result;
}

function sanitizeSplitTokenArtifacts(text: string): string {
  const cleaned = text
    .replace(/\[\[ZEE_SPLIT\]\]/gi, " ")
    .replace(/\[\[ZEE_SPLIT\]?/gi, " ")
    .replace(/\[\[[^\]]{0,10}SPLIT[^\]]*\]\]/gi, " ")
    .replace(/ZEE[_\s]*SPLIT/gi, " ")
    .replace(/\[\[ZEE[_\s]*SPLIT/gi, " ")
    .replace(/ZEE_SPLIT\]?\]?/gi, " ")
    .replace(/(^|[\s.!?,;:])\]\](?=\s|$)/g, "$1")
    .replace(/(^|\s)\[\[(?=\s|$)/g, "$1")
    .replace(/[ \t]{2,}/g, " ");
  return normalizeWordSpacing(cleaned);
}

function renderSimpleMarkdown(text: string): React.ReactNode {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let listItems: React.ReactNode[] = [];
  let listType: "ul" | "ol" | null = null;
  let keyCounter = 0;

  const flushList = () => {
    if (listItems.length > 0 && listType) {
      const ListTag = listType;
      elements.push(
        <ListTag key={`list-${keyCounter++}`} className={listType === "ul" ? "list-disc pl-5 my-1 space-y-1" : "list-decimal pl-5 my-1 space-y-1"}>
          {listItems}
        </ListTag>
      );
      listItems = [];
      listType = null;
    }
  };

  const renderInline = (content: string): React.ReactNode[] => {
    const parts: React.ReactNode[] = [];
    const regex = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|__(.+?)__|_(.+?)_|\[([^\]]+)\]\((https?:\/\/[^)]+)\)|(https?:\/\/[^\s<)]+))/g;
    let lastIndex = 0;
    let match;
    let inlineKey = 0;

    while ((match = regex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        parts.push(content.slice(lastIndex, match.index));
      }
      if (match[2]) {
        parts.push(<strong key={`bi-${inlineKey++}`}><em>{match[2]}</em></strong>);
      } else if (match[3]) {
        parts.push(<strong key={`b-${inlineKey++}`}>{match[3]}</strong>);
      } else if (match[4]) {
        parts.push(<em key={`i-${inlineKey++}`}>{match[4]}</em>);
      } else if (match[5]) {
        parts.push(<strong key={`bu-${inlineKey++}`}>{match[5]}</strong>);
      } else if (match[6]) {
        parts.push(<em key={`iu-${inlineKey++}`}>{match[6]}</em>);
      } else if (match[7] && match[8]) {
        parts.push(
          <a key={`link-${inlineKey++}`} href={match[8]} target="_blank" rel="noopener noreferrer"
            className="underline decoration-2 underline-offset-4 font-bold hover:opacity-80 transition-opacity"
            style={{ color: "var(--app-assistant-bubble-text)" }}
          >{match[7]}</a>
        );
      } else if (match[9]) {
        let domain = "";
        try { domain = new URL(match[9]).hostname.replace(/^www\./, ""); } catch { domain = match[9].slice(0, 30); }
        parts.push(
          <a key={`url-${inlineKey++}`} href={match[9]} target="_blank" rel="noopener noreferrer"
            className="underline decoration-2 underline-offset-4 font-bold hover:opacity-80 transition-opacity"
            style={{ color: "var(--app-assistant-bubble-text)" }}
          >{domain}</a>
        );
      }
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < content.length) {
      parts.push(content.slice(lastIndex));
    }
    return parts;
  };

  for (const line of lines) {
    const h3Match = line.match(/^###\s+(.+)/);
    const h2Match = !h3Match ? line.match(/^##\s+(.+)/) : null;
    const bulletMatch = line.match(/^\s*[-•]\s+(.+)/);
    const numberedMatch = line.match(/^\s*(\d+)[.)]\s+(.+)/);

    if (h3Match) {
      flushList();
      elements.push(
        <div key={`h3-${keyCounter++}`} className="text-[12px] font-bold uppercase tracking-wider mt-4 mb-1.5 opacity-90 border-b border-current pb-0.5" style={{ color: "var(--app-assistant-bubble-text)", borderColor: "color-mix(in srgb, var(--app-assistant-bubble-text) 20%, transparent)" }}>
          {renderInline(h3Match[1])}
        </div>
      );
    } else if (h2Match) {
      flushList();
      elements.push(
        <div key={`h2-${keyCounter++}`} className="text-[17px] font-black mt-5 mb-2 tracking-tight" style={{ color: "var(--app-assistant-bubble-text)" }}>
          {renderInline(h2Match[1])}
        </div>
      );
    } else if (bulletMatch) {
      if (listType !== "ul") { flushList(); listType = "ul"; }
      listItems.push(<li key={`li-${keyCounter++}`}>{renderInline(bulletMatch[1])}</li>);
    } else if (numberedMatch) {
      if (listType !== "ol") { flushList(); listType = "ol"; }
      listItems.push(<li key={`li-${keyCounter++}`}>{renderInline(numberedMatch[2])}</li>);
    } else {
      flushList();
      if (line.trim() === "") {
        elements.push(<br key={`br-${keyCounter++}`} />);
      } else {
        elements.push(<span key={`p-${keyCounter++}`}>{renderInline(line)}{"\n"}</span>);
      }
    }
  }
  flushList();
  return <>{elements}</>;
}

interface MessageAttachmentData {
  id: string;
  conversationId: string;
  messageId: string | null;
  status: string;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  summaryText: string | null;
  createdAt: string | null;
  signedUrl: string;
}

interface MessageData {
  id: string;
  conversationId: string;
  sender: string;
  turnId?: string | null;
  partIndex?: number | null;
  text: string;
  createdAt: string | null;
  attachments?: MessageAttachmentData[];
  uiPayload?: AgentMessageUiPayload | null;
  isTyping?: boolean;
  localOnly?: boolean;
}

interface SendMessageOptions {
  ignoreAttachments?: boolean;
}

interface TraceAwareResponse {
  traceId?: string;
}

interface PendingImageAttachment {
  localId: string;
  attachmentId?: string;
  attachment?: MessageAttachmentData;
  previewUrl: string;
  status: "uploading" | "ready" | "error";
  error?: string;
  mimeType: string;
  byteSize: number;
}

interface ChatStreamAckEvent {
  type: "ack";
  traceId?: string;
  conversationId: string;
  userMessage: MessageData;
}

interface ChatStreamDeltaEvent {
  type: "delta";
  text: string;
  partIndex?: number;
}

interface ChatStreamPartFinalEvent {
  type: "part_final";
  turnId: string;
  partIndex: number;
  message: MessageData;
}

interface ChatStreamFinalEvent {
  type: "final";
  assistantMessage: MessageData;
  assistantMessages?: MessageData[];
  model?: string;
  usage?: unknown;
  googleSearchGroundingUsed?: boolean;
  decisionPath?: "companion_reply" | "offer_required" | "collecting_slots" | "agent_task";
  decisionPathReason?:
    | "explicit_build_offer"
    | "offer_pending"
    | "slot_collection_active"
    | "task_started"
    | "companion";
  elapsedMs?: number;
}

interface ChatStreamErrorEvent {
  type: "error";
  message: string;
  traceId?: string;
}

interface ChatStreamTaskCreatedEvent {
  type: "task_created";
  task: AgentTaskSummary;
}

interface ChatStreamTaskStepEvent {
  type: "task_step";
  taskId: string;
  step: AgentStepSummary;
}

interface ChatStreamTaskApprovalRequiredEvent {
  type: "task_approval_required";
  taskId: string;
  approval: AgentApprovalSummary;
}

interface ChatStreamTaskArtifactReadyEvent {
  type: "task_artifact_ready";
  taskId: string;
  artifact: AgentArtifactSummary;
}

interface ChatStreamTaskFailedEvent {
  type: "task_failed";
  taskId: string;
  message: string;
  failure?: TaskFailureSummary | null;
}

interface ChatStreamWebSearchEvent {
  type: "web_search";
  mode?: "text" | "voice";
  status: "searching" | "grounded" | "idle";
  label?: string;
}

type ChatStreamEvent =
  | ChatStreamAckEvent
  | ChatStreamDeltaEvent
  | ChatStreamPartFinalEvent
  | ChatStreamFinalEvent
  | ChatStreamErrorEvent
  | ChatStreamWebSearchEvent
  | ChatStreamTaskCreatedEvent
  | ChatStreamTaskStepEvent
  | ChatStreamTaskApprovalRequiredEvent
  | ChatStreamTaskArtifactReadyEvent
  | ChatStreamTaskFailedEvent;

type ResponseStylePreset = "concise" | "balanced" | "expressive" | "playful";
type GenderOption =
  | "female"
  | "male"
  | "non_binary"
  | "other"
  | "prefer_not_to_say";
type ZeeAvatarPreset = "woman_1" | "woman_2" | "man_1" | "man_2";

interface UserProfileData {
  id: string | null;
  userId: string;
  displayName: string | null;
  bio: string | null;
  location: string | null;
  age: number | null;
  profession: string | null;
  gender: GenderOption | null;
  genderOther: string | null;
  responseStylePreset: ResponseStylePreset;
  responseStyleNote: string | null;
  zeeAvatarPreset: ZeeAvatarPreset;
  zeeAvatarAttachmentId: string | null;
  zeeAvatarUrl: string | null;
  avatarAttachmentId: string | null;
  avatarUrl: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

interface QuotaMetricData {
  used: number;
  limit: number;
  remaining: number;
  oldestInWindowAt: string | null;
  nextUnlockAt: string | null;
}

type QuotaTier = "default" | "power" | "privileged";

interface QuotaSummaryData {
  window: "rolling_30_days";
  windowDays: number;
  limits: {
    text: number;
    voiceSeconds: number;
    cameraSeconds: number;
    creationRuns?: number;
    codingTasks?: number;
    documentTasks?: number;
    presentationTasks?: number;
    presentationImages?: number;
  };
  used: {
    text: number;
    voiceSeconds: number;
    cameraSeconds: number;
    creationRuns?: number;
    codingTasks?: number;
    documentTasks?: number;
    presentationTasks?: number;
    presentationImages?: number;
  };
  remaining: {
    text: number;
    voiceSeconds: number;
    cameraSeconds: number;
    creationRuns?: number;
    codingTasks?: number;
    documentTasks?: number;
    presentationTasks?: number;
    presentationImages?: number;
  };
  nextUnlockAt: {
    text: string | null;
    voiceSeconds: string | null;
    cameraSeconds: string | null;
    creationRuns?: string | null;
    codingTasks?: string | null;
    documentTasks?: string | null;
    presentationTasks?: string | null;
    presentationImages?: string | null;
  };
  metrics: {
    text: QuotaMetricData;
    voiceSeconds: QuotaMetricData;
    cameraSeconds: QuotaMetricData;
    creationRuns?: QuotaMetricData;
    codingTasks?: QuotaMetricData;
    documentTasks?: QuotaMetricData;
    presentationTasks?: QuotaMetricData;
    presentationImages?: QuotaMetricData;
  };
}

interface QuotaSummaryResponse {
  traceId?: string;
  tier?: QuotaTier;
  quota: QuotaSummaryData;
}

interface QuotaErrorPayload {
  message?: string;
  reason?: string;
  traceId?: string;
  quota?: {
    text?: number;
    voiceSeconds?: number;
    cameraSeconds?: number;
    creationRuns?: number;
    codingTasks?: number;
    documentTasks?: number;
    presentationTasks?: number;
    presentationImages?: number;
    window?: string;
    windowDays?: number;
    limits?: {
      text?: number;
      voiceSeconds?: number;
      cameraSeconds?: number;
      creationRuns?: number;
      codingTasks?: number;
      documentTasks?: number;
      presentationTasks?: number;
      presentationImages?: number;
    };
    used?: {
      text?: number;
      voiceSeconds?: number;
      cameraSeconds?: number;
      creationRuns?: number;
      codingTasks?: number;
      documentTasks?: number;
      presentationTasks?: number;
      presentationImages?: number;
    };
    nextUnlockAt?: {
      text?: string | null;
      voiceSeconds?: string | null;
      cameraSeconds?: string | null;
      creationRuns?: string | null;
      codingTasks?: string | null;
      documentTasks?: string | null;
      presentationTasks?: string | null;
      presentationImages?: string | null;
    };
  };
}

interface AgentArtifactsResponse {
  traceId?: string;
  artifacts: AgentArtifactSummary[];
}

interface AgentArtifactResponse {
  traceId?: string;
  artifact: AgentArtifactSummary;
}

interface AgentTaskResponse {
  traceId?: string;
  task: AgentTaskSummary;
  steps?: AgentStepSummary[];
  approvals?: AgentApprovalSummary[];
  artifacts?: AgentArtifactSummary[];
  toolCalls?: AgentToolCallSummary[];
  stateVersion?: TaskStateVersion;
  resolvedStatusSource?: TaskStateResolvedStatusSource;
  qualitySummary?: ArtifactQualitySummary | null;
  assumptionsUsed?: TaskAssumption[];
  failure?: TaskFailureSummary | null;
}

interface AgentOfferResponse {
  traceId?: string;
  accepted?: boolean;
  declined?: boolean;
  alreadyAccepted?: boolean;
  alreadyDeclined?: boolean;
  offer: AgentOfferSummary;
  task?: AgentTaskSummary | null;
  awaitingApproval?: boolean;
}

type LiveMemoryMode = "safe_selective" | "remember_everything";
interface MemorySettingsData {
  memoryMode: LiveMemoryMode;
  crossChatMemoryEnabled: boolean;
}

interface MemorySettingsResponse extends TraceAwareResponse {
  settings: MemorySettingsData;
}

interface MemoryItemData {
  id: string;
  kind: string;
  summary: string;
  sensitivity: string;
  confidence: number | null;
  sourceMessageId: string | null;
  sourceConversationId: string | null;
  lastReinforcedAt: string | null;
  archived: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

interface MemoryItemsResponse extends TraceAwareResponse {
  items: MemoryItemData[];
  paging: {
    limit: number;
    offset: number;
    nextOffset: number;
  };
}

type LiveMemoryFallbackUsed =
  | "none"
  | "active_thread_only"
  | "persona_only"
  | "disabled";

interface LiveTokenMemoryMeta {
  activeThreadMessagesUsed: number;
  crossChatMessagesUsed: number;
  profileApplied: boolean;
  mode: LiveMemoryMode;
  buildMs: number;
  fallbackUsed: LiveMemoryFallbackUsed;
}

interface LiveTokenConfigSummary {
  lowLatencyMode: boolean;
  activityHandling: "START_OF_ACTIVITY_INTERRUPTS" | "NO_INTERRUPTION";
  automaticActivityDetectionDisabled: boolean;
  forceAlwaysRespond: boolean;
  vadStartSensitivity: "HIGH" | "LOW";
  vadEndSensitivity: "HIGH" | "LOW";
  vadPrefixPaddingMs: number;
  vadSilenceMs: number;
  turnCoverage: "TURN_INCLUDES_ONLY_ACTIVITY" | "TURN_INCLUDES_ALL_INPUT";
  affectiveDialog: boolean;
  proactiveAudio: boolean;
  sessionResumptionEnabled: boolean;
  contextWindowCompressionEnabled: boolean;
  effectiveInterruptMode: "client_manual_activity";
  thinkingBudget: number | null;
  includeThoughts: boolean;
  temperature: number;
  topP: number;
  topK: number | null;
  maxOutputTokens: number;
  deviceClass: "mobile" | "desktop" | "unknown";
  googleSearchGroundingEnabled: boolean;
  morningBriefFunctionCallingEnabled: boolean;
  googlePersonalContextFunctionCallingEnabled: boolean;
}

interface LiveTokenResponse extends TraceAwareResponse {
  ephemeralToken: string;
  model: string;
  voice?: LiveVoiceName;
  memoryMeta?: LiveTokenMemoryMeta;
  configSummary?: LiveTokenConfigSummary;
}

interface LiveTraceEntry {
  at: number;
  event: string;
  metadata: Record<string, unknown>;
}

interface GoogleIntegrationStatusResponse extends TraceAwareResponse {
  connected: boolean;
  status: "connected" | "disconnected" | "error";
  email: string | null;
  scopes: string[];
  gmailConnected?: boolean;
  calendarConnected?: boolean;
  missingScopes?: string[];
  lastError: string | null;
  expiry: string | null;
  enabled?: boolean;
}

interface GoogleConnectUrlResponse extends TraceAwareResponse {
  connectUrl?: string;
  url?: string;
  scopes?: string[];
  redirectUri?: string;
  redirectSource?: "configured_env" | "dynamic_host" | "query_override";
  code?: string;
  missingEnv?: string[];
  message?: string;
}

interface LiveTaskSnapshot {
  task: AgentTaskSummary;
  latestStep: AgentStepSummary | null;
  approval: AgentApprovalSummary | null;
  artifact: AgentArtifactSummary | null;
  failure: TaskFailureSummary | null;
  timeline: UnifiedAgentTaskTimelineItem[];
  updatedAtIso: string;
}

type TextRenderItem =
  | {
      kind: "message";
      message: MessageData;
    }
  | {
      kind: "agent_unified_task";
      message: MessageData;
      card: UnifiedAgentTaskCardModel;
    };

const ZEE_AVATAR_PRESET_OPTIONS: Array<{
  id: ZeeAvatarPreset;
  label: string;
  styleLabel: string;
  src: string;
}> = [
  { id: "woman_1", label: "Sage", styleLabel: "Woman", src: zeeAvatar },
  { id: "woman_2", label: "Ember", styleLabel: "Woman", src: zarraAvatar },
  { id: "man_1", label: "Atlas", styleLabel: "Man", src: zeeAvatarMan1 },
  { id: "man_2", label: "Kai", styleLabel: "Man", src: zeeAvatarMan2 },
];

function getZeeAvatarPresetSrc(preset: ZeeAvatarPreset | null | undefined): string {
  const resolvedPreset = preset ?? "woman_1";
  const match = ZEE_AVATAR_PRESET_OPTIONS.find(
    (option) => option.id === resolvedPreset,
  );
  return match?.src ?? zeeAvatar;
}

function createLocalId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createRequestTraceId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `trace-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function detectLiveDeviceClass(): "mobile" | "desktop" | "unknown" {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent || "";
  return /android|iphone|ipad|ipod|mobile/i.test(ua) ? "mobile" : "desktop";
}

function detectClientTimeZone(): string | null {
  if (typeof Intl === "undefined" || typeof Intl.DateTimeFormat !== "function") {
    return null;
  }
  const candidate = Intl.DateTimeFormat().resolvedOptions().timeZone?.trim();
  return candidate && candidate.length > 0 ? candidate : null;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function safeParseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function parseHttpError(error: unknown): {
  status: number;
  payload: Record<string, unknown> | null;
  bodyText: string;
} | null {
  const message = getErrorMessage(error).trim();
  const match = message.match(/^(\d{3}):\s*([\s\S]*)$/);
  if (!match) return null;
  const status = Number.parseInt(match[1], 10);
  if (!Number.isFinite(status)) return null;
  const bodyText = match[2]?.trim() ?? "";
  if (!bodyText) {
    return {
      status,
      payload: null,
      bodyText,
    };
  }
  const payload = bodyText.startsWith("{")
    ? safeParseJson<Record<string, unknown>>(bodyText)
    : null;
  return {
    status,
    payload,
    bodyText,
  };
}

function mapGoogleConnectActionError(error: unknown): string {
  const parsed = parseHttpError(error);
  if (!parsed) {
    return "Could not start Google connection. Please try again.";
  }

  const payload = parsed.payload ?? {};
  const code = typeof payload.code === "string" ? payload.code : "";
  const message = typeof payload.message === "string" ? payload.message : "";
  const traceId = typeof payload.traceId === "string" ? payload.traceId : null;
  const traceSuffix = traceId ? ` (trace ${traceId})` : "";

  if (code === "google_personal_context_disabled") {
    return "Google personal context is disabled in this environment.";
  }

  if (code === "google_oauth_not_configured") {
    const missingEnv = Array.isArray(payload.missingEnv)
      ? payload.missingEnv
          .map((value) => (typeof value === "string" ? value.trim() : ""))
          .filter((value) => value.length > 0)
      : [];
    if (missingEnv.length > 0) {
      return `Google integration is not fully configured on the server. Missing: ${missingEnv.join(", ")}.${traceSuffix}`;
    }
    return `Google integration is not fully configured on the server.${traceSuffix}`;
  }

  if (code === "google_connect_invalid_request") {
    return `Invalid Google connect request. Refresh and try again.${traceSuffix}`;
  }

  if (message) {
    return `${message}${traceSuffix}`;
  }

  if (parsed.status === 503) {
    return `Google connection is temporarily unavailable.${traceSuffix}`;
  }

  return `Could not start Google connection. Please try again.${traceSuffix}`;
}

function mapGoogleIntegrationFailureReason(reason: string | null): string {
  if (!reason) {
    return "Google connection failed. Please try reconnecting.";
  }
  if (reason === "encryption_key_invalid") {
    return "Google connection failed due to server encryption key configuration. Set GOOGLE_INTEGRATION_ENCRYPTION_KEY and try again.";
  }
  if (reason === "missing_refresh_token") {
    return "Google did not return a refresh token. Disconnect and reconnect Google, then choose your account again.";
  }
  if (reason === "oauth_exchange_failed") {
    return "Google authorization exchange failed. Please retry connecting Google.";
  }
  if (reason === "redirect_uri_mismatch") {
    return "Google rejected the callback URL (redirect_uri_mismatch). Verify authorized redirect URIs in Google Cloud Console and retry.";
  }
  return "Google connection failed. Please try reconnecting.";
}

function parseQuotaError(error: unknown): QuotaErrorPayload | null {
  const message = getErrorMessage(error);
  const [statusText, ...rest] = message.split(": ");
  const status = Number.parseInt(statusText, 10);
  if (status !== 429 || rest.length === 0) return null;
  const payloadText = rest.join(": ").trim();
  if (!payloadText.startsWith("{")) return null;
  return safeParseJson<QuotaErrorPayload>(payloadText);
}

function isAgentTaskStatusPayload(
  payload: MessageData["uiPayload"],
): payload is Extract<AgentMessageUiPayload, { kind: "agent_task_status" }> {
  return Boolean(payload && payload.kind === "agent_task_status");
}

function isAgentApprovalPayload(
  payload: MessageData["uiPayload"],
): payload is Extract<AgentMessageUiPayload, { kind: "agent_approval" }> {
  return Boolean(payload && payload.kind === "agent_approval");
}

function isAgentArtifactPayload(
  payload: MessageData["uiPayload"],
): payload is Extract<AgentMessageUiPayload, { kind: "agent_artifact" }> {
  return Boolean(payload && payload.kind === "agent_artifact");
}

function isAgentOfferPayload(
  payload: MessageData["uiPayload"],
): payload is Extract<AgentMessageUiPayload, { kind: "agent_offer" }> {
  return Boolean(payload && payload.kind === "agent_offer");
}

function isAgentUiPayload(payload: MessageData["uiPayload"]): boolean {
  return (
    isAgentTaskStatusPayload(payload) ||
    isAgentApprovalPayload(payload) ||
    isAgentArtifactPayload(payload) ||
    isAgentOfferPayload(payload)
  );
}

function toTaskStatusLabel(status: AgentTaskSummary["status"]): string {
  if (status === "in_progress") return "In progress";
  if (status === "approval_required") return "Needs approval";
  if (status === "completed") return "Completed";
  if (status === "failed") return "Failed";
  if (status === "cancelled") return "Canceled";
  return "Queued";
}

function isTerminalTaskStatus(status: AgentTaskSummary["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function parseClientBooleanFlag(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

const ENABLE_UNIFIED_AGENT_TASK_CARD = parseClientBooleanFlag(
  (import.meta.env as Record<string, unknown>).VITE_ENABLE_UNIFIED_AGENT_TASK_CARD ??
    (import.meta.env as Record<string, unknown>).ENABLE_UNIFIED_AGENT_TASK_CARD,
  true,
);

const ENABLE_AGENTIC_CREATIONS = parseClientBooleanFlag(
  (import.meta.env as Record<string, unknown>).VITE_ENABLE_AGENTIC_CREATIONS ??
    (import.meta.env as Record<string, unknown>).ENABLE_AGENTIC_CREATIONS,
  false,
);

const ENABLE_JSON_RENDER_ARTIFACT_VIEWER = parseClientBooleanFlag(
  (import.meta.env as Record<string, unknown>).VITE_ENABLE_JSON_RENDER_ARTIFACT_VIEWER ??
    (import.meta.env as Record<string, unknown>).ENABLE_JSON_RENDER_ARTIFACT_VIEWER,
  true,
);

const GOOGLE_OAUTH_CONNECT_REDIRECT_URI_OVERRIDE = (() => {
  const raw = (import.meta.env as Record<string, unknown>)
    .VITE_GOOGLE_OAUTH_CONNECT_REDIRECT_URI;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
})();

const TASK_STATUS_PRECEDENCE: Record<AgentTaskSummary["status"], number> = {
  queued: 1,
  in_progress: 2,
  approval_required: 3,
  completed: 4,
  failed: 5,
  cancelled: 5,
};

function isLikelyAgentArtifactBodyLeak(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  if (normalized.length > 320) return true;
  if (/^#\s+/m.test(normalized) || /^##\s+/m.test(normalized)) return true;
  if ((normalized.match(/\*\*[^*]+\*\*/g) ?? []).length >= 2) return true;
  if (/artifact ready:|zee is crafting your|done\. your outputs are ready below/i.test(normalized)) {
    return true;
  }
  return false;
}

function suppressLeakedArtifactBodies(messages: MessageData[]): MessageData[] {
  if (messages.length === 0) return messages;

  const sanitized = messages.map((message) => {
    if (message.sender !== "assistant" || !message.text) return message;
    const cleaned = sanitizeSplitTokenArtifacts(message.text);
    return cleaned !== message.text ? { ...message, text: cleaned } : message;
  });

  const hasTaskUiPayload = sanitized.some(
    (message) =>
      isAgentTaskStatusPayload(message.uiPayload) ||
      isAgentApprovalPayload(message.uiPayload) ||
      isAgentArtifactPayload(message.uiPayload),
  );
  if (!hasTaskUiPayload) return sanitized;

  const filtered = sanitized.filter((message) => {
    if (message.sender !== "assistant") return true;
    if (
      isAgentTaskStatusPayload(message.uiPayload) ||
      isAgentApprovalPayload(message.uiPayload) ||
      isAgentArtifactPayload(message.uiPayload)
    ) {
      return true;
    }
    return !isLikelyAgentArtifactBodyLeak(message.text ?? "");
  });
  return filtered.length > 0 ? filtered : sanitized;
}

function toIsoString(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function toEpochMs(value: string | Date | null | undefined): number {
  const iso = toIsoString(value);
  if (!iso) return 0;
  const parsed = new Date(iso).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function extractAgentTaskIdFromPayload(
  payload: MessageData["uiPayload"],
): string | null {
  if (!payload) return null;
  if (payload.kind === "agent_task_status") {
    return payload.task.id;
  }
  if (payload.kind === "agent_approval" || payload.kind === "agent_artifact") {
    return payload.taskId;
  }
  return null;
}

function pickLatestTaskSummary(
  existingTask: AgentTaskSummary | null,
  incomingTask: AgentTaskSummary | null,
): AgentTaskSummary | null {
  if (!incomingTask) return existingTask;
  if (!existingTask) return incomingTask;
  const existingUpdatedMs = Math.max(
    toEpochMs(existingTask.updatedAt),
    toEpochMs(existingTask.completedAt),
    toEpochMs(existingTask.createdAt),
  );
  const incomingUpdatedMs = Math.max(
    toEpochMs(incomingTask.updatedAt),
    toEpochMs(incomingTask.completedAt),
    toEpochMs(incomingTask.createdAt),
  );
  return incomingUpdatedMs >= existingUpdatedMs ? incomingTask : existingTask;
}

function resolveTaskStatus(
  statuses: Array<AgentTaskSummary["status"] | null | undefined>,
): AgentTaskSummary["status"] {
  let resolved: AgentTaskSummary["status"] = "queued";
  let bestRank = TASK_STATUS_PRECEDENCE[resolved];
  for (const status of statuses) {
    if (!status) continue;
    const rank = TASK_STATUS_PRECEDENCE[status];
    if (rank > bestRank) {
      resolved = status;
      bestRank = rank;
    }
  }
  return resolved;
}

function upsertTimelineItem(
  timeline: UnifiedAgentTaskTimelineItem[],
  item: UnifiedAgentTaskTimelineItem,
) {
  const existingIndex = timeline.findIndex((entry) => entry.id === item.id);
  if (existingIndex >= 0) {
    timeline[existingIndex] = item;
  } else {
    timeline.push(item);
  }
}

function toTaskKindLabel(taskKind: string): string {
  if (taskKind === "mini_game") return "Mini game";
  if (taskKind === "web_build") return "Web build";
  if (taskKind === "doc_markdown") return "Document";
  if (taskKind === "mixed") return "Mixed";
  return "Agent task";
}

function toUnifiedTaskOutputSummary(card: UnifiedAgentTaskCardModel): string {
  const summary = card.summaryText?.trim() ?? "";
  const summaryLooksLeakedArtifact = isLikelyAgentArtifactBodyLeak(summary);
  if (card.status === "failed") {
    return (
      card.failure?.reason ||
      summary ||
      "This task failed before publishing an output."
    );
  }
  if (card.approval?.status === "pending") {
    return card.approval.requestedAction;
  }
  if (card.artifact) {
    const summaryLower = summary.toLowerCase();
    const isStaleCraftingCopy =
      summaryLower.includes("crafting") ||
      summaryLower.includes("task started") ||
      summaryLower.includes("queued");
    if (summary.length > 0 && !isStaleCraftingCopy && !summaryLooksLeakedArtifact) {
      return summary;
    }
    if (card.artifact.type === "mini_game") {
      return "Open View / Play to launch the game and see controls in the full viewer.";
    }
    if (card.artifact.type === "web_app") {
      return "Open View / Launch to open your web app in the full viewer.";
    }
    return "Your output is ready to open.";
  }
  if (summary.length > 0) {
    if (summaryLooksLeakedArtifact) {
      return card.latestStep?.detail ?? "Zee is preparing your output.";
    }
    return summary;
  }
  return card.latestStep?.detail ?? "Zee is working through your request.";
}

function toDefaultTaskTitle(params: {
  task: AgentTaskSummary | null;
  artifact: AgentArtifactSummary | null;
  taskId: string;
}): string {
  if (params.artifact?.title) return params.artifact.title;
  if (params.task?.prompt?.trim()) {
    return params.task.prompt.trim().slice(0, 72);
  }
  return `Task ${params.taskId.slice(0, 8)}`;
}

function normalizeTimeline(
  timeline: UnifiedAgentTaskTimelineItem[],
): UnifiedAgentTaskTimelineItem[] {
  return [...timeline].sort((a, b) => {
    const aRank = toEpochMs(a.createdAt);
    const bRank = toEpochMs(b.createdAt);
    if (aRank !== bRank) return aRank - bRank;
    return a.id.localeCompare(b.id);
  });
}

function buildUnifiedAgentTaskCards(
  messages: MessageData[],
  liveTaskSnapshots: Record<string, LiveTaskSnapshot>,
): TextRenderItem[] {
  if (!ENABLE_UNIFIED_AGENT_TASK_CARD) {
    return messages.map((message) => ({ kind: "message", message }));
  }

  interface AgentTaskAggregate {
    taskId: string;
    firstMessageId: string;
    task: AgentTaskSummary | null;
    latestStep: AgentStepSummary | null;
    approval: AgentApprovalSummary | null;
    artifact: AgentArtifactSummary | null;
    failure: TaskFailureSummary | null;
    timeline: UnifiedAgentTaskTimelineItem[];
    summaryText: string | null;
  }

  const taskAggregates = new Map<string, AgentTaskAggregate>();
  const hiddenMessageIds = new Set<string>();

  for (const message of messages) {
    if (message.sender !== "assistant") continue;
    const taskId = extractAgentTaskIdFromPayload(message.uiPayload);
    if (!taskId) continue;

    const existingAggregate = taskAggregates.get(taskId);
    if (!existingAggregate) {
      taskAggregates.set(taskId, {
        taskId,
        firstMessageId: message.id,
        task: null,
        latestStep: null,
        approval: null,
        artifact: null,
        failure: null,
        timeline: [],
        summaryText: null,
      });
    } else {
      hiddenMessageIds.add(message.id);
    }

    const aggregate = taskAggregates.get(taskId);
    if (!aggregate) continue;

    if (message.text.trim().length > 0 && !isLikelyAgentArtifactBodyLeak(message.text)) {
      aggregate.summaryText = message.text.trim();
    }

    if (isAgentTaskStatusPayload(message.uiPayload)) {
      aggregate.task = pickLatestTaskSummary(aggregate.task, message.uiPayload.task);
      if (message.uiPayload.task.status === "failed") {
        const failureReason =
          message.uiPayload.task.errorMessage?.trim() ||
          message.uiPayload.latestStep?.detail?.trim() ||
          aggregate.summaryText;
        if (failureReason) {
          aggregate.failure = {
            traceId: null,
            stage: "unknown",
            stepKey: message.uiPayload.latestStep?.stepKey ?? null,
            stepTitle: message.uiPayload.latestStep?.title ?? null,
            toolName: null,
            code: null,
            reason: failureReason,
            toolOutputSummary: null,
            sandboxJobId: null,
            retriable: false,
            occurredAt: toIsoString(message.uiPayload.task.updatedAt),
            rawMessage: message.uiPayload.task.errorMessage ?? failureReason,
          };
        }
      }
      if (message.uiPayload.latestStep) {
        aggregate.latestStep = message.uiPayload.latestStep;
        upsertTimelineItem(aggregate.timeline, {
          id: `step-${message.uiPayload.latestStep.id}`,
          title: message.uiPayload.latestStep.title,
          detail: message.uiPayload.latestStep.detail ?? null,
          status: message.uiPayload.latestStep.status,
          createdAt: toIsoString(message.uiPayload.latestStep.updatedAt),
        });
      } else {
        upsertTimelineItem(aggregate.timeline, {
          id: `status-${message.uiPayload.task.status}`,
          title: toTaskStatusLabel(message.uiPayload.task.status),
          detail: message.uiPayload.text ?? null,
          status:
            message.uiPayload.task.status === "completed"
              ? "completed"
              : message.uiPayload.task.status === "failed"
                ? "failed"
                : message.uiPayload.task.status === "approval_required"
                  ? "blocked"
                  : "in_progress",
          createdAt: toIsoString(message.createdAt),
        });
      }
    }

    if (isAgentApprovalPayload(message.uiPayload)) {
      aggregate.approval = message.uiPayload.approval;
      upsertTimelineItem(aggregate.timeline, {
        id: `approval-${message.uiPayload.approval.id}`,
        title:
          message.uiPayload.approval.status === "pending"
            ? "Approval required"
            : `Approval ${message.uiPayload.approval.status}`,
        detail: message.uiPayload.approval.requestedAction,
        status:
          message.uiPayload.approval.status === "denied" ? "failed" : "blocked",
        createdAt: toIsoString(message.uiPayload.approval.createdAt),
      });
    }

    if (isAgentArtifactPayload(message.uiPayload)) {
      aggregate.artifact = message.uiPayload.artifact;
      upsertTimelineItem(aggregate.timeline, {
        id: `artifact-${message.uiPayload.artifact.id}`,
        title: "Artifact ready",
        detail: message.uiPayload.artifact.title,
        status: "completed",
        createdAt: toIsoString(message.uiPayload.artifact.updatedAt),
      });
    }
  }

  for (const [taskId, snapshot] of Object.entries(liveTaskSnapshots)) {
    const aggregate = taskAggregates.get(taskId);
    if (!aggregate) continue;

    aggregate.task = pickLatestTaskSummary(aggregate.task, snapshot.task);
    if (snapshot.latestStep) {
      aggregate.latestStep = snapshot.latestStep;
    }
    if (snapshot.approval) {
      aggregate.approval = snapshot.approval;
    }
    if (snapshot.artifact) {
      aggregate.artifact = snapshot.artifact;
    }
    if (snapshot.failure) {
      aggregate.failure = snapshot.failure;
    }
    for (const timelineItem of snapshot.timeline) {
      upsertTimelineItem(aggregate.timeline, timelineItem);
    }
  }

  return messages.flatMap((message, messageIndex): TextRenderItem[] => {
    const taskId =
      message.sender === "assistant"
        ? extractAgentTaskIdFromPayload(message.uiPayload)
        : null;
    if (!taskId) {
      return [{ kind: "message", message }];
    }
    if (hiddenMessageIds.has(message.id)) {
      return [];
    }

    const aggregate = taskAggregates.get(taskId);
    if (!aggregate || aggregate.firstMessageId !== message.id) {
      return [{ kind: "message", message }];
    }

    if (
      aggregate.approval?.status === "pending" &&
      (Boolean(aggregate.artifact) ||
        Boolean(aggregate.task?.status && isTerminalTaskStatus(aggregate.task.status)))
    ) {
      aggregate.approval = null;
    }

    const hasTerminalTaskStatus = Boolean(
      aggregate.task?.status && isTerminalTaskStatus(aggregate.task.status),
    );
    const inferredStatusFromApproval =
      !hasTerminalTaskStatus && !aggregate.artifact && aggregate.approval?.status === "pending"
        ? "approval_required"
        : aggregate.approval?.status === "denied"
          ? "failed"
          : null;
    const inferredStatusFromArtifact = aggregate.artifact ? "completed" : null;
    const resolvedStatus = resolveTaskStatus([
      aggregate.task?.status,
      inferredStatusFromApproval,
      inferredStatusFromArtifact,
    ]);

    const resolvedTask =
      aggregate.task ??
      ({
        id: taskId,
        conversationId: message.conversationId,
        status: resolvedStatus,
        riskLevel: "low",
        taskKind:
          aggregate.artifact?.type === "mini_game"
            ? "mini_game"
            : aggregate.artifact?.type === "web_app"
              ? "web_build"
              : "doc_markdown",
        prompt: message.text,
        errorMessage:
          aggregate.failure?.rawMessage ?? aggregate.failure?.reason ?? null,
        createdAt: message.createdAt ? new Date(message.createdAt) : null,
        updatedAt: message.createdAt ? new Date(message.createdAt) : null,
        completedAt: null,
      } satisfies AgentTaskSummary);

    const timeline = normalizeTimeline(aggregate.timeline);
    const summaryText = aggregate.summaryText?.trim()
      ? aggregate.summaryText.trim()
      : null;
    const card: UnifiedAgentTaskCardModel = {
      taskId,
      title: toDefaultTaskTitle({
        task: resolvedTask,
        artifact: aggregate.artifact,
        taskId,
      }),
      prompt: resolvedTask.prompt,
      summaryText,
      taskKind: resolvedTask.taskKind,
      status: resolvedStatus,
      latestStep: aggregate.latestStep,
      approval: aggregate.approval,
      artifact: aggregate.artifact,
      failure: aggregate.failure,
      timeline,
      autoCollapsed:
        isTerminalTaskStatus(resolvedStatus) &&
        messages
          .slice(messageIndex + 1)
          .filter((entry) => entry.sender === "user").length >= 2,
    };

    return [{ kind: "agent_unified_task", message, card }];
  });
}

function formatMinutesFromSeconds(seconds: number): string {
  return `${Math.max(0, Math.floor(seconds / 60))}`;
}

function toUserFacingCameraError(error: unknown, fallback: string): string {
  const message = getErrorMessage(error).trim();
  if (!message) return fallback;

  const lower = message.toLowerCase();
  if (
    lower.includes("permission") ||
    lower.includes("denied") ||
    lower.includes("notallowederror")
  ) {
    return "Camera permission is blocked. Allow camera access and try again.";
  }
  if (lower.includes("notfounderror") || lower.includes("device not found")) {
    return "No camera device was found for this browser session.";
  }
  if (lower.includes("timed out")) {
    return "Camera permission prompt timed out. Try again and approve access.";
  }

  return `${fallback} (${message})`;
}

function extractTraceId(
  response: Response,
  body?: TraceAwareResponse | null,
): string | undefined {
  return getResponseTraceId(response) ?? body?.traceId;
}

// --- Constants ---
const ONBOARDING_STEPS = [
  {
    id: 1,
    title: "Welcome.",
    description: "I'm here with you.",
    orbColor: "#6AF4E7",
    orbGlow: "rgba(106, 244, 231, 0.45)",
    bgGradient:
      "radial-gradient(130% 95% at 50% 8%, rgba(57, 172, 180, 0.44) 0%, rgba(14, 41, 60, 0.86) 45%, #040914 100%)",
    accentRing: "rgba(106, 244, 231, 0.3)",
    particleColor: "rgba(160, 255, 247, 0.72)",
    headlineColor: "#ECF7FF",
    bodyColor: "rgba(222, 245, 255, 0.86)",
    skipColor: "rgba(216, 243, 255, 0.74)",
    dotInactive: "rgba(201, 242, 255, 0.2)",
    ctaText: "#EEF8FF",
    ctaBackground: "linear-gradient(135deg, rgba(255,255,255,0.18), rgba(255,255,255,0.07))",
    ctaBorder: "rgba(186, 246, 241, 0.42)",
  },
  {
    id: 2,
    title: "I'm here to listen.",
    description: "A shoulder to lean on.",
    orbColor: "#FF9D55",
    orbGlow: "rgba(255, 157, 85, 0.45)",
    bgGradient:
      "radial-gradient(130% 95% at 50% 8%, rgba(245, 95, 72, 0.48) 0%, rgba(77, 28, 33, 0.89) 44%, #11070C 100%)",
    accentRing: "rgba(255, 157, 85, 0.34)",
    particleColor: "rgba(255, 183, 136, 0.76)",
    headlineColor: "#FFE3C8",
    bodyColor: "rgba(255, 216, 185, 0.86)",
    skipColor: "rgba(255, 206, 162, 0.72)",
    dotInactive: "rgba(255, 203, 160, 0.2)",
    ctaText: "#FFF2E4",
    ctaBackground: "linear-gradient(135deg, rgba(255,255,255,0.15), rgba(255,196,141,0.12))",
    ctaBorder: "rgba(255, 191, 144, 0.5)",
  },
  {
    id: 3,
    title: "We grow together.",
    description: "Our journey, our bond.",
    orbColor: "#BC73FF",
    orbGlow: "rgba(188, 115, 255, 0.48)",
    bgGradient:
      "radial-gradient(130% 95% at 50% 8%, rgba(120, 84, 235, 0.5) 0%, rgba(43, 24, 98, 0.88) 45%, #070512 100%)",
    accentRing: "rgba(188, 115, 255, 0.3)",
    particleColor: "rgba(208, 171, 255, 0.74)",
    headlineColor: "#F4E8FF",
    bodyColor: "rgba(228, 204, 255, 0.84)",
    skipColor: "rgba(215, 186, 255, 0.7)",
    dotInactive: "rgba(212, 180, 255, 0.2)",
    ctaText: "#F8EEFF",
    ctaBackground: "linear-gradient(135deg, rgba(255,255,255,0.16), rgba(188,115,255,0.12))",
    ctaBorder: "rgba(208, 170, 255, 0.46)",
  }
];
const ONBOARDING_RELATIONSHIP_WORDS = [
  "Bestie",
  "Homie",
  "Friend",
  "Assistant",
  "Helper",
  "Confidant",
] as const;

const CHAT_IMAGE_MAX_COUNT = 3;
const TRANSCRIPT_DEDUPE_WINDOW_MS = 2500;
const TRANSCRIPT_DEDUPE_PRUNE_MS = 60000;
const MORNING_BRIEF_QUICK_ACTION_TEXT = "Give me my morning briefing";
const ASSISTANT_NAME: Persona = "Zee";
const DEFAULT_LIVE_VOICE: LiveVoiceName = "Aoede";
const LIVE_VOICE_OPTIONS: Array<{
  id: LiveVoiceName;
  label: string;
  style: "feminine" | "masculine";
  avatar: string;
}> = [
  { id: "Aoede", label: "Aoede", style: "feminine", avatar: zeeAvatar },
  { id: "Kore", label: "Kore", style: "feminine", avatar: zarraAvatar },
  { id: "Charon", label: "Charon", style: "masculine", avatar: zeeAvatarMan1 },
  { id: "Fenrir", label: "Fenrir", style: "masculine", avatar: zeeAvatarMan2 },
];

function isLiveVoiceName(value: unknown): value is LiveVoiceName {
  return LIVE_VOICE_OPTIONS.some((option) => option.id === value);
}

// --- Components ---

const PROFESSION_OPTIONS = [
  "Software Engineer",
  "Designer",
  "Product Manager",
  "Data Scientist",
  "Teacher / Educator",
  "Healthcare Professional",
  "Marketing / PR",
  "Student",
  "Entrepreneur",
  "Writer / Content Creator",
  "Artist / Creative",
  "Consultant",
  "Sales Professional",
  "Researcher / Scientist",
  "Coach / Therapist",
  "Finance / Accounting",
  "Legal Professional",
  "Real Estate",
  "Homemaker",
  "Other",
];

const SearchableDropdown = ({ value, onChange, options, placeholder, testId }: {
  value: string;
  onChange: (val: string) => void;
  options: string[];
  placeholder: string;
  testId: string;
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = options.filter((o) =>
    o.toLowerCase().includes(search.toLowerCase())
  );

  const handleSelect = (option: string) => {
    onChange(option);
    setSearch("");
    setOpen(false);
  };

  return (
    <div className="relative">
      <input
        type="text"
        value={open ? search : value}
        onChange={(e) => {
          setSearch(e.target.value);
          if (!open) setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
          setSearch(value);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        placeholder={placeholder}
        className="w-full h-12 px-4 rounded-xl bg-white/10 border border-white/20 text-white placeholder:text-white/40 focus:outline-none focus:border-[var(--app-accent)] focus:ring-1 focus:ring-[var(--app-accent)] transition-colors"
        data-testid={testId}
      />
      <AnimatePresence>
        {open && filtered.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -4, scaleY: 0.95 }}
            animate={{ opacity: 1, y: 0, scaleY: 1 }}
            exit={{ opacity: 0, y: -4, scaleY: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute z-50 left-0 right-0 mt-1.5 max-h-48 overflow-y-auto rounded-xl bg-[#1a4a4d] border border-white/15 shadow-2xl backdrop-blur-lg origin-top"
            style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.15) transparent" }}
          >
            {filtered.map((option) => (
              <button
                key={option}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleSelect(option)}
                className={cn(
                  "w-full text-left px-4 py-2.5 text-sm transition-colors",
                  value === option
                    ? "bg-[#DAA112]/20 text-[#DAA112] font-medium"
                    : "text-white/80 hover:bg-white/10 hover:text-white"
                )}
                data-testid={`option-${testId}-${option.toLowerCase().replace(/[\s\/]+/g, "-")}`}
              >
                {option}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const REFERRAL_OPTIONS = [
  "Social Media",
  "Friend or Family",
  "App Store",
  "Blog / Article",
  "Podcast",
  "Search Engine",
  "Other",
];

const OnboardingOrb = ({
  slide,
  size = 320,
}: {
  slide: typeof ONBOARDING_STEPS[number];
  size?: number;
}) => (
  <CanvasOrb config={slide} size={size} />
);

const AuthPage = ({ onLogin, onRegister, loginError, registerError, isLoggingIn, isRegistering, initialMode = "welcome" }: {
  onLogin: (data: { email: string; password: string }) => Promise<any>;
  onRegister: (data: { email: string; password: string; confirmPassword?: string; firstName: string; lastName: string; profession?: string; referralSource?: string }) => Promise<any>;
  loginError: Error | null;
  registerError: Error | null;
  isLoggingIn: boolean;
  isRegistering: boolean;
  initialMode?: "welcome" | "login";
}) => {
  const [authMode, setAuthMode] = useState<"welcome" | "login" | "register">(initialMode);
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    confirmPassword: "",
    firstName: "",
    lastName: "",
    profession: "",
    referralSource: "",
  });
  const [localError, setLocalError] = useState("");
  const startGoogleAuth = useCallback(
    (mode: "signin" | "signup") => {
      const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      const url = new URL("/api/auth/google/start", window.location.origin);
      url.searchParams.set("mode", mode);
      url.searchParams.set("returnTo", returnTo);
      window.location.assign(url.toString());
    },
    [],
  );

  useEffect(() => {
    const url = new URL(window.location.href);
    const authError = url.searchParams.get("auth_error");
    if (!authError) return;

    const errorMap: Record<string, string> = {
      invalid_oauth_state: "Google sign-in session expired. Please try again.",
      expired_oauth_state: "Google sign-in took too long. Please try again.",
      oauth_exchange_failed: "Google sign-in failed at token exchange. Please try again.",
      access_denied: "Google sign-in was canceled.",
      google_sign_in_failed: "Google sign-in failed. Please try again.",
      google_sso_not_configured: "Google sign-in is not configured yet.",
      missing_email: "Google did not return an email for this account.",
    };

    setLocalError(errorMap[authError] ?? "Google sign-in failed. Please try again.");
    setAuthMode("login");
    url.searchParams.delete("auth_error");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError("");
    try {
      await onLogin({ email: formData.email, password: formData.password });
    } catch (err: any) {
      setLocalError(err.message?.includes(":") ? err.message.split(": ").slice(1).join(": ") : "Invalid email or password");
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError("");
    if (formData.password.length < 8) {
      setLocalError("Password must be at least 8 characters");
      return;
    }
    if (formData.password !== formData.confirmPassword) {
      setLocalError("Passwords do not match");
      return;
    }
    try {
      await onRegister({
        email: formData.email,
        password: formData.password,
        confirmPassword: formData.confirmPassword,
        firstName: formData.firstName,
        lastName: formData.lastName,
        profession: formData.profession || undefined,
        referralSource: formData.referralSource || undefined,
      });
    } catch (err: any) {
      setLocalError(err.message?.includes(":") ? err.message.split(": ").slice(1).join(": ") : "Something went wrong");
    }
  };

  const inputClass = "w-full h-12 px-4 rounded-xl bg-white/10 border border-white/20 text-white placeholder:text-white/40 focus:outline-none focus:border-[var(--app-accent)] focus:ring-1 focus:ring-[var(--app-accent)] transition-colors";

  if (authMode === "welcome") {
    return (
      <MarketingLandingPage
        onGetStarted={() => setAuthMode("register")}
        onSignIn={() => setAuthMode("login")}
      />
    );
  }

  if (authMode === "login") {
    return (
      <div className="w-full h-[100dvh] min-h-[100dvh] flex items-center justify-center overflow-hidden" style={{ background: "var(--app-shell-bg)" }} data-testid="login-page">
        <div className="w-full h-full md:max-w-[400px] md:h-[850px] md:rounded-[2.5rem] shadow-2xl overflow-hidden relative flex flex-col" style={{ background: "var(--app-shell-bg)" }}>
          <div className="p-6">
            <button onClick={() => setAuthMode("welcome")} className="text-white/70 hover:text-white transition-colors" data-testid="button-back-to-welcome">
              <ArrowLeft className="w-6 h-6" />
            </button>
          </div>

          <div className="flex-1 flex flex-col px-8 pb-8">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-8"
            >
              <h1 className="text-3xl font-serif font-bold text-[#E8E8E8] mb-2">Welcome Back</h1>
              <p className="text-white/60">Sign in to continue your journey</p>
            </motion.div>

            <form onSubmit={handleLogin} className="space-y-4 flex-1 flex flex-col">
              <div>
                <label className="text-sm text-white/60 mb-1.5 block">Email</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData(f => ({ ...f, email: e.target.value }))}
                  className={inputClass}
                  placeholder="you@example.com"
                  required
                  data-testid="input-login-email"
                />
              </div>

              <div>
                <label className="text-sm text-white/60 mb-1.5 block">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={formData.password}
                    onChange={(e) => setFormData(f => ({ ...f, password: e.target.value }))}
                    className={inputClass}
                    placeholder="Enter your password"
                    required
                    data-testid="input-login-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70"
                    data-testid="button-toggle-password"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              {localError && (
                <motion.p
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-red-400 text-sm"
                  data-testid="text-login-error"
                >
                  {localError}
                </motion.p>
              )}

              <div className="flex-1" />

              <Button
                type="submit"
                disabled={isLoggingIn}
                className="w-full h-14 text-lg rounded-2xl shadow-xl bg-[#DAA112] text-[#10383A] hover:bg-[#DAA112]/90 transition-transform active:scale-95 font-bold disabled:opacity-50"
                data-testid="button-login-submit"
              >
                {isLoggingIn ? "Signing in..." : "Sign In"}
              </Button>

              <Button
                type="button"
                onClick={() => startGoogleAuth("signin")}
                className="w-full h-14 text-base rounded-2xl border border-white/20 bg-white/10 text-white hover:bg-white/15 transition-colors font-semibold"
                data-testid="button-login-google"
              >
                Continue with Google
              </Button>

              <p className="text-center text-white/50 text-sm">
                Don't have an account?{" "}
                <button type="button" onClick={() => { setAuthMode("register"); setLocalError(""); }} className="text-[#DAA112] hover:underline" data-testid="button-switch-to-register">
                  Sign up
                </button>
              </p>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-[100dvh] min-h-[100dvh] flex items-center justify-center overflow-hidden" style={{ background: "var(--app-shell-bg)" }} data-testid="register-page">
      <div className="w-full h-full md:max-w-[400px] md:h-[850px] md:rounded-[2.5rem] shadow-2xl overflow-hidden relative flex flex-col" style={{ background: "var(--app-shell-bg)" }}>
        <div className="p-6">
          <button onClick={() => setAuthMode("welcome")} className="text-white/70 hover:text-white transition-colors" data-testid="button-back-to-welcome-register">
            <ArrowLeft className="w-6 h-6" />
          </button>
        </div>

        <ScrollArea className="flex-1 px-8 pb-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6"
          >
            <h1 className="text-3xl font-serif font-bold text-[#E8E8E8] mb-2">Create Account</h1>
            <p className="text-white/60">Join our caring community</p>
          </motion.div>

          <form onSubmit={handleRegister} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm text-white/60 mb-1.5 block">First Name</label>
                <input
                  type="text"
                  value={formData.firstName}
                  onChange={(e) => setFormData(f => ({ ...f, firstName: e.target.value }))}
                  className={inputClass}
                  placeholder="First name"
                  required
                  data-testid="input-register-firstname"
                />
              </div>
              <div>
                <label className="text-sm text-white/60 mb-1.5 block">Last Name</label>
                <input
                  type="text"
                  value={formData.lastName}
                  onChange={(e) => setFormData(f => ({ ...f, lastName: e.target.value }))}
                  className={inputClass}
                  placeholder="Last name"
                  required
                  data-testid="input-register-lastname"
                />
              </div>
            </div>

            <div>
              <label className="text-sm text-white/60 mb-1.5 block">Email</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData(f => ({ ...f, email: e.target.value }))}
                className={inputClass}
                placeholder="you@example.com"
                required
                data-testid="input-register-email"
              />
            </div>

            <div>
              <label className="text-sm text-white/60 mb-1.5 block">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={formData.password}
                  onChange={(e) => setFormData(f => ({ ...f, password: e.target.value }))}
                  className={inputClass}
                  placeholder="At least 8 characters"
                  required
                  minLength={8}
                  data-testid="input-register-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70"
                  data-testid="button-toggle-password-register"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            <div>
              <label className="text-sm text-white/60 mb-1.5 block">Confirm Password</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={formData.confirmPassword}
                  onChange={(e) => setFormData(f => ({ ...f, confirmPassword: e.target.value }))}
                  className={inputClass}
                  placeholder="Confirm your password"
                  required
                  minLength={8}
                  data-testid="input-register-confirm-password"
                />
              </div>
            </div>

            <div>
              <label className="text-sm text-white/60 mb-1.5 block">Profession</label>
              <SearchableDropdown
                value={formData.profession}
                onChange={(val) => setFormData(f => ({ ...f, profession: val }))}
                options={PROFESSION_OPTIONS}
                placeholder="Search or select your profession..."
                testId="input-register-profession"
              />
            </div>

            <div>
              <label className="text-sm text-white/60 mb-1.5 block">How did you hear about us?</label>
              <SearchableDropdown
                value={formData.referralSource}
                onChange={(val) => setFormData(f => ({ ...f, referralSource: val }))}
                options={REFERRAL_OPTIONS}
                placeholder="Select an option..."
                testId="select-register-referral"
              />
            </div>

            {localError && (
              <motion.p
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-red-400 text-sm"
                data-testid="text-register-error"
              >
                {localError}
              </motion.p>
            )}

            <div className="pt-2 pb-4">
              <Button
                type="submit"
                disabled={isRegistering}
                className="w-full h-14 text-lg rounded-2xl shadow-xl bg-[#DAA112] text-[#10383A] hover:bg-[#DAA112]/90 transition-transform active:scale-95 font-bold disabled:opacity-50"
                data-testid="button-register-submit"
              >
                {isRegistering ? "Creating account..." : "Create Account"}
              </Button>

              <Button
                type="button"
                onClick={() => startGoogleAuth("signup")}
                className="w-full h-14 mt-3 text-base rounded-2xl border border-white/20 bg-white/10 text-white hover:bg-white/15 transition-colors font-semibold"
                data-testid="button-register-google"
              >
                Sign up with Google
              </Button>

              <p className="text-center text-white/50 text-sm mt-4">
                Already have an account?{" "}
                <button type="button" onClick={() => { setAuthMode("login"); setLocalError(""); }} className="text-[#DAA112] hover:underline" data-testid="button-switch-to-login">
                  Sign in
                </button>
              </p>
            </div>
          </form>
        </ScrollArea>
      </div>
    </div>
  );
};

const SharedFooter = ({ 
  persona, 
  mode,
  onSendMessage,
  onSelectCameraFiles,
  onSelectGalleryFiles,
  onRemoveAttachment,
  pendingAttachments,
  isSending,
  uploadError,
  quotaSummary,
  quotaLoading,
  hasBriefInChat,
}: { 
  persona: Persona, 
  mode: Mode,
  onSendMessage: (text: string, options?: SendMessageOptions) => void,
  onSelectCameraFiles: (files: FileList | null) => void;
  onSelectGalleryFiles: (files: FileList | null) => void;
  onRemoveAttachment: (localId: string) => void;
  pendingAttachments: PendingImageAttachment[];
  isSending: boolean;
  uploadError: string | null;
  quotaSummary?: QuotaSummaryData;
  quotaLoading?: boolean;
  hasBriefInChat?: boolean;
}) => {
  const [inputValue, setInputValue] = useState("");
  const [isMediaTrayOpen, setIsMediaTrayOpen] = useState(false);
  const cameraInputId = useId();
  const galleryInputId = useId();

  const [briefRequested, setBriefRequested] = useState(false);

  const hasReadyAttachment = pendingAttachments.some((item) => item.status === "ready");
  const hasUploadingAttachment = pendingAttachments.some(
    (item) => item.status === "uploading",
  );
  const showMorningBriefQuickAction =
    mode === "text" &&
    !isSending &&
    !briefRequested &&
    !hasBriefInChat &&
    !uploadError &&
    pendingAttachments.length === 0 &&
    !inputValue.trim() &&
    !isMediaTrayOpen;

  const handleSend = () => {
    const trimmed = inputValue.trim();
    if (!trimmed && !hasReadyAttachment) return;
    if (hasUploadingAttachment || isSending) return;
    if (trimmed.toLowerCase().includes("morning brief")) {
      setBriefRequested(true);
    }
    onSendMessage(trimmed);
    setInputValue("");
    setIsMediaTrayOpen(false);
  };

  const handleQuickActionMorningBrief = () => {
    if (isSending) return;
    setBriefRequested(true);
    onSendMessage(MORNING_BRIEF_QUICK_ACTION_TEXT, {
      ignoreAttachments: true,
    });
    setInputValue("");
    setIsMediaTrayOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div
      className="absolute bottom-0 left-0 right-0 z-50 border-t backdrop-blur-md"
      style={{
        backgroundColor: "var(--app-footer-bg)",
        borderTopColor: "var(--app-soft-card-border)",
        paddingLeft: "0.75rem",
        paddingRight: "0.75rem",
        paddingTop: "0.55rem",
        paddingBottom: "max(0.65rem, env(safe-area-inset-bottom))",
      }}
    >
      <div className="mb-2 text-[11px] text-center" style={{ color: "var(--app-on-dark-muted)" }}>
        {quotaLoading
          ? "Checking beta quota..."
          : quotaSummary
            ? `Beta quota: ${quotaSummary.remaining.text} texts left · ${formatMinutesFromSeconds(quotaSummary.remaining.voiceSeconds)} voice min left · ${formatMinutesFromSeconds(quotaSummary.remaining.cameraSeconds)} camera min left`
            : "Beta quota unavailable right now."}
      </div>
      {showMorningBriefQuickAction && (
        <div className="mb-2 flex items-center justify-center">
          <button
            type="button"
            onClick={handleQuickActionMorningBrief}
            disabled={isSending}
            className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium transition-colors disabled:opacity-50"
            style={{
              borderColor: "var(--app-soft-card-border)",
              backgroundColor:
                "color-mix(in srgb, var(--app-soft-card-bg) 70%, transparent)",
              color: "var(--app-on-dark-muted)",
            }}
            data-testid="button-morning-brief-quick-action"
          >
            <Globe className="h-3 w-3" style={{ color: "var(--app-accent)" }} />
            Morning Brief
          </button>
        </div>
      )}
      {pendingAttachments.length > 0 && (
        <div className="mb-2 flex items-center gap-2 overflow-x-auto pb-1">
          {pendingAttachments.map((attachment) => (
            <div
              key={attachment.localId}
              className="relative h-14 w-14 shrink-0 rounded-lg border border-white/20 bg-black/25"
            >
              <img
                src={attachment.previewUrl}
                alt="Selected attachment"
                className="h-full w-full rounded-lg object-cover"
              />
              <button
                type="button"
                className="absolute -right-1 -top-1 rounded-full bg-black/70 p-0.5 text-white"
                onClick={() => onRemoveAttachment(attachment.localId)}
                aria-label="Remove attachment"
              >
                <X className="h-3 w-3" />
              </button>
              <div className="absolute bottom-0 left-0 right-0 rounded-b-lg bg-black/70 px-1 py-[1px] text-center text-[9px] text-white">
                {attachment.status === "uploading"
                  ? "Uploading..."
                  : attachment.status === "error"
                    ? "Retry"
                    : "Ready"}
              </div>
            </div>
          ))}
        </div>
      )}
      {uploadError && (
        <p className="mb-2 text-xs text-red-200" role="status">
          {uploadError}
        </p>
      )}
      <AnimatePresence>
        {isMediaTrayOpen && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="mb-3 rounded-2xl border p-3 shadow-lg shadow-black/30"
            style={{
              borderColor: "var(--app-media-tray-border)",
              backgroundImage:
                "linear-gradient(to bottom, var(--app-media-tray-from), var(--app-media-tray-to))",
            }}
          >
            <div className="flex items-center justify-between mb-3">
                <span
                  className="text-xs font-semibold tracking-wide uppercase"
                  style={{ color: "var(--app-on-dark-muted)" }}
                >
                  Add an image
                </span>
              <button
                type="button"
                onClick={() => setIsMediaTrayOpen(false)}
                className="rounded-full p-1 text-white/40 hover:text-white/80 hover:bg-white/10 transition-colors"
                aria-label="Close image picker"
                data-testid="button-close-media-tray"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <label
                htmlFor={cameraInputId}
                className={cn(
                  "group flex cursor-pointer flex-col items-center gap-2 rounded-xl border px-4 py-3.5 transition-all active:scale-[0.97]",
                  isSending && "pointer-events-none opacity-60",
                )}
                style={{
                  borderColor: "var(--app-soft-card-border)",
                  backgroundColor: "var(--app-soft-card-bg)",
                }}
                onClick={() => setIsMediaTrayOpen(false)}
              >
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-full transition-colors"
                  style={{
                    backgroundColor: "var(--app-soft-card-bg)",
                    color: "var(--app-accent)",
                  }}
                >
                  <Camera className="h-4.5 w-4.5" />
                </div>
                <span
                  className="text-xs font-medium transition-colors"
                  style={{ color: "var(--app-on-dark-muted)" }}
                >
                  Take photo
                </span>
              </label>
              <label
                htmlFor={galleryInputId}
                className={cn(
                  "group flex cursor-pointer flex-col items-center gap-2 rounded-xl border px-4 py-3.5 transition-all active:scale-[0.97]",
                  isSending && "pointer-events-none opacity-60",
                )}
                style={{
                  borderColor: "var(--app-soft-card-border)",
                  backgroundColor: "var(--app-soft-card-bg)",
                }}
                onClick={() => setIsMediaTrayOpen(false)}
              >
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-full transition-colors"
                  style={{
                    backgroundColor: "var(--app-soft-card-bg)",
                    color: "var(--app-muted)",
                  }}
                >
                  <ImageIcon className="h-4.5 w-4.5" />
                </div>
                <span
                  className="text-xs font-medium transition-colors"
                  style={{ color: "var(--app-on-dark-muted)" }}
                >
                  Photo library
                </span>
              </label>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex items-center gap-1.5 sm:gap-2">
         <input
          id={cameraInputId}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          onChange={(event) => {
            onSelectCameraFiles(event.target.files);
            event.currentTarget.value = "";
            setIsMediaTrayOpen(false);
          }}
        />
        <input
          id={galleryInputId}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          onChange={(event) => {
            onSelectGalleryFiles(event.target.files);
            event.currentTarget.value = "";
            setIsMediaTrayOpen(false);
          }}
        />
         <motion.div whileTap={{ scale: 0.85 }} whileHover={{ scale: 1.05 }}>
           <Button 
            variant="ghost" 
            size="icon" 
            className="transition-colors"
            style={{ color: "var(--app-on-dark-muted)" }}
            onClick={() => setIsMediaTrayOpen((current) => !current)}
            disabled={isSending}
          >
             <Camera className="w-6 h-6" />
           </Button>
         </motion.div>
         <div
           className="flex-1 rounded-full px-4 py-2.5 border transition-all"
           style={{
             backgroundColor: "var(--app-input-bg)",
             borderColor: "var(--app-input-border)",
           }}
         >
           <input 
            type="text" 
            placeholder={`Message ${persona}...`} 
            className="w-full bg-transparent border-none outline-none text-sm app-composer-input"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isSending}
            data-testid="input-message"
          />
         </div>
         <motion.div
           whileTap={{ scale: 0.8, rotate: -10 }}
           whileHover={{ scale: 1.1 }}
           animate={inputValue.trim() || hasReadyAttachment
             ? { scale: [1, 1.08, 1] }
             : { scale: 1 }
           }
           transition={inputValue.trim() || hasReadyAttachment
             ? { duration: 1.5, repeat: Infinity, ease: "easeInOut" }
             : { duration: 0.15 }
           }
           className="rounded-full"
         >
           <Button 
             size="icon" 
             className="rounded-full shadow-md"
             style={{
               backgroundColor: "var(--app-accent)",
               color: "var(--app-accent-text)",
             }}
             onClick={handleSend}
             disabled={isSending || hasUploadingAttachment || (!inputValue.trim() && !hasReadyAttachment)}
             data-testid="button-send-message"
           >
             <ChevronRight className="w-5 h-5" />
           </Button>
         </motion.div>
      </div>
    </div>
  );
};

const RESPONSE_STYLE_OPTIONS: Array<{
  value: ResponseStylePreset;
  label: string;
  description: string;
}> = [
  { value: "concise", label: "Concise", description: "Short, direct replies" },
  { value: "balanced", label: "Balanced", description: "Natural mix of short and detailed" },
  { value: "expressive", label: "Expressive", description: "More emotional and vivid" },
  { value: "playful", label: "Playful", description: "Light humor and banter" },
];

const GENDER_OPTIONS: Array<{ value: GenderOption; label: string }> = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "non_binary", label: "Non-binary" },
  { value: "other", label: "Other" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
];

const GOOGLE_INTEGRATION_STATUS_QUERY_KEY = ["/api/integrations/google/status"];

const ProfileView = ({
  onClose,
  user,
  profile,
  isProfileLoading,
  isSaving,
  isUploadingAvatar,
  selectedTheme,
  onSaveProfile,
  onSaveTheme,
  onUploadAvatar,
  onUploadZeeAvatar,
  onReplayOnboarding,
  onOpenSettings,
  onOpenOutputsHistory,
  onLogout,
  quotaSummary,
  quotaTier,
  isQuotaLoading,
}: {
  onClose: () => void;
  user: any;
  profile: UserProfileData | undefined;
  isProfileLoading: boolean;
  isSaving: boolean;
  isUploadingAvatar: boolean;
  selectedTheme: AppThemeId;
  onSaveProfile: (payload: {
    displayName: string | null;
    bio: string | null;
    location: string | null;
    age: number | null;
    profession: string | null;
    gender: GenderOption | null;
    genderOther: string | null;
    responseStylePreset: ResponseStylePreset;
    responseStyleNote: string | null;
    zeeAvatarPreset: ZeeAvatarPreset;
    clearZeeAvatarAttachment?: boolean;
  }) => Promise<void>;
  onSaveTheme: (theme: AppThemeId) => Promise<void>;
  onUploadAvatar: (file: File) => Promise<void>;
  onUploadZeeAvatar: (file: File) => Promise<void>;
  onReplayOnboarding: () => void;
  onOpenSettings: () => void;
  onOpenOutputsHistory: () => void;
  onLogout: () => void;
  quotaSummary?: QuotaSummaryData;
  quotaTier?: QuotaTier;
  isQuotaLoading: boolean;
}) => {
  const queryClient = useQueryClient();
  const avatarInputId = useId();
  const zeeAvatarInputId = useId();
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [location, setLocation] = useState("");
  const [ageInput, setAgeInput] = useState("");
  const [profession, setProfession] = useState("");
  const [gender, setGender] = useState<GenderOption | "">("");
  const [genderOther, setGenderOther] = useState("");
  const [stylePreset, setStylePreset] = useState<ResponseStylePreset>("balanced");
  const [styleNote, setStyleNote] = useState("");
  const [zeeAvatarPreset, setZeeAvatarPreset] = useState<ZeeAvatarPreset>("woman_1");
  const [themeChoice, setThemeChoice] = useState<AppThemeId>(selectedTheme);
  const [clearZeeAvatarAttachment, setClearZeeAvatarAttachment] = useState(false);
  const [zeeAvatarOpen, setZeeAvatarOpen] = useState(false);
  const [personalizationOpen, setPersonalizationOpen] = useState(false);
  const [responseStyleOpen, setResponseStyleOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [quotaOpen, setQuotaOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [connectedAccountsOpen, setConnectedAccountsOpen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [googleIntegrationNotice, setGoogleIntegrationNotice] = useState<string | null>(
    null,
  );
  const [googleIntegrationActionError, setGoogleIntegrationActionError] = useState<
    string | null
  >(null);
  const googleIntegrationQuery = useQuery<GoogleIntegrationStatusResponse>({
    queryKey: GOOGLE_INTEGRATION_STATUS_QUERY_KEY,
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/integrations/google/status");
      return (await response.json()) as GoogleIntegrationStatusResponse;
    },
    staleTime: 0,
  });

  const connectGoogleMutation = useMutation({
    mutationFn: async () => {
      const query = new URLSearchParams({
        returnTo: "/",
      });
      if (GOOGLE_OAUTH_CONNECT_REDIRECT_URI_OVERRIDE) {
        query.set("redirectUri", GOOGLE_OAUTH_CONNECT_REDIRECT_URI_OVERRIDE);
      }
      const response = await apiRequest(
        "GET",
        `/api/integrations/google/connect-url?${query.toString()}`,
      );
      return (await response.json()) as GoogleConnectUrlResponse;
    },
    onSuccess: (payload) => {
      console.log("[GoogleOAuth]", "connect_url_ready", {
        redirectUri: payload.redirectUri ?? null,
        redirectSource: payload.redirectSource ?? null,
        traceId: payload.traceId ?? null,
      });
      const connectUrl = payload.connectUrl ?? payload.url;
      if (connectUrl) {
        window.location.href = connectUrl;
      } else {
        setGoogleIntegrationActionError(
          "Google connect URL was not returned by the server.",
        );
      }
    },
    onError: (error) => {
      setGoogleIntegrationActionError(mapGoogleConnectActionError(error));
    },
  });

  const disconnectGoogleMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/integrations/google/disconnect", {});
    },
    onSuccess: async () => {
      setGoogleIntegrationActionError(null);
      setGoogleIntegrationNotice("Google account disconnected.");
      await queryClient.invalidateQueries({
        queryKey: GOOGLE_INTEGRATION_STATUS_QUERY_KEY,
      });
    },
    onError: (error) => {
      setGoogleIntegrationActionError(getErrorMessage(error));
    },
  });

  useEffect(() => {
    setDisplayName(profile?.displayName ?? "");
    setBio(profile?.bio ?? "");
    setLocation(profile?.location ?? "");
    setAgeInput(
      typeof profile?.age === "number" && Number.isFinite(profile.age)
        ? String(profile.age)
        : "",
    );
    setProfession(profile?.profession ?? user?.profession ?? "");
    setGender((profile?.gender as GenderOption | null) ?? "");
    setGenderOther(profile?.genderOther ?? "");
    setStylePreset(profile?.responseStylePreset ?? "balanced");
    setStyleNote(profile?.responseStyleNote ?? "");
    setZeeAvatarPreset(profile?.zeeAvatarPreset ?? "woman_1");
    setThemeChoice(selectedTheme);
    setClearZeeAvatarAttachment(false);
    setSaveError(null);
    setSaveSuccess(null);
  }, [profile, user?.profession, selectedTheme]);

  useEffect(() => {
    const status = googleIntegrationQuery.data?.status;
    if (status !== "error") return;
    if (!googleIntegrationQuery.data?.lastError) return;
    setGoogleIntegrationActionError(
      "Google connection issue detected. Disconnect and reconnect to restore access.",
    );
  }, [googleIntegrationQuery.data?.status, googleIntegrationQuery.data?.lastError]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const integrationStatus = url.searchParams.get("google_integration");
    const integrationReason = url.searchParams.get("google_integration_reason");
    const traceId = url.searchParams.get("traceId");
    if (!integrationStatus) return;

    if (integrationStatus === "connected") {
      setGoogleIntegrationNotice("Google account connected.");
      setGoogleIntegrationActionError(null);
    } else if (integrationStatus === "failed") {
      const baseMessage = mapGoogleIntegrationFailureReason(integrationReason);
      setGoogleIntegrationActionError(
        traceId ? `${baseMessage} (trace ${traceId})` : baseMessage,
      );
    }

    url.searchParams.delete("google_integration");
    url.searchParams.delete("google_integration_reason");
    url.searchParams.delete("traceId");
    const nextPath = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState({}, "", nextPath);
    void queryClient.invalidateQueries({
      queryKey: GOOGLE_INTEGRATION_STATUS_QUERY_KEY,
    });
  }, [queryClient]);

  const bioWordCount = bio.trim().length === 0 ? 0 : bio.trim().split(/\s+/).length;
  const bioWordLimit = 1000;
  const approxBioCharLimit = 6000;
  const themedInputClass =
    "app-input-theme w-full rounded-xl border px-3 py-2 text-sm outline-none transition-colors focus:border-[var(--app-accent)] focus:ring-1 focus:ring-[var(--app-accent)]";
  const themedCardStyle = {
    backgroundColor: "var(--app-soft-card-bg)",
    borderColor: "var(--app-soft-card-border)",
  } as const;
  const googleIntegration = googleIntegrationQuery.data;
  const googleConnected = Boolean(googleIntegration?.connected);
  const gmailConnected = Boolean(googleIntegration?.gmailConnected);
  const calendarConnected = Boolean(googleIntegration?.calendarConnected);
  const missingScopes = googleIntegration?.missingScopes ?? [];

  const hasCustomZeeAvatar = Boolean(profile?.zeeAvatarUrl) && !clearZeeAvatarAttachment;
  const zeeAvatarPreviewSrc = hasCustomZeeAvatar
    ? profile?.zeeAvatarUrl ?? getZeeAvatarPresetSrc(zeeAvatarPreset)
    : getZeeAvatarPresetSrc(zeeAvatarPreset);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaveError(null);
    setSaveSuccess(null);

    const parsedAge =
      ageInput.trim().length === 0 ? null : Number.parseInt(ageInput, 10);
    if (
      parsedAge !== null &&
      (!Number.isFinite(parsedAge) || parsedAge < 13 || parsedAge > 120)
    ) {
      setSaveError("Age must be between 13 and 120.");
      return;
    }

    if (bioWordCount > bioWordLimit) {
      setSaveError(`Bio is too long. Keep it under ${bioWordLimit} words.`);
      return;
    }

    if (gender === "other" && genderOther.trim().length === 0) {
      setSaveError("Please add details for gender when selecting other.");
      return;
    }

    try {
      await onSaveProfile({
        displayName: displayName.trim() || null,
        bio: bio.trim() || null,
        location: location.trim() || null,
        age: parsedAge,
        profession: profession.trim() || null,
        gender: (gender || null) as GenderOption | null,
        genderOther: genderOther.trim() || null,
        responseStylePreset: stylePreset,
        responseStyleNote: styleNote.trim() || null,
        zeeAvatarPreset,
        clearZeeAvatarAttachment: clearZeeAvatarAttachment || undefined,
      });
      await onSaveTheme(themeChoice);
      setSaveSuccess("Profile saved.");
    } catch (error) {
      setSaveError(getErrorMessage(error));
    }
  };

  const onConnectGoogle = () => {
    setGoogleIntegrationNotice(null);
    setGoogleIntegrationActionError(null);
    connectGoogleMutation.mutate();
  };

  const onDisconnectGoogle = () => {
    const confirmed = window.confirm(
      "Disconnect Google account from Zee? Gmail and Calendar access will be removed until you reconnect.",
    );
    if (!confirmed) return;
    setGoogleIntegrationNotice(null);
    setGoogleIntegrationActionError(null);
    disconnectGoogleMutation.mutate();
  };

  return (
    <motion.div
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", damping: 25, stiffness: 200 }}
      className="absolute inset-0 z-50 flex flex-col h-full overflow-hidden"
      style={{
        backgroundColor: "var(--app-panel-bg)",
        color: "var(--app-on-dark)",
      }}
    >
      <div className="relative h-48 shrink-0 overflow-hidden">
        <img src={leafBg} alt="Cover" className="w-full h-full object-cover" />
        <div
          className="absolute inset-0"
          style={{
            background: "linear-gradient(to bottom, transparent 0%, var(--app-panel-bg) 100%)",
          }}
        />
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-4 left-4 hover:opacity-90"
          style={{ color: "var(--app-on-dark)" }}
          onClick={onClose}
          data-testid="button-close-profile"
        >
          <ArrowLeft className="w-6 h-6" />
        </Button>
      </div>

      <div className="px-4 sm:px-6 -mt-12 relative z-10 flex flex-1 flex-col min-h-0">
        <div className="flex flex-col items-center mb-6">
          <label
            htmlFor={avatarInputId}
            className={cn(
              "relative cursor-pointer rounded-full",
              isUploadingAvatar && "pointer-events-none opacity-70",
            )}
            data-testid="button-edit-avatar"
          >
            <Avatar
              className="w-24 h-24 border-4 shadow-xl"
              style={{ borderColor: "var(--app-soft-card-border)" }}
            >
              <AvatarImage src={profile?.avatarUrl || user?.profileImageUrl} />
              <AvatarFallback>
                {user?.firstName?.[0] || "U"}
                {user?.lastName?.[0] || ""}
              </AvatarFallback>
            </Avatar>
            <div
              className="absolute bottom-0 right-0 w-7 h-7 rounded-full border-2 border-background flex items-center justify-center shadow-md"
              style={{ backgroundColor: "var(--app-panel-bg)" }}
            >
              {isUploadingAvatar ? (
                <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }} className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full" />
              ) : (
                <Pencil className="w-3 h-3" style={{ color: "var(--app-on-dark)" }} />
              )}
            </div>
          </label>
          <input
            id={avatarInputId}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                setSaveError(null);
                void onUploadAvatar(file)
                  .then(() => {
                    setSaveSuccess("Profile photo updated.");
                  })
                  .catch((error) => {
                    setSaveError(getErrorMessage(error));
                  });
              }
              event.currentTarget.value = "";
            }}
          />
          <div className="text-center mt-4">
            <h2
              className="text-2xl font-bold"
              style={{ color: "var(--app-on-dark)" }}
              data-testid="text-username"
            >
              {user?.firstName || ""} {user?.lastName || ""}
            </h2>
            <p className="italic" style={{ color: "var(--app-on-dark-muted)" }}>
              "Here for you, always"
            </p>
          </div>
        </div>

        <ScrollArea className="flex-1 min-h-0 -mx-4 px-4 pb-6 sm:-mx-6 sm:px-6">
          <form onSubmit={onSubmit} className="space-y-6">
            <section>
              <button
                type="button"
                className="flex items-center justify-between w-full mb-3"
                onClick={() => setAccountOpen((v) => !v)}
                data-testid="button-toggle-account"
              >
                <h3
                  className="text-sm font-semibold uppercase tracking-wider"
                  style={{ color: "var(--app-on-dark-muted)" }}
                >
                  Account
                </h3>
                <motion.span
                  animate={{ rotate: accountOpen ? 180 : 0 }}
                  transition={{ duration: 0.2 }}
                  style={{ color: "var(--app-on-dark-muted)" }}
                >
                  <ChevronDown size={16} />
                </motion.span>
              </button>
              <AnimatePresence initial={false}>
                {accountOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: "easeInOut" }}
                    className="overflow-hidden"
                  >
                    <div className="rounded-xl p-4 shadow-sm border space-y-3" style={themedCardStyle}>
                      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
                        <span className="font-medium" style={{ color: "var(--app-on-dark)" }}>
                          Email
                        </span>
                        <span
                          className="text-sm break-all sm:text-right"
                          style={{ color: "var(--app-on-dark-muted)" }}
                          data-testid="text-user-email"
                        >
                          {user?.email || "Not set"}
                        </span>
                      </div>
                      <p className="text-xs" style={{ color: "var(--app-on-dark-muted)" }}>
                        Optional profile fields help Zee personalize better.
                      </p>
                      <button
                        type="button"
                        onClick={onReplayOnboarding}
                        className="w-full rounded-xl border px-3 py-2 text-sm font-medium transition-colors hover:opacity-95"
                        style={{
                          borderColor: "var(--app-soft-card-border)",
                          backgroundColor: "var(--app-input-bg)",
                          color: "var(--app-on-dark)",
                        }}
                        data-testid="button-replay-onboarding"
                      >
                        Replay onboarding
                      </button>
                      {ENABLE_AGENTIC_CREATIONS && (
                        <button
                          type="button"
                          onClick={onOpenOutputsHistory}
                          className="w-full rounded-xl border px-3 py-2 text-sm font-medium transition-colors hover:opacity-95"
                          style={{
                            borderColor: "var(--app-soft-card-border)",
                            backgroundColor: "var(--app-soft-card-bg)",
                            color: "var(--app-on-dark)",
                          }}
                          data-testid="button-open-outputs-history"
                        >
                          Outputs history
                        </button>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </section>

            <section>
              <button
                type="button"
                className="flex items-center justify-between w-full mb-3"
                onClick={() => setConnectedAccountsOpen((v) => !v)}
                data-testid="button-toggle-connected-accounts"
              >
                <h3
                  className="text-sm font-semibold uppercase tracking-wider"
                  style={{ color: "var(--app-on-dark-muted)" }}
                >
                  Connected Accounts
                </h3>
                <motion.span
                  animate={{ rotate: connectedAccountsOpen ? 180 : 0 }}
                  transition={{ duration: 0.2 }}
                  style={{ color: "var(--app-on-dark-muted)" }}
                >
                  <ChevronDown size={16} />
                </motion.span>
              </button>
              <AnimatePresence initial={false}>
                {connectedAccountsOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: "easeInOut" }}
                    className="overflow-hidden"
                  >
                    <div className="rounded-xl p-4 shadow-sm border space-y-3" style={themedCardStyle}>
                      {googleIntegrationQuery.isLoading && (
                        <p className="text-xs" style={{ color: "var(--app-on-dark-muted)" }}>
                          Checking Google connection...
                        </p>
                      )}

                      {!googleIntegrationQuery.isLoading && googleIntegrationQuery.isError && (
                        <div className="space-y-2">
                          <p className="text-sm" style={{ color: "var(--app-on-dark)" }}>
                            Unable to check connection status.
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              setGoogleIntegrationActionError(null);
                              void googleIntegrationQuery.refetch();
                            }}
                            className="rounded-xl border px-3 py-2 text-sm font-medium transition-colors hover:opacity-95"
                            style={{
                              borderColor: "var(--app-soft-card-border)",
                              backgroundColor: "var(--app-input-bg)",
                              color: "var(--app-on-dark)",
                            }}
                            data-testid="button-retry-google-status"
                          >
                            Retry
                          </button>
                        </div>
                      )}

                      {!googleIntegrationQuery.isLoading &&
                        !googleIntegrationQuery.isError &&
                        googleIntegration?.enabled === false && (
                          <p className="text-xs" style={{ color: "var(--app-on-dark-muted)" }}>
                            Google personal context is currently disabled in this environment.
                          </p>
                        )}

                      {!googleIntegrationQuery.isLoading &&
                        !googleIntegrationQuery.isError &&
                        googleIntegration?.enabled !== false && (
                          <>
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex items-center gap-3">
                                <span
                                  className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold"
                                  style={{
                                    backgroundColor: "var(--app-input-bg)",
                                    border: "1px solid var(--app-soft-card-border)",
                                    color: "var(--app-on-dark)",
                                  }}
                                >
                                  G
                                </span>
                                <div className="space-y-0.5">
                                  <p className="text-sm font-medium" style={{ color: "var(--app-on-dark)" }}>
                                    Google Account
                                  </p>
                                  <p className="text-xs" style={{ color: "var(--app-on-dark-muted)" }}>
                                    {googleConnected
                                      ? googleIntegration?.email ?? "Connected"
                                      : "Connect Gmail and Calendar for personal context answers."}
                                  </p>
                                </div>
                              </div>
                              {googleConnected ? (
                                <span
                                  className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                                  style={{
                                    backgroundColor: "rgba(46, 204, 113, 0.14)",
                                    color: "#83f0b7",
                                  }}
                                >
                                  Connected
                                </span>
                              ) : null}
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className="inline-flex items-center rounded-full px-2 py-0.5 text-xs"
                                style={{
                                  backgroundColor: gmailConnected
                                    ? "rgba(46, 204, 113, 0.14)"
                                    : "var(--app-input-bg)",
                                  color: gmailConnected
                                    ? "#83f0b7"
                                    : "var(--app-on-dark-muted)",
                                  border: "1px solid var(--app-soft-card-border)",
                                }}
                              >
                                Gmail {gmailConnected ? "✓" : "—"}
                              </span>
                              <span
                                className="inline-flex items-center rounded-full px-2 py-0.5 text-xs"
                                style={{
                                  backgroundColor: calendarConnected
                                    ? "rgba(46, 204, 113, 0.14)"
                                    : "var(--app-input-bg)",
                                  color: calendarConnected
                                    ? "#83f0b7"
                                    : "var(--app-on-dark-muted)",
                                  border: "1px solid var(--app-soft-card-border)",
                                }}
                              >
                                Calendar {calendarConnected ? "✓" : "— reconnect to enable"}
                              </span>
                            </div>

                            {missingScopes.length > 0 && (
                              <p className="text-xs" style={{ color: "#f5c57a" }}>
                                Missing permission detected. Disconnect and reconnect Google to grant
                                required scope(s).
                              </p>
                            )}

                            {googleConnected ? (
                              <button
                                type="button"
                                onClick={onDisconnectGoogle}
                                disabled={disconnectGoogleMutation.isPending}
                                className="w-full rounded-xl border px-3 py-2 text-sm font-medium transition-colors hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-70"
                                style={{
                                  borderColor: "rgba(250, 131, 131, 0.5)",
                                  backgroundColor: "rgba(250, 131, 131, 0.08)",
                                  color: "#f7b6b6",
                                }}
                                data-testid="button-disconnect-google"
                              >
                                {disconnectGoogleMutation.isPending
                                  ? "Disconnecting..."
                                  : "Disconnect Google"}
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={onConnectGoogle}
                                disabled={connectGoogleMutation.isPending}
                                className="w-full rounded-xl border px-3 py-2 text-sm font-medium transition-colors hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-70"
                                style={{
                                  borderColor: "var(--app-accent)",
                                  backgroundColor: "color-mix(in srgb, var(--app-accent) 18%, transparent)",
                                  color: "var(--app-on-dark)",
                                }}
                                data-testid="button-connect-google"
                              >
                                {connectGoogleMutation.isPending
                                  ? "Preparing connection..."
                                  : "Connect Google"}
                              </button>
                            )}
                          </>
                        )}

                      {googleIntegrationNotice && (
                        <p className="text-xs" style={{ color: "#83f0b7" }}>
                          {googleIntegrationNotice}
                        </p>
                      )}

                      {googleIntegrationActionError && (
                        <p className="text-xs" style={{ color: "#f7b6b6" }}>
                          {googleIntegrationActionError}
                        </p>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </section>

            <section>
              <button
                type="button"
                className="flex items-center justify-between w-full mb-3"
                onClick={() => setQuotaOpen((v) => !v)}
                data-testid="button-toggle-quota"
              >
                <h3
                  className="text-sm font-semibold uppercase tracking-wider"
                  style={{ color: "var(--app-on-dark-muted)" }}
                >
                  Beta Quota
                </h3>
                <motion.span
                  animate={{ rotate: quotaOpen ? 180 : 0 }}
                  transition={{ duration: 0.2 }}
                  style={{ color: "var(--app-on-dark-muted)" }}
                >
                  <ChevronDown size={16} />
                </motion.span>
              </button>
              <AnimatePresence initial={false}>
                {quotaOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: "easeInOut" }}
                    className="overflow-hidden"
                  >
                    <div className="rounded-xl p-4 shadow-sm border space-y-2.5" style={themedCardStyle}>
                      {isQuotaLoading && (
                        <p className="text-xs" style={{ color: "var(--app-on-dark-muted)" }}>
                          Loading quota...
                        </p>
                      )}
                      {!isQuotaLoading && quotaSummary && (
                        <>
                          <p className="text-xs" style={{ color: "var(--app-on-dark-muted)" }}>
                            Rolling {quotaSummary.windowDays}-day limits reset automatically as older usage expires.
                          </p>
                          <div className="flex items-center justify-between text-xs">
                            <span style={{ color: "var(--app-on-dark-muted)" }}>Quota tier</span>
                            <span className="font-medium uppercase" style={{ color: "var(--app-on-dark)" }}>
                              {(quotaTier ?? "default").replace("_", " ")}
                            </span>
                          </div>
                          <div className="grid grid-cols-1 gap-2 text-sm">
                            <div className="flex items-center justify-between">
                              <span style={{ color: "var(--app-on-dark-muted)" }}>Texts</span>
                              <span style={{ color: "var(--app-on-dark)" }}>
                                {quotaSummary.remaining.text} left / {quotaSummary.limits.text}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span style={{ color: "var(--app-on-dark-muted)" }}>Voice minutes</span>
                              <span style={{ color: "var(--app-on-dark)" }}>
                                {formatMinutesFromSeconds(quotaSummary.remaining.voiceSeconds)} left / {formatMinutesFromSeconds(quotaSummary.limits.voiceSeconds)}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span style={{ color: "var(--app-on-dark-muted)" }}>Camera minutes</span>
                              <span style={{ color: "var(--app-on-dark)" }}>
                                {formatMinutesFromSeconds(quotaSummary.remaining.cameraSeconds)} left / {formatMinutesFromSeconds(quotaSummary.limits.cameraSeconds)}
                              </span>
                            </div>
                            {ENABLE_AGENTIC_CREATIONS && typeof quotaSummary.remaining.creationRuns === "number" &&
                              typeof quotaSummary.limits.creationRuns === "number" && (
                                <div className="flex items-center justify-between">
                                  <span style={{ color: "var(--app-on-dark-muted)" }}>Creations</span>
                                  <span style={{ color: "var(--app-on-dark)" }}>
                                    {quotaSummary.remaining.creationRuns} left / {quotaSummary.limits.creationRuns}
                                  </span>
                                </div>
                              )}
                            {ENABLE_AGENTIC_CREATIONS && typeof quotaSummary.remaining.codingTasks === "number" &&
                              typeof quotaSummary.limits.codingTasks === "number" && (
                                <div className="flex items-center justify-between">
                                  <span style={{ color: "var(--app-on-dark-muted)" }}>Coding builds</span>
                                  <span style={{ color: "var(--app-on-dark)" }}>
                                    {quotaSummary.remaining.codingTasks} left / {quotaSummary.limits.codingTasks}
                                  </span>
                                </div>
                              )}
                            {ENABLE_AGENTIC_CREATIONS && typeof quotaSummary.remaining.documentTasks === "number" &&
                              typeof quotaSummary.limits.documentTasks === "number" && (
                                <div className="flex items-center justify-between">
                                  <span style={{ color: "var(--app-on-dark-muted)" }}>Documents</span>
                                  <span style={{ color: "var(--app-on-dark)" }}>
                                    {quotaSummary.remaining.documentTasks} left / {quotaSummary.limits.documentTasks}
                                  </span>
                                </div>
                              )}
                            {ENABLE_AGENTIC_CREATIONS && typeof quotaSummary.remaining.presentationTasks === "number" &&
                              typeof quotaSummary.limits.presentationTasks === "number" && (
                                <div className="flex items-center justify-between">
                                  <span style={{ color: "var(--app-on-dark-muted)" }}>Presentations</span>
                                  <span style={{ color: "var(--app-on-dark)" }}>
                                    {quotaSummary.remaining.presentationTasks} left / {quotaSummary.limits.presentationTasks}
                                  </span>
                                </div>
                              )}
                            {ENABLE_AGENTIC_CREATIONS && typeof quotaSummary.remaining.presentationImages === "number" &&
                              typeof quotaSummary.limits.presentationImages === "number" && (
                                <div className="flex items-center justify-between">
                                  <span style={{ color: "var(--app-on-dark-muted)" }}>Slide images</span>
                                  <span style={{ color: "var(--app-on-dark)" }}>
                                    {quotaSummary.remaining.presentationImages} left / {quotaSummary.limits.presentationImages}
                                  </span>
                                </div>
                              )}
                          </div>
                        </>
                      )}
                      {!isQuotaLoading && !quotaSummary && (
                        <p className="text-xs" style={{ color: "var(--app-on-dark-muted)" }}>
                          Quota details are currently unavailable.
                        </p>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </section>

            <section>
              <h3
                className="text-sm font-semibold uppercase tracking-wider mb-3"
                style={{ color: "var(--app-on-dark-muted)" }}
              >
                Zee Avatar
              </h3>
              <div className="rounded-xl shadow-sm border overflow-hidden" style={themedCardStyle}>
                <button
                  type="button"
                  onClick={() => setZeeAvatarOpen((prev) => !prev)}
                  className="flex w-full items-center gap-3 p-4 text-left transition-opacity hover:opacity-95"
                  data-testid="button-zee-avatar-toggle"
                >
                  <Avatar
                    className="h-10 w-10 shrink-0 border-2"
                    style={{ borderColor: "var(--app-accent)" }}
                  >
                    <AvatarImage src={zeeAvatarPreviewSrc} className="object-cover" />
                    <AvatarFallback>Z</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold" style={{ color: "var(--app-on-dark)" }}>
                      Current Zee look
                    </p>
                    <p className="text-xs" style={{ color: "var(--app-on-dark-muted)" }}>
                      {hasCustomZeeAvatar
                        ? "Custom image"
                        : `Preset: ${
                            ZEE_AVATAR_PRESET_OPTIONS.find(
                              (option) => option.id === zeeAvatarPreset,
                            )?.label ?? "Radiant"
                          }`}
                    </p>
                  </div>
                  <ChevronDown
                    className={cn("w-4 h-4 transition-transform shrink-0", zeeAvatarOpen && "rotate-180")}
                    style={{ color: "var(--app-on-dark-muted)" }}
                  />
                </button>

                <AnimatePresence initial={false}>
                  {zeeAvatarOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: "easeInOut" }}
                      className="overflow-hidden"
                    >
                      <div
                        className="px-4 pb-4 space-y-1 border-t pt-2"
                        style={{ borderColor: "var(--app-soft-card-border)" }}
                      >
                        {ZEE_AVATAR_PRESET_OPTIONS.map((option) => (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => {
                              setZeeAvatarPreset(option.id);
                              setClearZeeAvatarAttachment(true);
                              setSaveSuccess(null);
                            }}
                            className={cn(
                              "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-all border",
                              zeeAvatarPreset === option.id && !hasCustomZeeAvatar
                                ? ""
                                : "hover:opacity-95",
                            )}
                            style={
                              zeeAvatarPreset === option.id && !hasCustomZeeAvatar
                                ? {
                                    backgroundColor: "var(--app-soft-card-bg)",
                                    borderColor: "var(--app-soft-card-border)",
                                  }
                                : { borderColor: "transparent" }
                            }
                            data-testid={`button-zee-avatar-preset-${option.id}`}
                          >
                            <Avatar className="h-9 w-9 shrink-0">
                              <AvatarImage src={option.src} className="object-cover" />
                              <AvatarFallback>Z</AvatarFallback>
                            </Avatar>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium" style={{ color: "var(--app-on-dark)" }}>
                                {option.label}
                              </p>
                              <p
                                className="text-[11px] uppercase tracking-wide"
                                style={{ color: "var(--app-on-dark-muted)" }}
                              >
                                {option.styleLabel}
                              </p>
                            </div>
                            {zeeAvatarPreset === option.id && !hasCustomZeeAvatar && (
                              <div
                                className="w-2 h-2 rounded-full shrink-0"
                                style={{ backgroundColor: "var(--app-accent)" }}
                              />
                            )}
                          </button>
                        ))}

                        <label
                          htmlFor={zeeAvatarInputId}
                          className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left transition-opacity hover:opacity-95"
                          data-testid="button-upload-zee-avatar"
                        >
                          <div
                            className="h-9 w-9 rounded-full flex items-center justify-center shrink-0"
                            style={{ backgroundColor: "var(--app-input-bg)" }}
                          >
                            <Camera className="w-4 h-4" style={{ color: "var(--app-on-dark-muted)" }} />
                          </div>
                          <p className="text-sm font-medium" style={{ color: "var(--app-on-dark)" }}>
                            Upload custom avatar
                          </p>
                        </label>
                        <input
                          id={zeeAvatarInputId}
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          className="sr-only"
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) {
                              setSaveError(null);
                              void onUploadZeeAvatar(file)
                                .then(() => {
                                  setClearZeeAvatarAttachment(false);
                                  setSaveSuccess("Zee avatar updated.");
                                })
                                .catch((error) => {
                                  setSaveError(getErrorMessage(error));
                                });
                            }
                            event.currentTarget.value = "";
                          }}
                        />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </section>

            <section>
              <h3
                className="text-sm font-semibold uppercase tracking-wider mb-3"
                style={{ color: "var(--app-on-dark-muted)" }}
              >
                Appearance
              </h3>
              <div className="rounded-xl shadow-sm border overflow-hidden" style={themedCardStyle}>
                <button
                  type="button"
                  onClick={() => setThemeOpen((prev) => !prev)}
                  className="flex w-full items-center gap-3 p-4 text-left transition-opacity hover:opacity-95"
                  data-testid="button-theme-toggle"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold" style={{ color: "var(--app-on-dark)" }}>
                      {getAppTheme(themeChoice).label}
                    </p>
                    <p className="text-xs" style={{ color: "var(--app-on-dark-muted)" }}>
                      {getAppTheme(themeChoice).description}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {getAppTheme(themeChoice).palette.map((color) => (
                      <span
                        key={`header-${color}`}
                        className="h-3.5 w-3.5 rounded-full border border-black/10"
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                  <ChevronDown
                    className={cn("w-4 h-4 transition-transform shrink-0", themeOpen && "rotate-180")}
                    style={{ color: "var(--app-on-dark-muted)" }}
                  />
                </button>

                <AnimatePresence initial={false}>
                  {themeOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: "easeInOut" }}
                      className="overflow-hidden"
                    >
                      <div
                        className="px-4 pb-4 space-y-2 border-t pt-3"
                        style={{ borderColor: "var(--app-soft-card-border)" }}
                      >
                        {APP_THEME_OPTIONS.map((themeOption) => (
                          <button
                            key={themeOption.id}
                            type="button"
                            onClick={() => {
                              setThemeChoice(themeOption.id);
                              applyAppTheme(themeOption.id);
                            }}
                            className={cn(
                              "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-all border",
                              themeChoice === themeOption.id ? "" : "hover:opacity-95",
                            )}
                            style={
                              themeChoice === themeOption.id
                                ? {
                                    backgroundColor: "var(--app-soft-card-bg)",
                                    borderColor: "var(--app-soft-card-border)",
                                  }
                                : { borderColor: "transparent" }
                            }
                            data-testid={`button-theme-${themeOption.id}`}
                          >
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium" style={{ color: "var(--app-on-dark)" }}>
                                {themeOption.label}
                              </p>
                              <p className="text-[11px]" style={{ color: "var(--app-on-dark-muted)" }}>
                                {themeOption.description}
                              </p>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {themeOption.palette.map((color) => (
                                <span
                                  key={`${themeOption.id}-${color}`}
                                  className="h-3.5 w-3.5 rounded-full border border-black/10"
                                  style={{ backgroundColor: color }}
                                />
                              ))}
                            </div>
                          </button>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </section>

            <section>
              <h3
                className="text-sm font-semibold uppercase tracking-wider mb-3"
                style={{ color: "var(--app-on-dark-muted)" }}
              >
                Personalization
              </h3>
              <div className="rounded-xl shadow-sm border overflow-hidden" style={themedCardStyle}>
                <button
                  type="button"
                  onClick={() => setPersonalizationOpen((prev) => !prev)}
                  className="flex w-full items-center gap-3 p-4 text-left transition-opacity hover:opacity-95"
                  data-testid="button-personalization-toggle"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold" style={{ color: "var(--app-on-dark)" }}>
                      {displayName || "Set up your profile"}
                    </p>
                    <p className="text-xs" style={{ color: "var(--app-on-dark-muted)" }}>
                      {[profession, location].filter(Boolean).join(" · ") || "Name, bio, location & more"}
                    </p>
                  </div>
                  <ChevronDown
                    className={cn("w-4 h-4 transition-transform shrink-0", personalizationOpen && "rotate-180")}
                    style={{ color: "var(--app-on-dark-muted)" }}
                  />
                </button>

                <AnimatePresence initial={false}>
                  {personalizationOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: "easeInOut" }}
                      className="overflow-hidden"
                    >
                      <div
                        className="px-4 pb-4 space-y-4 border-t pt-3"
                        style={{ borderColor: "var(--app-soft-card-border)" }}
                      >
                        <div className="space-y-1.5">
                          <label className="text-sm font-medium" htmlFor="profile-display-name">
                            Preferred name
                          </label>
                          <input
                            id="profile-display-name"
                            value={displayName}
                            onChange={(event) => setDisplayName(event.target.value)}
                            maxLength={120}
                            className={themedInputClass}
                            placeholder="How should Zee address you?"
                            data-testid="input-profile-display-name"
                          />
                        </div>

                        <div className="space-y-1.5">
                          <label className="text-sm font-medium" htmlFor="profile-bio">
                            Bio (optional)
                          </label>
                          <textarea
                            id="profile-bio"
                            value={bio}
                            onChange={(event) => setBio(event.target.value.slice(0, approxBioCharLimit))}
                            rows={4}
                            className={themedInputClass}
                            placeholder="Share what matters to you, your goals, and your vibe."
                            data-testid="input-profile-bio"
                          />
                          <div
                            className="flex items-center justify-between text-[11px]"
                            style={{ color: "var(--app-on-dark-muted)" }}
                          >
                            <span>{bioWordCount}/{bioWordLimit} words</span>
                            <span>{bio.length}/{approxBioCharLimit} chars</span>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-3 min-[370px]:grid-cols-2">
                          <div className="space-y-1.5">
                            <label className="text-sm font-medium" htmlFor="profile-location">
                              Location
                            </label>
                            <input
                              id="profile-location"
                              value={location}
                              onChange={(event) => setLocation(event.target.value)}
                              maxLength={120}
                              className={themedInputClass}
                              placeholder="City, country"
                              data-testid="input-profile-location"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-sm font-medium" htmlFor="profile-age">
                              Age
                            </label>
                            <input
                              id="profile-age"
                              value={ageInput}
                              onChange={(event) =>
                                setAgeInput(event.target.value.replace(/[^0-9]/g, ""))
                              }
                              className={themedInputClass}
                              placeholder="Optional"
                              inputMode="numeric"
                              data-testid="input-profile-age"
                            />
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <label className="text-sm font-medium" htmlFor="profile-profession">
                            Profession
                          </label>
                          <input
                            id="profile-profession"
                            value={profession}
                            onChange={(event) => setProfession(event.target.value)}
                            maxLength={120}
                            className={themedInputClass}
                            placeholder="What do you do?"
                            data-testid="input-profile-profession"
                          />
                        </div>

                        <div className="space-y-1.5">
                          <label className="text-sm font-medium" htmlFor="profile-gender">
                            Gender
                          </label>
                          <select
                            id="profile-gender"
                            value={gender}
                            onChange={(event) => setGender(event.target.value as GenderOption | "")}
                            className={themedInputClass}
                            data-testid="select-profile-gender"
                          >
                            <option value="">Not specified</option>
                            {GENDER_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        {gender === "other" && (
                          <div className="space-y-1.5">
                            <label className="text-sm font-medium" htmlFor="profile-gender-other">
                              Gender details
                            </label>
                            <input
                              id="profile-gender-other"
                              value={genderOther}
                              onChange={(event) => setGenderOther(event.target.value)}
                              maxLength={80}
                              className={themedInputClass}
                              placeholder="Share if you'd like"
                              data-testid="input-profile-gender-other"
                            />
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </section>

            <section>
              <h3
                className="text-sm font-semibold uppercase tracking-wider mb-3"
                style={{ color: "var(--app-on-dark-muted)" }}
              >
                Response Style
              </h3>
              <div className="rounded-xl shadow-sm border overflow-hidden" style={themedCardStyle}>
                <button
                  type="button"
                  onClick={() => setResponseStyleOpen((prev) => !prev)}
                  className="flex w-full items-center gap-3 p-4 text-left transition-opacity hover:opacity-95"
                  data-testid="button-response-style-toggle"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold" style={{ color: "var(--app-on-dark)" }}>
                      {RESPONSE_STYLE_OPTIONS.find((o) => o.value === stylePreset)?.label ?? "Balanced"}
                    </p>
                    <p className="text-xs" style={{ color: "var(--app-on-dark-muted)" }}>
                      {RESPONSE_STYLE_OPTIONS.find((o) => o.value === stylePreset)?.description ?? "Adjust how Zee responds"}
                    </p>
                  </div>
                  <ChevronDown
                    className={cn("w-4 h-4 transition-transform shrink-0", responseStyleOpen && "rotate-180")}
                    style={{ color: "var(--app-on-dark-muted)" }}
                  />
                </button>

                <AnimatePresence initial={false}>
                  {responseStyleOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: "easeInOut" }}
                      className="overflow-hidden"
                    >
                      <div
                        className="px-4 pb-4 space-y-4 border-t pt-3"
                        style={{ borderColor: "var(--app-soft-card-border)" }}
                      >
                        <div className="space-y-1.5">
                          <label className="text-sm font-medium" htmlFor="profile-style-preset">
                            Preset
                          </label>
                          <select
                            id="profile-style-preset"
                            value={stylePreset}
                            onChange={(event) =>
                              setStylePreset(event.target.value as ResponseStylePreset)
                            }
                            className={themedInputClass}
                            data-testid="select-profile-style-preset"
                          >
                            {RESPONSE_STYLE_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label} - {option.description}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-sm font-medium" htmlFor="profile-style-note">
                            Custom note (optional)
                          </label>
                          <textarea
                            id="profile-style-note"
                            value={styleNote}
                            onChange={(event) => setStyleNote(event.target.value.slice(0, 600))}
                            rows={3}
                            className={themedInputClass}
                            placeholder='Example: "Use more humor and quick punchy replies."'
                            data-testid="input-profile-style-note"
                          />
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </section>

            {(saveError || saveSuccess || isProfileLoading) && (
              <div className="rounded-xl border px-3 py-2 text-xs" style={themedCardStyle}>
                {isProfileLoading && (
                  <p style={{ color: "var(--app-on-dark-muted)" }}>Loading profile...</p>
                )}
                {saveError && <p className="text-red-500">{saveError}</p>}
                {saveSuccess && <p className="text-emerald-600">{saveSuccess}</p>}
              </div>
            )}

            <section className="space-y-3 pb-4">
              <Button
                type="submit"
                className="w-full h-12 rounded-xl gap-2"
                style={{
                  backgroundColor: "var(--app-shell-bg)",
                  color: "var(--app-on-dark)",
                }}
                disabled={isSaving || isProfileLoading}
                data-testid="button-save-profile"
              >
                {isSaving ? "Saving..." : "Save Profile"}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full h-12 rounded-xl gap-2"
                onClick={onOpenSettings}
                style={{
                  borderColor: "var(--app-soft-card-border)",
                  backgroundColor: "var(--app-soft-card-bg)",
                  color: "var(--app-on-dark)",
                }}
                data-testid="button-open-settings"
              >
                <Settings className="w-5 h-5" />
                Settings
              </Button>
              <Button
                variant="destructive"
                className="w-full h-12 rounded-xl gap-2"
                onClick={onLogout}
                data-testid="button-logout"
                type="button"
              >
                <LogOut className="w-5 h-5" />
                Log Out
              </Button>
            </section>
          </form>
        </ScrollArea>
      </div>
    </motion.div>
  );
};

const MEMORY_MODE_OPTIONS: Array<{
  value: LiveMemoryMode;
  title: string;
  description: string;
}> = [
  {
    value: "safe_selective",
    title: "Safe selective",
    description:
      "Prioritizes relevant context and avoids replaying sensitive details by default.",
  },
  {
    value: "remember_everything",
    title: "Remember everything",
    description:
      "Keeps broad recall across conversations, including lower-priority details.",
  },
];

function formatMemoryKindLabel(kind: string): string {
  if (kind === "fact") return "Fact";
  if (kind === "preference") return "Preference";
  if (kind === "goal") return "Goal";
  if (kind === "relationship") return "Relationship";
  return "Other";
}

function formatMemoryTimestamp(value: string | null): string {
  if (!value) return "Just now";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Just now";
  return parsed.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const SettingsView = ({
  onClose,
  memorySettings,
  isMemorySettingsLoading,
  isSavingMemorySettings,
  onUpdateMemorySettings,
  memoryItems,
  isMemoryItemsLoading,
  onForgetMemoryItem,
}: {
  onClose: () => void;
  memorySettings?: MemorySettingsData;
  isMemorySettingsLoading: boolean;
  isSavingMemorySettings: boolean;
  onUpdateMemorySettings: (patch: Partial<MemorySettingsData>) => Promise<void>;
  memoryItems: MemoryItemData[];
  isMemoryItemsLoading: boolean;
  onForgetMemoryItem: (memoryItemId: string) => Promise<void>;
}) => {
  const [localMode, setLocalMode] = useState<LiveMemoryMode>("safe_selective");
  const [localCrossChatEnabled, setLocalCrossChatEnabled] = useState(true);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsSuccess, setSettingsSuccess] = useState<string | null>(null);
  const [forgettingMemoryItemId, setForgettingMemoryItemId] = useState<
    string | null
  >(null);

  useEffect(() => {
    if (!memorySettings) return;
    setLocalMode(memorySettings.memoryMode);
    setLocalCrossChatEnabled(memorySettings.crossChatMemoryEnabled);
  }, [memorySettings]);

  const handleModeChange = async (nextMode: LiveMemoryMode) => {
    if (
      nextMode === localMode ||
      isMemorySettingsLoading ||
      isSavingMemorySettings
    ) {
      return;
    }
    const previousMode = localMode;
    setSettingsError(null);
    setSettingsSuccess(null);
    setLocalMode(nextMode);
    try {
      await onUpdateMemorySettings({ memoryMode: nextMode });
      setSettingsSuccess("Memory mode updated.");
    } catch (error) {
      setLocalMode(previousMode);
      setSettingsError(getErrorMessage(error));
    }
  };

  const handleCrossChatChange = async (nextEnabled: boolean) => {
    if (isMemorySettingsLoading || isSavingMemorySettings) return;
    const previous = localCrossChatEnabled;
    setSettingsError(null);
    setSettingsSuccess(null);
    setLocalCrossChatEnabled(nextEnabled);
    try {
      await onUpdateMemorySettings({ crossChatMemoryEnabled: nextEnabled });
      setSettingsSuccess("Cross-chat memory updated.");
    } catch (error) {
      setLocalCrossChatEnabled(previous);
      setSettingsError(getErrorMessage(error));
    }
  };

  const handleForgetMemoryItem = async (memoryItemId: string) => {
    if (forgettingMemoryItemId) return;
    setForgettingMemoryItemId(memoryItemId);
    setSettingsError(null);
    setSettingsSuccess(null);
    try {
      await onForgetMemoryItem(memoryItemId);
      setSettingsSuccess("Memory removed.");
    } catch (error) {
      setSettingsError(getErrorMessage(error));
    } finally {
      setForgettingMemoryItemId(null);
    }
  };

  const isBusy = isMemorySettingsLoading || isSavingMemorySettings;

  return (
    <motion.div
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", damping: 25, stiffness: 200 }}
      className="absolute inset-0 z-[70] flex h-full flex-col overflow-hidden"
      style={{
        backgroundColor: "var(--app-panel-bg)",
        color: "var(--app-on-dark)",
      }}
    >
      <div className="relative h-28 shrink-0 overflow-hidden border-b border-[var(--app-soft-card-border)]">
        <img src={leafBg} alt="Settings cover" className="h-full w-full object-cover" />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to bottom, rgba(0,0,0,0.12) 0%, color-mix(in srgb, var(--app-panel-bg) 90%, transparent) 100%)",
          }}
        />
        <Button
          variant="ghost"
          size="icon"
          className="absolute left-4 top-4 hover:opacity-90"
          style={{ color: "var(--app-on-dark)" }}
          onClick={onClose}
          data-testid="button-close-settings"
        >
          <ArrowLeft className="h-6 w-6" />
        </Button>
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-center">
          <h2 className="text-lg font-semibold tracking-tight">Settings</h2>
          <p
            className="text-xs uppercase tracking-[0.22em]"
            style={{ color: "var(--app-on-dark-muted)" }}
          >
            Memory and controls
          </p>
        </div>
      </div>

      <ScrollArea className="flex-1 px-4 py-4 sm:px-6">
        <div className="space-y-4 pb-6">
          <section
            className="rounded-2xl border p-4 shadow-sm"
            style={{
              backgroundColor: "var(--app-soft-card-bg)",
              borderColor: "var(--app-soft-card-border)",
            }}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold">Memory</h3>
                <p
                  className="mt-1 text-xs leading-relaxed"
                  style={{ color: "var(--app-on-dark-muted)" }}
                >
                  Choose how much Zee recalls across voice + text and how cross-chat
                  context should be used.
                </p>
              </div>
              {isSavingMemorySettings && (
                <Loader2
                  className="h-4 w-4 animate-spin"
                  style={{ color: "var(--app-on-dark-muted)" }}
                />
              )}
            </div>

            <div className="space-y-2.5">
              {MEMORY_MODE_OPTIONS.map((option) => {
                const selected = localMode === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      void handleModeChange(option.value);
                    }}
                    disabled={isBusy}
                    className={cn(
                      "w-full rounded-xl border px-3 py-3 text-left transition-opacity",
                      !isBusy && "hover:opacity-95",
                    )}
                    style={{
                      backgroundColor: selected
                        ? "color-mix(in srgb, var(--app-accent) 14%, var(--app-soft-card-bg))"
                        : "var(--app-panel-bg)",
                      borderColor: selected
                        ? "var(--app-accent)"
                        : "var(--app-soft-card-border)",
                    }}
                    data-testid={`button-memory-mode-${option.value}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold">{option.title}</p>
                        <p
                          className="mt-1 text-xs leading-relaxed"
                          style={{ color: "var(--app-on-dark-muted)" }}
                        >
                          {option.description}
                        </p>
                      </div>
                      {selected && (
                        <CheckCircle2
                          className="h-4 w-4 shrink-0"
                          style={{ color: "var(--app-accent)" }}
                        />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            <div
              className="mt-4 flex items-start justify-between gap-3 rounded-xl border px-3 py-3"
              style={{
                borderColor: "var(--app-soft-card-border)",
                backgroundColor: "var(--app-panel-bg)",
              }}
            >
              <div>
                <p className="text-sm font-semibold">Use cross-chat memories</p>
                <p
                  className="mt-1 text-xs leading-relaxed"
                  style={{ color: "var(--app-on-dark-muted)" }}
                >
                  Pull relevant memory from your other conversations when helpful.
                </p>
              </div>
              <Switch
                checked={localCrossChatEnabled}
                onCheckedChange={(checked) => {
                  void handleCrossChatChange(checked);
                }}
                disabled={isBusy}
                data-testid="switch-cross-chat-memory"
              />
            </div>
          </section>

          <section
            className="rounded-2xl border p-4 shadow-sm"
            style={{
              backgroundColor: "var(--app-soft-card-bg)",
              borderColor: "var(--app-soft-card-border)",
            }}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold">Saved memories</h3>
                <p
                  className="mt-1 text-xs"
                  style={{ color: "var(--app-on-dark-muted)" }}
                >
                  Inspect and forget individual memory items.
                </p>
              </div>
            </div>

            {isMemoryItemsLoading && (
              <p className="text-xs" style={{ color: "var(--app-on-dark-muted)" }}>
                Loading memories...
              </p>
            )}

            {!isMemoryItemsLoading && memoryItems.length === 0 && (
              <p className="text-xs" style={{ color: "var(--app-on-dark-muted)" }}>
                No memory items yet. Zee will add memories as you chat.
              </p>
            )}

            {!isMemoryItemsLoading && memoryItems.length > 0 && (
              <div className="space-y-2.5">
                {memoryItems.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-xl border p-3"
                    style={{
                      backgroundColor: "var(--app-panel-bg)",
                      borderColor: "var(--app-soft-card-border)",
                    }}
                    data-testid="memory-item-row"
                  >
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span
                        className="rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                        style={{
                          borderColor: "var(--app-soft-card-border)",
                          color: "var(--app-on-dark-muted)",
                        }}
                      >
                        {formatMemoryKindLabel(item.kind)}
                      </span>
                      <span
                        className="rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                        style={{
                          borderColor: "var(--app-soft-card-border)",
                          color: "var(--app-on-dark-muted)",
                        }}
                      >
                        {item.sensitivity}
                      </span>
                    </div>
                    <p className="text-sm font-medium leading-relaxed">{item.summary}</p>
                    <p
                      className="mt-1 text-[11px]"
                      style={{ color: "var(--app-on-dark-muted)" }}
                    >
                      Last reinforced {formatMemoryTimestamp(item.lastReinforcedAt)}
                    </p>
                    <div className="mt-3 flex justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-lg px-3 text-xs"
                        style={{
                          borderColor: "var(--app-soft-card-border)",
                          color: "var(--app-on-dark)",
                        }}
                        disabled={Boolean(forgettingMemoryItemId)}
                        onClick={() => {
                          void handleForgetMemoryItem(item.id);
                        }}
                        data-testid={`button-forget-memory-${item.id}`}
                      >
                        {forgettingMemoryItemId === item.id ? "Forgetting..." : "Forget"}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {(settingsError || settingsSuccess) && (
            <div
              className="rounded-xl border px-3 py-2 text-xs"
              style={{
                backgroundColor: "var(--app-soft-card-bg)",
                borderColor: "var(--app-soft-card-border)",
              }}
            >
              {settingsError && <p className="text-red-500">{settingsError}</p>}
              {settingsSuccess && <p className="text-emerald-600">{settingsSuccess}</p>}
            </div>
          )}
        </div>
      </ScrollArea>
    </motion.div>
  );
};

const SharedHeader = ({ 
  assistantName,
  selectedVoice,
  setSelectedVoice,
  onProfile, 
  isActive, 
  duration,
  mode,
  userProfileImage
}: { 
  assistantName: Persona,
  selectedVoice: LiveVoiceName,
  setSelectedVoice: (voice: LiveVoiceName) => void,
  onProfile: () => void, 
  isActive: boolean,
  duration: number,
  mode: Mode,
  userProfileImage?: string
}) => {
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div
      className="absolute top-0 left-0 right-0 z-50 flex items-center justify-between pointer-events-none"
      style={{
        paddingLeft: "1rem",
        paddingRight: "1rem",
        paddingTop: "max(0.85rem, env(safe-area-inset-top))",
        paddingBottom: "0.75rem",
      }}
    >
      <div className="pointer-events-auto">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex items-center gap-2 border px-4 py-2 rounded-2xl shadow-sm transition-colors focus:outline-none"
              style={{
                backgroundColor: "var(--app-header-bg)",
                borderColor: "var(--app-soft-card-border)",
              }}
              data-testid="button-persona-selector"
            >
              <div className="flex flex-col items-start leading-tight">
                <span className="font-bold text-lg" style={{ color: "var(--app-on-dark)" }}>
                  {assistantName}
                </span>
                <span
                  className="text-[10px] uppercase tracking-wide"
                  style={{ color: "var(--app-on-dark-muted)" }}
                >
                  Voice: {selectedVoice}
                </span>
              </div>
              <ChevronRight
                className="w-4 h-4 rotate-90"
                style={{ color: "var(--app-on-dark-muted)" }}
              />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="w-56 rounded-xl"
            style={{
              backgroundColor: "var(--app-header-bg)",
              borderColor: "var(--app-soft-card-border)",
              color: "var(--app-on-dark)",
            }}
          >
            {LIVE_VOICE_OPTIONS.map((voice) => (
              <DropdownMenuItem
                key={voice.id}
                onClick={() => setSelectedVoice(voice.id)}
                className="gap-2.5 p-3 font-medium cursor-pointer"
                data-testid={`button-voice-${voice.id.toLowerCase()}`}
              >
                <div
                  className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 border-2"
                  style={{
                    borderColor:
                      selectedVoice === voice.id
                        ? "var(--app-accent)"
                        : "var(--app-soft-card-border)",
                  }}
                >
                  <img
                    src={voice.avatar}
                    alt={voice.label}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span>{voice.label}</span>
                  <span
                    className="text-[10px] uppercase tracking-wide"
                    style={{ color: "var(--app-on-dark-muted)" }}
                  >
                    {voice.style === "feminine" ? "Woman" : "Man"}
                  </span>
                </div>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      
      <AnimatePresence>
        {isActive && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute left-1/2 -translate-x-1/2 font-mono text-sm font-medium px-3 py-1 rounded-full backdrop-blur-sm"
            style={{
              color: "var(--app-on-dark)",
              backgroundColor: "var(--app-soft-card-bg)",
              border: "1px solid var(--app-soft-card-border)",
            }}
          >
            {formatTime(duration)}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="pointer-events-auto">
        <Button variant="ghost" size="icon" className="rounded-full w-12 h-12" onClick={onProfile} data-testid="button-profile">
          <div
            className="w-full h-full rounded-full overflow-hidden p-0.5"
            style={{
              border: "1px solid var(--app-soft-card-border)",
              backgroundColor: "var(--app-soft-card-bg)",
            }}
          >
                <Avatar className="w-full h-full">
                <AvatarImage src={userProfileImage} className="object-cover" />
                <AvatarFallback
                  className="text-sm"
                  style={{ backgroundColor: "var(--app-muted)" }}
                >
                  U
                </AvatarFallback>
              </Avatar>
          </div>
        </Button>
      </div>

      <AnimatePresence>
        {mode === "text" && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="absolute inset-x-0 bottom-2 flex justify-center pointer-events-none"
            aria-hidden="true"
          >
            <motion.div
              className="h-1.5 w-14 rounded-full"
              style={{ backgroundColor: "var(--app-on-dark-muted)" }}
              animate={{ opacity: [0.45, 0.8, 0.45] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
              data-testid="header-drape-handle"
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

interface VoiceLiveDebugPanelProps {
  enabled: boolean;
  state: LiveVoiceDebugState | null;
  tokenConfigSummary: LiveTokenConfigSummary | null;
  traces: LiveTraceEntry[];
  onExport: () => void;
}

const VoiceView = ({ isActive, isConnecting, onEndCall, onInterruptAssistant, onProfile, assistantName, assistantAvatar, selectedVoice, setSelectedVoice, mode, setMode, duration, userProfileImage, isVideoEnabled, onToggleVideo, onFlipCamera, videoStream, isVideoTransitioning, cameraFacingMode, webLookupStatus, webLookupLabel, liveDebug }: {
  isActive: boolean; 
  isConnecting: boolean;
  onEndCall: () => void;
  onInterruptAssistant: () => void;
  onProfile: () => void;
  assistantName: Persona;
  assistantAvatar: string;
  selectedVoice: LiveVoiceName;
  setSelectedVoice: (voice: LiveVoiceName) => void;
  mode: Mode;
  setMode: (m: Mode) => void;
  duration: number;
  userProfileImage?: string;
  isVideoEnabled: boolean;
  onToggleVideo: () => void;
  onFlipCamera: () => void;
  videoStream: MediaStream | null;
  isVideoTransitioning: boolean;
  cameraFacingMode: CameraFacingMode;
  webLookupStatus: WebLookupStatus | null;
  webLookupLabel?: string | null;
  liveDebug: VoiceLiveDebugPanelProps;
}) => {
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const [debugPanelOpen, setDebugPanelOpen] = useState(false);

  useEffect(() => {
    if (!videoPreviewRef.current) return;
    videoPreviewRef.current.srcObject = videoStream;
  }, [videoStream]);

  return (
    <motion.div 
      className="absolute top-0 left-0 right-0 z-40 rounded-b-[2.5rem] shadow-2xl overflow-hidden"
      style={{ backgroundColor: "var(--app-header-bg)" }}
      initial={false}
      animate={{ height: mode === "voice" ? "100%" : "110px" }}
      transition={{ type: "spring", stiffness: 200, damping: 25 }}
      drag="y"
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={0.05}
      onDragEnd={(_, info) => {
         if (mode === "voice" && info.offset.y < -100) {
           setMode("text");
         } else if (mode === "text" && info.offset.y > 50) {
           setMode("voice");
         }
      }}
    >
      <div className="w-full h-full relative flex flex-col pointer-events-none">
        
        <div className="relative z-50 pointer-events-auto">
          <SharedHeader 
            assistantName={assistantName}
            selectedVoice={selectedVoice}
            setSelectedVoice={setSelectedVoice}
            onProfile={onProfile} 
            isActive={isActive} 
            duration={duration} 
            mode={mode}
            userProfileImage={userProfileImage}
          />
        </div>

        {liveDebug.enabled && (
          <div className="absolute right-3 top-[5.6rem] z-40 pointer-events-auto">
            <button
              type="button"
              className="rounded-full border px-3 py-1.5 text-[11px] font-semibold tracking-[0.18em] uppercase backdrop-blur-md"
              style={{
                borderColor: "color-mix(in srgb, var(--app-soft-card-border) 80%, transparent)",
                backgroundColor:
                  "color-mix(in srgb, var(--app-soft-card-bg) 92%, transparent)",
                color: "var(--app-on-dark)",
              }}
              onClick={() => setDebugPanelOpen((current) => !current)}
              data-testid="button-live-debug-panel"
            >
              {debugPanelOpen ? "Hide Debug" : "Live Debug"}
            </button>
            <AnimatePresence>
              {debugPanelOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.98 }}
                  transition={{ duration: 0.16, ease: "easeOut" }}
                  className="mt-2 w-[min(92vw,24rem)] overflow-hidden rounded-[1.35rem] border shadow-2xl"
                  style={{
                    borderColor:
                      "color-mix(in srgb, var(--app-soft-card-border) 85%, transparent)",
                    backgroundColor:
                      "color-mix(in srgb, var(--app-soft-card-bg) 96%, transparent)",
                  }}
                >
                  <div className="flex items-center justify-between border-b px-4 py-3"
                    style={{
                      borderColor:
                        "color-mix(in srgb, var(--app-soft-card-border) 72%, transparent)",
                    }}
                  >
                    <div>
                      <div
                        className="text-[11px] font-semibold uppercase tracking-[0.22em]"
                        style={{ color: "var(--app-on-dark-muted)" }}
                      >
                        Voice Debug
                      </div>
                      <div
                        className="text-xs"
                        style={{ color: "var(--app-on-dark)" }}
                      >
                        Manual activity and trace diagnostics
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 rounded-full px-3 text-[11px] uppercase tracking-[0.16em]"
                      onClick={liveDebug.onExport}
                    >
                      Export JSON
                    </Button>
                  </div>
                  <div className="space-y-3 px-4 py-3 text-xs" style={{ color: "var(--app-on-dark)" }}>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-2xl border px-3 py-2"
                        style={{
                          borderColor:
                            "color-mix(in srgb, var(--app-soft-card-border) 72%, transparent)",
                        }}
                      >
                        <div className="text-[10px] uppercase tracking-[0.18em]" style={{ color: "var(--app-on-dark-muted)" }}>
                          Speech State
                        </div>
                        <div className="mt-1 font-medium">
                          {liveDebug.state?.speechState ?? "idle"}
                        </div>
                      </div>
                      <div className="rounded-2xl border px-3 py-2"
                        style={{
                          borderColor:
                            "color-mix(in srgb, var(--app-soft-card-border) 72%, transparent)",
                        }}
                      >
                        <div className="text-[10px] uppercase tracking-[0.18em]" style={{ color: "var(--app-on-dark-muted)" }}>
                          Interrupt Mode
                        </div>
                        <div className="mt-1 font-medium">
                          {liveDebug.tokenConfigSummary?.effectiveInterruptMode ??
                            "client_manual_activity"}
                        </div>
                      </div>
                      <div className="rounded-2xl border px-3 py-2"
                        style={{
                          borderColor:
                            "color-mix(in srgb, var(--app-soft-card-border) 72%, transparent)",
                        }}
                      >
                        <div className="text-[10px] uppercase tracking-[0.18em]" style={{ color: "var(--app-on-dark-muted)" }}>
                          Ambient RMS
                        </div>
                        <div className="mt-1 font-medium">
                          {(liveDebug.state?.ambientRms ?? 0).toFixed(4)}
                        </div>
                      </div>
                      <div className="rounded-2xl border px-3 py-2"
                        style={{
                          borderColor:
                            "color-mix(in srgb, var(--app-soft-card-border) 72%, transparent)",
                        }}
                      >
                        <div className="text-[10px] uppercase tracking-[0.18em]" style={{ color: "var(--app-on-dark-muted)" }}>
                          Active Threshold
                        </div>
                        <div className="mt-1 font-medium">
                          {(liveDebug.state?.activeThreshold ?? 0).toFixed(4)}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl border px-3 py-3"
                      style={{
                        borderColor:
                          "color-mix(in srgb, var(--app-soft-card-border) 72%, transparent)",
                      }}
                    >
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                        <span className="text-[10px] uppercase tracking-[0.18em]" style={{ color: "var(--app-on-dark-muted)" }}>
                          Analyzer
                        </span>
                        <span>{liveDebug.state?.analyzerKind ?? "script_processor"}</span>
                        <span className="text-[10px] uppercase tracking-[0.18em]" style={{ color: "var(--app-on-dark-muted)" }}>
                          Current RMS
                        </span>
                        <span>{(liveDebug.state?.currentRms ?? 0).toFixed(4)}</span>
                        <span className="text-[10px] uppercase tracking-[0.18em]" style={{ color: "var(--app-on-dark-muted)" }}>
                          Manual Activity
                        </span>
                        <span>{liveDebug.state?.manualActivityActive ? "on" : "off"}</span>
                      </div>
                      <div className="mt-3 text-[10px]" style={{ color: "var(--app-on-dark-muted)" }}>
                        Resumption handle updated:
                        {" "}
                        {liveDebug.state?.sessionResumptionUpdatedAt
                          ? new Date(
                              liveDebug.state.sessionResumptionUpdatedAt,
                            ).toLocaleTimeString()
                          : "not yet"}
                      </div>
                      <div className="mt-1 text-[10px]" style={{ color: "var(--app-on-dark-muted)" }}>
                        GoAway time left:
                        {" "}
                        {liveDebug.state?.goAwayTimeLeft ?? "none"}
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-2xl border px-3 py-3"
                        style={{
                          borderColor:
                            "color-mix(in srgb, var(--app-soft-card-border) 72%, transparent)",
                        }}
                      >
                        <div className="text-[10px] uppercase tracking-[0.18em]" style={{ color: "var(--app-on-dark-muted)" }}>
                          Granted Mic Settings
                        </div>
                        <pre className="mt-2 whitespace-pre-wrap break-words text-[10px] leading-4">
                          {JSON.stringify(
                            liveDebug.state?.trackSettings ?? null,
                            null,
                            2,
                          )}
                        </pre>
                      </div>
                      <div className="rounded-2xl border px-3 py-3"
                        style={{
                          borderColor:
                            "color-mix(in srgb, var(--app-soft-card-border) 72%, transparent)",
                        }}
                      >
                        <div className="text-[10px] uppercase tracking-[0.18em]" style={{ color: "var(--app-on-dark-muted)" }}>
                          Track Capabilities
                        </div>
                        <pre className="mt-2 whitespace-pre-wrap break-words text-[10px] leading-4">
                          {JSON.stringify(
                            liveDebug.state?.trackCapabilities ?? null,
                            null,
                            2,
                          )}
                        </pre>
                      </div>
                    </div>

                    <div className="rounded-2xl border px-3 py-3"
                      style={{
                        borderColor:
                          "color-mix(in srgb, var(--app-soft-card-border) 72%, transparent)",
                      }}
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <div className="text-[10px] uppercase tracking-[0.18em]" style={{ color: "var(--app-on-dark-muted)" }}>
                          LiveTrace Buffer ({liveDebug.traces.length})
                        </div>
                      </div>
                      <ScrollArea className="h-48 pr-3">
                        <div className="space-y-2 text-[10px] leading-4">
                          {liveDebug.traces.length === 0 ? (
                            <div style={{ color: "var(--app-on-dark-muted)" }}>
                              No traces captured yet.
                            </div>
                          ) : (
                            liveDebug.traces
                              .slice()
                              .reverse()
                              .map((trace) => (
                                <div
                                  key={`${trace.at}-${trace.event}`}
                                  className="rounded-xl border px-2 py-2"
                                  style={{
                                    borderColor:
                                      "color-mix(in srgb, var(--app-soft-card-border) 60%, transparent)",
                                  }}
                                >
                                  <div className="font-medium">{trace.event}</div>
                                  <div style={{ color: "var(--app-on-dark-muted)" }}>
                                    {new Date(trace.at).toLocaleTimeString()}
                                  </div>
                                  <pre className="mt-1 whitespace-pre-wrap break-words">
                                    {JSON.stringify(trace.metadata, null, 2)}
                                  </pre>
                                </div>
                              ))
                          )}
                        </div>
                      </ScrollArea>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        <motion.div
          className="flex-1 flex flex-col pointer-events-auto"
          style={{
            paddingTop: "max(5rem, calc(env(safe-area-inset-top) + 3.2rem))",
            paddingBottom: "0.25rem",
          }}
          animate={{ opacity: mode === "voice" ? 1 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <AnimatePresence>
            {isActive && webLookupStatus && (
              <motion.div
                initial={{ opacity: 0, y: -8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.96 }}
                transition={{ duration: 0.16, ease: "easeOut" }}
                className="absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-full border px-3 py-1.5 text-[11px] font-medium tracking-wide backdrop-blur-md"
                style={{
                  borderColor:
                    webLookupStatus === "searching"
                      ? "color-mix(in srgb, #4285F4 30%, transparent)"
                      : "color-mix(in srgb, var(--app-soft-card-border) 76%, transparent)",
                  backgroundColor:
                    "color-mix(in srgb, var(--app-soft-card-bg) 88%, transparent)",
                  color: "var(--app-on-dark-muted)",
                }}
              >
                {webLookupStatus === "searching" ? (
                  <span className="flex items-center gap-2">
                    <span className="flex items-center gap-0.5">
                      {["#4285F4", "#EA4335", "#FBBC05", "#34A853"].map((c, i) => (
                        <motion.span
                          key={c}
                          className="inline-block h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: c }}
                          animate={{ opacity: [0.4, 1, 0.4], scale: [0.8, 1.15, 0.8] }}
                          transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.12 }}
                        />
                      ))}
                    </span>
                    {webLookupLabel ?? "Searching the web…"}
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <Globe className="h-3 w-3" style={{ color: "var(--app-accent)" }} />
                    {webLookupLabel ?? "Web-checked"}
                  </span>
                )}
              </motion.div>
            )}
          </AnimatePresence>
          <div className="flex-1 flex flex-col items-center justify-center relative">
            {isActive ? (
              <div className="w-full h-full flex items-center justify-center px-8">
                <div
                  className={cn(
                    "relative flex w-full items-center justify-center",
                    isVideoEnabled ? "h-[56vh]" : "h-48",
                  )}
                >
                  {isVideoEnabled && (
                    <div className="absolute left-1/2 top-1/2 h-[52vh] max-h-[460px] w-[82%] max-w-[340px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[2rem] border border-white/20 bg-black/40 shadow-2xl">
                      <video
                        ref={videoPreviewRef}
                        autoPlay
                        muted
                        playsInline
                        className="h-full w-full object-cover"
                        style={cameraFacingMode === "user" ? { transform: "scaleX(-1)" } : undefined}
                      />
                      <button
                        type="button"
                        className="absolute top-3 right-3 w-10 h-10 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center text-white/90 hover:bg-black/70 transition-colors active:scale-95"
                        onClick={onFlipCamera}
                        disabled={isVideoTransitioning}
                        aria-label="Switch camera"
                        data-testid="button-flip-camera"
                      >
                        <SwitchCamera className="w-5 h-5" />
                      </button>
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 to-transparent px-3 pb-3 pt-8 text-center text-sm text-white/95">
                        Camera on
                      </div>
                    </div>
                  )}

                  {!isVideoEnabled && (
                    <div className="relative flex items-center justify-center">
                      {[0, 1, 2].map((i) => (
                        <motion.div
                          key={`active-ring-${i}`}
                          className="absolute rounded-full border border-[#DAA112]/20"
                          animate={{
                            width: [120, 200 + i * 40],
                            height: [120, 200 + i * 40],
                            opacity: [0.4, 0],
                          }}
                          transition={{
                            duration: 2,
                            repeat: Infinity,
                            delay: i * 0.6,
                            ease: "easeOut",
                          }}
                        />
                      ))}
                      <motion.div
                        className="w-28 h-28 rounded-full overflow-hidden ring-4 ring-[#DAA112]/40 shadow-[0_0_50px_rgba(218,161,18,0.25)]"
                        animate={{ scale: [1, 1.06, 1] }}
                        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                      >
                        <img src={assistantAvatar} alt={assistantName} className="w-full h-full object-cover" />
                      </motion.div>
                    </div>
                  )}

                  <div
                    className={cn(
                      "z-10 flex items-center justify-center gap-1.5",
                      isVideoEnabled
                        ? "absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full bg-black/35 px-4 py-3 backdrop-blur-sm"
                        : "absolute -bottom-12 left-1/2 -translate-x-1/2 rounded-full bg-white/5 px-4 py-2 backdrop-blur-sm",
                    )}
                  >
                    {webLookupStatus === "searching" ? (
                      <div
                        className="flex min-w-[232px] flex-col gap-1.5"
                        data-testid="voice-web-lookup-indicator"
                      >
                        <div className="flex items-center justify-center gap-2">
                          <div className="flex items-center gap-1.5">
                            <motion.span
                              className="h-1.5 w-1.5 rounded-full"
                              style={{ backgroundColor: "#4285F4" }}
                              animate={{ opacity: [0.5, 1, 0.5], y: [0, -1, 0] }}
                              transition={{ duration: 0.95, repeat: Infinity, delay: 0 }}
                            />
                            <motion.span
                              className="h-1.5 w-1.5 rounded-full"
                              style={{ backgroundColor: "#EA4335" }}
                              animate={{ opacity: [0.5, 1, 0.5], y: [0, -1, 0] }}
                              transition={{ duration: 0.95, repeat: Infinity, delay: 0.12 }}
                            />
                            <motion.span
                              className="h-1.5 w-1.5 rounded-full"
                              style={{ backgroundColor: "#FBBC05" }}
                              animate={{ opacity: [0.5, 1, 0.5], y: [0, -1, 0] }}
                              transition={{ duration: 0.95, repeat: Infinity, delay: 0.24 }}
                            />
                            <motion.span
                              className="h-1.5 w-1.5 rounded-full"
                              style={{ backgroundColor: "#34A853" }}
                              animate={{ opacity: [0.5, 1, 0.5], y: [0, -1, 0] }}
                              transition={{ duration: 0.95, repeat: Infinity, delay: 0.36 }}
                            />
                          </div>
                          <span
                            className="text-[11px] font-medium tracking-wide"
                            style={{ color: "var(--app-on-dark-muted)" }}
                          >
                            {webLookupLabel ?? "Looking up latest info"}
                          </span>
                        </div>
                        <div
                          className="relative h-1.5 overflow-hidden rounded-full"
                          style={{
                            backgroundColor:
                              "color-mix(in srgb, var(--app-soft-card-border) 50%, transparent)",
                          }}
                        >
                          <motion.div
                            className="absolute inset-y-0 left-0 rounded-full"
                            style={{
                              width: "42%",
                              background:
                                "linear-gradient(90deg, #4285F4 0%, #EA4335 33%, #FBBC05 66%, #34A853 100%)",
                            }}
                            animate={{ x: ["-35%", "140%"] }}
                            transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
                          />
                        </div>
                      </div>
                    ) : webLookupStatus === "grounded" ? (
                      <div
                        className="flex min-w-[194px] items-center justify-center gap-2 rounded-full px-2 py-1"
                        style={{
                          backgroundColor:
                            "color-mix(in srgb, var(--app-soft-card-bg) 65%, transparent)",
                        }}
                      >
                        <Globe className="h-3.5 w-3.5" style={{ color: "var(--app-accent)" }} />
                        <span
                          className="text-[11px] font-medium tracking-wide"
                          style={{ color: "var(--app-on-dark-muted)" }}
                        >
                          {webLookupLabel ?? "Web-checked"}
                        </span>
                      </div>
                    ) : (
                      [...Array(8)].map((_, i) => (
                        <motion.div
                          key={i}
                          className={cn(
                            "rounded-full opacity-80",
                            isVideoEnabled ? "w-3" : "w-2.5",
                          )}
                          animate={{
                            height: ["20%", "80%", "20%"],
                            backgroundColor: [
                              "var(--app-accent)",
                              "var(--app-assistant-bubble-bg)",
                              "var(--app-accent)",
                            ],
                          }}
                          transition={{
                            duration: 1 + Math.random() * 0.5,
                            repeat: Infinity,
                            delay: i * 0.1,
                            ease: "easeInOut"
                          }}
                        />
                      ))
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-6">
                 <button
                   type="button"
                   className={cn(
                     "relative group cursor-pointer flex items-center justify-center",
                     isConnecting && "cursor-wait",
                   )}
                   onClick={onEndCall}
                   disabled={isConnecting}
                   aria-label={isConnecting ? "Connecting voice session" : `Start voice call with ${assistantName}`}
                   data-testid="button-start-call"
                 >
                   {[0, 1, 2].map((i) => (
                     <motion.div
                       key={`ring-${i}`}
                       className="absolute rounded-full border-2"
                       style={{ borderColor: "color-mix(in srgb, var(--app-accent) 15%, transparent)" }}
                       animate={{
                         width: [140, 220 + i * 50],
                         height: [140, 220 + i * 50],
                         opacity: [0.5, 0],
                       }}
                       transition={{
                         duration: 3,
                         repeat: Infinity,
                         delay: i * 0.8,
                         ease: "easeOut",
                       }}
                     />
                   ))}

                   <motion.div
                     className="absolute w-44 h-44 rounded-full opacity-[0.08]"
                     style={{ backgroundColor: "var(--app-accent)" }}
                     animate={{ scale: [1, 1.15, 1], opacity: [0.08, 0.16, 0.08] }}
                     transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                   />
                   <motion.div
                     className="absolute w-36 h-36 rounded-full opacity-[0.12]"
                     style={{ backgroundColor: "var(--app-accent)" }}
                     animate={{ scale: [1, 1.08, 1], opacity: [0.12, 0.22, 0.12] }}
                     transition={{ duration: 3, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
                   />

                   <motion.div
                     className={cn(
                       "relative w-32 h-32 rounded-full overflow-hidden ring-4",
                       isConnecting && "opacity-70",
                     )}
                     style={{
                       ["--tw-ring-color" as string]: "color-mix(in srgb, var(--app-accent) 50%, transparent)",
                       boxShadow: "0 0 60px color-mix(in srgb, var(--app-accent) 30%, transparent)",
                     }}
                     animate={{ scale: [1, 1.04, 1] }}
                     transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                     whileHover={!isConnecting ? { scale: 1.08 } : undefined}
                     whileTap={!isConnecting ? { scale: 0.95 } : undefined}
                   >
                     <img src={assistantAvatar} alt={assistantName} className="w-full h-full object-cover" />
                     <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
                     <div
                       className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full p-2 shadow-lg"
                       style={{ backgroundColor: "var(--app-accent)" }}
                     >
                       <Mic className="w-4 h-4" style={{ color: "var(--app-accent-text)" }} />
                     </div>
                   </motion.div>
                 </button>
                 <motion.p
                   className="font-medium tracking-wide text-center"
                   style={{ color: "var(--app-on-dark-muted)" }}
                   animate={isConnecting ? { opacity: [0.5, 1, 0.5] } : { opacity: 1 }}
                   transition={isConnecting ? { duration: 1.5, repeat: Infinity, ease: "easeInOut" } : {}}
                 >
                   {isConnecting ? `Connecting to ${assistantName}...` : `Tap to speak to ${assistantName}`}
                 </motion.p>
              </div>
            )}
          </div>

          <div
            className="px-4 sm:px-6 space-y-5"
            style={{ paddingBottom: "max(5rem, calc(env(safe-area-inset-bottom) + 4.1rem))" }}
          >
            {isActive && (
              <div className="mb-4 flex flex-wrap items-center justify-center gap-4">
                 <Button 
                    variant="outline" 
                    size="icon" 
                    className={cn(
                      "w-14 h-14 rounded-full border-2 transition-colors",
                      isVideoEnabled
                        ? ""
                        : "hover:opacity-90",
                    )}
                    style={{
                      backgroundColor: "var(--app-soft-card-bg)",
                      borderColor: isVideoEnabled
                        ? "var(--app-accent)"
                        : "var(--app-soft-card-border)",
                      color: "var(--app-on-dark)",
                    }}
                    onClick={onToggleVideo}
                    disabled={isVideoTransitioning}
                    data-testid="button-toggle-video"
                  >
                    <Video className="w-6 h-6" />
                  </Button>
                  <Button
                    variant="outline"
                    className="h-14 rounded-full border-2 px-5 text-sm font-medium transition-colors hover:opacity-90"
                    style={{
                      backgroundColor: "var(--app-soft-card-bg)",
                      borderColor: "var(--app-soft-card-border)",
                      color: "var(--app-on-dark)",
                    }}
                    onClick={onInterruptAssistant}
                    aria-label="Interrupt Zee and start talking"
                    data-testid="button-interrupt-assistant"
                  >
                    <VolumeX className="mr-2 h-4 w-4" />
                    Interrupt
                  </Button>
                  <Button 
                    variant="destructive" 
                    size="icon" 
                    className="w-20 h-20 rounded-full shadow-2xl hover:scale-105 transition-transform bg-red-500 hover:bg-red-600 text-white border-4"
                    style={{ borderColor: "var(--app-shell-bg)" }}
                    onClick={onEndCall}
                    data-testid="button-end-call"
                  >
                    <PhoneOff className="w-8 h-8" />
                  </Button>
              </div>
            )}

            <button
              type="button"
              className="w-full flex flex-col items-center justify-center gap-2 py-3 pb-6 cursor-grab active:cursor-grabbing"
              style={{ color: "var(--app-on-dark-muted)" }}
              onClick={() => setMode("text")}
              aria-label="Switch to text chat"
              data-testid="button-open-text-chat"
            >
               <div className="w-12 h-1.5 rounded-full" style={{ backgroundColor: "var(--app-on-dark-muted)" }} />
               <span className="text-xs font-medium uppercase tracking-wider">Swipe up to chat</span>
            </button>
          </div>
        </motion.div>
        
        <AnimatePresence>
          {mode === "text" && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
               className="absolute bottom-2 left-0 right-0 flex justify-center pb-2 pointer-events-none"
            >
               <div className="w-12 h-1.5 rounded-full" style={{ backgroundColor: "var(--app-on-dark-muted)" }} />
            </motion.div>
          )}
        </AnimatePresence>
        
      </div>
    </motion.div>
  );
};

function formatTimelineTimeLabel(value: string | null): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function toTimelineVisual(status: UnifiedAgentTaskTimelineItem["status"]): {
  label: string;
  icon: ReactNode;
  color: string;
} {
  if (status === "completed") {
    return {
      label: "Completed",
      icon: <CheckCircle2 className="h-3.5 w-3.5" />,
      color: "color-mix(in srgb, var(--app-accent) 75%, #22c55e)",
    };
  }
  if (status === "failed") {
    return {
      label: "Failed",
      icon: <AlertTriangle className="h-3.5 w-3.5" />,
      color: "color-mix(in srgb, var(--app-accent) 38%, #ef4444)",
    };
  }
  if (status === "blocked") {
    return {
      label: "Blocked",
      icon: <AlertTriangle className="h-3.5 w-3.5" />,
      color: "color-mix(in srgb, var(--app-accent) 65%, #f59e0b)",
    };
  }
  if (status === "in_progress") {
    return {
      label: "In progress",
      icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
      color: "var(--app-accent)",
    };
  }
  if (status === "queued") {
    return {
      label: "Queued",
      icon: <Clock3 className="h-3.5 w-3.5" />,
      color: "var(--app-on-dark-muted)",
    };
  }
  return {
    label: "Info",
    icon: <CircleDot className="h-3.5 w-3.5" />,
    color: "var(--app-on-dark-muted)",
  };
}

const UnifiedAgentTaskCard = ({
  card,
  onOpenArtifact,
  onResolveApproval,
}: {
  card: UnifiedAgentTaskCardModel;
  onOpenArtifact: (artifactId: string) => void;
  onResolveApproval: (
    taskId: string,
    approve: boolean,
    reason?: string,
  ) => Promise<void>;
}) => {
  const [activeTab, setActiveTab] = useState("output");
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const [isResolvingApproval, setIsResolvingApproval] = useState(false);
  const [inlineIframeKey, setInlineIframeKey] = useState(0);
  const [hasRevealedIframe, setHasRevealedIframe] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(Boolean(card.autoCollapsed));
  const [hasManualCollapseOverride, setHasManualCollapseOverride] = useState(false);

  useEffect(() => {
    setHasManualCollapseOverride(false);
    setIsCollapsed(Boolean(card.autoCollapsed));
  }, [card.taskId]);

  useEffect(() => {
    if (!hasManualCollapseOverride) {
      setIsCollapsed(Boolean(card.autoCollapsed));
    }
  }, [card.autoCollapsed, hasManualCollapseOverride]);

  const taskDetailQuery = useQuery<AgentTaskResponse>({
    queryKey: [`/api/agent/tasks/${card.taskId}`],
    enabled: isInfoOpen || activeTab === "process" || activeTab === "terminal",
    staleTime: 0,
    retry: 2,
  });

  const detailTimeline = useMemo(() => {
    const details = taskDetailQuery.data;
    if (!details) return [] as UnifiedAgentTaskTimelineItem[];
    const rows: UnifiedAgentTaskTimelineItem[] = [];

    for (const step of details.steps ?? []) {
      rows.push({
        id: `detail-step-${step.id}`,
        title: step.title,
        detail: step.detail ?? null,
        status: step.status,
        createdAt: toIsoString(step.updatedAt) ?? toIsoString(step.createdAt),
      });
    }

    for (const approval of details.approvals ?? []) {
      rows.push({
        id: `detail-approval-${approval.id}`,
        title:
          approval.status === "pending"
            ? "Approval required"
            : `Approval ${approval.status}`,
        detail: approval.requestedAction,
        status: approval.status === "denied" ? "failed" : "blocked",
        createdAt: toIsoString(approval.respondedAt) ?? toIsoString(approval.createdAt),
      });
    }

    for (const artifact of details.artifacts ?? []) {
      rows.push({
        id: `detail-artifact-${artifact.id}`,
        title: "Artifact published",
        detail: artifact.title,
        status: "completed",
        createdAt: toIsoString(artifact.updatedAt) ?? toIsoString(artifact.createdAt),
      });
    }

    for (const toolCall of details.toolCalls ?? []) {
      rows.push({
        id: `detail-tool-${toolCall.id}`,
        title: `Tool: ${toolCall.toolName}`,
        detail: toolCall.outputSummary ?? null,
        status:
          toolCall.status === "completed"
            ? "completed"
            : toolCall.status === "failed"
              ? "failed"
              : toolCall.status === "started"
                ? "in_progress"
                : "info",
        createdAt: toIsoString(toolCall.createdAt),
      });
    }

    if (details.failure) {
      rows.push({
        id: `detail-failure-${card.taskId}`,
        title: "Failure diagnostics",
        detail: details.failure.reason,
        status: "failed",
        createdAt: details.failure.occurredAt ?? new Date().toISOString(),
      });
    }

    return normalizeTimeline(rows);
  }, [taskDetailQuery.data]);

  const timeline = detailTimeline.length > 0 ? detailTimeline : card.timeline;
  const failure = taskDetailQuery.data?.failure ?? card.failure;
  const hasArtifact = Boolean(card.artifact);
  const approvalPending = card.approval?.status === "pending";
  const isRunning = card.status === "queued" || card.status === "in_progress";
  const statusLabel = toTaskStatusLabel(card.status);
  const kindLabel = toTaskKindLabel(card.taskKind);
  const outputSummary = toUnifiedTaskOutputSummary(card);
  const detailTools = taskDetailQuery.data?.toolCalls ?? [];

  const statusTone =
    card.status === "failed"
      ? "color-mix(in srgb, var(--app-accent) 40%, #ef4444)"
      : card.status === "approval_required"
        ? "color-mix(in srgb, var(--app-accent) 70%, #f59e0b)"
        : card.status === "completed"
          ? "color-mix(in srgb, var(--app-accent) 85%, #22c55e)"
          : "var(--app-accent)";

  const handleApproval = async (approve: boolean) => {
    setIsResolvingApproval(true);
    try {
      await onResolveApproval(
        card.taskId,
        approve,
        approve ? undefined : "Denied from unified task card",
      );
    } finally {
      setIsResolvingApproval(false);
    }
  };

  const canRenderInlineHtml =
    hasArtifact &&
    typeof card.artifact?.htmlContent === "string" &&
    card.artifact.htmlContent.trim().length > 0;
  const artifactMetadata =
    card.artifact?.metadata &&
    typeof card.artifact.metadata === "object" &&
    !Array.isArray(card.artifact.metadata)
      ? (card.artifact.metadata as Record<string, unknown>)
      : null;
  const hasRenderSpec = Boolean(artifactMetadata?.render);
  const isInlineInteractiveArtifact =
    card.artifact?.type === "mini_game" || card.artifact?.type === "web_app";
  const canRenderInlineInteractive =
    canRenderInlineHtml && isInlineInteractiveArtifact;
  const canRenderInlineDocument =
    canRenderInlineHtml &&
    card.artifact?.type === "doc_markdown" &&
    !ENABLE_JSON_RENDER_ARTIFACT_VIEWER &&
    !hasRenderSpec;

  const inlineIframeSrc = useMemo(() => {
    if (!canRenderInlineHtml || !card.artifact?.id) return null;
    return `/api/agent/artifacts/${card.artifact.id}/render?v=${inlineIframeKey}`;
  }, [canRenderInlineHtml, card.artifact?.id, inlineIframeKey]);

  const terminalLines = useMemo(() => {
    const lines: { text: string; type: "info" | "success" | "warn" | "cmd" }[] = [];
    const meta = card.artifact?.metadata as Record<string, unknown> | undefined;
    const gen = meta?.generation as Record<string, unknown> | undefined;
    const qa = meta?.qa as Record<string, unknown> | undefined;
    const sandbox = meta?.sandbox as Record<string, unknown> | undefined;

    lines.push({ text: `$ zee task init --kind ${card.taskKind}`, type: "cmd" });
    lines.push({ text: `[task] ${card.taskId.slice(0, 8)}... created`, type: "info" });

    if (gen) {
      const model = gen.model ?? "unknown";
      const engine = gen.engine ?? "canvas_dom";
      const mode = gen.mode ?? "deterministic";
      const attempts = gen.attempts ?? 1;
      lines.push({ text: `$ zee generate --model ${model} --engine ${engine}`, type: "cmd" });
      lines.push({ text: `[gen] mode=${mode} attempts=${attempts}`, type: "info" });
      if (gen.backendFallbackReason) {
        lines.push({ text: `[warn] fallback: ${gen.backendFallbackReason}`, type: "warn" });
      }
    }

    if (sandbox) {
      const jobId = String(sandbox.jobId ?? "").slice(0, 8);
      const output = sandbox.outputPath ?? "index.html";
      lines.push({ text: `$ zee sandbox run --job ${jobId}...`, type: "cmd" });
      lines.push({ text: `[sandbox] output: ${output}`, type: "success" });
    }

    if (qa) {
      const qaMode = qa.mode ?? "unknown";
      const passed = qa.passed;
      lines.push({ text: `$ zee qa check --mode ${qaMode}`, type: "cmd" });
      if (passed) {
        lines.push({ text: `[qa] PASSED`, type: "success" });
      } else {
        lines.push({ text: `[qa] FAILED`, type: "warn" });
      }
      if (qa.warning) {
        lines.push({ text: `[qa] ${String(qa.warning).slice(0, 80)}...`, type: "warn" });
      }
    }

    if (card.artifact) {
      lines.push({ text: `$ zee artifact publish "${card.artifact.title}"`, type: "cmd" });
      lines.push({ text: `[done] artifact ${card.artifact.id.slice(0, 8)}... ready`, type: "success" });
    }

    for (const tc of detailTools) {
      lines.push({ text: `$ zee tool ${tc.toolName}`, type: "cmd" });
      if (tc.outputSummary) {
        lines.push({ text: `  → ${tc.outputSummary.slice(0, 60)}`, type: "info" });
      }
    }

    if (failure) {
      lines.push({
        text: `$ zee forensic --stage ${failure.stage} --trace ${failure.traceId ?? "n/a"}`,
        type: "cmd",
      });
      lines.push({ text: `[fail] ${failure.reason}`, type: "warn" });
      if (failure.code) {
        lines.push({ text: `[code] ${failure.code}`, type: "warn" });
      }
      if (failure.toolName) {
        lines.push({ text: `[tool] ${failure.toolName}`, type: "warn" });
      }
      if (failure.retriable) {
        lines.push({ text: `[hint] retriable=true`, type: "info" });
      }
    }

    return lines;
  }, [card.artifact, card.taskId, card.taskKind, detailTools, failure]);

  const tabAnimVariants = {
    initial: { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -4 },
  };

  return (
    <div
      className="space-y-2.5"
      data-testid="agent-unified-task-card"
      data-agent-task-id={card.taskId}
      data-agent-task-status={card.status}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="min-w-0">
            <p className="line-clamp-1 text-sm font-semibold leading-snug" style={{ color: "var(--app-on-dark)" }}>{card.title}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span
                className="text-[10px] font-bold uppercase tracking-[0.14em]"
                style={{ color: "var(--app-on-dark-muted)" }}
              >
                {kindLabel}
              </span>
              <span
                className="rounded-full border px-2 py-px text-[9px] font-bold uppercase tracking-wide"
                style={{
                  borderColor: "color-mix(in srgb, var(--app-soft-card-border) 75%, transparent)",
                  backgroundColor: "color-mix(in srgb, var(--app-soft-card-bg) 65%, transparent)",
                  color: statusTone,
                }}
              >
                {statusLabel}
              </span>
              {isRunning && (
                <motion.span
                  className="inline-flex h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: "var(--app-accent)" }}
                  animate={{ opacity: [1, 0.3, 1] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                />
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => {
                    setHasManualCollapseOverride(true);
                    setIsCollapsed((c) => !c);
                  }}
                  className="mt-0.5 rounded-lg border p-1.5 transition-all hover:opacity-90"
                  style={{
                    borderColor: "var(--app-soft-card-border)",
                    backgroundColor: "var(--app-soft-card-bg)",
                  }}
                  data-testid="agent-task-collapse-button"
                >
                  <motion.div
                    animate={{ rotate: isCollapsed ? 0 : 180 }}
                    transition={{ duration: 0.25 }}
                  >
                    <ChevronDown className="h-3.5 w-3.5" style={{ color: "var(--app-on-dark)" }} />
                  </motion.div>
                </button>
              </TooltipTrigger>
              <TooltipContent>{isCollapsed ? "Expand" : "Collapse"}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setIsInfoOpen(true)}
                  className="mt-0.5 rounded-lg border p-1.5 transition-all hover:opacity-90"
                  style={{
                    borderColor: "var(--app-soft-card-border)",
                    backgroundColor: "var(--app-soft-card-bg)",
                  }}
                  data-testid="agent-task-info-button"
                >
                  <Info className="h-3.5 w-3.5" style={{ color: "var(--app-on-dark)" }} />
                </button>
              </TooltipTrigger>
              <TooltipContent>View full activity</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {!isCollapsed && (
          <motion.div
            key="card-panel"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div
              className="overflow-hidden rounded-2xl border"
              style={{
                borderColor: "var(--app-soft-card-border)",
                backgroundColor: "var(--app-soft-card-bg)",
              }}
            >
        <div
          className="flex border-b"
          style={{ borderColor: "var(--app-soft-card-border)" }}
          data-testid="agent-task-tabs"
        >
          {[
            { key: "output", label: "Output" },
            { key: "process", label: "Thinking/Process" },
            { key: "terminal", label: "Terminal/Code" },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "relative flex-1 px-2 py-2.5 text-[11px] font-semibold tracking-wide transition-colors",
              )}
              style={{
                color: activeTab === tab.key ? "var(--app-on-dark)" : "var(--app-on-dark-muted)",
              }}
              data-testid={`agent-task-tab-${tab.key}`}
            >
              {tab.label}
              {activeTab === tab.key && (
                <motion.div
                  layoutId={`tab-indicator-${card.taskId}`}
                  className="absolute inset-x-2 bottom-0 h-[2px] rounded-full"
                  style={{ backgroundColor: "var(--app-accent)" }}
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                />
              )}
            </button>
          ))}
        </div>

        <div className="relative min-h-[200px]">
          <AnimatePresence mode="wait">
            {activeTab === "output" && (
              <motion.div
                key="tab-output"
                variants={tabAnimVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{ duration: 0.2 }}
                className="p-3"
              >
                {canRenderInlineInteractive && inlineIframeSrc ? (
                  <div className="space-y-2">
                    <div
                      className="relative overflow-hidden rounded-xl border group cursor-pointer"
                      style={{
                        borderColor: "var(--app-soft-card-border)",
                        boxShadow: "inset 0 1px 8px color-mix(in srgb, var(--app-accent) 12%, transparent)",
                      }}
                      onClick={() => !hasRevealedIframe && setHasRevealedIframe(true)}
                    >
                      <AnimatePresence>
                        {!hasRevealedIframe && (
                          <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0, scale: 1.05 }}
                            transition={{ duration: 0.4, ease: "easeOut" }}
                            className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 text-center p-6"
                            style={{
                              background: "linear-gradient(135deg, color-mix(in srgb, var(--app-accent) 25%, #0a0a0a), #0a0a0a)",
                            }}
                          >
                            <div 
                              className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-dashed transition-transform duration-500 group-hover:scale-110"
                              style={{ borderColor: "color-mix(in srgb, var(--app-accent) 40%, transparent)" }}
                            >
                              <Play className="ml-1 h-6 w-6" style={{ color: "var(--app-accent)" }} />
                            </div>
                            <div className="space-y-1">
                              <p className="text-sm font-bold tracking-tight" style={{ color: "var(--app-on-dark)" }}>
                                Tap to Launch
                              </p>
                              <p className="text-[11px] font-medium opacity-60" style={{ color: "var(--app-on-dark-muted)" }}>
                                {card.artifact?.title ??
                                  (card.artifact?.type === "web_app"
                                    ? "Web App"
                                    : "Mini Game")}
                              </p>
                            </div>
                            <div 
                              className="absolute inset-0 opacity-20 group-hover:opacity-30 transition-opacity duration-500"
                              style={{
                                background: "radial-gradient(circle at center, var(--app-accent) 0%, transparent 70%)"
                              }}
                            />
                          </motion.div>
                        )}
                      </AnimatePresence>
                      <iframe
                        key={inlineIframeKey}
                        title={card.artifact?.title ?? "Output"}
                        sandbox="allow-scripts"
                        src={inlineIframeSrc}
                        className="h-[280px] w-full"
                        style={{ backgroundColor: "#0a0a0a", border: "none" }}
                        data-testid="agent-inline-artifact-iframe"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onOpenArtifact(card.artifact!.id)}
                        className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-semibold transition-colors hover:opacity-90"
                        style={{
                          borderColor: "var(--app-soft-card-border)",
                          backgroundColor: "var(--app-soft-card-bg)",
                          color: "var(--app-accent)",
                        }}
                        data-testid="button-fullscreen-inline-artifact"
                      >
                        <Maximize2 className="h-3 w-3" />
                        {card.artifact?.type === "web_app" ? "View / Launch" : "Full Screen"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setInlineIframeKey((k) => k + 1)}
                        className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-semibold transition-colors hover:opacity-90"
                        style={{
                          borderColor: "var(--app-soft-card-border)",
                          backgroundColor: "var(--app-soft-card-bg)",
                          color: "var(--app-on-dark)",
                        }}
                        data-testid="button-reload-inline-artifact"
                      >
                        Reload
                      </button>
                    </div>
                  </div>
                ) : canRenderInlineDocument && inlineIframeSrc ? (
                  <div className="space-y-2">
                    <div
                      className="rounded-xl border p-2"
                      style={{
                        borderColor: "var(--app-soft-card-border)",
                        backgroundColor:
                          "color-mix(in srgb, var(--app-soft-card-bg) 80%, transparent)",
                      }}
                    >
                      <div className="mb-2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide opacity-75">
                        <FileText className="h-3 w-3" />
                        Document Preview
                      </div>
                      <iframe
                        key={inlineIframeKey}
                        title={card.artifact?.title ?? "Document"}
                        sandbox="allow-scripts"
                        src={inlineIframeSrc}
                        className="h-[280px] w-full rounded-lg border"
                        style={{
                          backgroundColor: "#ffffff",
                          borderColor: "var(--app-soft-card-border)",
                        }}
                        data-testid="agent-inline-document-iframe"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onOpenArtifact(card.artifact!.id)}
                        className="rounded-lg border px-3 py-1.5 text-[11px] font-semibold transition-colors hover:opacity-90"
                        style={{
                          borderColor: "var(--app-soft-card-border)",
                          backgroundColor: "var(--app-soft-card-bg)",
                          color: "var(--app-accent)",
                        }}
                        data-testid="button-open-agent-artifact"
                      >
                        View
                      </button>
                      <button
                        type="button"
                        onClick={() => setInlineIframeKey((k) => k + 1)}
                        className="rounded-lg border px-3 py-1.5 text-[11px] font-semibold transition-colors hover:opacity-90"
                        style={{
                          borderColor: "var(--app-soft-card-border)",
                          backgroundColor: "var(--app-soft-card-bg)",
                          color: "var(--app-on-dark)",
                        }}
                        data-testid="button-reload-inline-artifact"
                      >
                        Reload
                      </button>
                    </div>
                  </div>
                ) : hasArtifact &&
                  card.artifact &&
                  card.artifact.markdownContent &&
                  !hasRenderSpec ? (
                  <div
                    className="relative overflow-hidden rounded-xl border p-4"
                    style={{
                      borderColor: "var(--app-soft-card-border)",
                      background:
                        "radial-gradient(120% 100% at 12% 10%, color-mix(in srgb, var(--app-accent) 14%, transparent) 0%, transparent 56%), color-mix(in srgb, var(--app-soft-card-bg) 80%, transparent)",
                    }}
                  >
                    <div className="space-y-2">
                      <div className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide opacity-70">
                        <FileText className="h-3 w-3" />
                        Document
                      </div>
                      <p className="text-sm font-semibold">{card.artifact.title}</p>
                      <div
                        className="max-h-[200px] overflow-y-auto rounded-lg border p-3 text-xs leading-relaxed opacity-85"
                        style={{
                          borderColor: "var(--app-soft-card-border)",
                          backgroundColor: "color-mix(in srgb, var(--app-soft-card-bg) 70%, transparent)",
                        }}
                        data-testid="agent-inline-markdown-preview"
                      >
                        <pre className="whitespace-pre-wrap font-sans">{card.artifact.markdownContent}</pre>
                      </div>
                      <button
                        type="button"
                        onClick={() => onOpenArtifact(card.artifact!.id)}
                        className="rounded-lg border px-3 py-1.5 text-[11px] font-semibold transition-colors hover:opacity-95"
                        style={{
                          borderColor: "var(--app-soft-card-border)",
                          backgroundColor: "var(--app-soft-card-bg)",
                          color: "var(--app-accent)",
                        }}
                        data-testid="button-open-agent-artifact"
                      >
                        View Full
                      </button>
                    </div>
                  </div>
                ) : hasArtifact && card.artifact ? (
                  <div
                    className="relative overflow-hidden rounded-xl border p-4"
                    style={{
                      borderColor: "var(--app-soft-card-border)",
                      background:
                        "radial-gradient(120% 100% at 12% 10%, color-mix(in srgb, var(--app-accent) 14%, transparent) 0%, transparent 56%), color-mix(in srgb, var(--app-soft-card-bg) 80%, transparent)",
                    }}
                  >
                    <div className="space-y-2">
                      <div className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide opacity-70">
                        {card.artifact.type === "web_app" ? (
                          <Globe className="h-3 w-3" />
                        ) : (
                          <Sparkles className="h-3 w-3" />
                        )}
                        {card.artifact.type === "web_app" ? "Web app" : "Ready"}
                      </div>
                      <p className="text-sm font-semibold">{card.artifact.title}</p>
                      <p className="text-xs opacity-75">{outputSummary}</p>
                      <button
                        type="button"
                        onClick={() => onOpenArtifact(card.artifact!.id)}
                        className="rounded-lg border px-3 py-1.5 text-[11px] font-semibold transition-colors hover:opacity-95"
                        style={{
                          borderColor: "var(--app-soft-card-border)",
                          backgroundColor: "var(--app-soft-card-bg)",
                          color: "var(--app-accent)",
                        }}
                        data-testid="button-open-agent-artifact"
                      >
                        {card.artifact.type === "mini_game"
                          ? "View / Play"
                          : card.artifact.type === "web_app"
                            ? "View / Launch"
                            : "View"}
                      </button>
                    </div>
                  </div>
                ) : card.status === "failed" ? (
                  <div
                    className="rounded-xl border p-4"
                    style={{
                      borderColor: "color-mix(in srgb, var(--app-accent) 42%, #ef4444)",
                      backgroundColor:
                        "color-mix(in srgb, var(--app-soft-card-bg) 84%, transparent)",
                    }}
                    data-testid="agent-task-failure-panel"
                  >
                    <div className="mb-2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide opacity-85">
                      <AlertTriangle className="h-3 w-3" />
                      Failure diagnostics
                    </div>
                    <p className="text-sm font-semibold">
                      {failure?.reason ||
                        card.summaryText ||
                        card.latestStep?.detail ||
                        "This task failed before publishing output."}
                    </p>
                    <div className="mt-3 grid grid-cols-1 gap-1.5 text-[11px] opacity-80">
                      {failure?.stage ? <p>Stage: {failure.stage}</p> : null}
                      {failure?.toolName ? <p>Tool: {failure.toolName}</p> : null}
                      {failure?.code ? <p>Code: {failure.code}</p> : null}
                      {failure?.traceId ? (
                        <p className="break-all">Trace: {failure.traceId}</p>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="flex h-[200px] flex-col items-center justify-center gap-3 text-center">
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                      className="h-8 w-8 rounded-full border-2"
                      style={{
                        borderColor: "color-mix(in srgb, var(--app-soft-card-border) 50%, transparent)",
                        borderTopColor: "var(--app-accent)",
                      }}
                    />
                    <p className="text-xs opacity-60">Generating output...</p>
                  </div>
                )}

                {approvalPending && card.approval && (
                  <div
                    className="mt-3 space-y-2 rounded-xl border p-3"
                    style={{
                      borderColor: "var(--app-soft-card-border)",
                      backgroundColor: "color-mix(in srgb, var(--app-soft-card-bg) 82%, transparent)",
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4" />
                      <p className="text-xs font-semibold uppercase tracking-wide">
                        Approval required
                      </p>
                    </div>
                    <p className="text-xs opacity-80">{card.approval.requestedAction}</p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void handleApproval(true)}
                        disabled={isResolvingApproval}
                        className="rounded-lg border px-2.5 py-1.5 text-xs font-semibold disabled:opacity-60"
                        style={{
                          borderColor: "var(--app-soft-card-border)",
                          backgroundColor: "var(--app-soft-card-bg)",
                          color: "var(--app-accent)",
                        }}
                        data-testid="button-agent-approve"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleApproval(false)}
                        disabled={isResolvingApproval}
                        className="rounded-lg border px-2.5 py-1.5 text-xs font-semibold disabled:opacity-60"
                        style={{
                          borderColor: "var(--app-soft-card-border)",
                          backgroundColor: "transparent",
                        }}
                        data-testid="button-agent-deny"
                      >
                        Deny
                      </button>
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === "process" && (
              <motion.div
                key="tab-process"
                variants={tabAnimVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{ duration: 0.2 }}
                className="max-h-[320px] overflow-y-auto p-3"
              >
                <div className="space-y-1" data-testid="agent-task-process-timeline">
                  {timeline.length === 0 ? (
                    <div className="flex h-[160px] items-center justify-center">
                      <p className="text-xs opacity-50">
                        Activity will appear here as Zee works.
                      </p>
                    </div>
                  ) : (
                    timeline.slice(-5).map((item, idx, arr) => {
                      const visual = toTimelineVisual(item.status);
                      const isLast = idx === arr.length - 1;
                      return (
                        <motion.div
                          key={item.id}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: idx * 0.04, duration: 0.25 }}
                          className="flex gap-3 py-2"
                        >
                          <div className="flex flex-col items-center">
                            <div
                              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
                              style={{
                                backgroundColor: `color-mix(in srgb, ${visual.color} 18%, transparent)`,
                                color: visual.color,
                              }}
                            >
                              {visual.icon}
                            </div>
                            {!isLast && (
                              <div
                                className="mt-1 w-px flex-1"
                                style={{
                                  backgroundColor: "color-mix(in srgb, var(--app-soft-card-border) 60%, transparent)",
                                }}
                              />
                            )}
                          </div>
                          <div className="min-w-0 flex-1 pb-2">
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-xs font-semibold leading-tight" style={{ color: "var(--app-on-dark)" }}>{item.title}</p>
                              <span className="shrink-0 text-[10px]" style={{ color: "var(--app-on-dark-muted)" }}>
                                {formatTimelineTimeLabel(item.createdAt)}
                              </span>
                            </div>
                            {item.detail && (
                              <p className="mt-0.5 text-[11px] leading-relaxed" style={{ color: "var(--app-on-dark-muted)" }}>
                                {item.detail}
                              </p>
                            )}
                          </div>
                        </motion.div>
                      );
                    })
                  )}
                  {timeline.length > 5 && (
                    <button
                      type="button"
                      onClick={() => setIsInfoOpen(true)}
                      className="mt-1 w-full text-center text-[11px] font-semibold opacity-50 transition-opacity hover:opacity-80"
                      style={{ color: "var(--app-accent)" }}
                      data-testid="agent-task-view-all-activity"
                    >
                      View all {timeline.length} steps
                    </button>
                  )}
                </div>

                {detailTools.length > 0 && (
                  <div className="mt-2 space-y-1.5 border-t pt-2" style={{ borderColor: "var(--app-soft-card-border)" }}>
                    <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--app-on-dark-muted)" }}>
                      Services Used
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {detailTools.map((toolCall) => (
                        <span
                          key={`tool-chip-${toolCall.id}`}
                          className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium"
                          style={{
                            borderColor: "color-mix(in srgb, var(--app-accent) 30%, var(--app-soft-card-border))",
                            backgroundColor: "color-mix(in srgb, var(--app-accent) 8%, transparent)",
                            color: "var(--app-accent)",
                          }}
                        >
                          <Globe className="h-2.5 w-2.5" />
                          {toolCall.toolName}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === "terminal" && (
              <motion.div
                key="tab-terminal"
                variants={tabAnimVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{ duration: 0.2 }}
                className="flex flex-col"
              >
                <div
                  className="flex items-center gap-2 border-b px-3 py-2"
                  style={{ borderColor: "var(--app-soft-card-border)" }}
                >
                  <Terminal className="h-3.5 w-3.5 opacity-60" />
                  <span className="text-[11px] font-bold tracking-wide opacity-70">
                    Zee's Computer & IDE
                  </span>
                  <div className="ml-auto flex gap-1">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: "#ef4444", opacity: 0.6 }} />
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: "#f59e0b", opacity: 0.6 }} />
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: "#22c55e", opacity: 0.6 }} />
                  </div>
                </div>
                <div
                  className="max-h-[280px] overflow-y-auto px-3 py-2 font-mono text-[11px] leading-[1.7]"
                  style={{
                    backgroundColor: "color-mix(in srgb, #000000 80%, var(--app-panel-bg))",
                    color: "color-mix(in srgb, var(--app-accent) 60%, #a0ffa0)",
                  }}
                  data-testid="agent-task-terminal-view"
                >
                  {terminalLines.length === 0 ? (
                    <div className="flex h-[160px] items-center justify-center font-sans">
                      <p className="text-xs opacity-40">
                        Terminal output will appear here.
                      </p>
                    </div>
                  ) : (
                    terminalLines.map((line, idx) => (
                      <motion.div
                        key={`term-${idx}`}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: idx * 0.05, duration: 0.2 }}
                        className={cn(
                          line.type === "cmd" && "font-semibold",
                          line.type === "warn" && "opacity-70",
                        )}
                        style={{
                          color:
                            line.type === "cmd"
                              ? "color-mix(in srgb, var(--app-accent) 70%, #ffffff)"
                              : line.type === "success"
                                ? "#4ade80"
                                : line.type === "warn"
                                  ? "#fbbf24"
                                  : undefined,
                        }}
                      >
                        {line.text}
                      </motion.div>
                    ))
                  )}
                  <motion.span
                    className="inline-block h-3 w-1.5 align-middle"
                    style={{ backgroundColor: "var(--app-accent)" }}
                    animate={{ opacity: [1, 0, 1] }}
                    transition={{ duration: 1, repeat: Infinity }}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Dialog open={isInfoOpen} onOpenChange={setIsInfoOpen}>
        <DialogContent
          className="fixed left-1/2 top-1/2 w-[calc(100%-1.5rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border p-0 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
          style={{
            borderColor: "var(--app-soft-card-border)",
            backgroundColor: "var(--app-panel-bg)",
            color: "var(--app-on-dark)",
          }}
          data-testid="agent-task-info-dialog"
        >
          <div className="flex items-center justify-between gap-3 border-b px-4 pb-3 pt-4" style={{ borderColor: "var(--app-soft-card-border)" }}>
            <DialogHeader className="space-y-0.5 text-left p-0">
              <DialogTitle className="text-sm font-bold" style={{ color: "var(--app-on-dark)" }}>
                Task Timeline
              </DialogTitle>
              <DialogDescription className="text-[11px] line-clamp-1" style={{ color: "var(--app-on-dark-muted)" }}>
                {card.title}
              </DialogDescription>
            </DialogHeader>
            <span
              className="shrink-0 rounded-full border px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
              style={{
                borderColor: "color-mix(in srgb, var(--app-soft-card-border) 75%, transparent)",
                backgroundColor: "color-mix(in srgb, var(--app-soft-card-bg) 65%, transparent)",
                color: statusTone,
              }}
            >
              {statusLabel}
            </span>
          </div>

          {taskDetailQuery.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-xs" style={{ color: "var(--app-on-dark-muted)" }}>
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading timeline...
            </div>
          ) : (
            <div className="max-h-[55dvh] overflow-y-auto px-4 py-3">
              {timeline.length === 0 ? (
                <p className="py-6 text-center text-xs" style={{ color: "var(--app-on-dark-muted)" }}>No activity logged yet.</p>
              ) : (
                <div className="relative pl-7">
                  <div
                    className="absolute left-[9px] top-3 bottom-3 w-px"
                    style={{ backgroundColor: "color-mix(in srgb, var(--app-soft-card-border) 80%, transparent)" }}
                  />
                  {timeline.map((item, idx) => {
                    const visual = toTimelineVisual(item.status);
                    const isLast = idx === timeline.length - 1;
                    return (
                      <div
                        key={`timeline-dialog-${item.id}`}
                        className={cn("relative", !isLast && "pb-4")}
                        data-testid="agent-task-timeline-row"
                      >
                        <div
                          className="absolute -left-7 flex h-[18px] w-[18px] items-center justify-center rounded-full"
                          style={{
                            backgroundColor: `color-mix(in srgb, ${visual.color} 20%, var(--app-panel-bg))`,
                            color: visual.color,
                            boxShadow: `0 0 0 3px var(--app-panel-bg)`,
                          }}
                        >
                          <span className="flex h-2.5 w-2.5 items-center justify-center [&>svg]:h-2.5 [&>svg]:w-2.5">{visual.icon}</span>
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-[12px] font-semibold leading-tight" style={{ color: "var(--app-on-dark)" }}>
                              {item.title}
                            </p>
                            <span className="shrink-0 text-[10px] pt-px" style={{ color: "var(--app-on-dark-muted)" }}>
                              {formatTimelineTimeLabel(item.createdAt)}
                            </span>
                          </div>
                          {item.detail && (
                            <p
                              className="mt-1 rounded-lg border px-2.5 py-1.5 text-[11px] leading-relaxed"
                              style={{
                                color: "var(--app-on-dark-muted)",
                                borderColor: "color-mix(in srgb, var(--app-soft-card-border) 50%, transparent)",
                                backgroundColor: "color-mix(in srgb, var(--app-soft-card-bg) 40%, transparent)",
                              }}
                            >
                              {item.detail}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {detailTools.length > 0 && (
                <div className="mt-3 border-t pt-3" style={{ borderColor: "var(--app-soft-card-border)" }}>
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--app-on-dark-muted)" }}>
                    Services Used
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {detailTools.map((toolCall) => (
                      <span
                        key={`tool-chip-dialog-${toolCall.id}`}
                        className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-medium"
                        style={{
                          borderColor: "color-mix(in srgb, var(--app-accent) 30%, var(--app-soft-card-border))",
                          backgroundColor: "color-mix(in srgb, var(--app-accent) 8%, transparent)",
                          color: "var(--app-accent)",
                        }}
                      >
                        <Globe className="h-2.5 w-2.5" />
                        {toolCall.toolName}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

const TextView = ({
  messages,
  isStreamingReply,
  persona,
  assistantAvatarSrc,
  webLookupStatus,
  webLookupLabel,
  mode,
  userProfileImage,
  onOpenArtifact,
  onResolveApproval,
  onResolveOffer,
  liveTaskSnapshots,
}: {
  messages: MessageData[];
  isStreamingReply: boolean;
  persona: Persona;
  assistantAvatarSrc: string;
  webLookupStatus: WebLookupStatus | null;
  webLookupLabel?: string | null;
  mode: Mode;
  userProfileImage?: string;
  onOpenArtifact: (artifactId: string) => void;
  onResolveApproval: (
    taskId: string,
    approve: boolean,
    reason?: string,
  ) => Promise<void>;
  onResolveOffer: (offerId: string, accept: boolean) => Promise<void>;
  liveTaskSnapshots: Record<string, LiveTaskSnapshot>;
}) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [showJumpToNewest, setShowJumpToNewest] = useState(false);
  const shouldAutoStickRef = useRef(true);

  const scrollToBottom = (smooth: boolean) => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: smooth ? "smooth" : "auto",
    });
  };

  const handleScroll = () => {
    const node = scrollRef.current;
    if (!node) return;
    const nearBottom = node.scrollHeight - (node.scrollTop + node.clientHeight) < 120;
    shouldAutoStickRef.current = nearBottom;
    setShowJumpToNewest(!nearBottom);
  };

  useEffect(() => {
    scrollToBottom(false);
    shouldAutoStickRef.current = true;
    setShowJumpToNewest(false);
  }, []);

  const visibleMessages = useMemo(
    () =>
      ENABLE_AGENTIC_CREATIONS
        ? messages
        : messages.filter((message) => !isAgentUiPayload(message.uiPayload)),
    [messages],
  );

  useEffect(() => {
    if (shouldAutoStickRef.current) {
      scrollToBottom(isStreamingReply);
      setShowJumpToNewest(false);
    }
  }, [visibleMessages, isStreamingReply]);

  const latestAssistantText =
    [...visibleMessages]
      .reverse()
      .find((msg) => msg.sender === "assistant")
      ?.text ?? "";

  const renderItems = useMemo(() => {
    if (!ENABLE_AGENTIC_CREATIONS || !ENABLE_UNIFIED_AGENT_TASK_CARD) {
      return visibleMessages.map((message) => ({
        kind: "message",
        message,
      })) as TextRenderItem[];
    }
    return buildUnifiedAgentTaskCards(visibleMessages, liveTaskSnapshots);
  }, [visibleMessages, liveTaskSnapshots]);

  return (
    <div
      className="h-full relative flex flex-col"
      style={{ backgroundColor: "var(--app-panel-bg)" }}
    >
      <div
        className="absolute inset-x-0 top-0 pointer-events-none"
        style={{ height: "clamp(6.5rem, 19vh, 10rem)" }}
        aria-hidden="true"
      />
      <div className="sr-only" aria-live="polite">
        {isStreamingReply && !latestAssistantText
          ? `${persona} is typing`
          : latestAssistantText}
      </div>
      <AnimatePresence>
        {webLookupStatus && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.96 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            className="absolute left-1/2 z-20 -translate-x-1/2 rounded-full border px-3 py-1.5 text-[11px] font-medium tracking-wide backdrop-blur-md"
            style={{
              top: "clamp(5.3rem, 16vh, 7.4rem)",
              borderColor:
                webLookupStatus === "searching"
                  ? "color-mix(in srgb, #4285F4 30%, transparent)"
                  : "color-mix(in srgb, var(--app-soft-card-border) 74%, transparent)",
              backgroundColor: "color-mix(in srgb, var(--app-soft-card-bg) 88%, transparent)",
              color: "var(--app-on-dark-muted)",
            }}
          >
            {webLookupStatus === "searching" ? (
              <span className="flex items-center gap-2">
                <span className="flex items-center gap-0.5">
                  {["#4285F4", "#EA4335", "#FBBC05", "#34A853"].map((c, i) => (
                    <motion.span
                      key={c}
                      className="inline-block h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: c }}
                      animate={{ opacity: [0.4, 1, 0.4], scale: [0.8, 1.15, 0.8] }}
                      transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.12 }}
                    />
                  ))}
                </span>
                {webLookupLabel ?? "Searching the web…"}
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <Globe className="h-3 w-3" style={{ color: "var(--app-accent)" }} />
                {webLookupLabel ?? "Web-checked"}
              </span>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4"
        style={{
          paddingTop: "clamp(6.75rem, 19vh, 10rem)",
          paddingBottom: "max(5.5rem, calc(env(safe-area-inset-bottom) + 4.5rem))",
        }}
      >
        <div className="space-y-4 pb-8">
          {renderItems.map((item, idx) => {
            const msg = item.message;
            const isUnifiedTaskCard = item.kind === "agent_unified_task";
            return (
            <motion.div
              key={
                isUnifiedTaskCard
                  ? `agent-card-${item.card.taskId}-${msg.id}`
                  : msg.id
              }
              initial={{ opacity: 0, y: 16, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{
                type: "spring",
                stiffness: 400,
                damping: 30,
                delay: msg.sender !== "user" && msg.partIndex && msg.partIndex > 0
                  ? msg.partIndex * 0.15
                  : 0,
              }}
              className={cn(
                "flex w-full",
                msg.sender === "user" ? "justify-end" : "justify-start",
              )}
            >
              <div
                className={cn(
                  "flex items-end gap-2",
                  isUnifiedTaskCard ? "max-w-[88%]" : "max-w-[80%]",
                )}
              >
                {msg.sender !== "user" && (
                  <Avatar
                    className="w-8 h-8 mb-1 shrink-0 ring-2"
                    style={{ boxShadow: "0 0 0 2px var(--app-soft-card-border)" }}
                  >
                    <AvatarImage src={assistantAvatarSrc} className="object-cover" />
                    <AvatarFallback>{persona[0]}</AvatarFallback>
                  </Avatar>
                )}
                <div
                  className={cn(
                    "text-sm leading-relaxed",
                    !isUnifiedTaskCard && "rounded-2xl shadow-sm",
                    !isUnifiedTaskCard &&
                      (msg.sender === "user"
                        ? "font-medium rounded-br-none"
                        : "rounded-bl-none"),
                  )}
                  style={
                    isUnifiedTaskCard
                      ? undefined
                      : msg.sender === "user"
                      ? {
                          backgroundColor: "var(--app-user-bubble-bg)",
                          color: "var(--app-user-bubble-text)",
                        }
                      : {
                          backgroundColor: "var(--app-assistant-bubble-bg)",
                          color: "var(--app-assistant-bubble-text)",
                        }
                  }
                >
                  {!isUnifiedTaskCard && (msg.attachments ?? []).length > 0 && (
                    <div className="grid gap-2 p-2">
                      {(msg.attachments ?? []).map((attachment) => (
                        <img
                          key={attachment.id}
                          src={attachment.signedUrl}
                          alt="Shared attachment"
                          className="max-h-48 w-full rounded-xl object-cover"
                        />
                      ))}
                    </div>
                  )}
                  <div className={isUnifiedTaskCard ? "" : `px-5 py-3 ${msg.sender === "user" ? "whitespace-pre-wrap" : ""}`}>
                    {msg.isTyping ? (() => {
                      const prevUserMsg = renderItems.slice(0, idx).reverse().find(i => i.message.sender === "user");
                      const isBriefLoading = prevUserMsg?.message.text?.toLowerCase().includes("morning brief");
                      return isBriefLoading ? (
                      <div className="flex items-center gap-2 py-1.5">
                        <motion.div
                          animate={{ rotate: 360 }}
                          transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                        >
                          <Globe className="h-4 w-4" style={{ color: "var(--app-accent, #DAA112)" }} />
                        </motion.div>
                        <span className="text-[12px] font-medium" style={{ color: "var(--app-assistant-bubble-text)", opacity: 0.8 }}>
                          Fetching your briefing
                        </span>
                        <motion.span
                          className="h-1 w-1 rounded-full"
                          style={{ backgroundColor: "var(--app-accent, #DAA112)" }}
                          animate={{ opacity: [0.3, 1, 0.3] }}
                          transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
                        />
                        <motion.span
                          className="h-1 w-1 rounded-full"
                          style={{ backgroundColor: "var(--app-accent, #DAA112)" }}
                          animate={{ opacity: [0.3, 1, 0.3] }}
                          transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut", delay: 0.3 }}
                        />
                        <motion.span
                          className="h-1 w-1 rounded-full"
                          style={{ backgroundColor: "var(--app-accent, #DAA112)" }}
                          animate={{ opacity: [0.3, 1, 0.3] }}
                          transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut", delay: 0.6 }}
                        />
                      </div>
                      ) : (
                      <div className="flex items-center gap-1.5 py-1">
                        <motion.span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: "color-mix(in srgb, var(--app-assistant-bubble-text) 60%, transparent)" }}
                          animate={{ y: [0, -4, 0], opacity: [0.4, 1, 0.4] }}
                          transition={{ duration: 0.8, repeat: Infinity, ease: "easeInOut" }}
                        />
                        <motion.span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: "color-mix(in srgb, var(--app-assistant-bubble-text) 60%, transparent)" }}
                          animate={{ y: [0, -4, 0], opacity: [0.4, 1, 0.4] }}
                          transition={{ duration: 0.8, repeat: Infinity, ease: "easeInOut", delay: 0.15 }}
                        />
                        <motion.span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: "color-mix(in srgb, var(--app-assistant-bubble-text) 60%, transparent)" }}
                          animate={{ y: [0, -4, 0], opacity: [0.4, 1, 0.4] }}
                          transition={{ duration: 0.8, repeat: Infinity, ease: "easeInOut", delay: 0.3 }}
                        />
                      </div>
                      );
                    })() : isUnifiedTaskCard ? (
                      <UnifiedAgentTaskCard
                        card={item.card}
                        onOpenArtifact={onOpenArtifact}
                        onResolveApproval={onResolveApproval}
                      />
                    ) : isAgentOfferPayload(msg.uiPayload) ? (
                      <div
                        className="space-y-2"
                        data-testid="agent-offer-card"
                        data-agent-offer-status={msg.uiPayload.offer.status}
                        data-agent-offer-id={msg.uiPayload.offer.id}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-semibold uppercase tracking-wide opacity-75">
                            Suggested build
                          </span>
                          <span className="text-[11px] font-semibold">
                            {msg.uiPayload.offer.status === "pending"
                              ? "Needs your choice"
                              : msg.uiPayload.offer.status === "accepted"
                                ? "Accepted"
                                : msg.uiPayload.offer.status === "declined"
                                  ? "Skipped"
                                  : "Expired"}
                          </span>
                        </div>
                        <p className="text-sm font-semibold">{msg.uiPayload.offer.title}</p>
                        <p className="text-xs opacity-85">{msg.uiPayload.offer.summary}</p>
                        {msg.uiPayload.offer.status === "pending" ? (
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                const offerPayload = msg.uiPayload as Extract<
                                  AgentMessageUiPayload,
                                  { kind: "agent_offer" }
                                >;
                                void onResolveOffer(offerPayload.offer.id, true);
                              }}
                              className="rounded-lg border px-2.5 py-1.5 text-xs font-semibold"
                              style={{
                                borderColor: "var(--app-soft-card-border)",
                                backgroundColor: "var(--app-soft-card-bg)",
                              }}
                              data-testid="button-agent-offer-accept"
                            >
                              Yes, build it
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const offerPayload = msg.uiPayload as Extract<
                                  AgentMessageUiPayload,
                                  { kind: "agent_offer" }
                                >;
                                void onResolveOffer(offerPayload.offer.id, false);
                              }}
                              className="rounded-lg border px-2.5 py-1.5 text-xs font-semibold"
                              style={{
                                borderColor: "var(--app-soft-card-border)",
                                backgroundColor: "transparent",
                              }}
                              data-testid="button-agent-offer-decline"
                            >
                              Not now
                            </button>
                          </div>
                        ) : (
                          <p className="text-xs opacity-80">{sanitizeSplitTokenArtifacts(msg.text)}</p>
                        )}
                      </div>
                    ) : isAgentTaskStatusPayload(msg.uiPayload) ? (
                      <div
                        className="space-y-2"
                        data-testid="agent-task-status-card"
                        data-agent-task-id={msg.uiPayload.task.id}
                        data-agent-task-status={msg.uiPayload.task.status}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-semibold uppercase tracking-wide opacity-75">
                            Agent task
                          </span>
                          <span className="text-[11px] font-semibold">
                            {toTaskStatusLabel(msg.uiPayload.task.status)}
                          </span>
                        </div>
                        <p className="text-sm font-medium">{msg.uiPayload.text}</p>
                        {msg.uiPayload.latestStep && (
                          <div className="rounded-lg border border-black/10 bg-black/5 px-3 py-2 text-xs">
                            <p className="font-semibold">{msg.uiPayload.latestStep.title}</p>
                            <p className="opacity-80">{msg.uiPayload.latestStep.detail}</p>
                          </div>
                        )}
                      </div>
                    ) : isAgentApprovalPayload(msg.uiPayload) ? (
                      <div
                        className="space-y-2"
                        data-testid="agent-approval-card"
                        data-agent-task-id={msg.uiPayload.taskId}
                      >
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4" />
                          <p className="text-sm font-semibold">Approval required</p>
                        </div>
                        <p className="text-xs opacity-85">
                          {msg.uiPayload.approval.requestedAction}
                        </p>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              const approvalPayload = msg.uiPayload as Extract<
                                AgentMessageUiPayload,
                                { kind: "agent_approval" }
                              >;
                              void onResolveApproval(approvalPayload.taskId, true);
                            }}
                            className="rounded-lg border px-2.5 py-1.5 text-xs font-semibold"
                            style={{
                              borderColor: "var(--app-soft-card-border)",
                              backgroundColor: "var(--app-soft-card-bg)",
                            }}
                            data-testid="button-agent-approve"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const approvalPayload = msg.uiPayload as Extract<
                                AgentMessageUiPayload,
                                { kind: "agent_approval" }
                              >;
                              void onResolveApproval(
                                approvalPayload.taskId,
                                false,
                                "Denied from chat card",
                              );
                            }}
                            className="rounded-lg border px-2.5 py-1.5 text-xs font-semibold"
                            style={{
                              borderColor: "var(--app-soft-card-border)",
                              backgroundColor: "transparent",
                            }}
                            data-testid="button-agent-deny"
                          >
                            Deny
                          </button>
                        </div>
                      </div>
                    ) : isAgentArtifactPayload(msg.uiPayload) ? (
                      <div
                        className="space-y-2"
                        data-testid="agent-artifact-card"
                        data-agent-artifact-id={msg.uiPayload.artifact.id}
                        data-agent-artifact-type={msg.uiPayload.artifact.type}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            {msg.uiPayload.artifact.type === "mini_game" ? (
                              <Play className="h-4 w-4" />
                            ) : msg.uiPayload.artifact.type === "web_app" ? (
                              <Globe className="h-4 w-4" />
                            ) : (
                              <FileText className="h-4 w-4" />
                            )}
                            <p className="text-sm font-semibold">
                              {msg.uiPayload.artifact.title}
                            </p>
                          </div>
                          <span className="text-[11px] uppercase tracking-wide opacity-70">
                            {msg.uiPayload.artifact.type === "mini_game"
                              ? "Game"
                              : msg.uiPayload.artifact.type === "web_app"
                                ? "Web App"
                              : "Doc"}
                          </span>
                        </div>
                        <p className="text-xs opacity-80">{sanitizeSplitTokenArtifacts(msg.text)}</p>
                        <button
                          type="button"
                          onClick={() => {
                            const artifactPayload = msg.uiPayload as Extract<
                              AgentMessageUiPayload,
                              { kind: "agent_artifact" }
                            >;
                            onOpenArtifact(artifactPayload.artifact.id);
                          }}
                          className="rounded-lg border px-2.5 py-1.5 text-xs font-semibold"
                          style={{
                            borderColor: "var(--app-soft-card-border)",
                            backgroundColor: "var(--app-soft-card-bg)",
                          }}
                          data-testid="button-open-agent-artifact"
                        >
                          {msg.uiPayload.artifact.type === "mini_game"
                            ? "View / Play"
                            : msg.uiPayload.artifact.type === "web_app"
                              ? "View / Launch"
                            : "View"}
                        </button>
                      </div>
                    ) : (
                      msg.sender === "assistant" ? renderSimpleMarkdown(sanitizeSplitTokenArtifacts(msg.text)) : msg.text
                    )}
                  </div>
                </div>
                {msg.sender === "user" && (
                  <div
                    className="w-8 h-8 rounded-full border flex items-center justify-center mb-1 text-xs font-bold overflow-hidden flex-shrink-0"
                    style={{
                      backgroundColor: "var(--app-soft-card-bg)",
                      borderColor: "var(--app-accent)",
                      color: "var(--app-accent)",
                    }}
                  >
                    {userProfileImage ? (
                      <img src={userProfileImage} alt="" className="w-full h-full object-cover" />
                    ) : (
                      "U"
                    )}
                  </div>
                )}
              </div>
            </motion.div>
            );
          })}
        </div>
      </div>
      {mode === "text" && showJumpToNewest && (
        <button
          type="button"
          onClick={() => {
            shouldAutoStickRef.current = true;
            scrollToBottom(true);
            setShowJumpToNewest(false);
          }}
          className="absolute bottom-28 left-1/2 -translate-x-1/2 rounded-full border px-3 py-1 text-xs backdrop-blur-sm"
          style={{
            borderColor: "var(--app-soft-card-border)",
            backgroundColor: "var(--app-soft-card-bg)",
            color: "var(--app-on-dark)",
          }}
        >
          Jump to newest
        </button>
      )}
    </div>
  );
};

const ArtifactViewer = ({
  artifact,
  isLoading,
  onClose,
  onRetry,
}: {
  artifact: AgentArtifactSummary | null;
  isLoading: boolean;
  onClose: () => void;
  onRetry: () => void;
}) => {
  const isGame = artifact?.type === "mini_game";
  const isWebApp = artifact?.type === "web_app";
  const isDocArtifact = artifact?.type === "doc_markdown";
  const hasHtmlContent =
    typeof artifact?.htmlContent === "string" && artifact.htmlContent.trim().length > 0;
  const hasRenderSpec = Boolean(
    artifact?.metadata &&
      typeof artifact.metadata === "object" &&
      !Array.isArray(artifact.metadata) &&
      (artifact.metadata as Record<string, unknown>).render,
  );
  const shouldUseJsonRenderViewer =
    Boolean(artifact) &&
    !isGame &&
    !isWebApp &&
    isDocArtifact &&
    ENABLE_JSON_RENDER_ARTIFACT_VIEWER &&
    hasRenderSpec;
  const canRenderIframe = hasHtmlContent && (isGame || isWebApp || !shouldUseJsonRenderViewer);
  const markdown = artifact?.markdownContent ?? "";
  const [iframeKey, setIframeKey] = useState(0);
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  const generationMetadata = (artifact?.metadata as
    | { generation?: { format?: string } }
    | undefined)?.generation;
  const isPresentation = generationMetadata?.format === "presentation";
  const artifactLabel = isGame
    ? "Mini Game"
    : isWebApp
      ? "Web App"
      : isPresentation
        ? "Presentation"
        : "Document";

  const iframeSrc = useMemo(() => {
    if (!canRenderIframe || !artifact?.id) return null;
    return `/api/agent/artifacts/${artifact.id}/render?v=${iframeKey}`;
  }, [canRenderIframe, artifact?.id, iframeKey]);

  const handleReload = () => {
    setIframeKey((k) => k + 1);
  };

  const downloadMarkdown = () => {
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${(artifact?.title ?? "document").replace(/\\s+/g, "-").toLowerCase()}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const downloadArtifactPdf = async () => {
    if (!artifact?.id || isExportingPdf) return;
    setIsExportingPdf(true);
    try {
      const response = await fetch(
        `/api/agent/artifacts/${artifact.id}/export.pdf`,
        {
          credentials: "include",
          headers: {
            "x-trace-id": createRequestTraceId(),
          },
        },
      );
      if (!response.ok) {
        const text = (await response.text()) || response.statusText;
        throw new Error(text);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${(artifact.title ?? "presentation")
        .replace(/\s+/g, "-")
        .toLowerCase()}.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("artifact.pdf.export.failed", error);
    } finally {
      setIsExportingPdf(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-[95] flex flex-col"
      style={{
        backgroundColor: "var(--app-panel-bg)",
        color: "var(--app-on-dark)",
      }}
    >
      <div
        className="flex items-center justify-between border-b px-4 py-3"
        style={{ borderColor: "var(--app-soft-card-border)" }}
      >
        <div>
          <p className="text-xs uppercase tracking-wide opacity-70">
            {artifactLabel}
          </p>
          <h3 className="text-base font-semibold">{artifact?.title ?? "Loading..."}</h3>
        </div>
        <div className="flex items-center gap-2">
          {(isGame || isWebApp) && canRenderIframe && (
            <button
              type="button"
              onClick={handleReload}
              className="rounded-lg border px-3 py-1.5 text-xs font-semibold"
              style={{
                borderColor: "var(--app-soft-card-border)",
                backgroundColor: "var(--app-soft-card-bg)",
              }}
              data-testid="button-reload-game"
            >
              Reload
            </button>
          )}
          {!isGame && !isWebApp && artifact && (
            <>
              {!isPresentation && (
                <button
                  type="button"
                  onClick={downloadMarkdown}
                  className="rounded-lg border px-3 py-1.5 text-xs font-semibold"
                  style={{
                    borderColor: "var(--app-soft-card-border)",
                    backgroundColor: "var(--app-soft-card-bg)",
                  }}
                >
                  Download Markdown
                </button>
              )}
              <button
                type="button"
                onClick={downloadArtifactPdf}
                disabled={isExportingPdf}
                className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
                style={{
                  borderColor: "var(--app-soft-card-border)",
                  backgroundColor: "var(--app-soft-card-bg)",
                }}
              >
                {isExportingPdf ? "Exporting..." : "Download PDF"}
              </button>
            </>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            data-testid="button-close-artifact-viewer"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-hidden p-3">
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
              className="w-8 h-8 border-4 rounded-full"
              style={{
                borderColor: "var(--app-soft-card-border)",
                borderTopColor: "var(--app-accent)",
              }}
            />
          </div>
        ) : shouldUseJsonRenderViewer && artifact ? (
          <JsonRenderArtifactViewer metadata={artifact.metadata} />
        ) : canRenderIframe && iframeSrc ? (
          <iframe
            key={iframeKey}
            title={artifact?.title ?? "Game"}
            sandbox="allow-scripts"
            src={iframeSrc}
            className="h-full w-full rounded-xl border"
            style={{
              borderColor: "var(--app-soft-card-border)",
              backgroundColor: "#0a0a0a",
            }}
          />
        ) : !artifact ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <p className="text-sm opacity-70">Could not load this content.</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onRetry}
                className="rounded-lg border px-3 py-1.5 text-xs font-semibold"
                style={{
                  borderColor: "var(--app-soft-card-border)",
                  backgroundColor: "var(--app-soft-card-bg)",
                  color: "var(--app-accent)",
                }}
                data-testid="button-retry-artifact"
              >
                Retry
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border px-3 py-1.5 text-xs font-semibold opacity-70"
                style={{
                  borderColor: "var(--app-soft-card-border)",
                  backgroundColor: "var(--app-soft-card-bg)",
                }}
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <div
            className="h-full overflow-auto rounded-xl border p-4 text-sm leading-relaxed"
            style={{
              borderColor: "var(--app-soft-card-border)",
              backgroundColor: "var(--app-soft-card-bg)",
            }}
          >
            <pre className="whitespace-pre-wrap font-sans">{markdown || "No content."}</pre>
          </div>
        )}
      </div>
    </motion.div>
  );
};

const OutputsHistoryView = ({
  artifacts,
  isLoading,
  onClose,
  onOpenArtifact,
  onArchiveArtifact,
  onDeleteArtifact,
}: {
  artifacts: AgentArtifactSummary[];
  isLoading: boolean;
  onClose: () => void;
  onOpenArtifact: (artifactId: string) => void;
  onArchiveArtifact: (artifactId: string) => void;
  onDeleteArtifact: (artifactId: string) => void;
}) => {
  return (
    <motion.div
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", damping: 28, stiffness: 220 }}
      className="absolute inset-0 z-[92] flex flex-col"
      style={{
        backgroundColor: "var(--app-panel-bg)",
        color: "var(--app-on-dark)",
      }}
    >
      <div
        className="flex items-center justify-between border-b px-4 py-3"
        style={{ borderColor: "var(--app-soft-card-border)" }}
      >
        <div>
          <p className="text-xs uppercase tracking-wide opacity-70">History</p>
          <h3 className="text-base font-semibold">Outputs</h3>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          data-testid="button-close-outputs-history"
        >
          <X className="h-5 w-5" />
        </Button>
      </div>
      <ScrollArea className="flex-1 px-4 py-4">
        {isLoading ? (
          <p className="text-sm opacity-70">Loading outputs...</p>
        ) : artifacts.length === 0 ? (
          <p className="text-sm opacity-70">No outputs yet. Ask Zee to craft something.</p>
        ) : (
          <div className="space-y-3 pb-6">
            {artifacts.map((artifact) => (
              <div
                key={artifact.id}
                className="rounded-xl border p-3"
                style={{
                  borderColor: "var(--app-soft-card-border)",
                  backgroundColor: "var(--app-soft-card-bg)",
                }}
                data-testid="outputs-history-artifact-card"
                data-agent-artifact-id={artifact.id}
                data-agent-artifact-type={artifact.type}
                data-agent-artifact-status={artifact.status}
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">{artifact.title}</p>
                    <p className="text-[11px] uppercase tracking-wide opacity-70">
                      {artifact.type === "mini_game"
                        ? "Game"
                        : artifact.type === "web_app"
                          ? "Web App"
                          : "Doc"}{" "}
                      · {artifact.status}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="rounded-md border px-2 py-1 text-[11px] font-semibold"
                    style={{ borderColor: "var(--app-soft-card-border)" }}
                    onClick={() => onOpenArtifact(artifact.id)}
                    data-testid="button-open-history-artifact"
                  >
                    {artifact.type === "mini_game"
                      ? "View/Play"
                      : artifact.type === "web_app"
                        ? "View/Launch"
                        : "View"}
                  </button>
                </div>
                <div className="flex gap-2">
                  {artifact.status !== "archived" && (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold"
                      style={{ borderColor: "var(--app-soft-card-border)" }}
                      onClick={() => onArchiveArtifact(artifact.id)}
                      data-testid="button-archive-history-artifact"
                    >
                      <Archive className="h-3.5 w-3.5" />
                      Archive
                    </button>
                  )}
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold"
                    style={{ borderColor: "var(--app-soft-card-border)" }}
                    onClick={() => onDeleteArtifact(artifact.id)}
                    data-testid="button-delete-history-artifact"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </motion.div>
  );
};

const OnboardingView = ({
  onComplete,
  userName,
}: {
  onComplete: () => void;
  userName?: string | null;
}) => {
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [relationshipIndex, setRelationshipIndex] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(() =>
    typeof window !== "undefined" ? window.innerHeight : 844,
  );
  const slide = ONBOARDING_STEPS[step];
  const dragX = useRef(0);
  const isFinalStep = step === ONBOARDING_STEPS.length - 1;
  const resolvedName = (userName?.trim().split(/\s+/)[0] || "Friend").slice(0, 20);
  const relationshipWord = ONBOARDING_RELATIONSHIP_WORDS[relationshipIndex];
  const isCompactHeight = viewportHeight <= 700;
  const isVeryCompactHeight = viewportHeight <= 620;
  const orbSize = isVeryCompactHeight ? 220 : isCompactHeight ? 260 : 320;
  const glowSize = isVeryCompactHeight ? 170 : isCompactHeight ? 220 : 256;
  const contentHorizontalPadding = isVeryCompactHeight ? "1rem" : "1.75rem";
  const contentTopPadding = isVeryCompactHeight
    ? "max(0.5rem, env(safe-area-inset-top))"
    : "max(0.85rem, env(safe-area-inset-top))";
  const contentBottomPadding = isVeryCompactHeight
    ? "max(0.6rem, env(safe-area-inset-bottom))"
    : "max(1rem, env(safe-area-inset-bottom))";

  const transitionVariants = {
    initial: (dir: number) => ({
      opacity: 0,
      x: dir > 0 ? 36 : -36,
      y: 16,
      filter: "blur(8px)",
    }),
    animate: {
      opacity: 1,
      x: 0,
      y: 0,
      filter: "blur(0px)",
    },
    exit: (dir: number) => ({
      opacity: 0,
      x: dir > 0 ? -24 : 24,
      y: -8,
      filter: "blur(8px)",
    }),
  };

  const goToStep = (nextStep: number, nextDirection: 1 | -1) => {
    if (nextStep < 0 || nextStep >= ONBOARDING_STEPS.length || nextStep === step) {
      return;
    }
    setDirection(nextDirection);
    setStep(nextStep);
  };

  const handleNext = () => {
    if (!isFinalStep) {
      goToStep(step + 1, 1);
    } else {
      onComplete();
    }
  };

  useEffect(() => {
    if (step !== 0) {
      return;
    }

    const rotationTimer = window.setInterval(() => {
      setRelationshipIndex((index) => (index + 1) % ONBOARDING_RELATIONSHIP_WORDS.length);
    }, 1700);

    return () => window.clearInterval(rotationTimer);
  }, [step]);

  useEffect(() => {
    if (step !== 0) {
      setRelationshipIndex(0);
    }
  }, [step]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => setViewportHeight(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <motion.div
      className="absolute inset-0 z-[100] overflow-hidden"
      animate={{ background: slide.bgGradient }}
      transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.08}
      onDrag={(_, info) => { dragX.current = info.offset.x; }}
      onDragEnd={() => {
        if (dragX.current < -50 && step < ONBOARDING_STEPS.length - 1) {
          goToStep(step + 1, 1);
        } else if (dragX.current > 50 && step > 0) {
          goToStep(step - 1, -1);
        }
        dragX.current = 0;
      }}
    >
      <motion.div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(circle at 15% 20%, rgba(255,255,255,0.34) 0 1px, transparent 1.3px), radial-gradient(circle at 77% 16%, rgba(255,255,255,0.28) 0 1px, transparent 1.3px), radial-gradient(circle at 85% 31%, rgba(255,255,255,0.22) 0 1.2px, transparent 1.4px), radial-gradient(circle at 26% 40%, rgba(255,255,255,0.18) 0 1px, transparent 1.4px), radial-gradient(circle at 73% 55%, rgba(255,255,255,0.18) 0 1px, transparent 1.4px), radial-gradient(circle at 40% 70%, rgba(255,255,255,0.15) 0 1.2px, transparent 1.5px)",
        }}
        animate={{
          opacity: [0.2, 0.36, 0.2],
          scale: [1, 1.03, 1],
        }}
        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
      />

      <motion.div
        className="absolute left-1/2 -translate-x-1/2 rounded-full blur-3xl pointer-events-none"
        style={{
          backgroundColor: slide.orbColor,
          top: isVeryCompactHeight ? "10%" : isCompactHeight ? "14%" : "18%",
          width: glowSize,
          height: glowSize,
        }}
        animate={{
          opacity: [0.35, 0.62, 0.35],
          scale: [0.9, 1.1, 0.9],
        }}
        transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
      />

      <motion.div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: "linear-gradient(to bottom, rgba(1,2,8,0.15), rgba(1,2,8,0.72))",
        }}
        animate={{ opacity: [0.68, 0.84, 0.68] }}
        transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
      />

      <div
        className="relative z-10 mx-auto flex h-full w-full max-w-[480px] flex-col justify-between"
        style={{
          paddingLeft: contentHorizontalPadding,
          paddingRight: contentHorizontalPadding,
          paddingTop: contentTopPadding,
          paddingBottom: contentBottomPadding,
        }}
      >
        <div
          className="flex flex-1 items-center justify-center w-full"
          style={{ minHeight: isVeryCompactHeight ? 180 : isCompactHeight ? 210 : 240 }}
        >
          <AnimatePresence custom={direction} mode="wait">
            <motion.div
              key={`orb-${slide.id}`}
              custom={direction}
              variants={transitionVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.52, ease: [0.22, 1, 0.36, 1] }}
              className="relative"
              style={{ marginTop: isVeryCompactHeight ? -12 : -4 }}
            >
              <motion.div
                className="absolute inset-[26%] rounded-full border"
                style={{ borderColor: slide.accentRing }}
                animate={{ scale: [0.88, 1.08, 0.88], opacity: [0.2, 0.7, 0.2] }}
                transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
              />
              <motion.div
                animate={{ y: [0, -7, 0] }}
                transition={{ duration: 4.4, repeat: Infinity, ease: "easeInOut" }}
              >
                <OnboardingOrb slide={slide} size={orbSize} />
              </motion.div>
            </motion.div>
          </AnimatePresence>
        </div>

        <div
          className="w-full z-10"
          style={{
            marginBottom: isVeryCompactHeight ? 2 : 10,
            display: "grid",
            gap: isVeryCompactHeight ? 12 : 18,
          }}
        >
          <div className="text-center" style={{ display: "grid", gap: isVeryCompactHeight ? 6 : 10 }}>
            <AnimatePresence custom={direction} mode="wait">
              <motion.div
                key={`text-${slide.id}`}
                custom={direction}
                variants={transitionVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              >
                {step === 0 ? (
                  <>
                    <h1
                      className={cn(
                        "font-serif font-semibold tracking-tight leading-tight",
                        isVeryCompactHeight
                          ? "text-[1.5rem] mb-1.5"
                          : isCompactHeight
                            ? "text-[1.72rem] mb-2"
                            : "text-[1.95rem] sm:text-[2.2rem] mb-2",
                      )}
                      style={{
                        color: slide.headlineColor,
                        display: "-webkit-box",
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                    >
                      <span>{`Welcome ${resolvedName}, I'm Zee, your `}</span>
                      <span className="inline-block align-baseline">
                        <AnimatePresence mode="wait">
                          <motion.span
                            key={relationshipWord}
                            initial={{ opacity: 0, y: 10, filter: "blur(6px)" }}
                            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                            exit={{ opacity: 0, y: -10, filter: "blur(6px)" }}
                            transition={{ duration: 0.32, ease: "easeOut" }}
                            className={cn(
                              "font-semibold tracking-tight",
                              isVeryCompactHeight
                                ? "text-[1.25rem]"
                                : isCompactHeight
                                  ? "text-[1.4rem]"
                                  : "text-[1.5rem] sm:text-[1.65rem]",
                            )}
                            style={{ color: slide.orbColor }}
                          >
                            {`${relationshipWord}.`}
                          </motion.span>
                        </AnimatePresence>
                      </span>
                    </h1>
                    <p
                      className={cn(
                        "leading-relaxed font-medium",
                        isVeryCompactHeight
                          ? "text-[1rem] mt-0.5"
                          : "text-[1.12rem] mt-1",
                      )}
                      style={{ color: slide.bodyColor }}
                    >
                      {slide.description}
                    </p>
                  </>
                ) : (
                  <>
                    <h1
                      className={cn(
                        "font-serif font-semibold tracking-tight",
                        isVeryCompactHeight
                          ? "text-[1.72rem] mb-2"
                          : isCompactHeight
                            ? "text-[1.92rem] mb-2.5"
                            : "text-[2.1rem] sm:text-[2.25rem] mb-3",
                      )}
                      style={{ color: slide.headlineColor }}
                    >
                      {slide.title}
                    </h1>
                    <p
                      className={cn(
                        "leading-relaxed font-medium",
                        isVeryCompactHeight ? "text-[1rem]" : "text-[1.12rem]",
                      )}
                      style={{ color: slide.bodyColor }}
                    >
                      {slide.description}
                    </p>
                  </>
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          <div className="flex justify-center gap-2.5">
            {ONBOARDING_STEPS.map((_, dotIdx) => (
              <motion.span
                key={dotIdx}
                className={cn(
                  "rounded-full",
                  isVeryCompactHeight ? "h-2 w-2" : "h-2.5 w-2.5",
                )}
                animate={{
                  scale: dotIdx === step ? 1.25 : 1,
                  opacity: dotIdx === step ? 1 : 0.58,
                  backgroundColor: dotIdx === step ? slide.orbColor : slide.dotInactive,
                }}
                transition={{ duration: 0.3, ease: "easeOut" }}
              />
            ))}
          </div>

          <div className={cn("flex items-center gap-3", isVeryCompactHeight ? "pt-0" : "pt-1")}>
            <Button
              variant="ghost"
              className={cn(
                "flex-1 rounded-2xl font-medium hover:bg-white/10",
                isVeryCompactHeight ? "h-12 text-[1.02rem]" : "h-14 text-[1.15rem]",
              )}
              style={{ color: slide.skipColor }}
              onClick={onComplete}
              data-testid="button-skip-onboarding"
            >
              Skip
            </Button>
            <Button
              className={cn(
                "flex-[1.8] rounded-2xl border font-semibold transition-transform active:scale-[0.98]",
                isVeryCompactHeight ? "h-12 text-[1.04rem]" : "h-14 text-[1.2rem]",
              )}
              style={{
                background: isFinalStep
                  ? `linear-gradient(135deg, ${slide.orbColor}, rgba(255,255,255,0.18))`
                  : slide.ctaBackground,
                borderColor: isFinalStep ? "rgba(255,255,255,0.32)" : slide.ctaBorder,
                color: isFinalStep ? "#0D1420" : slide.ctaText,
                boxShadow: `0 16px 40px ${slide.orbGlow}`,
                backdropFilter: "blur(10px)",
              }}
              onClick={handleNext}
              data-testid="button-next-onboarding"
            >
              {isFinalStep ? "Get Started" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

// --- Main App Component ---

function App() {
  const {
    user,
    isLoading: authLoading,
    isAuthenticated,
    login,
    register,
    loginError,
    registerError,
    isLoggingIn,
    isRegistering,
    logout,
  } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    applyAppTheme(DEFAULT_APP_THEME_ID);
  }, []);

  const [showMarketingLanding, setShowMarketingLanding] = useState(true);
  const [authEntryMode, setAuthEntryMode] = useState<"welcome" | "login">("welcome");

  const [mode, setMode] = useState<Mode>("voice");
  const [isCalling, setIsCalling] = useState(false);
  const [isLiveConnecting, setIsLiveConnecting] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showOutputsHistory, setShowOutputsHistory] = useState(false);
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null);
  const [liveTaskSnapshots, setLiveTaskSnapshots] = useState<
    Record<string, LiveTaskSnapshot>
  >({});
  const [duration, setDuration] = useState(0);
  const [callStartTime, setCallStartTime] = useState<number | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [isVideoEnabled, setIsVideoEnabled] = useState(false);
  const [isVideoTransitioning, setIsVideoTransitioning] = useState(false);
  const [cameraFacingMode, setCameraFacingMode] =
    useState<CameraFacingMode>("user");
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
  const [textWebLookupStatus, setTextWebLookupStatus] =
    useState<WebLookupStatus | null>(null);
  const [voiceWebLookupStatus, setVoiceWebLookupStatus] =
    useState<WebLookupStatus | null>(null);
  const [textWebLookupLabel, setTextWebLookupLabel] = useState<string | null>(
    null,
  );
  const [voiceWebLookupLabel, setVoiceWebLookupLabel] = useState<string | null>(
    null,
  );
  const [liveDebugState, setLiveDebugState] =
    useState<LiveVoiceDebugState | null>(null);
  const [liveTokenConfigSummary, setLiveTokenConfigSummary] =
    useState<LiveTokenConfigSummary | null>(null);
  const [liveTraceEntries, setLiveTraceEntries] = useState<LiveTraceEntry[]>([]);

  const [pendingAttachments, setPendingAttachments] = useState<
    PendingImageAttachment[]
  >([]);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const isSendingMessageRef = useRef(false);

  useEffect(() => {
    if (!ENABLE_AGENTIC_CREATIONS) {
      if (showOutputsHistory) setShowOutputsHistory(false);
      if (activeArtifactId) setActiveArtifactId(null);
    }
  }, [showOutputsHistory, activeArtifactId]);

  const liveSessionRef = useRef<GeminiLiveVoiceSession | null>(null);
  const liveConversationRef = useRef<string | null>(null);
  const liveRunIdRef = useRef<string | null>(null);
  const liveStartNonceRef = useRef(0);
  const transcriptQueueRef = useRef<Promise<void>>(Promise.resolve());
  const transcriptSeenRef = useRef<Map<string, number>>(new Map());
  const manualLiveStopRef = useRef(false);
  const autoResumeBudgetRef = useRef(1);
  const liveSessionResumptionHandleRef = useRef<string | null>(null);
  const isVideoEnabledRef = useRef(false);
  const cameraFacingModeRef = useRef<CameraFacingMode>("user");
  const pendingAttachmentsRef = useRef<PendingImageAttachment[]>([]);
  const selectedVoiceRef = useRef<LiveVoiceName>(DEFAULT_LIVE_VOICE);
  const selectedThemeRef = useRef<AppThemeId>(DEFAULT_APP_THEME_ID);
  const quotaAutoStopReasonRef = useRef<"voice" | "camera" | null>(null);
  const liveQuotaBudgetRef = useRef<{
    voiceSeconds: number;
    cameraSeconds: number;
  } | null>(null);
  const cameraAccumulatedSecondsRef = useRef(0);
  const cameraActiveStartedAtRef = useRef<number | null>(null);
  const liveTraceEntriesRef = useRef<LiveTraceEntry[]>([]);
  const forceOnboardingRef = useRef<boolean>(
    typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("onboarding") === "1",
  );
  const liveDebugEnabled = useMemo(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("liveDebug") === "1",
    [],
  );
  const textWebLookupClearTimerRef = useRef<number | null>(null);
  const voiceWebLookupClearTimerRef = useRef<number | null>(null);
  const voiceSearchStartedAtRef = useRef<number | null>(null);
  const textSearchStartedAtRef = useRef<number | null>(null);
  const voiceSearchMinTimerRef = useRef<number | null>(null);
  const textSearchMinTimerRef = useRef<number | null>(null);

  const logLiveTrace = useCallback((
    event: string,
    metadata: Record<string, unknown> = {},
  ) => {
    const entry: LiveTraceEntry = {
      at: Date.now(),
      event,
      metadata,
    };
    const nextEntries = [...liveTraceEntriesRef.current, entry].slice(-200);
    liveTraceEntriesRef.current = nextEntries;
    if (liveDebugEnabled) {
      setLiveTraceEntries(nextEntries);
    }
    console.log("[LiveTrace]", event, metadata);
  }, [liveDebugEnabled]);

  const exportLiveDebugTrace = useCallback(() => {
    const payload = {
      exportedAt: new Date().toISOString(),
      speechState: liveDebugState,
      tokenConfigSummary: liveTokenConfigSummary,
      traces: liveTraceEntriesRef.current,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `live-debug-${Date.now()}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 0);
  }, [liveDebugState, liveTokenConfigSummary]);

  const clearWebLookupStatus = useCallback((mode: WebLookupMode) => {
    if (mode === "text") {
      if (textWebLookupClearTimerRef.current !== null) {
        window.clearTimeout(textWebLookupClearTimerRef.current);
        textWebLookupClearTimerRef.current = null;
      }
      setTextWebLookupStatus(null);
      setTextWebLookupLabel(null);
      return;
    }
    if (voiceWebLookupClearTimerRef.current !== null) {
      window.clearTimeout(voiceWebLookupClearTimerRef.current);
      voiceWebLookupClearTimerRef.current = null;
    }
    setVoiceWebLookupStatus(null);
    setVoiceWebLookupLabel(null);
  }, []);

  const defaultWebLookupLabel = useCallback(
    (mode: WebLookupMode, status: WebLookupStatus): string => {
      if (status === "searching") {
        return mode === "voice" ? "Looking up latest info" : "Searching the web…";
      }
      return "Web-checked";
    },
    [],
  );

  const SEARCH_MIN_DISPLAY_MS = 1400;

  const setWebLookupStatus = useCallback(
    (
      mode: WebLookupMode,
      status: WebLookupStatus | "idle",
      label?: string,
    ) => {
      if (status === "idle") {
        clearWebLookupStatus(mode);
        if (mode === "voice") voiceSearchStartedAtRef.current = null;
        else textSearchStartedAtRef.current = null;
        return;
      }

      const startedAtRef = mode === "voice" ? voiceSearchStartedAtRef : textSearchStartedAtRef;
      const minTimerRef = mode === "voice" ? voiceSearchMinTimerRef : textSearchMinTimerRef;
      const clearTimerRef = mode === "voice" ? voiceWebLookupClearTimerRef : textWebLookupClearTimerRef;
      const setStatus = mode === "voice" ? setVoiceWebLookupStatus : setTextWebLookupStatus;
      const setLabel = mode === "voice" ? setVoiceWebLookupLabel : setTextWebLookupLabel;

      if (clearTimerRef.current !== null) {
        window.clearTimeout(clearTimerRef.current);
        clearTimerRef.current = null;
      }
      if (minTimerRef.current !== null) {
        window.clearTimeout(minTimerRef.current);
        minTimerRef.current = null;
      }

      if (status === "searching") {
        startedAtRef.current = Date.now();
        setStatus("searching");
        setLabel(label ?? defaultWebLookupLabel(mode, "searching"));
        return;
      }

      if (startedAtRef.current === null) {
        startedAtRef.current = Date.now();
        setStatus("searching");
        setLabel(defaultWebLookupLabel(mode, "searching"));
      }

      const applyGrounded = () => {
        startedAtRef.current = null;
        setStatus("grounded");
        setLabel(label ?? defaultWebLookupLabel(mode, "grounded"));
        clearTimerRef.current = window.setTimeout(() => {
          setStatus(null);
          setLabel(null);
          clearTimerRef.current = null;
        }, 3600);
      };

      const elapsed = Date.now() - startedAtRef.current;
      const remaining = SEARCH_MIN_DISPLAY_MS - elapsed;

      if (remaining > 0) {
        minTimerRef.current = window.setTimeout(() => {
          minTimerRef.current = null;
          applyGrounded();
        }, remaining);
      } else {
        applyGrounded();
      }
    },
    [clearWebLookupStatus, defaultWebLookupLabel],
  );

  useEffect(() => {
    return () => {
      if (textWebLookupClearTimerRef.current !== null) {
        window.clearTimeout(textWebLookupClearTimerRef.current);
      }
      if (voiceWebLookupClearTimerRef.current !== null) {
        window.clearTimeout(voiceWebLookupClearTimerRef.current);
      }
      if (voiceSearchMinTimerRef.current !== null) {
        window.clearTimeout(voiceSearchMinTimerRef.current);
      }
      if (textSearchMinTimerRef.current !== null) {
        window.clearTimeout(textSearchMinTimerRef.current);
      }
    };
  }, []);

  const getConversationMessagesKey = (conversationId: string) =>
    [`/api/conversations/${conversationId}/messages`];
  const memorySettingsQueryKey = ["/api/memory/settings"];
  const memoryItemsQueryKey = [
    "/api/memory/items",
    { limit: 20, offset: 0, includeArchived: 0 },
  ] as const;

  const resetCallUsageTracking = () => {
    cameraAccumulatedSecondsRef.current = 0;
    cameraActiveStartedAtRef.current = null;
  };

  const beginCameraUsageTracking = () => {
    if (cameraActiveStartedAtRef.current !== null) return;
    cameraActiveStartedAtRef.current = Date.now();
  };

  const pauseCameraUsageTracking = () => {
    if (cameraActiveStartedAtRef.current === null) return;
    const elapsed = Math.max(
      0,
      Math.floor((Date.now() - cameraActiveStartedAtRef.current) / 1000),
    );
    cameraAccumulatedSecondsRef.current += elapsed;
    cameraActiveStartedAtRef.current = null;
  };

  const getCurrentCameraUsageSeconds = () => {
    const activeElapsed =
      cameraActiveStartedAtRef.current === null
        ? 0
        : Math.max(
            0,
            Math.floor((Date.now() - cameraActiveStartedAtRef.current) / 1000),
          );
    return cameraAccumulatedSecondsRef.current + activeElapsed;
  };

  const updateConversationMessages = (
    conversationId: string,
    updater: (current: MessageData[]) => MessageData[],
  ) => {
    queryClient.setQueryData<MessageData[]>(
      getConversationMessagesKey(conversationId),
      (current) => updater(current ?? []),
    );
  };

  const { data: preferences } = useQuery<{
    selectedPersona?: string;
    selectedVoice?: string;
    selectedTheme?: string;
    onboardingCompleted?: boolean;
  }>({
    queryKey: ["/api/preferences"],
    enabled: isAuthenticated,
  });

  const { data: quotaResponse, isLoading: isQuotaLoading } =
    useQuery<QuotaSummaryResponse>({
      queryKey: ["/api/quota/summary"],
      enabled: isAuthenticated,
      refetchInterval: 15000,
    });
  const quotaSummary = quotaResponse?.quota;
  const quotaTier = quotaResponse?.tier;

  const { data: userProfile, isLoading: isProfileLoading } =
    useQuery<UserProfileData>({
      queryKey: ["/api/profile/me"],
      enabled: isAuthenticated,
    });

  const {
    data: memorySettingsResponse,
    isLoading: isMemorySettingsLoading,
  } = useQuery<MemorySettingsResponse>({
    queryKey: memorySettingsQueryKey,
    enabled: isAuthenticated && showSettings,
    staleTime: 30_000,
  });
  const memorySettings = memorySettingsResponse?.settings;

  const {
    data: memoryItemsResponse,
    isLoading: isMemoryItemsLoading,
  } = useQuery<MemoryItemsResponse>({
    queryKey: memoryItemsQueryKey,
    queryFn: async () => {
      const response = await fetch(
        "/api/memory/items?limit=20&offset=0&includeArchived=0",
        {
          credentials: "include",
          headers: {
            "x-trace-id": createRequestTraceId(),
          },
        },
      );
      if (!response.ok) {
        const text = (await response.text()) || response.statusText;
        throw new Error(text);
      }
      return response.json() as Promise<MemoryItemsResponse>;
    },
    enabled: isAuthenticated && showSettings,
    staleTime: 10_000,
  });
  const memoryItems = memoryItemsResponse?.items ?? [];

  const {
    data: artifactsResponse,
    isLoading: isArtifactsLoading,
  } = useQuery<AgentArtifactsResponse>({
    queryKey: ["/api/agent/artifacts?includeArchived=1"],
    enabled: isAuthenticated,
    refetchInterval: 15000,
  });
  const artifacts = artifactsResponse?.artifacts ?? [];

  const { data: activeArtifactResponse, isLoading: isActiveArtifactLoading, refetch: refetchActiveArtifact } = useQuery<AgentArtifactResponse>({
    queryKey: activeArtifactId
      ? [`/api/agent/artifacts/${activeArtifactId}`]
      : ["/api/agent/artifacts/none"],
    enabled: Boolean(activeArtifactId),
    staleTime: 0,
    retry: 2,
    refetchOnWindowFocus: true,
  });

  const [showOnboarding, setShowOnboarding] = useState(false);
  const [selectedVoice, setSelectedVoice] =
    useState<LiveVoiceName>(DEFAULT_LIVE_VOICE);
  const [selectedTheme, setSelectedTheme] =
    useState<AppThemeId>(DEFAULT_APP_THEME_ID);
  const persona: Persona = ASSISTANT_NAME;

  useEffect(() => {
    if (preferences) {
      setShowOnboarding(forceOnboardingRef.current || !preferences.onboardingCompleted);
      if (isLiveVoiceName(preferences.selectedVoice)) {
        setSelectedVoice(preferences.selectedVoice);
      }
      if (isAppThemeId(preferences.selectedTheme)) {
        setSelectedTheme(preferences.selectedTheme);
      }
    }
  }, [preferences]);

  useEffect(() => {
    isVideoEnabledRef.current = isVideoEnabled;
  }, [isVideoEnabled]);

  useEffect(() => {
    cameraFacingModeRef.current = cameraFacingMode;
  }, [cameraFacingMode]);

  useEffect(() => {
    pendingAttachmentsRef.current = pendingAttachments;
  }, [pendingAttachments]);

  useEffect(() => {
    selectedVoiceRef.current = selectedVoice;
  }, [selectedVoice]);

  useEffect(() => {
    selectedThemeRef.current = selectedTheme;
    applyAppTheme(selectedTheme);
  }, [selectedTheme]);

  useEffect(() => {
    return () => {
      for (const attachment of pendingAttachmentsRef.current) {
        URL.revokeObjectURL(attachment.previewUrl);
      }
    };
  }, []);

  const updatePreferencesMutation = useMutation({
    mutationFn: async (data: {
      selectedPersona?: Persona;
      selectedVoice?: LiveVoiceName;
      selectedTheme?: AppThemeId;
      onboardingCompleted?: boolean;
    }) => {
      const res = await apiRequest("PUT", "/api/preferences", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/preferences"] });
    },
  });

  const updateProfileMutation = useMutation({
    mutationFn: async (payload: {
      displayName: string | null;
      bio: string | null;
      location: string | null;
      age: number | null;
      profession: string | null;
      gender: GenderOption | null;
      genderOther: string | null;
      responseStylePreset: ResponseStylePreset;
      responseStyleNote: string | null;
      zeeAvatarPreset: ZeeAvatarPreset;
      clearZeeAvatarAttachment?: boolean;
    }) => {
      const response = await apiRequest("PATCH", "/api/profile/me", payload);
      return response.json() as Promise<UserProfileData>;
    },
    onSuccess: (profile) => {
      queryClient.setQueryData(["/api/profile/me"], profile);
    },
  });

  const uploadProfileAvatarMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("image", file);

      const response = await fetch("/api/profile/avatar", {
        method: "POST",
        credentials: "include",
        headers: {
          "x-trace-id": createRequestTraceId(),
        },
        body: formData,
      });

      if (!response.ok) {
        const text = (await response.text()) || response.statusText;
        throw new Error(text);
      }

      return (await response.json()) as UserProfileData;
    },
    onSuccess: (profile) => {
      queryClient.setQueryData(["/api/profile/me"], profile);
    },
  });

  const uploadZeeAvatarMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("image", file);

      const response = await fetch("/api/profile/zee-avatar", {
        method: "POST",
        credentials: "include",
        headers: {
          "x-trace-id": createRequestTraceId(),
        },
        body: formData,
      });

      if (!response.ok) {
        const text = (await response.text()) || response.statusText;
        throw new Error(text);
      }

      return (await response.json()) as UserProfileData;
    },
    onSuccess: (profile) => {
      queryClient.setQueryData(["/api/profile/me"], profile);
    },
  });

  const updateMemorySettingsMutation = useMutation({
    mutationFn: async (payload: Partial<MemorySettingsData>) => {
      const response = await apiRequest("PATCH", "/api/memory/settings", payload);
      return (await response.json()) as MemorySettingsResponse;
    },
    onSuccess: (response) => {
      queryClient.setQueryData(memorySettingsQueryKey, response);
      queryClient.invalidateQueries({ queryKey: ["/api/preferences"] });
    },
  });

  const forgetMemoryItemMutation = useMutation({
    mutationFn: async (memoryItemId: string) => {
      await apiRequest("DELETE", `/api/memory/items/${memoryItemId}`);
      return memoryItemId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: memoryItemsQueryKey });
    },
  });

  const resolveTaskApprovalMutation = useMutation({
    mutationFn: async (params: {
      taskId: string;
      approve: boolean;
      reason?: string;
    }) => {
      const response = await apiRequest(
        "POST",
        `/api/agent/tasks/${params.taskId}/approve`,
        {
          approve: params.approve,
          reason: params.reason ?? null,
        },
      );
      return (await response.json()) as AgentTaskResponse;
    },
    onSuccess: () => {
      if (activeConversationId) {
        queryClient.invalidateQueries({
          queryKey: getConversationMessagesKey(activeConversationId),
        });
      }
      queryClient.invalidateQueries({
        queryKey: ["/api/agent/artifacts?includeArchived=1"],
      });
    },
  });

  const resolveAgentOfferMutation = useMutation({
    mutationFn: async (params: { offerId: string; accept: boolean }) => {
      const endpoint = params.accept ? "accept" : "decline";
      const response = await apiRequest(
        "POST",
        `/api/agent/offers/${params.offerId}/${endpoint}`,
        {},
      );
      return (await response.json()) as AgentOfferResponse;
    },
    onSuccess: () => {
      if (activeConversationId) {
        queryClient.invalidateQueries({
          queryKey: getConversationMessagesKey(activeConversationId),
        });
      }
      queryClient.invalidateQueries({
        queryKey: ["/api/agent/artifacts?includeArchived=1"],
      });
    },
  });

  const archiveArtifactMutation = useMutation({
    mutationFn: async (artifactId: string) => {
      const response = await apiRequest(
        "POST",
        `/api/agent/artifacts/${artifactId}/archive`,
      );
      return (await response.json()) as AgentArtifactResponse;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/agent/artifacts?includeArchived=1"],
      });
    },
  });

  const deleteArtifactMutation = useMutation({
    mutationFn: async (artifactId: string) => {
      await apiRequest("DELETE", `/api/agent/artifacts/${artifactId}`);
      return artifactId;
    },
    onSuccess: (artifactId) => {
      if (activeArtifactId === artifactId) {
        setActiveArtifactId(null);
      }
      queryClient.invalidateQueries({
        queryKey: ["/api/agent/artifacts?includeArchived=1"],
      });
    },
  });

  const handleOnboardingComplete = () => {
    forceOnboardingRef.current = false;
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (url.searchParams.has("onboarding")) {
        url.searchParams.delete("onboarding");
        window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
      }
    }
    setShowOnboarding(false);
    updatePreferencesMutation.mutate({
      selectedPersona: persona,
      selectedVoice,
      selectedTheme: selectedThemeRef.current,
      onboardingCompleted: true,
    });
  };

  const handleReplayOnboarding = () => {
    forceOnboardingRef.current = true;
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("onboarding", "1");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }
    setShowProfile(false);
    setShowSettings(false);
    setShowOutputsHistory(false);
    setShowOnboarding(true);
    updatePreferencesMutation.mutate({
      selectedPersona: persona,
      selectedVoice: selectedVoiceRef.current,
      selectedTheme: selectedThemeRef.current,
      onboardingCompleted: false,
    });
  };

  const handleVoiceChange = (voice: LiveVoiceName) => {
    setSelectedVoice(voice);
    updatePreferencesMutation.mutate({
      selectedPersona: persona,
      selectedVoice: voice,
      selectedTheme: selectedThemeRef.current,
      onboardingCompleted: preferences?.onboardingCompleted ?? true,
    });
  };

  const handleSaveTheme = async (themeId: AppThemeId) => {
    await updatePreferencesMutation.mutateAsync({
      selectedPersona: persona,
      selectedVoice: selectedVoiceRef.current,
      selectedTheme: themeId,
      onboardingCompleted: preferences?.onboardingCompleted ?? true,
    });
    setSelectedTheme(themeId);
  };

  const handleSaveProfile = async (payload: {
    displayName: string | null;
    bio: string | null;
    location: string | null;
    age: number | null;
    profession: string | null;
    gender: GenderOption | null;
    genderOther: string | null;
    responseStylePreset: ResponseStylePreset;
    responseStyleNote: string | null;
    zeeAvatarPreset: ZeeAvatarPreset;
    clearZeeAvatarAttachment?: boolean;
  }) => {
    await updateProfileMutation.mutateAsync(payload);
  };

  const handleUploadProfileAvatar = async (file: File) => {
    await uploadProfileAvatarMutation.mutateAsync(file);
  };

  const handleUploadZeeAvatar = async (file: File) => {
    await uploadZeeAvatarMutation.mutateAsync(file);
  };

  const handleUpdateMemorySettings = async (
    patch: Partial<MemorySettingsData>,
  ) => {
    await updateMemorySettingsMutation.mutateAsync(patch);
  };

  const handleForgetMemoryItem = async (memoryItemId: string) => {
    await forgetMemoryItemMutation.mutateAsync(memoryItemId);
  };

  const handleResolveTaskApproval = async (
    taskId: string,
    approve: boolean,
    reason?: string,
  ) => {
    try {
      await resolveTaskApprovalMutation.mutateAsync({
        taskId,
        approve,
        reason,
      });
      if (activeConversationId) {
        queryClient.invalidateQueries({
          queryKey: getConversationMessagesKey(activeConversationId),
        });
      }
    } catch (error) {
      const message = getErrorMessage(error);
      if (message.toLowerCase().includes("no pending approval")) {
        if (activeConversationId) {
          queryClient.invalidateQueries({
            queryKey: getConversationMessagesKey(activeConversationId),
          });
        }
        return;
      }
      setComposerError(message || "Failed to process approval decision.");
    }
  };

  const handleResolveAgentOffer = async (offerId: string, accept: boolean) => {
    try {
      await resolveAgentOfferMutation.mutateAsync({ offerId, accept });
      if (activeConversationId) {
        queryClient.invalidateQueries({
          queryKey: getConversationMessagesKey(activeConversationId),
        });
      }
    } catch (error) {
      const message = getErrorMessage(error);
      if (
        message.toLowerCase().includes("offer is no longer pending") ||
        message.toLowerCase().includes("already accepted") ||
        message.toLowerCase().includes("already declined") ||
        message.toLowerCase().includes("alreadyaccepted") ||
        message.toLowerCase().includes("alreadydeclined")
      ) {
        if (activeConversationId) {
          queryClient.invalidateQueries({
            queryKey: getConversationMessagesKey(activeConversationId),
          });
        }
        return;
      }
      setComposerError(message || "Failed to process offer decision.");
    }
  };

  const handleOpenArtifact = (artifactId: string) => {
    queryClient.invalidateQueries({
      queryKey: [`/api/agent/artifacts/${artifactId}`],
    });
    setActiveArtifactId(artifactId);
  };

  const handleArchiveArtifact = (artifactId: string) => {
    archiveArtifactMutation.mutate(artifactId);
  };

  const handleDeleteArtifact = (artifactId: string) => {
    deleteArtifactMutation.mutate(artifactId);
  };

  const { data: conversations } = useQuery<any[]>({
    queryKey: ["/api/conversations"],
    enabled: isAuthenticated && !showOnboarding,
  });

  const createConversationMutation = useMutation({
    mutationFn: async (data: { persona: string }) => {
      const res = await apiRequest("POST", "/api/conversations", data);
      return res.json() as Promise<{ id: string; persona: Persona }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
    },
  });

  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!isAuthenticated || showOnboarding) return;
    if (conversations && conversations.length > 0) {
      setActiveConversationId(conversations[0].id);
    } else if (conversations && conversations.length === 0) {
      createConversationMutation.mutate({ persona });
    }
  }, [conversations, isAuthenticated, showOnboarding]);

  useEffect(() => {
    setLiveTaskSnapshots({});
  }, [activeConversationId]);

  const ensureActiveConversationId = async (): Promise<string> => {
    if (activeConversationId) {
      return activeConversationId;
    }
    const created = await createConversationMutation.mutateAsync({ persona });
    setActiveConversationId(created.id);
    return created.id;
  };

  const messageQueryKey = activeConversationId
    ? getConversationMessagesKey(activeConversationId)
    : ["/api/conversations/none/messages"];

  const { data: messagesData = [] } = useQuery<MessageData[]>({
    queryKey: messageQueryKey,
    enabled: !!activeConversationId,
    refetchInterval: 5000,
  });

  const saveVoiceSessionMutation = useMutation({
    mutationFn: async (data: {
      persona: string;
      duration: number;
      cameraDuration: number;
    }) => {
      const res = await apiRequest("POST", "/api/voice-sessions", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quota/summary"] });
    },
  });

  const createLiveTokenMutation = useMutation({
    mutationFn: async (data: {
      persona: Persona;
      voice: LiveVoiceName;
      conversationId: string;
      deviceClass: "mobile" | "desktop" | "unknown";
    }) => {
      const clientTimeZone = detectClientTimeZone();
      const res = await apiRequest("POST", "/api/live/token", {
        conversationId: data.conversationId,
        persona: data.persona,
        voice: data.voice,
        deviceClass: data.deviceClass,
        clientTimeZone,
        responseModality: "AUDIO",
      });
      const body = (await res.json()) as LiveTokenResponse;
      return {
        ...body,
        traceId: extractTraceId(res, body),
      };
    },
  });

  const persistVoiceTranscriptMutation = useMutation({
    mutationFn: async (data: {
      conversationId: string;
      sender: "user" | "assistant";
      text: string;
    }) => {
      const res = await apiRequest(
        "POST",
        `/api/conversations/${data.conversationId}/voice-transcript`,
        {
          sender: data.sender,
          text: data.text,
        },
      );
      const body = (await res.json()) as { traceId?: string };
      return {
        ...body,
        traceId: extractTraceId(res, body),
      };
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({
        queryKey: getConversationMessagesKey(vars.conversationId),
      });
    },
    onError: (error, vars) => {
      console.error("voice.transcript.persist.failed", {
        conversationId: vars.conversationId,
        sender: vars.sender,
        error: getErrorMessage(error),
      });
    },
  });

  const queueTranscriptPersist = (payload: {
    conversationId: string;
    sender: "user" | "assistant";
    text: string;
  }) => {
    const dedupeKey = `${payload.sender}:${payload.text}`;
    const now = Date.now();
    const lastSeenAt = transcriptSeenRef.current.get(dedupeKey);
    if (typeof lastSeenAt === "number" && now - lastSeenAt < TRANSCRIPT_DEDUPE_WINDOW_MS) {
      return;
    }
    transcriptSeenRef.current.set(dedupeKey, now);
    transcriptSeenRef.current.forEach((seenAt, key) => {
      if (now - seenAt > TRANSCRIPT_DEDUPE_PRUNE_MS) {
        transcriptSeenRef.current.delete(key);
      }
    });

    transcriptQueueRef.current = transcriptQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const persisted = await persistVoiceTranscriptMutation.mutateAsync(payload);
        logLiveTrace("voice.transcript.persisted", {
          runId: liveRunIdRef.current,
          conversationId: payload.conversationId,
          sender: payload.sender,
          textLength: payload.text.length,
          traceId: persisted.traceId,
        });
      })
      .catch((error) => {
        logLiveTrace("voice.transcript.failed", {
          runId: liveRunIdRef.current,
          conversationId: payload.conversationId,
          sender: payload.sender,
          textLength: payload.text.length,
          error: getErrorMessage(error),
        });
        setLiveError(
          "Voice transcript sync failed. Conversation still works, but try reconnecting voice.",
        );
      });
  };

  const revokeAttachmentPreview = (attachment: PendingImageAttachment) => {
    URL.revokeObjectURL(attachment.previewUrl);
  };

  const removePendingAttachmentsByLocalId = (localIds: string[]) => {
    if (localIds.length === 0) return;
    const toRemove = new Set(localIds);
    setPendingAttachments((current) => {
      const removed = current.filter((item) => toRemove.has(item.localId));
      for (const item of removed) {
        revokeAttachmentPreview(item);
      }
      return current.filter((item) => !toRemove.has(item.localId));
    });
  };

  const uploadImageFile = async (
    conversationId: string,
    file: File,
    localId: string,
  ) => {
    const formData = new FormData();
    formData.append("image", file);

    const response = await fetch(
      `/api/conversations/${conversationId}/attachments/image`,
      {
        method: "POST",
        credentials: "include",
        headers: {
          "x-trace-id": createRequestTraceId(),
        },
        body: formData,
      },
    );

    if (!response.ok) {
      const text = (await response.text()) || response.statusText;
      throw new Error(`${response.status}: ${text}`);
    }

    const payload = (await response.json()) as {
      attachment: MessageAttachmentData;
      traceId?: string;
    };

    setPendingAttachments((current) =>
      current.map((item) =>
        item.localId === localId
          ? {
              ...item,
              status: "ready",
              attachmentId: payload.attachment.id,
              attachment: payload.attachment,
              error: undefined,
            }
          : item,
      ),
    );

    console.log("[ChatTrace] chat.attachment.uploaded", {
      conversationId,
      localId,
      attachmentId: payload.attachment.id,
      traceId: payload.traceId,
    });
  };

  const handleIncomingFiles = async (files: FileList | null) => {
    if (!files || files.length === 0 || isSendingMessage) {
      return;
    }

    // Clone synchronously before the input value is reset by the caller.
    const selectedFiles = Array.from(files);

    setComposerError(null);
    const remainingSlots = Math.max(0, CHAT_IMAGE_MAX_COUNT - pendingAttachments.length);
    if (remainingSlots <= 0) {
      setComposerError(`You can attach up to ${CHAT_IMAGE_MAX_COUNT} images per message.`);
      return;
    }

    const conversationId = await ensureActiveConversationId();
    const fileList = selectedFiles.slice(0, remainingSlots);

    for (const file of fileList) {
      if (!file.type.startsWith("image/")) {
        setComposerError("Only image files are supported.");
        continue;
      }

      const localId = createLocalId("attachment");
      const previewUrl = URL.createObjectURL(file);
      setPendingAttachments((current) => [
        ...current,
        {
          localId,
          previewUrl,
          status: "uploading",
          mimeType: file.type,
          byteSize: file.size,
        },
      ]);

      void uploadImageFile(conversationId, file, localId).catch((error) => {
        setPendingAttachments((current) =>
          current.map((item) =>
            item.localId === localId
              ? {
                  ...item,
                  status: "error",
                  error: getErrorMessage(error),
                }
              : item,
          ),
        );
        setComposerError("One image failed to upload. Remove it or try again.");
      });
    }
  };

  const handleRemoveAttachment = async (localId: string) => {
    setComposerError(null);
    const attachment = pendingAttachments.find((item) => item.localId === localId);

    setPendingAttachments((current) =>
      current.filter((item) => item.localId !== localId),
    );
    if (attachment) {
      revokeAttachmentPreview(attachment);
    }

    if (attachment?.attachmentId && attachment.attachment?.conversationId) {
      try {
        await apiRequest(
          "DELETE",
          `/api/conversations/${attachment.attachment.conversationId}/attachments/${attachment.attachmentId}`,
        );
      } catch (error) {
        setComposerError("Could not remove attachment from server.");
      }
    }
  };

  const buildOptimisticAssistantPartId = (turnSeed: string, partIndex: number) =>
    `${turnSeed}::part::${partIndex}`;

  const isOptimisticAssistantPart = (messageId: string, turnSeed: string) =>
    messageId.startsWith(`${turnSeed}::part::`);

  const replaceOptimisticAssistantTurn = (
    current: MessageData[],
    turnSeed: string,
    replacements: MessageData[],
  ): MessageData[] => {
    const next: MessageData[] = [];
    let inserted = false;

    for (const message of current) {
      if (isOptimisticAssistantPart(message.id, turnSeed)) {
        if (!inserted) {
          next.push(...replacements);
          inserted = true;
        }
        continue;
      }
      next.push(message);
    }

    if (!inserted) {
      next.push(...replacements);
    }

    return next;
  };

  const createFallbackLiveTaskSnapshot = (params: {
    taskId: string;
    conversationId: string;
  }): LiveTaskSnapshot => {
    const nowIso = new Date().toISOString();
    return {
      task: {
        id: params.taskId,
        conversationId: params.conversationId,
        status: "queued",
        riskLevel: "low",
        taskKind: "mixed",
        prompt: "",
        errorMessage: null,
        createdAt: new Date(nowIso),
        updatedAt: new Date(nowIso),
        completedAt: null,
      },
      latestStep: null,
      approval: null,
      artifact: null,
      failure: null,
      timeline: [],
      updatedAtIso: nowIso,
    };
  };

  const upsertLiveTaskSnapshot = (params: {
    taskId: string;
    conversationId: string;
    updater: (current: LiveTaskSnapshot) => LiveTaskSnapshot;
  }) => {
    setLiveTaskSnapshots((current) => {
      const existing =
        current[params.taskId] ??
        createFallbackLiveTaskSnapshot({
          taskId: params.taskId,
          conversationId: params.conversationId,
        });
      const updated = params.updater(existing);
      return {
        ...current,
        [params.taskId]: {
          ...updated,
          updatedAtIso: new Date().toISOString(),
        },
      };
    });
  };

  const appendLiveTimelineItem = (
    timeline: UnifiedAgentTaskTimelineItem[],
    item: UnifiedAgentTaskTimelineItem,
  ): UnifiedAgentTaskTimelineItem[] => {
    const next = [...timeline];
    upsertTimelineItem(next, item);
    return normalizeTimeline(next);
  };

  const streamChatResponse = async (params: {
    conversationId: string;
    text: string;
    attachmentIds: string[];
    optimisticUserId: string;
    optimisticAssistantTurnId: string;
  }): Promise<{ ackedUserMessageId: string | null }> => {
    const response = await fetch("/api/chat/respond/stream", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "x-trace-id": createRequestTraceId(),
      },
      body: JSON.stringify({
        conversationId: params.conversationId,
        text: params.text,
        persona,
        attachmentIds: params.attachmentIds,
        clientTimeZone: detectClientTimeZone(),
      }),
    });

    if (!response.ok) {
      const text = (await response.text()) || response.statusText;
      throw new Error(text);
    }

    if (!response.body) {
      throw new Error("Streaming is not supported in this browser.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalized = false;
    let activeTaskSummary: AgentTaskSummary | null = null;
    const pendingPartDeltas = new Map<number, string>();
    let deltaFlushTimer: number | null = null;

    let ackedUserMessageId: string | null = null;

    const primaryPartId = buildOptimisticAssistantPartId(
      params.optimisticAssistantTurnId,
      0,
    );

    const updatePrimaryOptimisticMessage = (updater: (message: MessageData) => MessageData) => {
      updateConversationMessages(params.conversationId, (current) => {
        const next = [...current];
        const index = next.findIndex((message) => message.id === primaryPartId);
        if (index < 0) return next;
        next[index] = updater(next[index]);
        return next;
      });
    };

    const flushPendingPartDeltas = () => {
      if (pendingPartDeltas.size === 0) return;
      const updates = Array.from(pendingPartDeltas.entries());
      pendingPartDeltas.clear();

      updateConversationMessages(params.conversationId, (current) => {
        const next = [...current];
        for (const [partIndex, deltaText] of updates) {
          if (!deltaText) continue;
          const partId = buildOptimisticAssistantPartId(
            params.optimisticAssistantTurnId,
            partIndex,
          );
          const existingIndex = next.findIndex((message) => message.id === partId);
          if (existingIndex >= 0) {
            next[existingIndex] = {
              ...next[existingIndex],
              text: `${next[existingIndex].text}${deltaText}`,
              isTyping: false,
              partIndex,
            };
            continue;
          }

          const newPartMessage: MessageData = {
            id: partId,
            conversationId: params.conversationId,
            sender: "assistant",
            turnId: params.optimisticAssistantTurnId,
            partIndex,
            text: deltaText,
            createdAt: new Date().toISOString(),
            isTyping: false,
            localOnly: true,
          };

          let lastPartIndex = -1;
          for (let index = 0; index < next.length; index += 1) {
            if (
              isOptimisticAssistantPart(
                next[index].id,
                params.optimisticAssistantTurnId,
              )
            ) {
              lastPartIndex = index;
            }
          }

          if (lastPartIndex >= 0) {
            next.splice(lastPartIndex + 1, 0, newPartMessage);
          } else {
            next.push(newPartMessage);
          }
        }
        return next;
      });
    };

    const schedulePartDeltaFlush = () => {
      if (deltaFlushTimer !== null) return;
      deltaFlushTimer = window.setTimeout(() => {
        deltaFlushTimer = null;
        flushPendingPartDeltas();
      }, 40);
    };

    const clearPendingPartDeltaFlush = () => {
      if (deltaFlushTimer !== null) {
        window.clearTimeout(deltaFlushTimer);
        deltaFlushTimer = null;
      }
    };

    const applyEvent = (event: ChatStreamEvent) => {
      if (event.type === "ack") {
        ackedUserMessageId = event.userMessage?.id ?? null;
        updateConversationMessages(params.conversationId, (current) =>
          current.map((message) =>
            message.id === params.optimisticUserId ? event.userMessage : message,
          ),
        );
        return;
      }

      if (event.type === "delta") {
        const partIndex = Number.isInteger(event.partIndex)
          ? Math.max(0, event.partIndex ?? 0)
          : 0;
        pendingPartDeltas.set(
          partIndex,
          sanitizeSplitTokenArtifacts(`${pendingPartDeltas.get(partIndex) ?? ""}${event.text}`),
        );
        schedulePartDeltaFlush();
        return;
      }

      if (event.type === "part_final") {
        clearPendingPartDeltaFlush();
        flushPendingPartDeltas();
        const partId = buildOptimisticAssistantPartId(
          params.optimisticAssistantTurnId,
          event.partIndex,
        );
        updateConversationMessages(params.conversationId, (current) => {
          const next = [...current];
          const finalizedMessage: MessageData = {
            ...event.message,
            id: partId,
            turnId: event.turnId,
            partIndex: event.partIndex,
            isTyping: false,
            localOnly: true,
          };
          const existingIndex = next.findIndex((message) => message.id === partId);
          if (existingIndex >= 0) {
            next[existingIndex] = finalizedMessage;
          } else {
            next.push(finalizedMessage);
          }
          return next;
        });
        return;
      }

      if (event.type === "web_search") {
        setWebLookupStatus(event.mode ?? "text", event.status, event.label);
        return;
      }

      if (event.type === "task_created") {
        activeTaskSummary = event.task;
        upsertLiveTaskSnapshot({
          taskId: event.task.id,
          conversationId: params.conversationId,
          updater: (snapshot) => ({
            ...snapshot,
            task: pickLatestTaskSummary(snapshot.task, event.task) ?? event.task,
            failure: null,
            timeline: appendLiveTimelineItem(snapshot.timeline, {
              id: `task-created-${event.task.id}`,
              title: "Task started",
              detail: "Zee started crafting your request.",
              status: "queued",
              createdAt: new Date().toISOString(),
            }),
          }),
        });
        updatePrimaryOptimisticMessage((message) => ({
          ...message,
          isTyping: false,
          text: "Zee is crafting your request...",
          uiPayload: {
            kind: "agent_task_status",
            task: event.task,
            text: "Task started",
          },
        }));
        return;
      }

      if (event.type === "task_step") {
        updatePrimaryOptimisticMessage((message) => {
          const task =
            activeTaskSummary ??
            (isAgentTaskStatusPayload(message.uiPayload)
              ? message.uiPayload.task
              : null);
          return {
            ...message,
            isTyping: false,
            text: event.step.detail ?? message.text,
            uiPayload: task
              ? {
                  kind: "agent_task_status",
                  task,
                  latestStep: event.step,
                  text: event.step.detail ?? event.step.title,
                }
              : message.uiPayload,
          };
        });
        upsertLiveTaskSnapshot({
          taskId: event.taskId,
          conversationId: params.conversationId,
          updater: (snapshot) => {
            const currentStatus = snapshot.task.status;
            const nextStatus: AgentTaskSummary["status"] =
              currentStatus === "completed" ||
              currentStatus === "failed" ||
              currentStatus === "cancelled"
                ? currentStatus
                : currentStatus === "approval_required"
                  ? "approval_required"
                  : "in_progress";
            const nextTask: AgentTaskSummary = {
              ...snapshot.task,
              status: nextStatus,
              updatedAt: new Date(),
            };
            return {
              ...snapshot,
              task: nextTask,
              latestStep: event.step,
              timeline: appendLiveTimelineItem(snapshot.timeline, {
                id: `step-${event.step.id}`,
                title: event.step.title,
                detail: event.step.detail ?? null,
                status: event.step.status,
                createdAt: toIsoString(event.step.updatedAt) ?? new Date().toISOString(),
              }),
            };
          },
        });
        return;
      }

      if (event.type === "task_approval_required") {
        upsertLiveTaskSnapshot({
          taskId: event.taskId,
          conversationId: params.conversationId,
          updater: (snapshot) => ({
            ...snapshot,
            task: {
              ...snapshot.task,
              status: "approval_required",
              updatedAt: new Date(),
            },
            approval: event.approval,
            timeline: appendLiveTimelineItem(snapshot.timeline, {
              id: `approval-${event.approval.id}`,
              title: "Approval required",
              detail: event.approval.requestedAction,
              status: "blocked",
              createdAt:
                toIsoString(event.approval.createdAt) ?? new Date().toISOString(),
            }),
          }),
        });
        updatePrimaryOptimisticMessage((message) => ({
          ...message,
          isTyping: false,
          text: "Approval required before continuing.",
          uiPayload: {
            kind: "agent_approval",
            taskId: event.taskId,
            approval: event.approval,
            text: "Approval needed",
          },
        }));
        return;
      }

      if (event.type === "task_artifact_ready") {
        upsertLiveTaskSnapshot({
          taskId: event.taskId,
          conversationId: params.conversationId,
          updater: (snapshot) => ({
            ...snapshot,
            task: {
              ...snapshot.task,
              status: snapshot.task.status === "failed" ? "failed" : "completed",
              errorMessage: snapshot.task.status === "failed" ? snapshot.task.errorMessage : null,
              updatedAt: new Date(),
              completedAt: new Date(),
            },
            approval: null,
            artifact: event.artifact,
            failure: snapshot.task.status === "failed" ? snapshot.failure : null,
            timeline: appendLiveTimelineItem(snapshot.timeline, {
              id: `artifact-${event.artifact.id}`,
              title: "Artifact ready",
              detail: event.artifact.title,
              status: "completed",
              createdAt:
                toIsoString(event.artifact.updatedAt) ?? new Date().toISOString(),
            }),
          }),
        });
        updatePrimaryOptimisticMessage((message) => ({
          ...message,
          isTyping: false,
          text: `Artifact ready: ${event.artifact.title}`,
          uiPayload: {
            kind: "agent_artifact",
            taskId: event.taskId,
            artifact: event.artifact,
            text:
              event.artifact.type === "mini_game"
                ? "View/Play"
                : event.artifact.type === "web_app"
                  ? "View/Launch"
                  : "View",
          },
        }));
        return;
      }

      if (event.type === "task_failed") {
        const normalizedFailure =
          event.failure ??
          ({
            traceId: null,
            stage: "unknown",
            stepKey: null,
            stepTitle: null,
            toolName: null,
            code: null,
            reason: event.message,
            toolOutputSummary: null,
            sandboxJobId: null,
            retriable: false,
            occurredAt: new Date().toISOString(),
            rawMessage: event.message,
          } satisfies TaskFailureSummary);
        upsertLiveTaskSnapshot({
          taskId: event.taskId,
          conversationId: params.conversationId,
          updater: (snapshot) => ({
            ...snapshot,
            task: {
              ...snapshot.task,
              status: "failed",
              errorMessage: event.message,
              updatedAt: new Date(),
              completedAt: new Date(),
            },
            approval: null,
            failure: normalizedFailure,
            timeline: appendLiveTimelineItem(snapshot.timeline, {
              id: `failed-${event.taskId}`,
              title: "Task failed",
              detail: normalizedFailure.reason,
              status: "failed",
              createdAt: new Date().toISOString(),
            }),
          }),
        });
        if (activeTaskSummary) {
          activeTaskSummary = {
            ...activeTaskSummary,
            status: "failed",
            errorMessage: event.message,
            updatedAt: new Date(),
            completedAt: new Date(),
          };
        }
        updatePrimaryOptimisticMessage((message) => ({
          ...message,
          isTyping: false,
          text: normalizedFailure.reason,
          uiPayload:
            activeTaskSummary
              ? {
                  kind: "agent_task_status",
                  task: {
                    ...activeTaskSummary,
                    status: "failed",
                    errorMessage: event.message,
                  },
                  text: "Failed",
                }
              : message.uiPayload,
        }));
        return;
      }

      if (event.type === "final") {
        clearPendingPartDeltaFlush();
        flushPendingPartDeltas();
        finalized = true;
        setWebLookupStatus(
          "text",
          event.googleSearchGroundingUsed ? "grounded" : "idle",
        );
        const assistantMessagesRaw =
          event.assistantMessages && event.assistantMessages.length > 0
            ? event.assistantMessages
            : [event.assistantMessage];
        const assistantMessages = suppressLeakedArtifactBodies(assistantMessagesRaw);
        updateConversationMessages(params.conversationId, (current) =>
          replaceOptimisticAssistantTurn(
            current,
            params.optimisticAssistantTurnId,
            assistantMessages,
          ),
        );
        for (const assistantMessage of assistantMessages) {
          const payload = assistantMessage.uiPayload ?? null;
          if (!payload) continue;

          if (isAgentTaskStatusPayload(payload)) {
            upsertLiveTaskSnapshot({
              taskId: payload.task.id,
              conversationId: params.conversationId,
              updater: (snapshot) => {
                const nextTask =
                  pickLatestTaskSummary(snapshot.task, payload.task) ?? payload.task;
                return {
                  ...snapshot,
                  task: nextTask,
                  approval:
                    nextTask.status === "approval_required" && !snapshot.artifact
                      ? snapshot.approval
                      : null,
                  failure:
                    nextTask.status === "failed"
                      ? snapshot.failure ??
                        (nextTask.errorMessage
                          ? {
                              traceId: null,
                              stage: "unknown",
                              stepKey: null,
                              stepTitle: null,
                              toolName: null,
                              code: null,
                              reason: nextTask.errorMessage,
                              toolOutputSummary: null,
                              sandboxJobId: null,
                              retriable: false,
                              occurredAt:
                                toIsoString(nextTask.updatedAt) ?? new Date().toISOString(),
                              rawMessage: nextTask.errorMessage,
                            }
                          : null)
                      : null,
                  latestStep: payload.latestStep ?? snapshot.latestStep,
                  timeline: appendLiveTimelineItem(snapshot.timeline, {
                  id: `final-status-${payload.task.status}`,
                  title: toTaskStatusLabel(payload.task.status),
                  detail: payload.text ?? assistantMessage.text,
                  status:
                    payload.task.status === "completed"
                      ? "completed"
                      : payload.task.status === "failed"
                        ? "failed"
                        : payload.task.status === "approval_required"
                          ? "blocked"
                          : payload.task.status === "queued"
                            ? "queued"
                            : "in_progress",
                  createdAt:
                    toIsoString(payload.task.updatedAt) ??
                    toIsoString(assistantMessage.createdAt) ??
                    new Date().toISOString(),
                  }),
                };
              },
            });
            continue;
          }

          if (isAgentApprovalPayload(payload)) {
            upsertLiveTaskSnapshot({
              taskId: payload.taskId,
              conversationId: params.conversationId,
              updater: (snapshot) => {
                const nextStatus: AgentTaskSummary["status"] =
                  payload.approval.status === "pending"
                    ? "approval_required"
                    : payload.approval.status === "denied"
                      ? "failed"
                      : "in_progress";
                return {
                  ...snapshot,
                  task: {
                    ...snapshot.task,
                    status: nextStatus,
                    updatedAt: new Date(),
                    completedAt:
                      nextStatus === "failed" ? new Date() : snapshot.task.completedAt,
                  },
                  approval: payload.approval.status === "pending" ? payload.approval : null,
                  timeline: appendLiveTimelineItem(snapshot.timeline, {
                  id: `approval-${payload.approval.id}`,
                  title:
                    payload.approval.status === "pending"
                      ? "Approval required"
                      : `Approval ${payload.approval.status}`,
                  detail: payload.approval.requestedAction,
                  status:
                    payload.approval.status === "denied" ? "failed" : "blocked",
                  createdAt:
                    toIsoString(payload.approval.respondedAt) ??
                    toIsoString(payload.approval.createdAt) ??
                    new Date().toISOString(),
                  }),
                };
              },
            });
            continue;
          }

          if (isAgentArtifactPayload(payload)) {
            upsertLiveTaskSnapshot({
              taskId: payload.taskId,
              conversationId: params.conversationId,
              updater: (snapshot) => ({
                ...snapshot,
                task: {
                  ...snapshot.task,
                  status: snapshot.task.status === "failed" ? "failed" : "completed",
                  errorMessage:
                    snapshot.task.status === "failed" ? snapshot.task.errorMessage : null,
                  updatedAt: new Date(),
                  completedAt: new Date(),
                },
                approval: null,
                artifact: payload.artifact,
                failure: snapshot.task.status === "failed" ? snapshot.failure : null,
                timeline: appendLiveTimelineItem(snapshot.timeline, {
                  id: `artifact-${payload.artifact.id}`,
                  title: "Artifact ready",
                  detail: payload.artifact.title,
                  status: "completed",
                  createdAt:
                    toIsoString(payload.artifact.updatedAt) ??
                    toIsoString(payload.artifact.createdAt) ??
                    new Date().toISOString(),
                }),
              }),
            });
          }
        }
        return;
      }

      if (event.type === "error") {
        setWebLookupStatus("text", "searching", "Retrying request…");
        clearPendingPartDeltaFlush();
        flushPendingPartDeltas();
        const err = new Error(event.message);
        (err as any).ackedUserMessageId = ackedUserMessageId;
        throw err;
      }
    };

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        while (true) {
          const lineBreakIndex = buffer.indexOf("\n");
          if (lineBreakIndex === -1) break;

          const line = buffer.slice(0, lineBreakIndex).trim();
          buffer = buffer.slice(lineBreakIndex + 1);
          if (!line) continue;

          const parsed = JSON.parse(line) as ChatStreamEvent;
          applyEvent(parsed);
        }
      }
    } catch (readError) {
      if ((readError as any).ackedUserMessageId === undefined) {
        (readError as any).ackedUserMessageId = ackedUserMessageId;
      }
      throw readError;
    }

    clearPendingPartDeltaFlush();
    flushPendingPartDeltas();

    if (!finalized) {
      const err = new Error("Stream ended before final response.");
      (err as any).ackedUserMessageId = ackedUserMessageId;
      throw err;
    }

    return { ackedUserMessageId };
  };

  const fallbackChatResponse = async (params: {
    conversationId: string;
    text: string;
    attachmentIds: string[];
    optimisticUserId: string;
    optimisticAssistantTurnId: string;
    existingUserMessageId?: string | null;
  }) => {
    const response = await apiRequest("POST", "/api/chat/respond", {
      conversationId: params.conversationId,
      text: params.text,
      persona,
      attachmentIds: params.attachmentIds,
      clientTimeZone: detectClientTimeZone(),
      existingUserMessageId: params.existingUserMessageId ?? undefined,
    });
    const payload = (await response.json()) as {
      userMessage: MessageData;
      assistantMessage: MessageData;
      assistantMessages?: MessageData[];
      googleSearchGroundingUsed?: boolean;
    };

    const assistantMessagesRaw =
      payload.assistantMessages && payload.assistantMessages.length > 0
        ? payload.assistantMessages
        : [payload.assistantMessage];
    const assistantMessages = suppressLeakedArtifactBodies(assistantMessagesRaw);

    updateConversationMessages(params.conversationId, (current) =>
      replaceOptimisticAssistantTurn(
        current.map((message) =>
          message.id === params.optimisticUserId ? payload.userMessage : message,
        ),
        params.optimisticAssistantTurnId,
        assistantMessages,
      ),
    );
    setWebLookupStatus(
      "text",
      payload.googleSearchGroundingUsed ? "grounded" : "idle",
    );
  };

  const handleSendMessage = async (text: string, options?: SendMessageOptions) => {
    const trimmed = text.trim();
    if (isSendingMessageRef.current) return;

    if (quotaSummary && quotaSummary.remaining.text <= 0) {
      setComposerError(
        "You reached your beta text limit for now. More texts unlock automatically on a rolling basis.",
      );
      return;
    }

    const includeAttachments = !options?.ignoreAttachments;
    const readyAttachments = includeAttachments
      ? pendingAttachments.filter(
          (item) => item.status === "ready" && item.attachmentId && item.attachment,
        )
      : [];
    const uploadingAttachments = includeAttachments
      ? pendingAttachments.filter((item) => item.status === "uploading")
      : [];

    if (uploadingAttachments.length > 0) {
      setComposerError("Wait for images to finish uploading before sending.");
      return;
    }

    if (!trimmed && readyAttachments.length === 0) {
      return;
    }

    setComposerError(null);
    setWebLookupStatus("text", "idle");
    isSendingMessageRef.current = true;
    setIsSendingMessage(true);

    let conversationId: string | null = null;
    let optimisticUserId = "";
    let optimisticAssistantTurnId = "";
    let attachmentIds: string[] = [];

    try {
      conversationId = await ensureActiveConversationId();
      const resolvedConversationId = conversationId;
      optimisticUserId = createLocalId("optimistic-user");
      optimisticAssistantTurnId = createLocalId("optimistic-assistant-turn");
      const firstOptimisticAssistantPartId = buildOptimisticAssistantPartId(
        optimisticAssistantTurnId,
        0,
      );

      updateConversationMessages(resolvedConversationId, (current) => [
        ...current,
        {
          id: optimisticUserId,
          conversationId: resolvedConversationId,
          sender: "user",
          text: trimmed,
          createdAt: new Date().toISOString(),
          attachments: readyAttachments
            .map((item) => item.attachment)
            .filter((item): item is MessageAttachmentData => Boolean(item)),
          localOnly: true,
        },
        {
          id: firstOptimisticAssistantPartId,
          conversationId: resolvedConversationId,
          sender: "assistant",
          turnId: optimisticAssistantTurnId,
          partIndex: 0,
          text: "",
          createdAt: new Date().toISOString(),
          isTyping: true,
          localOnly: true,
        },
      ]);

      attachmentIds = readyAttachments
        .map((item) => item.attachmentId)
        .filter((id): id is string => Boolean(id));

      try {
        await streamChatResponse({
          conversationId: resolvedConversationId,
          text: trimmed,
          attachmentIds,
          optimisticUserId,
          optimisticAssistantTurnId,
        });
        removePendingAttachmentsByLocalId(readyAttachments.map((item) => item.localId));
        queryClient.invalidateQueries({ queryKey: ["/api/quota/summary"] });
      } catch (streamError) {
        console.error("chat.stream.failed", streamError);
        const quotaError = parseQuotaError(streamError);
        if (quotaError) {
          updateConversationMessages(resolvedConversationId, (current) =>
            current.filter(
              (message) =>
                message.id !== optimisticUserId &&
                !isOptimisticAssistantPart(
                  message.id,
                  optimisticAssistantTurnId,
                ),
            ),
          );
          setComposerError(
            quotaError.message ??
              "You reached your beta text limit for now. More texts unlock automatically on a rolling basis.",
          );
          queryClient.invalidateQueries({ queryKey: ["/api/quota/summary"] });
          return;
        }
        const streamAckedUserMessageId =
          (streamError as any)?.ackedUserMessageId ?? null;
        try {
          await fallbackChatResponse({
            conversationId: resolvedConversationId,
            text: trimmed,
            attachmentIds,
            optimisticUserId,
            optimisticAssistantTurnId,
            existingUserMessageId: streamAckedUserMessageId,
          });
          removePendingAttachmentsByLocalId(
            readyAttachments.map((item) => item.localId),
          );
          queryClient.invalidateQueries({ queryKey: ["/api/quota/summary"] });
        } catch (fallbackError) {
          const quotaError = parseQuotaError(fallbackError);
          if (quotaError) {
            updateConversationMessages(resolvedConversationId, (current) =>
              current.filter(
                (message) =>
                  message.id !== optimisticUserId &&
                  !isOptimisticAssistantPart(
                    message.id,
                    optimisticAssistantTurnId,
                  ),
              ),
            );
            setComposerError(
              quotaError.message ??
                "You reached your beta text limit for now. More texts unlock automatically on a rolling basis.",
            );
            queryClient.invalidateQueries({ queryKey: ["/api/quota/summary"] });
            return;
          }
          updateConversationMessages(resolvedConversationId, (current) =>
            current.filter(
              (message) =>
                message.id !== optimisticUserId &&
                !isOptimisticAssistantPart(
                  message.id,
                  optimisticAssistantTurnId,
                ),
            ),
          );
          setComposerError(
            attachmentIds.length > 0
              ? "Message failed to send. Your uploaded images are still attached for retry."
              : "Message failed to send. Please try again.",
          );
          console.error("chat.respond.fallback.failed", fallbackError);
        }
      }
    } catch (error) {
      const quotaError = parseQuotaError(error);
      if (quotaError) {
        setComposerError(
          quotaError.message ??
            "You reached your beta text limit for now. More texts unlock automatically on a rolling basis.",
        );
        queryClient.invalidateQueries({ queryKey: ["/api/quota/summary"] });
      } else {
        setComposerError("Message failed to send. Please try again.");
      }
      console.error("chat.send.failed", error);
    } finally {
      isSendingMessageRef.current = false;
      setIsSendingMessage(false);
      if (conversationId) {
        queryClient.invalidateQueries({
          queryKey: getConversationMessagesKey(conversationId),
        });
      }
      queryClient.invalidateQueries({
        queryKey: ["/api/agent/artifacts?includeArchived=1"],
      });
    }
  };

  const stopLiveSession = async () => {
    manualLiveStopRef.current = true;
    liveStartNonceRef.current += 1;
    const runId = liveRunIdRef.current;
    pauseCameraUsageTracking();
    setWebLookupStatus("voice", "idle");

    logLiveTrace("live.stop.requested", {
      runId,
      isCalling,
      isLiveConnecting,
    });

    if (liveSessionRef.current) {
      await liveSessionRef.current.stop();
      liveSessionRef.current = null;
    }
    await transcriptQueueRef.current.catch(() => undefined);

    if (liveConversationRef.current) {
      queryClient.invalidateQueries({
        queryKey: getConversationMessagesKey(liveConversationRef.current),
      });
    }

    liveConversationRef.current = null;
    liveRunIdRef.current = null;
    liveSessionResumptionHandleRef.current = null;
    transcriptSeenRef.current = new Map();
    transcriptQueueRef.current = Promise.resolve();
    setIsCalling(false);
    setIsLiveConnecting(false);
    setCallStartTime(null);
    setIsVideoEnabled(false);
    setVideoStream(null);
    setIsVideoTransitioning(false);
    setLiveDebugState(null);
    setLiveTokenConfigSummary(null);
    liveTraceEntriesRef.current = [];
    if (liveDebugEnabled) {
      setLiveTraceEntries([]);
    }
    quotaAutoStopReasonRef.current = null;
    liveQuotaBudgetRef.current = null;
    resetCallUsageTracking();
    logLiveTrace("live.stop.completed", {
      runId,
    });
  };

  const startLiveSession = async (options?: {
    autoResumed?: boolean;
    restoreVideo?: boolean;
  }) => {
    if (!options?.autoResumed) {
      liveSessionResumptionHandleRef.current = null;
      setLiveDebugState(null);
      liveTraceEntriesRef.current = [];
      if (liveDebugEnabled) {
        setLiveTraceEntries([]);
      }
    }

    if (!options?.autoResumed) {
      if (quotaSummary && quotaSummary.remaining.voiceSeconds <= 0) {
        setLiveError(
          "You reached your beta voice minutes for now. Voice minutes unlock automatically on a rolling basis.",
        );
        queryClient.invalidateQueries({ queryKey: ["/api/quota/summary"] });
        return;
      }
      liveQuotaBudgetRef.current = quotaSummary
        ? {
            voiceSeconds: quotaSummary.remaining.voiceSeconds,
            cameraSeconds: quotaSummary.remaining.cameraSeconds,
          }
        : null;
      quotaAutoStopReasonRef.current = null;
      resetCallUsageTracking();
    }

    const startNonce = liveStartNonceRef.current + 1;
    liveStartNonceRef.current = startNonce;
    const runId = createLocalId("live");
    liveRunIdRef.current = runId;
    setLiveError(null);
    setWebLookupStatus("voice", "idle");
    setIsLiveConnecting(true);

    let preAcquiredMicStream: MediaStream | null = null;
    if (!options?.autoResumed) {
      try {
        preAcquiredMicStream = await getMicrophoneStreamWithFallback();
      } catch (micError: any) {
        setIsLiveConnecting(false);
        const msg = micError?.message ?? "";
        const micAttemptFailures = Array.isArray(micError?.attemptFailures)
          ? micError.attemptFailures
          : [];
        const micCompatibility =
          micError?.compatibility && typeof micError.compatibility === "object"
            ? micError.compatibility
            : null;
        const isAndroidUa = /android/i.test(navigator.userAgent || "");
        const captureContext = await collectMediaCaptureDebugContext().catch(
          () => ({} as Record<string, unknown>),
        );
        logLiveTrace("live.mic.permission_failed", {
          runId,
          error: msg,
          errorName: micError?.name ?? null,
          micAttemptFailures,
          micCompatibility,
          ...(captureContext ?? {}),
        });
        if (/denied|not allowed|permission/i.test(msg)) {
          setLiveError(
            "Microphone access was denied. To use voice calls, please allow microphone access in your browser settings and try again."
          );
        } else if (/not available|not supported/i.test(msg)) {
          setLiveError(
            isAndroidUa
              ? "This Android browser/WebView does not fully support live microphone capture. Update Chrome/WebView and try again."
              : "Your browser does not support microphone access. Please try using Safari or Chrome."
          );
        } else if (/timed?\s*out/i.test(msg)) {
          setLiveError(
            isAndroidUa
              ? "Microphone permission timed out on Android. Tap call again and allow mic access promptly, or update Chrome/WebView."
              : "Microphone permission request timed out. Please tap the call button again and allow microphone access when prompted."
          );
        } else {
          setLiveError(
            "Could not access your microphone. Please check your browser settings and try again."
          );
        }
        try {
          await fetch("/api/live/client-error", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              event: "live.mic.permission_failed",
              data: {
                error: msg,
                errorName: micError?.name,
                userAgent: navigator.userAgent,
                micAttemptFailures,
                micCompatibility,
                ...(captureContext ?? {}),
              },
            }),
          });
        } catch {}
        return;
      }
    }

    transcriptSeenRef.current = new Map();
    transcriptQueueRef.current = Promise.resolve();
    manualLiveStopRef.current = false;
    if (!options?.autoResumed) {
      autoResumeBudgetRef.current = 1;
    }

    let conversationId: string | null = null;
    let liveSession: GeminiLiveVoiceSession | null = null;
    let tokenModel: string | null = null;

    try {
      conversationId = await ensureActiveConversationId();
      liveConversationRef.current = conversationId;

      if (startNonce !== liveStartNonceRef.current) {
        preAcquiredMicStream?.getTracks().forEach(t => t.stop());
        return;
      }

      logLiveTrace("live.start.requested", {
        runId,
        conversationId,
        persona,
        voice: selectedVoiceRef.current,
        autoResumed: Boolean(options?.autoResumed),
      });

      const tokenPayload = await createLiveTokenMutation.mutateAsync({
        persona,
        voice: selectedVoiceRef.current,
        conversationId,
        deviceClass: detectLiveDeviceClass(),
      });
      tokenModel = tokenPayload.model;

      if (startNonce !== liveStartNonceRef.current) {
        preAcquiredMicStream?.getTracks().forEach(t => t.stop());
        return;
      }

      logLiveTrace("live.token.created", {
        runId,
        conversationId,
        model: tokenPayload.model,
        voice: tokenPayload.voice ?? selectedVoiceRef.current,
        traceId: tokenPayload.traceId,
        memoryMode: tokenPayload.memoryMeta?.mode ?? "safe_selective",
        memoryFallback: tokenPayload.memoryMeta?.fallbackUsed ?? "disabled",
        memoryBuildMs: tokenPayload.memoryMeta?.buildMs ?? 0,
        activeThreadMessagesUsed:
          tokenPayload.memoryMeta?.activeThreadMessagesUsed ?? 0,
        crossChatMessagesUsed:
          tokenPayload.memoryMeta?.crossChatMessagesUsed ?? 0,
        profileApplied: Boolean(tokenPayload.memoryMeta?.profileApplied),
        lowLatencyMode: tokenPayload.configSummary?.lowLatencyMode ?? null,
        activityHandling: tokenPayload.configSummary?.activityHandling ?? null,
        automaticActivityDetectionDisabled:
          tokenPayload.configSummary?.automaticActivityDetectionDisabled ?? null,
        forceAlwaysRespond: tokenPayload.configSummary?.forceAlwaysRespond ?? null,
        vadPrefixPaddingMs: tokenPayload.configSummary?.vadPrefixPaddingMs ?? null,
        vadSilenceMs: tokenPayload.configSummary?.vadSilenceMs ?? null,
        turnCoverage: tokenPayload.configSummary?.turnCoverage ?? null,
        affectiveDialog: tokenPayload.configSummary?.affectiveDialog ?? null,
        proactiveAudio: tokenPayload.configSummary?.proactiveAudio ?? null,
        sessionResumptionEnabled:
          tokenPayload.configSummary?.sessionResumptionEnabled ?? null,
        contextWindowCompressionEnabled:
          tokenPayload.configSummary?.contextWindowCompressionEnabled ?? null,
        effectiveInterruptMode:
          tokenPayload.configSummary?.effectiveInterruptMode ?? null,
        thinkingBudget: tokenPayload.configSummary?.thinkingBudget ?? null,
        googleSearchGroundingEnabled:
          tokenPayload.configSummary?.googleSearchGroundingEnabled ?? null,
        googlePersonalContextFunctionCallingEnabled:
          tokenPayload.configSummary?.googlePersonalContextFunctionCallingEnabled ??
          null,
      });
      setLiveTokenConfigSummary(tokenPayload.configSummary ?? null);
      if (!tokenPayload.configSummary?.googlePersonalContextFunctionCallingEnabled) {
        logLiveTrace("live.google_context.gate_disabled", {
          runId,
          conversationId,
          reason:
            "googlePersonalContextFunctionCallingEnabled=false in live token config",
          traceId: tokenPayload.traceId ?? null,
        });
      }

      const resolvedConversationId = conversationId;
      liveSession = new GeminiLiveVoiceSession({
        onTranscript: ({ sender, text }) => {
          queueTranscriptPersist({
            conversationId: resolvedConversationId,
            sender,
            text,
          });
        },
        onWebSearch: ({ status, label }) => {
          setWebLookupStatus("voice", status, label);
        },
        onMorningBriefDigest: ({ text }) => {
          if (!resolvedConversationId || !text.trim()) return;
          queueTranscriptPersist({
            conversationId: resolvedConversationId,
            sender: "assistant",
            text,
          });
        },
        onError: (error) => {
          console.error("Gemini Live session error:", {
            runId,
            error: error.message,
          });
          setLiveError(error.message);
        },
        onClosed: (reason) => {
          pauseCameraUsageTracking();
          setWebLookupStatus("voice", "idle");
          logLiveTrace("live.video.session_closed", {
            runId,
            reason: reason ?? "unknown",
          });
          const shouldAutoResume = !manualLiveStopRef.current;
          setIsLiveConnecting(false);
          setIsCalling(false);
          setCallStartTime(null);
          setIsVideoEnabled(false);
          setVideoStream(null);
          if (liveSessionRef.current === liveSession) {
            liveSessionRef.current = null;
          }
          if (liveSession) {
            try {
              void liveSession.stop();
            } catch {
              // Best-effort cleanup of old session resources.
            }
          }

          if (shouldAutoResume) {
            if (autoResumeBudgetRef.current <= 0) {
              logLiveTrace("live.video.auto_resume_failed", {
                runId,
                reason: "budget_exhausted",
              });
              setLiveError(
                "Live camera session ended. Reconnect to continue sharing video.",
              );
              return;
            }
            autoResumeBudgetRef.current -= 1;
            void startLiveSession({
              autoResumed: true,
              restoreVideo: isVideoEnabledRef.current,
            });
          }
        },
        onDebug: (message, metadata) => {
          logLiveTrace(message, {
            runId,
            ...(metadata ?? {}),
          });
        },
        onDebugState: (state) => {
          setLiveDebugState(state);
        },
        onSessionResumption: ({ handle, resumable, lastConsumedClientMessageIndex, at }) => {
          liveSessionResumptionHandleRef.current = handle;
          logLiveTrace("live.session_resumption.client_updated", {
            runId,
            resumable,
            handlePresent: Boolean(handle),
            lastConsumedClientMessageIndex,
            at,
          });
        },
        onGoAway: ({ timeLeft, at }) => {
          logLiveTrace("live.session.go_away.client_received", {
            runId,
            timeLeft,
            at,
          });
        },
      });

      liveSessionRef.current = liveSession;
      await liveSessionRef.current.start({
        ephemeralToken: tokenPayload.ephemeralToken,
        model: tokenPayload.model,
        conversationId,
        sessionResumptionHandle:
          options?.autoResumed
            ? liveSessionResumptionHandleRef.current
            : null,
        preAcquiredMicStream: preAcquiredMicStream ?? undefined,
        googleSearchGroundingEnabled:
          tokenPayload.configSummary?.googleSearchGroundingEnabled ?? false,
        morningBriefFunctionCallingEnabled:
          tokenPayload.configSummary?.morningBriefFunctionCallingEnabled ?? false,
        googlePersonalContextFunctionCallingEnabled:
          tokenPayload.configSummary?.googlePersonalContextFunctionCallingEnabled ??
          false,
      });

      if (startNonce !== liveStartNonceRef.current) {
        await liveSessionRef.current.stop().catch(() => undefined);
        liveSessionRef.current = null;
        return;
      }

      if (options?.restoreVideo && liveSessionRef.current) {
        const stream = await liveSessionRef.current.startVideo({
          facingMode: cameraFacingModeRef.current,
        });
        setVideoStream(stream);
        setIsVideoEnabled(true);
        beginCameraUsageTracking();
        logLiveTrace("live.video.auto_resumed", {
          runId,
          facingMode: cameraFacingModeRef.current,
        });
      }

      setIsCalling(true);
      setCallStartTime(Date.now());
      logLiveTrace("live.start.ready", {
        runId,
        conversationId,
      });
    } catch (error: any) {
      if (preAcquiredMicStream) {
        preAcquiredMicStream.getTracks().forEach(t => t.stop());
      }

      console.error("Failed to start Gemini Live session:", error);

      const isTimeout = /timed?\s*out/i.test(error?.message ?? "");
      const retryAttempt = (options as any)?._retryAttempt ?? 0;
      const isLikelyMicFailure =
        /microphone|media capture|getusermedia|audio/i.test(
          error?.message ?? "",
        ) || Array.isArray((error as any)?.attemptFailures);
      const micCaptureContext = isLikelyMicFailure
        ? await collectMediaCaptureDebugContext().catch(
            () => ({} as Record<string, unknown>),
          )
        : null;
      const micAttemptFailures = Array.isArray((error as any)?.attemptFailures)
        ? (error as any).attemptFailures
        : undefined;
      const micCompatibility =
        (error as any)?.compatibility &&
        typeof (error as any).compatibility === "object"
          ? (error as any).compatibility
          : undefined;

      try {
        await fetch("/api/live/client-error", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            event: "live.start.catch",
            data: {
              runId,
              conversationId,
              error: error?.message ?? String(error),
              errorName: error?.name,
              isTimeout,
              retryAttempt,
              model: tokenModel,
              userAgent: navigator.userAgent,
              micAttemptFailures,
              micCompatibility,
              ...(micCaptureContext ?? {}),
            },
          }),
        });
      } catch {}

      if (liveSession) {
        await liveSession.stop().catch(() => undefined);
      }
      if (liveSessionRef.current === liveSession) {
        liveSessionRef.current = null;
      }

      const MAX_RETRIES = 2;

      if (isTimeout && retryAttempt < MAX_RETRIES && startNonce === liveStartNonceRef.current && !manualLiveStopRef.current) {
        logLiveTrace("live.start.retry", {
          runId,
          conversationId,
          attempt: retryAttempt + 1,
          maxRetries: MAX_RETRIES,
        });
        const backoffMs = (retryAttempt + 1) * 1500;
        await new Promise((r) => setTimeout(r, backoffMs));
        if (startNonce === liveStartNonceRef.current) {
          return startLiveSession({ ...options, _retryAttempt: retryAttempt + 1 } as any);
        }
      }

      const quotaError = parseQuotaError(error);
      if (quotaError) {
        setLiveError(
          quotaError.message ??
            "You reached your beta voice minutes for now. Voice minutes unlock automatically on a rolling basis.",
        );
        queryClient.invalidateQueries({ queryKey: ["/api/quota/summary"] });
      } else {
        setLiveError(
          isTimeout
            ? "Connection timed out. Please check your signal and try again."
            : (error?.message ?? "We could not start the live voice session. Please try again."),
        );
      }

      setIsCalling(false);
      setCallStartTime(null);
      liveConversationRef.current = null;
      setIsVideoEnabled(false);
      setVideoStream(null);
      liveQuotaBudgetRef.current = null;
      resetCallUsageTracking();
      logLiveTrace("live.start.failed", {
        runId,
        conversationId,
        error: getErrorMessage(error),
        wasTimeout: isTimeout,
        retriesExhausted: isTimeout && retryAttempt >= MAX_RETRIES,
        isLikelyMicFailure,
        micAttemptFailures:
          typeof micAttemptFailures === "undefined"
            ? undefined
            : micAttemptFailures,
      });
    } finally {
      if (startNonce === liveStartNonceRef.current) {
        setIsLiveConnecting(false);
      }
    }
  };

  const handleToggleVideo = async () => {
    if (!liveSessionRef.current || !isCalling) {
      return;
    }

    const cameraBudgetRemaining =
      liveQuotaBudgetRef.current?.cameraSeconds ?? quotaSummary?.remaining.cameraSeconds;

    setLiveError(null);
    setIsVideoTransitioning(true);
    try {
      if (liveSessionRef.current.isVideoEnabled()) {
        pauseCameraUsageTracking();
        await liveSessionRef.current.stopVideo();
        setIsVideoEnabled(false);
        setVideoStream(null);
        logLiveTrace("live.video.stopped", { runId: liveRunIdRef.current });
      } else {
        if (
          typeof cameraBudgetRemaining === "number" &&
          getCurrentCameraUsageSeconds() >= cameraBudgetRemaining
        ) {
          setLiveError(
            "You reached your beta camera minutes for now. Camera minutes unlock automatically on a rolling basis.",
          );
          queryClient.invalidateQueries({ queryKey: ["/api/quota/summary"] });
          return;
        }
        const stream = await liveSessionRef.current.startVideo({
          facingMode: cameraFacingModeRef.current,
        });
        setVideoStream(stream);
        setIsVideoEnabled(true);
        beginCameraUsageTracking();
        logLiveTrace("live.video.started", {
          runId: liveRunIdRef.current,
          facingMode: cameraFacingModeRef.current,
        });
      }
    } catch (error) {
      setLiveError(toUserFacingCameraError(error, "Failed to toggle camera sharing"));
      logLiveTrace("live.video.toggle_failed", {
        runId: liveRunIdRef.current,
        error: getErrorMessage(error),
      });
    } finally {
      setIsVideoTransitioning(false);
    }
  };

  const handleInterruptAssistant = () => {
    if (!liveSessionRef.current || !isCalling) {
      return;
    }

    const interrupted = liveSessionRef.current.interruptAssistantPlayback(
      "voice_view_button",
    );
    if (!interrupted) {
      return;
    }

    setLiveError(null);
    logLiveTrace("live.assistant.interrupt_requested", {
      runId: liveRunIdRef.current,
      source: "voice_view_button",
    });
  };

  const handleFlipCamera = async () => {
    if (!liveSessionRef.current || !isCalling || !isVideoEnabled) {
      return;
    }

    setIsVideoTransitioning(true);
    try {
      const nextFacingMode = await liveSessionRef.current.flipCamera();
      setCameraFacingMode(nextFacingMode);
      setVideoStream(liveSessionRef.current.getVideoStream());
      logLiveTrace("live.video.flipped", {
        runId: liveRunIdRef.current,
        facingMode: nextFacingMode,
      });
    } catch (error) {
      setLiveError(toUserFacingCameraError(error, "Failed to switch camera"));
      logLiveTrace("live.video.flip_failed", {
        runId: liveRunIdRef.current,
        error: getErrorMessage(error),
      });
    } finally {
      setIsVideoTransitioning(false);
    }
  };

  const handleEndCall = () => {
    if (isCalling || isLiveConnecting || liveSessionRef.current) {
      if (isCalling) {
        pauseCameraUsageTracking();
        const cameraDuration = Math.min(duration, getCurrentCameraUsageSeconds());
        saveVoiceSessionMutation.mutate(
          { persona, duration, cameraDuration },
          {
            onError: (error) => {
              const quotaError = parseQuotaError(error);
              if (quotaError) {
                setLiveError(
                  quotaError.message ??
                    "You reached your beta live quota for now. Limits unlock automatically on a rolling basis.",
                );
                queryClient.invalidateQueries({ queryKey: ["/api/quota/summary"] });
                return;
              }
              console.error("voice.session.save.failed", error);
            },
          },
        );
      }
      void stopLiveSession();
    } else {
      void startLiveSession();
    }
  };

  useEffect(() => {
    return () => {
      if (liveSessionRef.current) {
        void liveSessionRef.current.stop();
        liveSessionRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (
      !isAuthenticated &&
      (isCalling || isLiveConnecting || liveSessionRef.current)
    ) {
      void stopLiveSession();
    }
  }, [isAuthenticated, isCalling, isLiveConnecting]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isCalling) {
      interval = setInterval(() => setDuration((d) => d + 1), 1000);
    } else {
      setDuration(0);
    }
    return () => clearInterval(interval);
  }, [isCalling]);

  useEffect(() => {
    if (!isCalling) return;

    const voiceBudget = liveQuotaBudgetRef.current?.voiceSeconds;
    if (
      typeof voiceBudget === "number" &&
      voiceBudget > 0 &&
      duration >= voiceBudget &&
      quotaAutoStopReasonRef.current !== "voice"
    ) {
      quotaAutoStopReasonRef.current = "voice";
      setLiveError(
        "You reached your beta voice minutes for now. Voice minutes unlock automatically on a rolling basis.",
      );
      queryClient.invalidateQueries({ queryKey: ["/api/quota/summary"] });
      handleEndCall();
      return;
    }

    const cameraBudget = liveQuotaBudgetRef.current?.cameraSeconds;
    if (
      typeof cameraBudget === "number" &&
      cameraBudget > 0 &&
      isVideoEnabled &&
      !isVideoTransitioning &&
      getCurrentCameraUsageSeconds() >= cameraBudget &&
      quotaAutoStopReasonRef.current !== "camera"
    ) {
      quotaAutoStopReasonRef.current = "camera";
      setLiveError(
        "You reached your beta camera minutes for now. Camera sharing has been stopped.",
      );
      queryClient.invalidateQueries({ queryKey: ["/api/quota/summary"] });
      void (async () => {
        pauseCameraUsageTracking();
        try {
          await liveSessionRef.current?.stopVideo();
        } catch (error) {
          console.error("live.video.auto_stop.failed", error);
        } finally {
          setIsVideoEnabled(false);
          setVideoStream(null);
          setIsVideoTransitioning(false);
        }
      })();
    }
  }, [
    duration,
    isCalling,
    isVideoEnabled,
    isVideoTransitioning,
    queryClient,
  ]);

  const resolvedProfileImage =
    userProfile?.avatarUrl || user?.profileImageUrl || undefined;
  const resolvedAssistantAvatar = getPersonaAvatar(persona, userProfile);
  const activeArtifact =
    activeArtifactResponse?.artifact ??
    (activeArtifactId
      ? artifacts.find((artifact) => artifact.id === activeArtifactId) ?? null
      : null);

  if (authLoading) {
    return (
      <div
        className="w-full h-[100dvh] min-h-[100dvh] flex items-center justify-center"
        style={{ backgroundColor: "var(--app-shell-bg)" }}
        data-testid="loading-screen"
      >
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="w-10 h-10 border-4 rounded-full"
          style={{
            borderColor: "var(--app-soft-card-border)",
            borderTopColor: "var(--app-accent)",
          }}
        />
      </div>
    );
  }

  if (!isAuthenticated) {
    if (showMarketingLanding) {
      return (
        <MarketingLandingPage
          onGetStarted={() => {
            setAuthEntryMode("welcome");
            setShowMarketingLanding(false);
          }}
          onSignIn={() => {
            setAuthEntryMode("login");
            setShowMarketingLanding(false);
          }}
        />
      );
    }
    return (
      <AuthPage
        onLogin={login}
        onRegister={register}
        loginError={loginError}
        registerError={registerError}
        isLoggingIn={isLoggingIn}
        isRegistering={isRegistering}
        initialMode={authEntryMode}
      />
    );
  }

  const isBrief = (text?: string) => text?.includes("## Morning Brief") || text?.includes("### TOP NEWS");
  const hasBriefInChat = messagesData.some(msg => 
    msg.sender === "assistant" && isBrief(msg.text)
  );

  return (
    <div
      className="w-full h-[100dvh] min-h-[100dvh] flex items-center justify-center overflow-hidden"
      style={{ backgroundColor: "var(--app-panel-bg)" }}
    >
      <div className="w-full h-full md:max-w-[400px] md:h-[850px] bg-background md:rounded-[2.5rem] shadow-2xl overflow-hidden relative">
        
        <AnimatePresence>
          {showOnboarding && (
            <OnboardingView
              onComplete={handleOnboardingComplete}
              userName={user?.firstName ?? null}
            />
          )}
        </AnimatePresence>

        <div className={cn("absolute inset-0", showOnboarding && "hidden")} aria-hidden={showOnboarding}>
          <SharedFooter 
            persona={persona}
            mode={mode}
            onSendMessage={handleSendMessage}
            onSelectCameraFiles={handleIncomingFiles}
            onSelectGalleryFiles={handleIncomingFiles}
            onRemoveAttachment={handleRemoveAttachment}
            pendingAttachments={pendingAttachments}
            isSending={isSendingMessage}
            uploadError={composerError}
            quotaSummary={quotaSummary}
            quotaLoading={isQuotaLoading}
            hasBriefInChat={hasBriefInChat}
          />

          <div className="absolute inset-0 z-0">
            <TextView
              messages={messagesData}
              isStreamingReply={isSendingMessage}
              persona={persona}
              assistantAvatarSrc={resolvedAssistantAvatar}
              webLookupStatus={textWebLookupStatus}
              webLookupLabel={textWebLookupLabel}
              mode={mode}
              userProfileImage={resolvedProfileImage}
              onOpenArtifact={handleOpenArtifact}
              onResolveApproval={handleResolveTaskApproval}
              onResolveOffer={handleResolveAgentOffer}
              liveTaskSnapshots={liveTaskSnapshots}
            />
          </div>

          <VoiceView 
            isActive={isCalling} 
            isConnecting={isLiveConnecting}
            onEndCall={handleEndCall}
            onInterruptAssistant={handleInterruptAssistant}
            onProfile={() => {
              setShowSettings(false);
              setShowOutputsHistory(false);
              setShowProfile(true);
            }}
            assistantName={persona}
            assistantAvatar={resolvedAssistantAvatar}
            selectedVoice={selectedVoice}
            setSelectedVoice={handleVoiceChange}
            mode={mode}
            setMode={setMode}
            duration={duration}
            userProfileImage={resolvedProfileImage}
            isVideoEnabled={isVideoEnabled}
            onToggleVideo={handleToggleVideo}
            onFlipCamera={handleFlipCamera}
            videoStream={videoStream}
            isVideoTransitioning={isVideoTransitioning}
            cameraFacingMode={cameraFacingMode}
            webLookupStatus={voiceWebLookupStatus}
            webLookupLabel={voiceWebLookupLabel}
            liveDebug={{
              enabled: liveDebugEnabled,
              state: liveDebugState,
              tokenConfigSummary: liveTokenConfigSummary,
              traces: liveTraceEntries,
              onExport: exportLiveDebugTrace,
            }}
          />

          <AnimatePresence>
            {showProfile && (
              <ProfileView
                onClose={() => {
                  applyAppTheme(selectedTheme);
                  setShowSettings(false);
                  setShowProfile(false);
                }}
                user={user}
                profile={userProfile}
                isProfileLoading={isProfileLoading}
                isSaving={updateProfileMutation.isPending || updatePreferencesMutation.isPending}
                isUploadingAvatar={uploadProfileAvatarMutation.isPending}
                selectedTheme={selectedTheme}
                onSaveProfile={handleSaveProfile}
                onSaveTheme={handleSaveTheme}
                onUploadAvatar={handleUploadProfileAvatar}
                onUploadZeeAvatar={handleUploadZeeAvatar}
                onReplayOnboarding={handleReplayOnboarding}
                onOpenSettings={() => setShowSettings(true)}
                onOpenOutputsHistory={() => {
                  setShowSettings(false);
                  setShowProfile(false);
                  setShowOutputsHistory(true);
                }}
                onLogout={logout}
                quotaSummary={quotaSummary}
                quotaTier={quotaTier}
                isQuotaLoading={isQuotaLoading}
              />
            )}
          </AnimatePresence>

          <AnimatePresence>
            {showSettings && (
              <SettingsView
                onClose={() => setShowSettings(false)}
                memorySettings={memorySettings}
                isMemorySettingsLoading={isMemorySettingsLoading}
                isSavingMemorySettings={updateMemorySettingsMutation.isPending}
                onUpdateMemorySettings={handleUpdateMemorySettings}
                memoryItems={memoryItems}
                isMemoryItemsLoading={isMemoryItemsLoading}
                onForgetMemoryItem={handleForgetMemoryItem}
              />
            )}
          </AnimatePresence>

          <AnimatePresence>
            {ENABLE_AGENTIC_CREATIONS && showOutputsHistory && (
              <OutputsHistoryView
                artifacts={artifacts}
                isLoading={isArtifactsLoading}
                onClose={() => setShowOutputsHistory(false)}
                onOpenArtifact={(artifactId) => {
                  setActiveArtifactId(artifactId);
                }}
                onArchiveArtifact={handleArchiveArtifact}
                onDeleteArtifact={handleDeleteArtifact}
              />
            )}
          </AnimatePresence>

          <AnimatePresence>
            {ENABLE_AGENTIC_CREATIONS && activeArtifactId && (
              <ArtifactViewer
                artifact={activeArtifact}
                isLoading={isActiveArtifactLoading && !activeArtifact}
                onClose={() => setActiveArtifactId(null)}
                onRetry={() => refetchActiveArtifact()}
              />
            )}
          </AnimatePresence>

          {liveError && (
            <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-[90] max-w-[85%] rounded-xl border border-red-400/30 bg-red-500/15 px-3 py-2 text-xs text-red-100 backdrop-blur-sm">
              {liveError}
            </div>
          )}
          {!liveError && isLiveConnecting && (
            <div
              className="absolute bottom-24 left-1/2 -translate-x-1/2 z-[90] max-w-[85%] rounded-xl border px-3 py-2 text-xs backdrop-blur-sm"
              style={{
                borderColor: "var(--app-soft-card-border)",
                backgroundColor: "var(--app-soft-card-bg)",
                color: "var(--app-on-dark)",
              }}
            >
              Connecting voice session...
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

export default App;
