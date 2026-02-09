import { useState, useEffect, useRef, useId } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, Video, PhoneOff, MessageSquare, Menu, Settings, ChevronRight, X, ArrowLeft, Camera, Paperclip, LogOut, Eye, EyeOff, ImageIcon } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import onboarding1 from "@/assets/onboarding-1-v2.png";
import onboarding2 from "@/assets/onboarding-2-v2.png";
import onboarding3 from "@/assets/onboarding-3-v2.png";
import mayaAvatar from "@/assets/maya-avatar.png";
import zarraAvatar from "@/assets/zarra-avatar.png";
import zeeAvatar from "@/assets/zee-avatar.png";
import leafBg from "@/assets/leaf-bg.png";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getResponseTraceId } from "@/lib/queryClient";
import { GeminiLiveVoiceSession } from "@/lib/gemini-live";

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

function getPersonaAvatar(persona: Persona | string): string {
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
  avatarAttachmentId: string | null;
  avatarUrl: string | null;
  createdAt: string | null;
  updatedAt: string | null;
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
    title: "Welcome, Friend!",
    description: "You're now part of our incredible and caring community. Let's get started!",
    image: onboarding1,
    color: "bg-[#10383A]",
    textColor: "text-[#E8E8E8]"
  },
  {
    id: 2,
    title: "Discover Balance",
    description: "Find peace and mindfulness with personalized guidance every day.",
    image: onboarding2,
    color: "bg-[#809276]",
    textColor: "text-[#10383A]"
  },
  {
    id: 3,
    title: "Grow Together",
    description: "Connect with your personal AI companion anytime, anywhere.",
    image: onboarding3,
    color: "bg-[#DAA112]",
    textColor: "text-[#10383A]"
  }
];

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
        className="w-full h-12 px-4 rounded-xl bg-white/10 border border-white/20 text-white placeholder:text-white/40 focus:outline-none focus:border-[#DAA112] focus:ring-1 focus:ring-[#DAA112] transition-colors"
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

  const inputClass = "w-full h-12 px-4 rounded-xl bg-white/10 border border-white/20 text-white placeholder:text-white/40 focus:outline-none focus:border-[#DAA112] focus:ring-1 focus:ring-[#DAA112] transition-colors";

  if (authMode === "welcome") {
    return (
      <div className="w-full h-screen bg-[#10383A] flex items-center justify-center overflow-hidden" data-testid="landing-page">
        <div className="w-full h-full md:max-w-[400px] md:h-[850px] md:rounded-[2.5rem] shadow-2xl overflow-hidden relative flex flex-col items-center justify-between p-8 bg-[#10383A]">
          <div className="flex-1 flex flex-col items-center justify-center w-full">
            <motion.img
              src={onboarding1}
              alt="Welcome"
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ delay: 0.2, type: "spring", stiffness: 200, damping: 20 }}
              className="w-full max-w-[280px] object-contain drop-shadow-2xl mb-8"
            />
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4, duration: 0.5 }}
              className="text-center space-y-4"
            >
              <h1 className="text-4xl font-serif font-bold text-[#E8E8E8] tracking-tight">
                Welcome
              </h1>
              <p className="text-lg leading-relaxed font-medium text-white/70">
                Your personal AI companion for mindfulness and balance.
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
              className="w-full h-14 text-lg rounded-2xl shadow-xl bg-[#DAA112] text-[#10383A] hover:bg-[#DAA112]/90 transition-transform active:scale-95 font-bold" 
              onClick={() => setAuthMode("register")}
              data-testid="button-get-started"
            >
              Get Started
            </Button>
            <Button 
              variant="ghost"
              className="w-full h-12 text-base text-white/70 hover:text-white hover:bg-white/10 rounded-2xl"
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
      <div className="w-full h-screen bg-[#10383A] flex items-center justify-center overflow-hidden" data-testid="login-page">
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
    <div className="w-full h-screen bg-[#10383A] flex items-center justify-center overflow-hidden" data-testid="register-page">
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
}: { 
  persona: Persona, 
  onSendMessage: (text: string) => void,
  onSelectCameraFiles: (files: FileList | null) => void;
  onSelectGalleryFiles: (files: FileList | null) => void;
  onRemoveAttachment: (localId: string) => void;
  pendingAttachments: PendingImageAttachment[];
  isSending: boolean;
  uploadError: string | null;
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
    <div className="absolute bottom-0 left-0 right-0 z-50 p-4 bg-[#10383A]/90 backdrop-blur-md border-t border-white/10">
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
            className="mb-3 rounded-2xl border border-[#DAA112]/20 bg-gradient-to-b from-[#10383A] to-[#0D2E30] p-3 shadow-lg shadow-black/30"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold tracking-wide text-white/80 uppercase">
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
                  "group flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3.5 transition-all hover:border-[#DAA112]/40 hover:bg-[#DAA112]/10 active:scale-[0.97]",
                  isSending && "pointer-events-none opacity-60",
                )}
                onClick={() => setIsMediaTrayOpen(false)}
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#DAA112]/15 text-[#DAA112] group-hover:bg-[#DAA112]/25 transition-colors">
                  <Camera className="h-4.5 w-4.5" />
                </div>
                <span className="text-xs font-medium text-white/70 group-hover:text-white transition-colors">
                  Take photo
                </span>
              </label>
              <label
                htmlFor={galleryInputId}
                className={cn(
                  "group flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3.5 transition-all hover:border-[#DAA112]/40 hover:bg-[#DAA112]/10 active:scale-[0.97]",
                  isSending && "pointer-events-none opacity-60",
                )}
                onClick={() => setIsMediaTrayOpen(false)}
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#809276]/20 text-[#809276] group-hover:bg-[#809276]/30 transition-colors">
                  <ImageIcon className="h-4.5 w-4.5" />
                </div>
                <span className="text-xs font-medium text-white/70 group-hover:text-white transition-colors">
                  Photo library
                </span>
              </label>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex items-center gap-2">
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
         <Button 
          variant="ghost" 
          size="icon" 
          className="text-white/70 hover:bg-white/10 hover:text-white transition-colors"
          onClick={() => setIsMediaTrayOpen((current) => !current)}
          disabled={isSending}
        >
           <Camera className="w-6 h-6" />
         </Button>
         <Button 
          variant="ghost" 
          size="icon" 
          className="text-white/70 hover:bg-white/10 hover:text-white transition-colors"
          onClick={() => setIsMediaTrayOpen((current) => !current)}
          disabled={isSending}
        >
           <Paperclip className="w-6 h-6" />
         </Button>
         <div className="flex-1 bg-black/20 rounded-full px-4 py-2.5 border border-white/5 focus-within:border-white/20 focus-within:bg-black/30 transition-all">
           <input 
            type="text" 
            placeholder={`Message ${persona}...`} 
            className="w-full bg-transparent border-none outline-none text-sm text-white placeholder:text-white/40"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isSending}
            data-testid="input-message"
          />
         </div>
         <Button 
           size="icon" 
           className="rounded-full bg-[#DAA112] text-[#10383A] shadow-md hover:bg-[#DAA112]/90"
           onClick={handleSend}
           disabled={isSending || hasUploadingAttachment || (!inputValue.trim() && !hasReadyAttachment)}
           data-testid="button-send-message"
         >
           <ChevronRight className="w-5 h-5" />
         </Button>
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
  onSaveProfile,
  onUploadAvatar,
  onLogout,
}: {
  onClose: () => void;
  user: any;
  profile: UserProfileData | undefined;
  isProfileLoading: boolean;
  isSaving: boolean;
  isUploadingAvatar: boolean;
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
  }) => Promise<void>;
  onUploadAvatar: (file: File) => Promise<void>;
  onLogout: () => void;
}) => {
  const avatarInputId = useId();
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [location, setLocation] = useState("");
  const [ageInput, setAgeInput] = useState("");
  const [profession, setProfession] = useState("");
  const [gender, setGender] = useState<GenderOption | "">("");
  const [genderOther, setGenderOther] = useState("");
  const [stylePreset, setStylePreset] = useState<ResponseStylePreset>("balanced");
  const [styleNote, setStyleNote] = useState("");
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
    setSaveError(null);
    setSaveSuccess(null);
  }, [profile, user?.profession]);

  const bioWordCount = bio.trim().length === 0 ? 0 : bio.trim().split(/\s+/).length;
  const bioWordLimit = 1000;
  const approxBioCharLimit = 6000;

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
      });
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
      className="absolute inset-0 z-50 bg-background flex flex-col h-full overflow-hidden"
    >
      <div className="relative h-48 shrink-0 overflow-hidden">
        <img src={leafBg} alt="Cover" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-background/90" />
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-4 left-4 text-white hover:bg-white/20"
          onClick={onClose}
          data-testid="button-close-profile"
        >
          <ArrowLeft className="w-6 h-6" />
        </Button>
      </div>

      <div className="px-6 -mt-12 relative z-10 flex flex-col min-h-0" style={{ height: "calc(100% - 12rem + 3rem)" }}>
        <div className="flex flex-col items-center mb-6">
          <label
            htmlFor={avatarInputId}
            className={cn(
              "relative cursor-pointer rounded-full",
              isUploadingAvatar && "pointer-events-none opacity-70",
            )}
            data-testid="button-edit-avatar"
          >
            <Avatar className="w-24 h-24 border-4 border-background shadow-xl">
              <AvatarImage src={profile?.avatarUrl || user?.profileImageUrl} />
              <AvatarFallback>
                {user?.firstName?.[0] || "U"}
                {user?.lastName?.[0] || ""}
              </AvatarFallback>
            </Avatar>
            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full bg-black/65 px-2 py-0.5 text-[10px] text-white">
              {isUploadingAvatar ? "Uploading..." : "Edit photo"}
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
            <h2 className="text-2xl font-bold text-foreground" data-testid="text-username">
              {user?.firstName || ""} {user?.lastName || ""}
            </h2>
            <p className="text-muted-foreground italic">"Here for you, always"</p>
          </div>
        </div>

        <ScrollArea className="flex-1 min-h-0 -mx-6 px-6 pb-6">
          <form onSubmit={onSubmit} className="space-y-6">
            <section>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Account
              </h3>
              <div className="bg-card rounded-xl p-4 shadow-sm border space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium">Email</span>
                  <span className="text-muted-foreground text-sm" data-testid="text-user-email">
                    {user?.email || "Not set"}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Optional profile fields help Zee personalize better.
                </p>
              </div>
            </section>

            <section>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Personalization
              </h3>
              <div className="bg-card rounded-xl p-4 shadow-sm border space-y-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="profile-display-name">
                    Preferred name
                  </label>
                  <input
                    id="profile-display-name"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    maxLength={120}
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[#DAA112]"
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
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[#DAA112]"
                    placeholder="Share what matters to you, your goals, and your vibe."
                    data-testid="input-profile-bio"
                  />
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>{bioWordCount}/{bioWordLimit} words</span>
                    <span>{bio.length}/{approxBioCharLimit} chars</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium" htmlFor="profile-location">
                      Location
                    </label>
                    <input
                      id="profile-location"
                      value={location}
                      onChange={(event) => setLocation(event.target.value)}
                      maxLength={120}
                      className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[#DAA112]"
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
                      className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[#DAA112]"
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
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[#DAA112]"
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
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[#DAA112]"
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
                      className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[#DAA112]"
                      placeholder="Share if you'd like"
                      data-testid="input-profile-gender-other"
                    />
                  </div>
                )}
              </div>
            </section>

            <section>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Response Style
              </h3>
              <div className="bg-card rounded-xl p-4 shadow-sm border space-y-4">
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
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[#DAA112]"
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
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[#DAA112]"
                    placeholder='Example: "Use more humor and quick punchy replies."'
                    data-testid="input-profile-style-note"
                  />
                </div>
              </div>
            </section>

            {(saveError || saveSuccess || isProfileLoading) && (
              <div className="rounded-xl border border-border bg-card px-3 py-2 text-xs">
                {isProfileLoading && <p className="text-muted-foreground">Loading profile...</p>}
                {saveError && <p className="text-red-500">{saveError}</p>}
                {saveSuccess && <p className="text-emerald-600">{saveSuccess}</p>}
              </div>
            )}

            <section className="space-y-3 pb-4">
              <Button
                type="submit"
                className="w-full h-12 rounded-xl gap-2 bg-[#10383A] text-white hover:bg-[#10383A]/90"
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
    <div className="absolute top-0 left-0 right-0 z-50 flex items-center justify-between p-6 pt-8 pointer-events-none">
      <div className="pointer-events-auto">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 bg-[#10383A] border border-white/10 px-4 py-2 rounded-2xl shadow-sm hover:bg-[#10383A]/80 transition-colors focus:outline-none" data-testid="button-persona-selector">
              <div className="flex flex-col items-start leading-tight">
                <span className="font-bold text-lg text-white">{assistantName}</span>
                <span className="text-[10px] uppercase tracking-wide text-white/60">
                  Voice: {selectedVoice}
                </span>
              </div>
              <ChevronRight className="w-4 h-4 rotate-90 text-white/70" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56 rounded-xl bg-[#10383A] border-white/10 text-white">
            {LIVE_VOICE_OPTIONS.map((voice) => (
              <DropdownMenuItem
                key={voice.id}
                onClick={() => setSelectedVoice(voice.id)}
                className="gap-2 p-3 font-medium cursor-pointer focus:bg-white/10 focus:text-white"
                data-testid={`button-voice-${voice.id.toLowerCase()}`}
              >
                <div
                  className={cn(
                    "w-6 h-6 rounded-full flex items-center justify-center text-[10px] text-white font-bold",
                    voice.style === "feminine" ? "bg-pink-500/80" : "bg-sky-500/80",
                  )}
                >
                  {voice.id.slice(0, 1)}
                </div>
                <div className="flex items-center gap-2">
                  <span>{voice.label}</span>
                  <span className="text-[10px] uppercase tracking-wide text-white/60">
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
            className="absolute left-1/2 -translate-x-1/2 font-mono text-sm font-medium text-white/70 bg-black/20 px-3 py-1 rounded-full backdrop-blur-sm"
          >
            {formatTime(duration)}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="pointer-events-auto">
        <Button variant="ghost" size="icon" className="rounded-full w-12 h-12" onClick={onProfile} data-testid="button-profile">
          <div className="w-full h-full rounded-full border border-white/20 bg-white/10 overflow-hidden p-0.5">
              <Avatar className="w-full h-full">
                <AvatarImage src={userProfileImage} className="object-cover" />
                <AvatarFallback className="bg-[#809276] text-white text-sm">U</AvatarFallback>
              </Avatar>
          </div>
        </Button>
      </div>
    </div>
  );
};

const VoiceView = ({ isActive, isConnecting, onEndCall, onProfile, assistantName, selectedVoice, setSelectedVoice, mode, setMode, duration, userProfileImage, isVideoEnabled, onToggleVideo, onFlipCamera, videoStream, isVideoTransitioning }: { 
  isActive: boolean; 
  isConnecting: boolean;
  onEndCall: () => void;
  onProfile: () => void;
  assistantName: Persona;
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
      className="absolute top-0 left-0 right-0 z-40 bg-[#10383A] rounded-b-[2.5rem] shadow-2xl overflow-hidden"
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
      <div className="w-full h-screen relative flex flex-col pointer-events-none">
        
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
          className="flex-1 flex flex-col pt-24 pb-4 pointer-events-auto"
          animate={{ opacity: mode === "voice" ? 1 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <div className="flex-1 flex flex-col items-center justify-center relative">
            {isActive ? (
              <div className="w-full h-full flex items-center justify-center px-8">
                <div
                  className={cn(
                    "relative flex w-full items-center justify-center",
                    isVideoEnabled ? "h-[56vh]" : "h-32",
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
                  <div
                    className={cn(
                      "z-10 flex items-center justify-center gap-1.5",
                      isVideoEnabled &&
                        "absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full bg-black/35 px-4 py-3 backdrop-blur-sm",
                    )}
                  >
                    {[...Array(8)].map((_, i) => (
                      <motion.div
                        key={i}
                        className={cn(
                          "rounded-full opacity-80",
                          isVideoEnabled ? "w-3" : "w-4",
                        )}
                        animate={{
                          height: ["20%", "80%", "20%"],
                          backgroundColor: ["#DAA112", "#FFF", "#DAA112"]
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
              <div className="flex flex-col items-center gap-8">
                 <button
                   type="button"
                   className={cn(
                     "relative group cursor-pointer",
                     isConnecting && "cursor-wait opacity-80",
                   )}
                   onClick={onEndCall}
                   disabled={isConnecting}
                   aria-label={isConnecting ? "Connecting voice session" : `Start voice call with ${assistantName}`}
                   data-testid="button-start-call"
                 >
                   <div className="absolute inset-0 bg-[#DAA112]/20 rounded-full animate-ping opacity-20 duration-3000" />
                   <div className="absolute -inset-4 bg-[#DAA112]/10 rounded-full animate-pulse opacity-30" />
                   
                   <div className={cn(
                     "w-32 h-32 bg-[#DAA112] rounded-full flex items-center justify-center shadow-[0_0_40px_rgba(218,161,18,0.3)] transform transition-transform",
                     !isConnecting && "group-hover:scale-105 active:scale-95",
                   )}>
                      <Mic className="w-12 h-12 text-[#10383A]" />
                   </div>
                 </button>
                 <p className="text-white/60 font-medium tracking-wide">
                   {isConnecting ? `Connecting to ${assistantName}...` : `Tap to speak to ${assistantName}`}
                 </p>
              </div>
            )}
          </div>

          <div className="px-6 space-y-6 pb-24">
            {isActive && (
              <div className="flex items-center justify-center gap-8 mb-4">
                  <Button 
                    variant="outline" 
                    size="icon" 
                    className={cn(
                      "w-14 h-14 rounded-full border-2 border-white/10 transition-colors text-white",
                      isVideoEnabled
                        ? "bg-[#DAA112]/30 border-[#DAA112]/70"
                        : "bg-white/5 hover:bg-white/10",
                    )}
                    onClick={onToggleVideo}
                    disabled={isVideoTransitioning}
                    data-testid="button-toggle-video"
                  >
                    <Video className="w-6 h-6" />
                  </Button>
                  <Button 
                    variant="destructive" 
                    size="icon" 
                    className="w-20 h-20 rounded-full shadow-2xl hover:scale-105 transition-transform bg-red-500 hover:bg-red-600 text-white border-4 border-[#10383A]"
                    onClick={onEndCall}
                    data-testid="button-end-call"
                  >
                    <PhoneOff className="w-8 h-8" />
                  </Button>
                  <Button 
                    variant="outline" 
                    size="icon" 
                    className="w-14 h-14 rounded-full border-2 border-white/10 bg-white/5 hover:bg-white/10 transition-colors text-white"
                    onClick={onFlipCamera}
                    disabled={!isVideoEnabled || isVideoTransitioning}
                    data-testid="button-flip-camera"
                  >
                    <Camera className="w-6 h-6" />
                  </Button>
              </div>
            )}

            <div className="flex flex-col items-center justify-center gap-2 py-2 text-white/30 cursor-grab active:cursor-grabbing">
               <div className="w-12 h-1.5 bg-white/20 rounded-full" />
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
               <div className="w-12 h-1.5 bg-white/20 rounded-full" />
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
  mode,
}: {
  messages: MessageData[];
  isStreamingReply: boolean;
  persona: Persona;
  mode: Mode;
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
    <div className="h-full flex flex-col bg-[#0D2E30] pt-40 pb-24 relative">
      <div className="sr-only" aria-live="polite">
        {isStreamingReply && !latestAssistantText
          ? `${persona} is typing`
          : latestAssistantText}
      </div>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4"
      >
        <div className="space-y-4 pb-8">
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn(
                "flex w-full",
                msg.sender === "user" ? "justify-end" : "justify-start",
              )}
            >
              <div className="flex items-end gap-2 max-w-[80%]">
                {msg.sender !== "user" && (
                  <Avatar className="w-8 h-8 mb-1 shrink-0 ring-2 ring-white/10">
                    <AvatarImage src={getPersonaAvatar(persona)} />
                    <AvatarFallback>{persona[0]}</AvatarFallback>
                  </Avatar>
                )}
                <div
                  className={cn(
                    "rounded-2xl text-sm leading-relaxed shadow-sm",
                    msg.sender === "user"
                      ? "bg-[#DAA112] text-[#10383A] font-medium rounded-br-none"
                      : "bg-white text-[#10383A] rounded-bl-none",
                  )}
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
                      <div className="flex items-center gap-1.5">
                        <span className="h-2 w-2 animate-bounce rounded-full bg-[#10383A]" />
                        <span className="h-2 w-2 animate-bounce rounded-full bg-[#10383A] [animation-delay:120ms]" />
                        <span className="h-2 w-2 animate-bounce rounded-full bg-[#10383A] [animation-delay:220ms]" />
                      </div>
                    ) : (
                      msg.text
                    )}
                  </div>
                </div>
                {msg.sender === "user" && (
                  <div className="w-8 h-8 rounded-full bg-[#DAA112]/20 border border-[#DAA112]/30 flex items-center justify-center mb-1 text-xs font-bold text-[#DAA112]">
                    U
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
          className="absolute bottom-28 left-1/2 -translate-x-1/2 rounded-full border border-white/30 bg-black/40 px-3 py-1 text-xs text-white backdrop-blur-sm"
        >
          Jump to newest
        </button>
      )}
    </div>
  );
};

const OnboardingView = ({ onComplete }: { onComplete: () => void }) => {
  const [step, setStep] = useState(0);

  const handleNext = () => {
    if (step < ONBOARDING_STEPS.length - 1) {
      setStep(step + 1);
    } else {
      onComplete();
    }
  };

  return (
    <div className="absolute inset-0 z-[100] overflow-hidden bg-background">
      <AnimatePresence mode="popLayout" initial={false}>
        {ONBOARDING_STEPS.map((slide, idx) => (
          idx === step && (
            <motion.div
              key={slide.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, zIndex: -1 }}
              transition={{ duration: 0.6, ease: "easeInOut" }}
              className={`absolute inset-0 flex flex-col items-center justify-between p-8 ${slide.color}`}
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.2}
              onDragEnd={(_, info) => {
                if (info.offset.x < -50 && step < ONBOARDING_STEPS.length - 1) {
                  setStep(s => s + 1);
                } else if (info.offset.x > 50 && step > 0) {
                  setStep(s => s - 1);
                }
              }}
            >
              <div className="flex-1 flex items-center justify-center w-full relative">
                 <motion.img 
                   src={slide.image} 
                   alt={slide.title}
                   initial={{ opacity: 0, scale: 0.9, y: 20 }}
                   animate={{ opacity: 1, scale: 1, y: 0 }}
                   transition={{ delay: 0.2, type: "spring", stiffness: 200, damping: 20 }}
                   className="w-full max-w-[320px] object-contain drop-shadow-2xl mix-blend-normal"
                 />
              </div>

              <div className="w-full space-y-10 mb-8 z-10">
                <div className="text-center space-y-4">
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3, duration: 0.5 }}
                  >
                    <h1 className={`text-4xl font-serif font-bold mb-4 ${slide.textColor} tracking-tight`}>
                      {slide.title}
                    </h1>
                    <p className={`text-lg leading-relaxed font-medium ${step === 0 ? "text-white/90" : "text-black/70"}`}>
                      {slide.description}
                    </p>
                  </motion.div>
                </div>

                <div className="flex justify-center gap-3">
                  {ONBOARDING_STEPS.map((_, dotIdx) => (
                    <div 
                      key={dotIdx} 
                      className={`h-2.5 rounded-full transition-all duration-500 ease-out ${
                        dotIdx === step 
                          ? `w-10 ${step === 0 ? "bg-white" : "bg-[#10383A]"}` 
                          : `w-2.5 ${step === 0 ? "bg-white/30" : "bg-black/10"}`
                      }`} 
                    />
                  ))}
                </div>

                <div className="flex items-center gap-4 pt-2">
                  <Button 
                    variant="ghost" 
                    className={`flex-1 h-14 text-base font-medium transition-colors ${step === 0 ? "text-white/70 hover:text-white hover:bg-white/10" : "text-black/60 hover:text-black hover:bg-black/5"}`}
                    onClick={onComplete}
                    data-testid="button-skip-onboarding"
                  >
                    Skip
                  </Button>
                  <Button 
                    className={`flex-[2] h-14 text-lg rounded-2xl shadow-xl transition-transform active:scale-95 ${step === 0 ? "bg-white text-[#10383A] hover:bg-white/90" : "bg-[#10383A] text-white hover:bg-[#10383A]/90"}`}
                    onClick={handleNext}
                    data-testid="button-next-onboarding"
                  >
                    {step === ONBOARDING_STEPS.length - 1 ? "Get Started" : "Next"}
                  </Button>
                </div>
              </div>
            </motion.div>
          )
        ))}
      </AnimatePresence>
    </div>
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

  const logLiveTrace = (
    event: string,
    metadata: Record<string, unknown> = {},
  ) => {
    console.log("[LiveTrace]", event, metadata);
  };

  const getConversationMessagesKey = (conversationId: string) =>
    [`/api/conversations/${conversationId}/messages`];

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
    onboardingCompleted?: boolean;
  }>({
    queryKey: ["/api/preferences"],
    enabled: isAuthenticated,
  });

  const { data: userProfile, isLoading: isProfileLoading } =
    useQuery<UserProfileData>({
      queryKey: ["/api/profile/me"],
      enabled: isAuthenticated,
    });

  const [showOnboarding, setShowOnboarding] = useState(false);
  const [selectedVoice, setSelectedVoice] =
    useState<LiveVoiceName>(DEFAULT_LIVE_VOICE);
  const persona: Persona = ASSISTANT_NAME;

  useEffect(() => {
    if (preferences) {
      setShowOnboarding(!preferences.onboardingCompleted);
      if (isLiveVoiceName(preferences.selectedVoice)) {
        setSelectedVoice(preferences.selectedVoice);
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

  const handleOnboardingComplete = () => {
    setShowOnboarding(false);
    updatePreferencesMutation.mutate({
      selectedPersona: persona,
      selectedVoice,
      onboardingCompleted: true,
    });
  };

  const handleVoiceChange = (voice: LiveVoiceName) => {
    setSelectedVoice(voice);
    updatePreferencesMutation.mutate({
      selectedPersona: persona,
      selectedVoice: voice,
      onboardingCompleted: preferences?.onboardingCompleted ?? true,
    });
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
  }) => {
    await updateProfileMutation.mutateAsync(payload);
  };

  const handleUploadProfileAvatar = async (file: File) => {
    await uploadProfileAvatarMutation.mutateAsync(file);
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
    mutationFn: async (data: { persona: string; duration: number }) => {
      const res = await apiRequest("POST", "/api/voice-sessions", data);
      return res.json();
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
      throw new Error(text);
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
      } catch (streamError) {
        console.error("chat.stream.failed", streamError);
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
        } catch (fallbackError) {
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
      setComposerError("Message failed to send. Please try again.");
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
    logLiveTrace("live.stop.completed", {
      runId,
    });
  };

  const startLiveSession = async (options?: {
    autoResumed?: boolean;
    restoreVideo?: boolean;
  }) => {
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
      setLiveError(
        error?.message ??
          "We could not start the live voice session. Please try again.",
      );

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

    setLiveError(null);
    setIsVideoTransitioning(true);
    try {
      if (liveSessionRef.current.isVideoEnabled()) {
        await liveSessionRef.current.stopVideo();
        setIsVideoEnabled(false);
        setVideoStream(null);
        logLiveTrace("live.video.stopped", { runId: liveRunIdRef.current });
      } else {
        const stream = await liveSessionRef.current.startVideo({
          facingMode: cameraFacingModeRef.current,
        });
        setVideoStream(stream);
        setIsVideoEnabled(true);
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
        saveVoiceSessionMutation.mutate({ persona, duration });
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

  const resolvedProfileImage =
    userProfile?.avatarUrl || user?.profileImageUrl || undefined;

  if (authLoading) {
    return (
      <div className="w-full h-screen bg-[#10383A] flex items-center justify-center" data-testid="loading-screen">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="w-10 h-10 border-4 border-white/20 border-t-[#DAA112] rounded-full"
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
    <div className="w-full h-screen bg-neutral-100 flex items-center justify-center overflow-hidden">
      <div className="w-full h-full md:max-w-[400px] md:h-[850px] bg-background md:rounded-[2.5rem] shadow-2xl overflow-hidden relative">
        
        <AnimatePresence>
          {showOnboarding && (
            <OnboardingView onComplete={handleOnboardingComplete} />
          )}
        </AnimatePresence>

        <SharedFooter 
          persona={persona}
          onSendMessage={handleSendMessage}
          onSelectCameraFiles={handleIncomingFiles}
          onSelectGalleryFiles={handleIncomingFiles}
          onRemoveAttachment={handleRemoveAttachment}
          pendingAttachments={pendingAttachments}
          isSending={isSendingMessage}
          uploadError={composerError}
        />

        <div className="absolute inset-0 z-0">
          <TextView
            messages={messagesData}
            isStreamingReply={isSendingMessage}
            persona={persona}
            mode={mode}
          />
        </div>

        <VoiceView 
          isActive={isCalling} 
          isConnecting={isLiveConnecting}
          onEndCall={handleEndCall}
          onProfile={() => setShowProfile(true)}
          assistantName={persona}
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
              onClose={() => setShowProfile(false)}
              user={user}
              profile={userProfile}
              isProfileLoading={isProfileLoading}
              isSaving={updateProfileMutation.isPending}
              isUploadingAvatar={uploadProfileAvatarMutation.isPending}
              onSaveProfile={handleSaveProfile}
              onUploadAvatar={handleUploadProfileAvatar}
              onLogout={logout}
            />
          )}
        </AnimatePresence>

        {liveError && (
          <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-[90] max-w-[85%] rounded-xl border border-red-400/30 bg-red-500/15 px-3 py-2 text-xs text-red-100 backdrop-blur-sm">
            {liveError}
          </div>
        )}
        {!liveError && isLiveConnecting && (
          <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-[90] max-w-[85%] rounded-xl border border-white/20 bg-black/30 px-3 py-2 text-xs text-white/90 backdrop-blur-sm">
            Connecting voice session...
          </div>
        )}

      </div>
    </div>
  );
}

export default App;
