import { useState, useEffect, useRef, useId } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, Video, PhoneOff, MessageSquare, Menu, Settings, ChevronRight, ChevronDown, X, ArrowLeft, Camera, LogOut, Eye, EyeOff, ImageIcon, Pencil } from "lucide-react";
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
import { GeminiLiveVoiceSession } from "@/lib/gemini-live";
import {
  APP_THEME_OPTIONS,
  DEFAULT_APP_THEME_ID,
  applyAppTheme,
  getAppTheme,
  isAppThemeId,
  type AppThemeId,
} from "@/lib/app-theme";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// --- Types ---
type Mode = "voice" | "text" | "profile";
type Persona = "Maya" | "Zarra" | "Zee";
type LiveVoiceName = "Aoede" | "Kore" | "Charon" | "Fenrir";
type CameraFacingMode = "user" | "environment";

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
  isTyping?: boolean;
  localOnly?: boolean;
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
  elapsedMs?: number;
}

interface ChatStreamErrorEvent {
  type: "error";
  message: string;
  traceId?: string;
}

type ChatStreamEvent =
  | ChatStreamAckEvent
  | ChatStreamDeltaEvent
  | ChatStreamPartFinalEvent
  | ChatStreamFinalEvent
  | ChatStreamErrorEvent;

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

interface QuotaSummaryData {
  window: "rolling_30_days";
  windowDays: number;
  limits: {
    text: number;
    voiceSeconds: number;
    cameraSeconds: number;
  };
  used: {
    text: number;
    voiceSeconds: number;
    cameraSeconds: number;
  };
  remaining: {
    text: number;
    voiceSeconds: number;
    cameraSeconds: number;
  };
  nextUnlockAt: {
    text: string | null;
    voiceSeconds: string | null;
    cameraSeconds: string | null;
  };
  metrics: {
    text: QuotaMetricData;
    voiceSeconds: QuotaMetricData;
    cameraSeconds: QuotaMetricData;
  };
}

interface QuotaSummaryResponse {
  traceId?: string;
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
    window?: string;
    windowDays?: number;
    limits?: {
      text?: number;
      voiceSeconds?: number;
      cameraSeconds?: number;
    };
    used?: {
      text?: number;
      voiceSeconds?: number;
      cameraSeconds?: number;
    };
    nextUnlockAt?: {
      text?: string | null;
      voiceSeconds?: string | null;
      cameraSeconds?: string | null;
    };
  };
}

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

function parseQuotaError(error: unknown): QuotaErrorPayload | null {
  const message = getErrorMessage(error);
  const [statusText, ...rest] = message.split(": ");
  const status = Number.parseInt(statusText, 10);
  if (status !== 429 || rest.length === 0) return null;
  const payloadText = rest.join(": ").trim();
  if (!payloadText.startsWith("{")) return null;
  return safeParseJson<QuotaErrorPayload>(payloadText);
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
const ASSISTANT_NAME: Persona = "Zee";
const DEFAULT_LIVE_VOICE: LiveVoiceName = "Aoede";
const LIVE_VOICE_OPTIONS: Array<{
  id: LiveVoiceName;
  label: string;
  style: "feminine" | "masculine";
}> = [
  { id: "Aoede", label: "Aoede", style: "feminine" },
  { id: "Kore", label: "Kore", style: "feminine" },
  { id: "Charon", label: "Charon", style: "masculine" },
  { id: "Fenrir", label: "Fenrir", style: "masculine" },
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

const AuthPage = ({ onLogin, onRegister, loginError, registerError, isLoggingIn, isRegistering }: {
  onLogin: (data: { email: string; password: string }) => Promise<any>;
  onRegister: (data: { email: string; password: string; confirmPassword?: string; firstName: string; lastName: string; profession?: string; referralSource?: string }) => Promise<any>;
  loginError: Error | null;
  registerError: Error | null;
  isLoggingIn: boolean;
  isRegistering: boolean;
}) => {
  const [authMode, setAuthMode] = useState<"welcome" | "login" | "register">("welcome");
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
    const landingSlide = ONBOARDING_STEPS[0];
    return (
      <div className="w-full h-[100dvh] min-h-[100dvh] flex items-center justify-center overflow-hidden" style={{ background: landingSlide.bgGradient }} data-testid="landing-page">
        <div className="w-full h-full md:max-w-[400px] md:h-[850px] md:rounded-[2.5rem] shadow-2xl overflow-hidden relative flex flex-col items-center justify-between p-8" style={{ background: landingSlide.bgGradient }}>
          <div className="flex-1 flex flex-col items-center justify-center w-full">
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2, type: "spring", stiffness: 150, damping: 20 }}
              className="mb-8"
            >
              <OnboardingOrb slide={landingSlide} />
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4, duration: 0.5 }}
              className="text-center space-y-4"
            >
              <h1 className="text-4xl font-serif font-bold text-white tracking-tight">
                Welcome
              </h1>
              <p className="text-lg leading-relaxed font-medium text-white/60">
                Your personal AI companion, always here.
              </p>
            </motion.div>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6, duration: 0.5 }}
            className="w-full space-y-3 mb-8"
          >
            <Button
              className="w-full h-14 text-lg rounded-2xl shadow-xl transition-transform active:scale-95 font-bold"
              style={{ backgroundColor: landingSlide.orbColor, color: "#0A0A0A" }}
              onClick={() => setAuthMode("register")}
              data-testid="button-get-started"
            >
              Get Started
            </Button>
            <Button 
              variant="ghost"
              className="w-full h-12 text-base text-white/50 hover:text-white hover:bg-white/10 rounded-2xl"
              onClick={() => setAuthMode("login")}
              data-testid="button-sign-in"
            >
              Already have an account? Sign in
            </Button>
          </motion.div>
        </div>
      </div>
    );
  }

  if (authMode === "login") {
    return (
      <div className="w-full h-[100dvh] min-h-[100dvh] bg-[#10383A] flex items-center justify-center overflow-hidden" data-testid="login-page">
        <div className="w-full h-full md:max-w-[400px] md:h-[850px] md:rounded-[2.5rem] shadow-2xl overflow-hidden relative flex flex-col bg-[#10383A]">
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
    <div className="w-full h-[100dvh] min-h-[100dvh] bg-[#10383A] flex items-center justify-center overflow-hidden" data-testid="register-page">
      <div className="w-full h-full md:max-w-[400px] md:h-[850px] md:rounded-[2.5rem] shadow-2xl overflow-hidden relative flex flex-col bg-[#10383A]">
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
  onSendMessage,
  onSelectCameraFiles,
  onSelectGalleryFiles,
  onRemoveAttachment,
  pendingAttachments,
  isSending,
  uploadError,
  quotaSummary,
  quotaLoading,
}: { 
  persona: Persona, 
  onSendMessage: (text: string) => void,
  onSelectCameraFiles: (files: FileList | null) => void;
  onSelectGalleryFiles: (files: FileList | null) => void;
  onRemoveAttachment: (localId: string) => void;
  pendingAttachments: PendingImageAttachment[];
  isSending: boolean;
  uploadError: string | null;
  quotaSummary?: QuotaSummaryData;
  quotaLoading?: boolean;
}) => {
  const [inputValue, setInputValue] = useState("");
  const [isMediaTrayOpen, setIsMediaTrayOpen] = useState(false);
  const cameraInputId = useId();
  const galleryInputId = useId();

  const hasReadyAttachment = pendingAttachments.some((item) => item.status === "ready");
  const hasUploadingAttachment = pendingAttachments.some(
    (item) => item.status === "uploading",
  );

  const handleSend = () => {
    const trimmed = inputValue.trim();
    if (!trimmed && !hasReadyAttachment) return;
    if (hasUploadingAttachment || isSending) return;
    onSendMessage(trimmed);
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
      <div className="mb-2 text-[11px]" style={{ color: "var(--app-on-dark-muted)" }}>
        {quotaLoading
          ? "Checking beta quota..."
          : quotaSummary
            ? `Beta quota: ${quotaSummary.remaining.text} texts left · ${formatMinutesFromSeconds(quotaSummary.remaining.voiceSeconds)} voice min left · ${formatMinutesFromSeconds(quotaSummary.remaining.cameraSeconds)} camera min left`
            : "Beta quota unavailable right now."}
      </div>
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
  onLogout,
  quotaSummary,
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
  onLogout: () => void;
  quotaSummary?: QuotaSummaryData;
  isQuotaLoading: boolean;
}) => {
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
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

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

  const bioWordCount = bio.trim().length === 0 ? 0 : bio.trim().split(/\s+/).length;
  const bioWordLimit = 1000;
  const approxBioCharLimit = 6000;
  const themedInputClass =
    "app-input-theme w-full rounded-xl border px-3 py-2 text-sm outline-none transition-colors focus:border-[var(--app-accent)] focus:ring-1 focus:ring-[var(--app-accent)]";
  const themedCardStyle = {
    backgroundColor: "var(--app-soft-card-bg)",
    borderColor: "var(--app-soft-card-border)",
  } as const;

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
                className="gap-2 p-3 font-medium cursor-pointer"
                data-testid={`button-voice-${voice.id.toLowerCase()}`}
              >
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold border"
                  style={{
                    backgroundColor: "var(--app-soft-card-bg)",
                    color: voice.style === "feminine" ? "var(--app-accent)" : "var(--app-muted)",
                    borderColor: "var(--app-soft-card-border)",
                    boxShadow:
                      selectedVoice === voice.id
                        ? "0 0 0 1px var(--app-soft-card-border)"
                        : undefined,
                  }}
                >
                  {voice.id.slice(0, 1)}
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

const VoiceView = ({ isActive, isConnecting, onEndCall, onProfile, assistantName, assistantAvatar, selectedVoice, setSelectedVoice, mode, setMode, duration, userProfileImage, isVideoEnabled, onToggleVideo, onFlipCamera, videoStream, isVideoTransitioning }: { 
  isActive: boolean; 
  isConnecting: boolean;
  onEndCall: () => void;
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
}) => {
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);

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

        <motion.div
          className="flex-1 flex flex-col pointer-events-auto"
          style={{
            paddingTop: "max(5rem, calc(env(safe-area-inset-top) + 3.2rem))",
            paddingBottom: "0.25rem",
          }}
          animate={{ opacity: mode === "voice" ? 1 : 0 }}
          transition={{ duration: 0.2 }}
        >
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
                      />
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
                    {[...Array(8)].map((_, i) => (
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
                    ))}
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
              <div className="flex items-center justify-center gap-8 mb-4">
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
                    variant="destructive" 
                    size="icon" 
                    className="w-20 h-20 rounded-full shadow-2xl hover:scale-105 transition-transform bg-red-500 hover:bg-red-600 text-white border-4"
                    style={{ borderColor: "var(--app-shell-bg)" }}
                    onClick={onEndCall}
                    data-testid="button-end-call"
                  >
                    <PhoneOff className="w-8 h-8" />
                  </Button>
                  <Button 
                    variant="outline" 
                    size="icon" 
                    className="w-14 h-14 rounded-full border-2 transition-colors hover:opacity-90"
                    style={{
                      borderColor: "var(--app-soft-card-border)",
                      backgroundColor: "var(--app-soft-card-bg)",
                      color: "var(--app-on-dark)",
                    }}
                    onClick={onFlipCamera}
                    disabled={!isVideoEnabled || isVideoTransitioning}
                    data-testid="button-flip-camera"
                  >
                    <Camera className="w-6 h-6" />
                  </Button>
              </div>
            )}

            <div
              className="flex flex-col items-center justify-center gap-2 py-3 pb-6 cursor-grab active:cursor-grabbing"
              style={{ color: "var(--app-on-dark-muted)" }}
            >
               <div className="w-12 h-1.5 rounded-full" style={{ backgroundColor: "var(--app-on-dark-muted)" }} />
               <span className="text-xs font-medium uppercase tracking-wider">Swipe up to chat</span>
            </div>
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

const TextView = ({
  messages,
  isStreamingReply,
  persona,
  assistantAvatarSrc,
  mode,
  userProfileImage,
}: {
  messages: MessageData[];
  isStreamingReply: boolean;
  persona: Persona;
  assistantAvatarSrc: string;
  mode: Mode;
  userProfileImage?: string;
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

  useEffect(() => {
    if (shouldAutoStickRef.current) {
      scrollToBottom(isStreamingReply);
      setShowJumpToNewest(false);
    }
  }, [messages, isStreamingReply]);

  const latestAssistantText =
    [...messages]
      .reverse()
      .find((msg) => msg.sender === "assistant")
      ?.text ?? "";

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
          {messages.map((msg, idx) => (
            <motion.div
              key={msg.id}
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
              <div className="flex items-end gap-2 max-w-[80%]">
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
                    "rounded-2xl text-sm leading-relaxed shadow-sm",
                    msg.sender === "user"
                      ? "font-medium rounded-br-none"
                      : "rounded-bl-none",
                  )}
                  style={
                    msg.sender === "user"
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
                  {(msg.attachments ?? []).length > 0 && (
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
                  <div className="px-5 py-3">
                    {msg.isTyping ? (
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
                    ) : (
                      msg.text
                    )}
                  </div>
                </div>
                {msg.sender === "user" && (
                  <div
                    className="w-8 h-8 rounded-full border flex items-center justify-center mb-1 text-xs font-bold overflow-hidden"
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
          ))}
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

  const [mode, setMode] = useState<Mode>("voice");
  const [isCalling, setIsCalling] = useState(false);
  const [isLiveConnecting, setIsLiveConnecting] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [duration, setDuration] = useState(0);
  const [callStartTime, setCallStartTime] = useState<number | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [isVideoEnabled, setIsVideoEnabled] = useState(false);
  const [isVideoTransitioning, setIsVideoTransitioning] = useState(false);
  const [cameraFacingMode, setCameraFacingMode] =
    useState<CameraFacingMode>("environment");
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null);

  const [pendingAttachments, setPendingAttachments] = useState<
    PendingImageAttachment[]
  >([]);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [isSendingMessage, setIsSendingMessage] = useState(false);

  const liveSessionRef = useRef<GeminiLiveVoiceSession | null>(null);
  const liveConversationRef = useRef<string | null>(null);
  const liveRunIdRef = useRef<string | null>(null);
  const liveStartNonceRef = useRef(0);
  const transcriptQueueRef = useRef<Promise<void>>(Promise.resolve());
  const transcriptSeenRef = useRef<Map<string, number>>(new Map());
  const manualLiveStopRef = useRef(false);
  const autoResumeBudgetRef = useRef(1);
  const isVideoEnabledRef = useRef(false);
  const cameraFacingModeRef = useRef<CameraFacingMode>("environment");
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
  const forceOnboardingRef = useRef<boolean>(
    typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("onboarding") === "1",
  );

  const logLiveTrace = (
    event: string,
    metadata: Record<string, unknown> = {},
  ) => {
    console.log("[LiveTrace]", event, metadata);
  };

  const getConversationMessagesKey = (conversationId: string) =>
    [`/api/conversations/${conversationId}/messages`];

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

  const { data: userProfile, isLoading: isProfileLoading } =
    useQuery<UserProfileData>({
      queryKey: ["/api/profile/me"],
      enabled: isAuthenticated,
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
    mutationFn: async (data: { persona: Persona; voice: LiveVoiceName }) => {
      const res = await apiRequest("POST", "/api/live/token", {
        persona: data.persona,
        voice: data.voice,
        responseModality: "AUDIO",
      });
      const body = (await res.json()) as {
        ephemeralToken: string;
        model: string;
        voice?: LiveVoiceName;
        traceId?: string;
      };
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

  const streamChatResponse = async (params: {
    conversationId: string;
    text: string;
    attachmentIds: string[];
    optimisticUserId: string;
    optimisticAssistantTurnId: string;
  }) => {
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

    const applyEvent = (event: ChatStreamEvent) => {
      if (event.type === "ack") {
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
        const partId = buildOptimisticAssistantPartId(
          params.optimisticAssistantTurnId,
          partIndex,
        );

        updateConversationMessages(params.conversationId, (current) => {
          const next = [...current];
          const existingIndex = next.findIndex((message) => message.id === partId);
          if (existingIndex >= 0) {
            next[existingIndex] = {
              ...next[existingIndex],
              text: `${next[existingIndex].text}${event.text}`,
              isTyping: false,
              partIndex,
            };
            return next;
          }

          const newPartMessage: MessageData = {
            id: partId,
            conversationId: params.conversationId,
            sender: "assistant",
            turnId: params.optimisticAssistantTurnId,
            partIndex,
            text: event.text,
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

          return next;
        });
        return;
      }

      if (event.type === "part_final") {
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

      if (event.type === "final") {
        finalized = true;
        const assistantMessages =
          event.assistantMessages && event.assistantMessages.length > 0
            ? event.assistantMessages
            : [event.assistantMessage];
        updateConversationMessages(params.conversationId, (current) =>
          replaceOptimisticAssistantTurn(
            current,
            params.optimisticAssistantTurnId,
            assistantMessages,
          ),
        );
        return;
      }

      if (event.type === "error") {
        throw new Error(event.message);
      }
    };

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

    if (!finalized) {
      throw new Error("Stream ended before final response.");
    }
  };

  const fallbackChatResponse = async (params: {
    conversationId: string;
    text: string;
    attachmentIds: string[];
    optimisticUserId: string;
    optimisticAssistantTurnId: string;
  }) => {
    const response = await apiRequest("POST", "/api/chat/respond", {
      conversationId: params.conversationId,
      text: params.text,
      persona,
      attachmentIds: params.attachmentIds,
    });
    const payload = (await response.json()) as {
      userMessage: MessageData;
      assistantMessage: MessageData;
      assistantMessages?: MessageData[];
    };

    const assistantMessages =
      payload.assistantMessages && payload.assistantMessages.length > 0
        ? payload.assistantMessages
        : [payload.assistantMessage];

    updateConversationMessages(params.conversationId, (current) =>
      replaceOptimisticAssistantTurn(
        current.map((message) =>
          message.id === params.optimisticUserId ? payload.userMessage : message,
        ),
        params.optimisticAssistantTurnId,
        assistantMessages,
      ),
    );
  };

  const handleSendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (isSendingMessage) return;

    if (quotaSummary && quotaSummary.remaining.text <= 0) {
      setComposerError(
        "You reached your beta text limit for now. More texts unlock automatically on a rolling basis.",
      );
      return;
    }

    const readyAttachments = pendingAttachments.filter(
      (item) => item.status === "ready" && item.attachmentId && item.attachment,
    );
    const uploadingAttachments = pendingAttachments.filter(
      (item) => item.status === "uploading",
    );

    if (uploadingAttachments.length > 0) {
      setComposerError("Wait for images to finish uploading before sending.");
      return;
    }

    if (!trimmed && readyAttachments.length === 0) {
      return;
    }

    setComposerError(null);
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
        try {
          await fallbackChatResponse({
            conversationId: resolvedConversationId,
            text: trimmed,
            attachmentIds,
            optimisticUserId,
            optimisticAssistantTurnId,
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
            "Message failed to send. Your uploaded images are still attached for retry.",
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
      setIsSendingMessage(false);
      if (conversationId) {
        queryClient.invalidateQueries({
          queryKey: getConversationMessagesKey(conversationId),
        });
      }
    }
  };

  const stopLiveSession = async () => {
    manualLiveStopRef.current = true;
    liveStartNonceRef.current += 1;
    const runId = liveRunIdRef.current;
    pauseCameraUsageTracking();

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
    transcriptSeenRef.current = new Map();
    transcriptQueueRef.current = Promise.resolve();
    setIsCalling(false);
    setIsLiveConnecting(false);
    setCallStartTime(null);
    setIsVideoEnabled(false);
    setVideoStream(null);
    setIsVideoTransitioning(false);
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
    setIsLiveConnecting(true);
    transcriptSeenRef.current = new Map();
    transcriptQueueRef.current = Promise.resolve();
    manualLiveStopRef.current = false;
    if (!options?.autoResumed) {
      autoResumeBudgetRef.current = 1;
    }

    let conversationId: string | null = null;
    let liveSession: GeminiLiveVoiceSession | null = null;

    try {
      conversationId = await ensureActiveConversationId();
      liveConversationRef.current = conversationId;

      if (startNonce !== liveStartNonceRef.current) {
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
      });

      if (startNonce !== liveStartNonceRef.current) {
        return;
      }

      logLiveTrace("live.token.created", {
        runId,
        conversationId,
        model: tokenPayload.model,
        voice: tokenPayload.voice ?? selectedVoiceRef.current,
        traceId: tokenPayload.traceId,
      });

      const resolvedConversationId = conversationId;
      liveSession = new GeminiLiveVoiceSession({
        onTranscript: ({ sender, text }) => {
          queueTranscriptPersist({
            conversationId: resolvedConversationId,
            sender,
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
          logLiveTrace("live.video.session_closed", {
            runId,
            reason: reason ?? "unknown",
          });
          const shouldAutoResume =
            !manualLiveStopRef.current && isVideoEnabledRef.current;
          setIsLiveConnecting(false);
          setIsCalling(false);
          setCallStartTime(null);
          setIsVideoEnabled(false);
          setVideoStream(null);
          if (liveSessionRef.current === liveSession) {
            liveSessionRef.current = null;
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
            void startLiveSession({ autoResumed: true, restoreVideo: true });
          }
        },
        onDebug: (message, metadata) => {
          logLiveTrace(message, {
            runId,
            ...(metadata ?? {}),
          });
        },
      });

      liveSessionRef.current = liveSession;
      await liveSessionRef.current.start({
        ephemeralToken: tokenPayload.ephemeralToken,
        model: tokenPayload.model,
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
      console.error("Failed to start Gemini Live session:", error);
      const quotaError = parseQuotaError(error);
      if (quotaError) {
        setLiveError(
          quotaError.message ??
            "You reached your beta voice minutes for now. Voice minutes unlock automatically on a rolling basis.",
        );
        queryClient.invalidateQueries({ queryKey: ["/api/quota/summary"] });
      } else {
        setLiveError(
          error?.message ??
            "We could not start the live voice session. Please try again.",
        );
      }

      if (liveSession) {
        await liveSession.stop().catch(() => undefined);
      }

      if (liveSessionRef.current === liveSession) {
        liveSessionRef.current = null;
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
    return (
      <AuthPage
        onLogin={login}
        onRegister={register}
        loginError={loginError}
        registerError={registerError}
        isLoggingIn={isLoggingIn}
        isRegistering={isRegistering}
      />
    );
  }

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
            onSendMessage={handleSendMessage}
            onSelectCameraFiles={handleIncomingFiles}
            onSelectGalleryFiles={handleIncomingFiles}
            onRemoveAttachment={handleRemoveAttachment}
            pendingAttachments={pendingAttachments}
            isSending={isSendingMessage}
            uploadError={composerError}
            quotaSummary={quotaSummary}
            quotaLoading={isQuotaLoading}
          />

          <div className="absolute inset-0 z-0">
            <TextView
              messages={messagesData}
              isStreamingReply={isSendingMessage}
              persona={persona}
              assistantAvatarSrc={resolvedAssistantAvatar}
              mode={mode}
              userProfileImage={resolvedProfileImage}
            />
          </div>

          <VoiceView 
            isActive={isCalling} 
            isConnecting={isLiveConnecting}
            onEndCall={handleEndCall}
            onProfile={() => setShowProfile(true)}
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
          />

          <AnimatePresence>
            {showProfile && (
              <ProfileView
                onClose={() => {
                  applyAppTheme(selectedTheme);
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
                onLogout={logout}
                quotaSummary={quotaSummary}
                isQuotaLoading={isQuotaLoading}
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
