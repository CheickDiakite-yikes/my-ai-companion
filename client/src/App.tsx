import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, Video, PhoneOff, MessageSquare, Menu, Settings, ChevronRight, X, ArrowLeft, Camera, Paperclip, LogOut, Eye, EyeOff } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import onboarding1 from "@/assets/onboarding-1-v2.png";
import onboarding2 from "@/assets/onboarding-2-v2.png";
import onboarding3 from "@/assets/onboarding-3-v2.png";
import mayaAvatar from "@/assets/maya-avatar.png";
import leafBg from "@/assets/leaf-bg.png";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// --- Types ---
type Mode = "voice" | "text" | "profile";
type Persona = "Maya" | "Zarra" | "Ore";

interface MessageData {
  id: string;
  conversationId: string;
  sender: string;
  text: string;
  createdAt: string | null;
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

// --- Components ---

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
  onRegister: (data: { email: string; password: string; firstName: string; lastName: string; profession?: string; referralSource?: string }) => Promise<any>;
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
    try {
      await onRegister({
        email: formData.email,
        password: formData.password,
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
              <label className="text-sm text-white/60 mb-1.5 block">Profession</label>
              <input
                type="text"
                value={formData.profession}
                onChange={(e) => setFormData(f => ({ ...f, profession: e.target.value }))}
                className={inputClass}
                placeholder="e.g. Designer, Student, Coach..."
                data-testid="input-register-profession"
              />
            </div>

            <div>
              <label className="text-sm text-white/60 mb-1.5 block">How did you hear about us?</label>
              <div className="grid grid-cols-2 gap-2">
                {REFERRAL_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setFormData(f => ({ ...f, referralSource: f.referralSource === option ? "" : option }))}
                    className={cn(
                      "px-3 py-2.5 rounded-xl text-sm font-medium transition-all border",
                      formData.referralSource === option
                        ? "bg-[#DAA112]/20 border-[#DAA112] text-[#DAA112]"
                        : "bg-white/5 border-white/10 text-white/60 hover:border-white/30"
                    )}
                    data-testid={`button-referral-${option.toLowerCase().replace(/\s+/g, "-")}`}
                  >
                    {option}
                  </button>
                ))}
              </div>
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
  onVoiceMode,
  onSendMessage
}: { 
  persona: Persona, 
  onVoiceMode: () => void,
  onSendMessage: (text: string) => void
}) => {
  const [inputValue, setInputValue] = useState("");

  const handleSend = () => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    onSendMessage(trimmed);
    setInputValue("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="absolute bottom-0 left-0 right-0 z-50 p-4 bg-[#10383A]/90 backdrop-blur-md border-t border-white/10">
      <div className="flex items-center gap-2">
         <Button 
          variant="ghost" 
          size="icon" 
          className="text-white/70 hover:bg-white/10 hover:text-white transition-colors"
        >
           <Camera className="w-6 h-6" />
         </Button>
         <Button 
          variant="ghost" 
          size="icon" 
          className="text-white/70 hover:bg-white/10 hover:text-white transition-colors"
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
            data-testid="input-message"
          />
         </div>
         <Button 
           size="icon" 
           className="rounded-full bg-[#DAA112] text-[#10383A] shadow-md hover:bg-[#DAA112]/90"
           onClick={handleSend}
           data-testid="button-send-message"
         >
           <ChevronRight className="w-5 h-5" />
         </Button>
      </div>
    </div>
  );
};

const ProfileView = ({ onClose, user, onLogout }: { onClose: () => void; user: any; onLogout: () => void }) => {
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
      
      <div className="px-6 -mt-12 relative z-10 flex flex-col h-full">
        <div className="flex flex-col items-center mb-8">
          <Avatar className="w-24 h-24 border-4 border-background shadow-xl">
            <AvatarImage src={user?.profileImageUrl || mayaAvatar} />
            <AvatarFallback>{user?.firstName?.[0] || "U"}{user?.lastName?.[0] || ""}</AvatarFallback>
          </Avatar>
          <div className="text-center mt-4">
            <h2 className="text-2xl font-bold text-foreground" data-testid="text-username">
              {user?.firstName || ""} {user?.lastName || ""}
            </h2>
            <p className="text-muted-foreground italic" data-testid="text-user-tagline">"Here for you, always"</p>
          </div>
        </div>

        <ScrollArea className="flex-1 -mx-6 px-6 pb-6">
          <div className="space-y-6">
            <section>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Account</h3>
              <div className="bg-card rounded-xl p-4 shadow-sm border space-y-4">
                <div className="flex items-center justify-between">
                  <span className="font-medium">Email</span>
                  <span className="text-muted-foreground text-sm" data-testid="text-user-email">{user?.email || "Not set"}</span>
                </div>
              </div>
            </section>

            <section>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Preferences</h3>
              <div className="bg-card rounded-xl shadow-sm border divide-y divide-border">
                <button className="w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors">
                  <span className="font-medium">Privacy Settings</span>
                  <ChevronRight className="w-5 h-5 text-muted-foreground" />
                </button>
                <button className="w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors">
                  <span className="font-medium">Permissions</span>
                  <ChevronRight className="w-5 h-5 text-muted-foreground" />
                </button>
                <button className="w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors">
                  <span className="font-medium">Appearance</span>
                  <div className="flex gap-2">
                    <div className="w-4 h-4 rounded-full bg-accent" />
                    <div className="w-4 h-4 rounded-full bg-primary" />
                    <ChevronRight className="w-5 h-5 text-muted-foreground" />
                  </div>
                </button>
              </div>
            </section>

            <section>
              <Button variant="destructive" className="w-full h-12 rounded-xl gap-2" onClick={onLogout} data-testid="button-logout">
                <LogOut className="w-5 h-5" />
                Log Out
              </Button>
            </section>
          </div>
        </ScrollArea>
      </div>
    </motion.div>
  );
};

const SharedHeader = ({ 
  persona, 
  setPersona, 
  onProfile, 
  isActive, 
  duration,
  mode,
  userProfileImage
}: { 
  persona: Persona, 
  setPersona: (p: Persona) => void, 
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
              <span className="font-bold text-lg text-white">{persona}</span>
              <ChevronRight className="w-4 h-4 rotate-90 text-white/70" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48 rounded-xl bg-[#10383A] border-white/10 text-white">
            <DropdownMenuItem onClick={() => setPersona("Maya")} className="gap-2 p-3 font-medium cursor-pointer focus:bg-white/10 focus:text-white" data-testid="button-persona-maya">
              <Avatar className="w-6 h-6">
                <AvatarImage src={mayaAvatar} />
                <AvatarFallback>M</AvatarFallback>
              </Avatar>
              Maya
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setPersona("Zarra")} className="gap-2 p-3 font-medium cursor-pointer focus:bg-white/10 focus:text-white" data-testid="button-persona-zarra">
              <div className="w-6 h-6 rounded-full bg-purple-500 flex items-center justify-center text-[10px] text-white font-bold">Z</div>
              Zarra
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setPersona("Ore")} className="gap-2 p-3 font-medium cursor-pointer focus:bg-white/10 focus:text-white" data-testid="button-persona-ore">
              <div className="w-6 h-6 rounded-full bg-orange-500 flex items-center justify-center text-[10px] text-white font-bold">O</div>
              Ore
            </DropdownMenuItem>
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
                <AvatarImage src={userProfileImage || mayaAvatar} className="object-cover" />
                <AvatarFallback>M</AvatarFallback>
              </Avatar>
          </div>
        </Button>
      </div>
    </div>
  );
};

const VoiceView = ({ isActive, onEndCall, onProfile, persona, setPersona, mode, setMode, duration, userProfileImage }: { 
  isActive: boolean; 
  onEndCall: () => void;
  onProfile: () => void;
  persona: Persona;
  setPersona: (p: Persona) => void;
  mode: Mode;
  setMode: (m: Mode) => void;
  duration: number;
  userProfileImage?: string;
}) => {
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
            persona={persona} 
            setPersona={setPersona} 
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
                <div className="flex items-center justify-center gap-1.5 h-32 w-full">
                  {[...Array(8)].map((_, i) => (
                    <motion.div
                      key={i}
                      className="w-4 bg-[#DAA112] rounded-full opacity-80"
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
            ) : (
              <div className="flex flex-col items-center gap-8">
                 <div className="relative group cursor-pointer" onClick={onEndCall}>
                   <div className="absolute inset-0 bg-[#DAA112]/20 rounded-full animate-ping opacity-20 duration-3000" />
                   <div className="absolute -inset-4 bg-[#DAA112]/10 rounded-full animate-pulse opacity-30" />
                   
                   <div className="w-32 h-32 bg-[#DAA112] rounded-full flex items-center justify-center shadow-[0_0_40px_rgba(218,161,18,0.3)] transform transition-transform group-hover:scale-105 active:scale-95">
                      <Mic className="w-12 h-12 text-[#10383A]" />
                   </div>
                 </div>
                 <p className="text-white/60 font-medium tracking-wide">Tap to speak to {persona}</p>
              </div>
            )}
          </div>

          <div className="px-6 space-y-6 pb-24">
            {isActive && (
              <div className="flex items-center justify-center gap-8 mb-4">
                  <Button 
                    variant="outline" 
                    size="icon" 
                    className="w-14 h-14 rounded-full border-2 border-white/10 bg-white/5 hover:bg-white/10 transition-colors text-white"
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
                  >
                    <Mic className="w-6 h-6" />
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

const TextView = ({ messages, onSendMessage, persona }: { messages: MessageData[]; onSendMessage: (text: string) => void; persona: Persona }) => {
  return (
    <div className="h-full flex flex-col bg-[#0D2E30] pt-40 pb-20">
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-4 pb-4">
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn(
                "flex w-full",
                msg.sender === "user" ? "justify-end" : "justify-start"
              )}
            >
              <div className="flex items-end gap-2 max-w-[80%]">
                {msg.sender !== "user" && (
                  <Avatar className="w-8 h-8 mb-1 shrink-0 ring-2 ring-white/10">
                    <AvatarImage src={mayaAvatar} />
                    <AvatarFallback>M</AvatarFallback>
                  </Avatar>
                )}
                <div
                  className={cn(
                    "px-5 py-3 rounded-2xl text-sm leading-relaxed shadow-sm",
                    msg.sender === "user" 
                      ? "bg-[#DAA112] text-[#10383A] font-medium rounded-br-none" 
                      : "bg-white text-[#10383A] rounded-bl-none"
                  )}
                >
                  {msg.text}
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
      </ScrollArea>
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
  const { user, isLoading: authLoading, isAuthenticated, login, register, loginError, registerError, isLoggingIn, isRegistering, logout } = useAuth();
  const queryClient = useQueryClient();

  const [mode, setMode] = useState<Mode>("voice");
  const [isCalling, setIsCalling] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [duration, setDuration] = useState(0);
  const [callStartTime, setCallStartTime] = useState<number | null>(null);

  const { data: preferences, isLoading: prefsLoading } = useQuery<{ selectedPersona?: string; onboardingCompleted?: boolean }>({
    queryKey: ["/api/preferences"],
    enabled: isAuthenticated,
  });

  const [showOnboarding, setShowOnboarding] = useState(false);
  const [persona, setPersona] = useState<Persona>("Maya");

  useEffect(() => {
    if (preferences) {
      setShowOnboarding(!preferences.onboardingCompleted);
      if (preferences.selectedPersona) {
        setPersona(preferences.selectedPersona as Persona);
      }
    }
  }, [preferences]);

  const updatePreferencesMutation = useMutation({
    mutationFn: async (data: { selectedPersona?: string; onboardingCompleted?: boolean }) => {
      const res = await apiRequest("PUT", "/api/preferences", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/preferences"] });
    },
  });

  const handleOnboardingComplete = () => {
    setShowOnboarding(false);
    updatePreferencesMutation.mutate({ selectedPersona: persona, onboardingCompleted: true });
  };

  const handlePersonaChange = (p: Persona) => {
    setPersona(p);
    updatePreferencesMutation.mutate({ selectedPersona: p, onboardingCompleted: preferences?.onboardingCompleted ?? true });
  };

  const { data: conversations } = useQuery<any[]>({
    queryKey: ["/api/conversations"],
    enabled: isAuthenticated && !showOnboarding,
  });

  const createConversationMutation = useMutation({
    mutationFn: async (data: { persona: string }) => {
      const res = await apiRequest("POST", "/api/conversations", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
    },
  });

  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated || showOnboarding) return;
    if (conversations && conversations.length > 0) {
      setActiveConversationId(conversations[0].id);
    } else if (conversations && conversations.length === 0) {
      createConversationMutation.mutate({ persona });
    }
  }, [conversations, isAuthenticated, showOnboarding]);

  const { data: messagesData } = useQuery<MessageData[]>({
    queryKey: [`/api/conversations/${activeConversationId}/messages`],
    enabled: !!activeConversationId,
    refetchInterval: 5000,
  });

  const sendMessageMutation = useMutation({
    mutationFn: async (text: string) => {
      if (!activeConversationId) return;
      const res = await apiRequest("POST", `/api/conversations/${activeConversationId}/messages`, {
        sender: "user",
        text,
      });
      return res.json();
    },
    onSuccess: () => {
      if (activeConversationId) {
        queryClient.invalidateQueries({ queryKey: [`/api/conversations/${activeConversationId}/messages`] });
      }
    },
  });

  const handleSendMessage = (text: string) => {
    sendMessageMutation.mutate(text);
  };

  const saveVoiceSessionMutation = useMutation({
    mutationFn: async (data: { persona: string; duration: number }) => {
      const res = await apiRequest("POST", "/api/voice-sessions", data);
      return res.json();
    },
  });

  const handleEndCall = () => {
    if (isCalling) {
      saveVoiceSessionMutation.mutate({ persona, duration });
      setIsCalling(false);
      setCallStartTime(null);
    } else {
      setIsCalling(true);
      setCallStartTime(Date.now());
    }
  };

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isCalling) {
      interval = setInterval(() => setDuration(d => d + 1), 1000);
    } else {
      setDuration(0);
    }
    return () => clearInterval(interval);
  }, [isCalling]);

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
          onVoiceMode={() => setMode(mode === "voice" ? "text" : "voice")}
          onSendMessage={handleSendMessage}
        />

        <div className="absolute inset-0 z-0">
          <TextView messages={messagesData || []} onSendMessage={handleSendMessage} persona={persona} />
        </div>

        <VoiceView 
          isActive={isCalling} 
          onEndCall={handleEndCall}
          onProfile={() => setShowProfile(true)}
          persona={persona}
          setPersona={handlePersonaChange}
          mode={mode}
          setMode={setMode}
          duration={duration}
          userProfileImage={user?.profileImageUrl || undefined}
        />

        <AnimatePresence>
          {showProfile && (
            <ProfileView onClose={() => setShowProfile(false)} user={user} onLogout={logout} />
          )}
        </AnimatePresence>

      </div>
    </div>
  );
}

export default App;
