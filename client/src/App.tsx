import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, Video, PhoneOff, MessageSquare, Menu, Settings, ChevronRight, X, ArrowLeft, Camera, Paperclip } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import onboarding1 from "@/assets/onboarding-1.png";
import onboarding2 from "@/assets/onboarding-2.png";
import onboarding3 from "@/assets/onboarding-3.png";
import mayaAvatar from "@/assets/maya-avatar.png";
import leafBg from "@/assets/leaf-bg.png";
import { cn } from "@/lib/utils";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// --- Types ---
type Mode = "voice" | "text" | "profile";
type Persona = "Maya" | "Zarra" | "Ore";

// --- Mock Data ---
const ONBOARDING_STEPS = [
  {
    id: 1,
    title: "Welcome, Friend!",
    description: "You're now part of our incredible and caring community. Let's get started!",
    image: onboarding1,
    color: "bg-[#10383A]", // Deep Teal
    textColor: "text-[#E8E8E8]" // Off-white text for contrast
  },
  {
    id: 2,
    title: "Discover Balance",
    description: "Find peace and mindfulness with personalized guidance every day.",
    image: onboarding2,
    color: "bg-[#809276]", // Sage Green (Light)
    textColor: "text-[#10383A]" // Deep Teal text
  },
  {
    id: 3,
    title: "Grow Together",
    description: "Connect with your personal AI companion anytime, anywhere.",
    image: onboarding3,
    color: "bg-[#DAA112]", // Mustard Yellow
    textColor: "text-[#10383A]" // Deep Teal text
  }
];

const INITIAL_MESSAGES = [
  { id: 1, sender: "maya", text: "Hey Bestie! 👋" },
  { id: 2, sender: "maya", text: "How are you feeling today?" },
  { id: 3, sender: "user", text: "Nm, gonna watch a movie hby?" },
  { id: 4, sender: "maya", text: "Sounds like fun! Which movie is it? 🍿" },
  { id: 5, sender: "user", text: "uhhh not telling you lol guess" },
  { id: 6, sender: "maya", text: "Hahaha okay umm Avengers?" },
  { id: 7, sender: "user", text: "lmaoo way off" },
  { id: 8, sender: "maya", text: "Hahaha oopss is right :)" },
];

// --- Components ---

const SharedFooter = ({ 
  persona, 
  onVoiceMode 
}: { 
  persona: Persona, 
  onVoiceMode: () => void 
}) => {
  return (
    <div className="absolute bottom-0 left-0 right-0 z-50 p-4 bg-background/80 backdrop-blur-md border-t">
      <div className="flex items-center gap-2">
         <Button 
          variant="ghost" 
          size="icon" 
          className="text-muted-foreground hover:bg-accent/20 hover:text-accent-foreground transition-colors"
        >
           <Camera className="w-6 h-6" />
         </Button>
         <Button 
          variant="ghost" 
          size="icon" 
          className="text-muted-foreground hover:bg-accent/20 hover:text-accent-foreground transition-colors"
        >
           <Paperclip className="w-6 h-6" />
         </Button>
         <div className="flex-1 bg-muted/50 rounded-full px-4 py-2.5 border border-transparent focus-within:border-primary/20 focus-within:bg-background transition-all">
           <input 
            type="text" 
            placeholder={`Message ${persona}...`} 
            className="w-full bg-transparent border-none outline-none text-sm placeholder:text-muted-foreground"
          />
         </div>
         <Button size="icon" className="rounded-full bg-primary text-white shadow-md hover:bg-primary/90">
           <ChevronRight className="w-5 h-5" />
         </Button>
      </div>
    </div>
  );
};

const ProfileView = ({ onClose }: { onClose: () => void }) => {
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
        >
          <ArrowLeft className="w-6 h-6" />
        </Button>
      </div>
      
      <div className="px-6 -mt-12 relative z-10 flex flex-col h-full">
        <div className="flex flex-col items-center mb-8">
          <Avatar className="w-24 h-24 border-4 border-background shadow-xl">
            <AvatarImage src={mayaAvatar} />
            <AvatarFallback>MY</AvatarFallback>
          </Avatar>
          <div className="text-center mt-4">
            <h2 className="text-2xl font-bold text-foreground">Maya</h2>
            <p className="text-muted-foreground italic">"Here for you, always"</p>
          </div>
        </div>

        <ScrollArea className="flex-1 -mx-6 px-6 pb-6">
          <div className="space-y-6">
            <section>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Account</h3>
              <div className="bg-card rounded-xl p-4 shadow-sm border space-y-4">
                <div className="flex items-center justify-between">
                  <span className="font-medium">Email</span>
                  <span className="text-muted-foreground text-sm">zorevl18@gmail.com</span>
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
  mode 
}: { 
  persona: Persona, 
  setPersona: (p: Persona) => void, 
  onProfile: () => void, 
  isActive: boolean,
  duration: number,
  mode: Mode
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
            <button className="flex items-center gap-2 bg-white/50 backdrop-blur-md px-4 py-2 rounded-2xl border border-border shadow-sm hover:bg-white/80 transition-colors focus:outline-none">
              <span className="font-bold text-lg text-foreground">{persona}</span>
              <ChevronRight className="w-4 h-4 rotate-90 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48 rounded-xl">
            <DropdownMenuItem onClick={() => setPersona("Maya")} className="gap-2 p-3 font-medium cursor-pointer">
              <Avatar className="w-6 h-6">
                <AvatarImage src={mayaAvatar} />
                <AvatarFallback>M</AvatarFallback>
              </Avatar>
              Maya
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setPersona("Zarra")} className="gap-2 p-3 font-medium cursor-pointer">
              <div className="w-6 h-6 rounded-full bg-purple-500 flex items-center justify-center text-[10px] text-white font-bold">Z</div>
              Zarra
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setPersona("Ore")} className="gap-2 p-3 font-medium cursor-pointer">
              <div className="w-6 h-6 rounded-full bg-orange-500 flex items-center justify-center text-[10px] text-white font-bold">O</div>
              Ore
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      
      {/* Timer only visible in Voice Mode when active */}
      <AnimatePresence>
        {isActive && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute left-1/2 -translate-x-1/2 font-mono text-sm font-medium text-muted-foreground bg-muted/30 px-3 py-1 rounded-full backdrop-blur-sm"
          >
            {formatTime(duration)}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="pointer-events-auto">
        <Button variant="ghost" size="icon" className="rounded-full w-12 h-12" onClick={onProfile}>
          <div className="w-full h-full rounded-full border border-border bg-muted/20 overflow-hidden p-0.5">
              <Avatar className="w-full h-full">
                <AvatarImage src={mayaAvatar} className="object-cover" />
                <AvatarFallback>M</AvatarFallback>
              </Avatar>
          </div>
        </Button>
      </div>
    </div>
  );
};

const VoiceView = ({ isActive, onEndCall, onProfile, persona, setPersona, mode, setMode, duration }: { 
  isActive: boolean; 
  onEndCall: () => void;
  onProfile: () => void;
  persona: Persona;
  setPersona: (p: Persona) => void;
  mode: Mode;
  setMode: (m: Mode) => void;
  duration: number;
}) => {
  return (
    <motion.div 
      className="absolute top-0 left-0 right-0 z-40 bg-background rounded-b-[2.5rem] shadow-lg overflow-hidden"
      initial={false}
      animate={{ height: mode === "voice" ? "100%" : "110px" }}
      transition={{ type: "spring", stiffness: 200, damping: 25 }}
      drag="y"
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={0.05} // Slightly reduced elastic for tighter feel
      onDragEnd={(_, info) => {
         if (mode === "voice" && info.offset.y < -100) {
           setMode("text");
         } else if (mode === "text" && info.offset.y > 50) {
           setMode("voice");
         }
      }}
    >
      {/* Container to prevent squishing of content when height shrinks */}
      <div className="w-full h-screen relative flex flex-col pointer-events-none">
        
        {/* Header embedded inside VoiceView */}
        <div className="relative z-50 pointer-events-auto">
          <SharedHeader 
            persona={persona} 
            setPersona={setPersona} 
            onProfile={onProfile} 
            isActive={isActive} 
            duration={duration} 
            mode={mode} 
          />
        </div>

        {/* Main Voice Content */}
        <motion.div 
          className="flex-1 flex flex-col pt-24 pb-4 pointer-events-auto"
          animate={{ opacity: mode === "voice" ? 1 : 0 }}
          transition={{ duration: 0.2 }}
        >
          {/* Main Content */}
          <div className="flex-1 flex flex-col items-center justify-center relative">
            {isActive ? (
              /* Active Call State */
              <div className="w-full h-full flex items-center justify-center px-8">
                <div className="flex items-center justify-center gap-1.5 h-32 w-full">
                  {[...Array(8)].map((_, i) => (
                    <motion.div
                      key={i}
                      className="w-4 bg-primary rounded-full opacity-80"
                      animate={{
                        height: ["20%", "80%", "20%"],
                        backgroundColor: ["hsl(175 45% 25%)", "hsl(45 80% 60%)", "hsl(175 45% 25%)"]
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
              /* Idle State */
              <div className="flex flex-col items-center gap-8">
                 <div className="relative group cursor-pointer" onClick={onEndCall}>
                   {/* Pulse Rings */}
                   <div className="absolute inset-0 bg-accent/20 rounded-full animate-ping opacity-20 duration-3000" />
                   <div className="absolute -inset-4 bg-secondary/20 rounded-full animate-pulse opacity-30" />
                   
                   {/* Main Button */}
                   <div className="w-24 h-24 bg-gradient-to-tr from-accent to-accent/80 rounded-full flex items-center justify-center shadow-xl transform transition-transform group-hover:scale-105 active:scale-95">
                      <Mic className="w-10 h-10 text-accent-foreground" />
                   </div>
                 </div>
                 <p className="text-muted-foreground font-medium">Tap to speak to {persona}</p>
              </div>
            )}
          </div>

          {/* Controls & Bottom Handle */}
          <div className="px-6 space-y-6 pb-24">
            {/* Call Controls (Only visible when active) */}
            {isActive && (
              <div className="flex items-center justify-center gap-8 mb-4">
                  <Button 
                    variant="outline" 
                    size="icon" 
                    className="w-14 h-14 rounded-full border-2 border-border bg-background hover:bg-muted transition-colors"
                  >
                    <Video className="w-6 h-6 text-foreground" />
                  </Button>
                  <Button 
                    variant="destructive" 
                    size="icon" 
                    className="w-20 h-20 rounded-full shadow-2xl hover:scale-105 transition-transform bg-red-500 hover:bg-red-600 text-white border-4 border-background"
                    onClick={onEndCall}
                  >
                    <PhoneOff className="w-8 h-8" />
                  </Button>
                  <Button 
                    variant="outline" 
                    size="icon" 
                    className="w-14 h-14 rounded-full border-2 border-border bg-background hover:bg-muted transition-colors"
                  >
                    <Mic className="w-6 h-6 text-foreground" />
                  </Button>
              </div>
            )}

            {/* Swipe Up Handle */}
            <div className="flex flex-col items-center justify-center gap-2 py-2 text-muted-foreground/50 cursor-grab active:cursor-grabbing">
               <div className="w-12 h-1.5 bg-muted-foreground/20 rounded-full" />
               <span className="text-xs font-medium uppercase tracking-wider">Swipe up to chat</span>
            </div>
          </div>
        </motion.div>
        
        {/* Collapsed Handle (Visible only in Text Mode) */}
        <AnimatePresence>
          {mode === "text" && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute bottom-2 left-0 right-0 flex justify-center pb-2 pointer-events-none"
            >
               <div className="w-12 h-1.5 bg-muted-foreground/20 rounded-full" />
            </motion.div>
          )}
        </AnimatePresence>
        
      </div>
    </motion.div>
  );
};

const TextView = () => {
  return (
    <div className="h-full flex flex-col bg-background/50 pt-40 pb-20">
      {/* Messages */}
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-4 pb-4">
          {INITIAL_MESSAGES.map((msg) => (
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
                {msg.sender === "maya" && (
                  <Avatar className="w-6 h-6 mb-1 shrink-0">
                    <AvatarImage src={mayaAvatar} />
                    <AvatarFallback>M</AvatarFallback>
                  </Avatar>
                )}
                <div
                  className={cn(
                    "px-4 py-2.5 rounded-2xl text-sm leading-relaxed shadow-sm",
                    msg.sender === "user" 
                      ? "bg-accent text-accent-foreground rounded-br-none" 
                      : "bg-white border text-foreground rounded-bl-none"
                  )}
                >
                  {msg.text}
                </div>
                 {msg.sender === "user" && (
                  <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center mb-1 text-xs font-bold text-primary">
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
              {/* Illustration Area */}
              <div className="flex-1 flex items-center justify-center w-full relative">
                <div className="relative w-72 h-72 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center mb-8 shadow-inner border border-white/10">
                   <motion.img 
                     src={slide.image} 
                     alt={slide.title}
                     initial={{ opacity: 0, scale: 0.8, y: 20 }}
                     animate={{ opacity: 1, scale: 1, y: 0 }}
                     transition={{ delay: 0.2, type: "spring", stiffness: 200, damping: 20 }}
                     className="w-64 h-64 object-contain drop-shadow-xl"
                   />
                </div>
              </div>

              {/* Text Content */}
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

                {/* Pagination Dots */}
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

                {/* Buttons */}
                <div className="flex items-center gap-4 pt-2">
                  <Button 
                    variant="ghost" 
                    className={`flex-1 h-14 text-base font-medium transition-colors ${step === 0 ? "text-white/70 hover:text-white hover:bg-white/10" : "text-black/60 hover:text-black hover:bg-black/5"}`}
                    onClick={onComplete}
                  >
                    Skip
                  </Button>
                  <Button 
                    className={`flex-[2] h-14 text-lg rounded-2xl shadow-xl transition-transform active:scale-95 ${step === 0 ? "bg-white text-[#10383A] hover:bg-white/90" : "bg-[#10383A] text-white hover:bg-[#10383A]/90"}`}
                    onClick={handleNext}
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
  const [showOnboarding, setShowOnboarding] = useState(true);
  const [mode, setMode] = useState<Mode>("voice");
  const [isCalling, setIsCalling] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [persona, setPersona] = useState<Persona>("Maya");
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isCalling) {
      interval = setInterval(() => setDuration(d => d + 1), 1000);
    } else {
      setDuration(0);
    }
    return () => clearInterval(interval);
  }, [isCalling]);

  return (
    <div className="w-full h-screen bg-neutral-100 flex items-center justify-center overflow-hidden">
      {/* Mobile Frame */}
      <div className="w-full h-full md:max-w-[400px] md:h-[850px] bg-background md:rounded-[2.5rem] shadow-2xl overflow-hidden relative border-4 border-neutral-800/5">
        
        {/* Onboarding Overlay */}
        <AnimatePresence>
          {showOnboarding && (
            <OnboardingView onComplete={() => setShowOnboarding(false)} />
          )}
        </AnimatePresence>

        {/* Shared Footer (Always Visible) */}
        <SharedFooter 
          persona={persona}
          onVoiceMode={() => setMode(mode === "voice" ? "text" : "voice")}
        />

        {/* Base Layer: Text View (Transcript) */}
        <div className="absolute inset-0 z-0">
          <TextView />
        </div>

        {/* Curtain Layer: Voice View */}
        <VoiceView 
          isActive={isCalling} 
          onEndCall={() => setIsCalling(!isCalling)}
          onProfile={() => setShowProfile(true)}
          persona={persona}
          setPersona={setPersona}
          mode={mode}
          setMode={setMode}
          duration={duration}
        />

        {/* Profile Overlay */}
        <AnimatePresence>
          {showProfile && (
            <ProfileView onClose={() => setShowProfile(false)} />
          )}
        </AnimatePresence>

      </div>
    </div>
  );
}

export default App;
