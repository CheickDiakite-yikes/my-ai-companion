import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, Video, PhoneOff, MessageSquare, Menu, Settings, ChevronRight, X, ArrowLeft } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import mayaAvatar from "@/assets/maya-avatar.png";
import leafBg from "@/assets/leaf-bg.png";
import { cn } from "@/lib/utils";

// --- Types ---
type Mode = "voice" | "text" | "profile";

// --- Mock Data ---
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

const VoiceView = ({ isActive, onTextMode, onEndCall, onProfile }: { 
  isActive: boolean; 
  onTextMode: () => void; 
  onEndCall: () => void;
  onProfile: () => void;
}) => {
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isActive) {
      interval = setInterval(() => setDuration(d => d + 1), 1000);
    } else {
      setDuration(0);
    }
    return () => clearInterval(interval);
  }, [isActive]);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="h-full flex flex-col relative bg-background">
      {/* Header */}
      <div className="flex items-center justify-between p-6">
        <div className="flex items-center gap-2 bg-white/50 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/60 shadow-sm">
          <span className="font-semibold text-foreground">Maya</span>
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
        </div>
        
        {isActive && (
          <div className="absolute left-1/2 -translate-x-1/2 font-mono text-sm font-medium text-muted-foreground bg-muted/30 px-3 py-1 rounded-full">
            {formatTime(duration)}
          </div>
        )}

        <Button variant="ghost" size="icon" className="rounded-full" onClick={onProfile}>
          <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center">
             <Avatar className="w-9 h-9">
               <AvatarImage src={mayaAvatar} />
               <AvatarFallback>M</AvatarFallback>
             </Avatar>
          </div>
        </Button>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col items-center justify-center relative">
        {isActive ? (
          /* Active Call State */
          <div className="w-full h-full flex items-center justify-center px-8">
            <div className="flex items-center justify-center gap-1.5 h-32 w-full">
              {[...Array(12)].map((_, i) => (
                <motion.div
                  key={i}
                  className="w-3 bg-primary/20 rounded-full"
                  animate={{
                    height: ["20%", "100%", "20%"],
                    backgroundColor: ["hsl(175 45% 25%)", "hsl(45 80% 60%)", "hsl(175 45% 25%)"]
                  }}
                  transition={{
                    duration: 1.2,
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
          <div className="text-center space-y-6">
            <div className="relative">
              <div className="absolute inset-0 bg-accent/20 blur-3xl rounded-full scale-150 opacity-50" />
              <div className="w-48 h-48 bg-gradient-to-tr from-accent/30 to-secondary/30 rounded-full flex items-center justify-center backdrop-blur-sm border border-white/20 shadow-2xl relative z-10">
                <Mic className="w-16 h-16 text-primary opacity-80" />
              </div>
            </div>
            <h2 className="text-2xl font-medium text-foreground/80">Tap to talk</h2>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="p-8 pb-12 space-y-6">
        <div className="flex items-center justify-center gap-6">
          {isActive ? (
            <>
              <Button 
                variant="destructive" 
                size="icon" 
                className="w-16 h-16 rounded-full shadow-lg hover:scale-105 transition-transform"
                onClick={onEndCall}
              >
                <PhoneOff className="w-8 h-8" />
              </Button>
              <Button 
                variant="outline" 
                size="icon" 
                className="w-14 h-14 rounded-full border-2 border-border bg-background/50 backdrop-blur"
              >
                <Video className="w-6 h-6 text-muted-foreground" />
              </Button>
            </>
          ) : (
            <Button 
              className="px-8 py-6 rounded-full text-lg shadow-lg hover:shadow-xl hover:scale-105 transition-all bg-primary text-primary-foreground font-medium"
              onClick={onEndCall} // Reusing this prop to toggle state for demo
            >
              <Mic className="mr-2 w-5 h-5" />
              Call Bestie
            </Button>
          )}
        </div>

        <button 
          onClick={onTextMode}
          className="w-full bg-white/60 backdrop-blur-xl border border-white/50 rounded-2xl p-4 flex items-center justify-between shadow-sm group active:scale-[0.98] transition-all"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-accent/20 rounded-full flex items-center justify-center text-primary group-hover:bg-accent/30 transition-colors">
              <MessageSquare className="w-5 h-5" />
            </div>
            <span className="font-medium text-foreground/80">Let's text instead...</span>
          </div>
        </button>
      </div>
    </div>
  );
};

const TextView = ({ onVoiceMode, onProfile }: { onVoiceMode: () => void; onProfile: () => void }) => {
  return (
    <div className="h-full flex flex-col bg-background/50">
      {/* Header */}
      <div className="p-4 border-b bg-background/80 backdrop-blur-md sticky top-0 z-10 flex items-center justify-between">
         <div className="flex items-center gap-3">
          <Avatar className="w-10 h-10 border-2 border-accent">
             <AvatarImage src={mayaAvatar} />
             <AvatarFallback>M</AvatarFallback>
           </Avatar>
           <div>
             <h3 className="font-bold text-foreground leading-none">Maya</h3>
             <span className="text-xs text-green-600 font-medium">Online</span>
           </div>
         </div>
         <Button variant="ghost" size="icon" onClick={onProfile}>
           <Settings className="w-6 h-6 text-muted-foreground" />
         </Button>
      </div>

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

      {/* Input Area */}
      <div className="p-4 bg-background/80 backdrop-blur-md border-t">
        <div className="flex items-center gap-2">
           <Button 
            variant="ghost" 
            size="icon" 
            className="text-muted-foreground hover:bg-accent/20 hover:text-accent-foreground transition-colors"
            onClick={onVoiceMode}
          >
             <Mic className="w-6 h-6" />
           </Button>
           <div className="flex-1 bg-muted/50 rounded-full px-4 py-2.5 border border-transparent focus-within:border-primary/20 focus-within:bg-background transition-all">
             <input 
              type="text" 
              placeholder="Message Maya..." 
              className="w-full bg-transparent border-none outline-none text-sm placeholder:text-muted-foreground"
            />
           </div>
           <Button size="icon" className="rounded-full bg-primary text-white shadow-md hover:bg-primary/90">
             <ChevronRight className="w-5 h-5" />
           </Button>
        </div>
      </div>
    </div>
  );
};

// --- Main App Component ---

function App() {
  const [mode, setMode] = useState<Mode>("voice");
  const [isCalling, setIsCalling] = useState(false);
  const [showProfile, setShowProfile] = useState(false);

  // The "Drapes" Concept:
  // Voice Mode is the "Curtain" that slides up/down over Text Mode.
  // When mode is 'text', curtain is UP (hidden/partially visible handle?). 
  // Wait, sketch says "Transition from voice to text. Sliding drapes motion".
  // This implies Voice covers Text.
  
  return (
    <div className="w-full h-screen bg-neutral-100 flex items-center justify-center overflow-hidden">
      {/* Mobile Frame */}
      <div className="w-full h-full md:max-w-[400px] md:h-[850px] bg-background md:rounded-[2.5rem] shadow-2xl overflow-hidden relative border-4 border-neutral-800/5">
        
        {/* Base Layer: Text View */}
        <div className="absolute inset-0 z-0">
          <TextView 
            onVoiceMode={() => setMode("voice")} 
            onProfile={() => setShowProfile(true)}
          />
        </div>

        {/* Curtain Layer: Voice View */}
        <AnimatePresence>
          {mode === "voice" && (
            <motion.div
              initial={{ y: "-100%" }}
              animate={{ y: "0%" }}
              exit={{ y: "-100%" }}
              transition={{ 
                type: "spring", 
                stiffness: 100, 
                damping: 20, 
                mass: 1.2 
              }}
              className="absolute inset-0 z-10 bg-background shadow-2xl rounded-b-[2rem]"
            >
              {/* Drag Handle Indicator (Visual cue for the drape) */}
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 w-12 h-1.5 bg-muted-foreground/20 rounded-full" />
              
              <VoiceView 
                isActive={isCalling} 
                onTextMode={() => setMode("text")}
                onEndCall={() => setIsCalling(!isCalling)}
                onProfile={() => setShowProfile(true)}
              />
            </motion.div>
          )}
        </AnimatePresence>

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
