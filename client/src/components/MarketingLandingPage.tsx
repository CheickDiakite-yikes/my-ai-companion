import { useRef, type ReactNode } from "react";
import { motion, useInView, useScroll, useTransform } from "framer-motion";
import { ArrowRight, Stars } from "lucide-react";
import CanvasOrb from "./OnboardingOrb";

function IconEmpatheticChat({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="chat-glow" x1="4" y1="4" x2="24" y2="24">
          <stop offset="0%" stopColor="#FFE4BF" />
          <stop offset="100%" stopColor="#F5C88A" />
        </linearGradient>
      </defs>
      <path d="M5 7.5C5 6.12 6.12 5 7.5 5h13C21.88 5 23 6.12 23 7.5v9c0 1.38-1.12 2.5-2.5 2.5H12l-4.2 3.5c-.45.38-1.1.05-1.1-.55V19H5.5C4.67 19 4 18.33 4 17.5v-9C4 7.17 4.67 6.5 5.5 6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 11.5c.8-1.2 2.2-2 3.8-2 1.6 0 3 .8 3.8 2" stroke="url(#chat-glow)" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="10.5" cy="11" r="0.8" fill="currentColor" opacity="0.7" />
      <circle cx="16" cy="11" r="0.8" fill="currentColor" opacity="0.7" />
      <path d="M10.5 14.5c.6.9 1.7 1.5 3 1.5s2.4-.6 3-1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="21" cy="7" r="2.5" fill="url(#chat-glow)" opacity="0.4" />
      <path d="M20 6.5l1 1.2 1.5-1.8" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
    </svg>
  );
}

function IconLiveVoice({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="voice-pulse" x1="8" y1="6" x2="20" y2="22">
          <stop offset="0%" stopColor="#FFE4BF" />
          <stop offset="100%" stopColor="#F5C88A" />
        </linearGradient>
        <radialGradient id="voice-orb" cx="50%" cy="40%" r="50%">
          <stop offset="0%" stopColor="#FFD7A8" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#FFD7A8" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="14" cy="14" r="10" fill="url(#voice-orb)" />
      <rect x="12" y="6" width="4" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9 14a5 5 0 0010 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <line x1="14" y1="19" x2="14" y2="22" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <line x1="11" y1="22" x2="17" y2="22" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M5.5 13c0 0-0.5-3 0-5" stroke="url(#voice-pulse)" strokeWidth="1.2" strokeLinecap="round" opacity="0.6" />
      <path d="M3.5 14c0 0-0.8-4 0-7" stroke="url(#voice-pulse)" strokeWidth="1" strokeLinecap="round" opacity="0.35" />
      <path d="M22.5 13c0 0 0.5-3 0-5" stroke="url(#voice-pulse)" strokeWidth="1.2" strokeLinecap="round" opacity="0.6" />
      <path d="M24.5 14c0 0 0.8-4 0-7" stroke="url(#voice-pulse)" strokeWidth="1" strokeLinecap="round" opacity="0.35" />
    </svg>
  );
}

function IconLivingMemory({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="mem-grad" x1="6" y1="4" x2="22" y2="24">
          <stop offset="0%" stopColor="#FFE4BF" />
          <stop offset="100%" stopColor="#F5C88A" />
        </linearGradient>
      </defs>
      <circle cx="14" cy="12" r="7" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2.5 2" opacity="0.5" />
      <circle cx="14" cy="12" r="4" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="14" cy="12" r="1.5" fill="url(#mem-grad)" />
      <path d="M14 19v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M10 24h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M7.5 7L5 4.5" stroke="url(#mem-grad)" strokeWidth="1.2" strokeLinecap="round" opacity="0.55" />
      <path d="M20.5 7L23 4.5" stroke="url(#mem-grad)" strokeWidth="1.2" strokeLinecap="round" opacity="0.55" />
      <path d="M18 10c0 0 1.5 1.5 0 3.5" stroke="url(#mem-grad)" strokeWidth="1.1" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}

function IconFriendship({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="friend-warm" x1="4" y1="6" x2="24" y2="22">
          <stop offset="0%" stopColor="#FFE4BF" />
          <stop offset="100%" stopColor="#F5C88A" />
        </linearGradient>
      </defs>
      <path d="M14 22s-8-4.5-8-10a4.2 4.2 0 018-1.8A4.2 4.2 0 0122 12c0 5.5-8 10-8 10z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M14 22s-5.5-3.5-6.5-7.5" stroke="url(#friend-warm)" strokeWidth="1.2" strokeLinecap="round" opacity="0.5" />
      <circle cx="11" cy="13" r="0.7" fill="currentColor" opacity="0.6" />
      <circle cx="17" cy="13" r="0.7" fill="currentColor" opacity="0.6" />
      <path d="M12 15.5c.5.6 1.2 1 2 1s1.5-.4 2-1" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      <path d="M7 8l-2-1.5M21 8l2-1.5M14 6V4" stroke="url(#friend-warm)" strokeWidth="1" strokeLinecap="round" opacity="0.45" />
    </svg>
  );
}

function IconComfort({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="comfort-glow" x1="6" y1="4" x2="22" y2="24">
          <stop offset="0%" stopColor="#FFE4BF" />
          <stop offset="100%" stopColor="#F5C88A" />
        </linearGradient>
        <radialGradient id="comfort-orb" cx="50%" cy="35%" r="50%">
          <stop offset="0%" stopColor="#FFD7A8" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#FFD7A8" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="14" cy="14" r="11" fill="url(#comfort-orb)" />
      <path d="M8 18c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M10.5 15c0-1.9 1.6-3.5 3.5-3.5s3.5 1.6 3.5 3.5" stroke="url(#comfort-glow)" strokeWidth="1.3" strokeLinecap="round" opacity="0.7" />
      <circle cx="14" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="14" cy="9" r="0.8" fill="url(#comfort-glow)" />
      <path d="M6 11c-1.5-.8-2.5-2-2.5-3.5 0-2.2 2-4 4.5-4 1.5 0 2.8.7 3.5 1.7" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.35" />
      <path d="M22 11c1.5-.8 2.5-2 2.5-3.5 0-2.2-2-4-4.5-4-1.5 0-2.8.7-3.5 1.7" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.35" />
    </svg>
  );
}

function IconCelebrate({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="celebrate-grad" x1="5" y1="5" x2="23" y2="23">
          <stop offset="0%" stopColor="#FFE4BF" />
          <stop offset="100%" stopColor="#F5C88A" />
        </linearGradient>
      </defs>
      <path d="M14 4l1.8 4.2 4.5.6-3.2 3.2.8 4.5L14 14.6l-3.9 1.9.8-4.5-3.2-3.2 4.5-.6L14 4z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M14 4l1.8 4.2 4.5.6-3.2 3.2.8 4.5L14 14.6l-3.9 1.9.8-4.5-3.2-3.2 4.5-.6L14 4z" fill="url(#celebrate-grad)" opacity="0.2" />
      <circle cx="6" cy="8" r="1.2" fill="url(#celebrate-grad)" opacity="0.5" />
      <circle cx="22" cy="10" r="1" fill="url(#celebrate-grad)" opacity="0.4" />
      <circle cx="8" cy="20" r="0.8" fill="url(#celebrate-grad)" opacity="0.35" />
      <path d="M10 21l-2 3M18 21l2 3M14 19v4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.5" />
      <path d="M5 14c-1 1-1 3 0 4M23 14c1 1 1 3 0 4" stroke="url(#celebrate-grad)" strokeWidth="1" strokeLinecap="round" opacity="0.4" />
    </svg>
  );
}

function IconSafeSpace({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="safe-grad" x1="6" y1="4" x2="22" y2="24">
          <stop offset="0%" stopColor="#FFE4BF" />
          <stop offset="100%" stopColor="#F5C88A" />
        </linearGradient>
        <radialGradient id="safe-orb" cx="50%" cy="40%" r="45%">
          <stop offset="0%" stopColor="#FFD7A8" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#FFD7A8" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="14" cy="15" r="10" fill="url(#safe-orb)" />
      <path d="M14 4C14 4 6 7 6 14c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10 0-7-8-10-8-10z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M14 4C14 4 6 7 6 14c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10 0-7-8-10-8-10z" fill="url(#safe-grad)" opacity="0.1" />
      <circle cx="14" cy="13" r="3" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="14" cy="13" r="1" fill="url(#safe-grad)" />
      <path d="M11.5 17c0 0 1 1.5 2.5 1.5s2.5-1.5 2.5-1.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" opacity="0.6" />
      <path d="M9 9.5c1-1 2.8-2 5-2s4 1 5 2" stroke="url(#safe-grad)" strokeWidth="1" strokeLinecap="round" opacity="0.45" />
    </svg>
  );
}

interface MarketingLandingPageProps {
  onGetStarted: () => void;
  onSignIn: () => void;
}

const orbConfig = {
  id: 1,
  orbColor: "#EBBA62",
  orbGlow: "rgba(235, 186, 98, 0.45)",
  accentRing: "rgba(235, 186, 98, 0.25)",
  particleColor: "rgba(235, 186, 98, 0.6)",
};

function RevealSection({ children, className = "", delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 40 }}
      animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 40 }}
      transition={{ duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

function StoryIcon({ children }: { children: ReactNode }) {
  return (
    <motion.div
      whileHover={{ y: -2, scale: 1.04 }}
      className="w-16 h-16 rounded-[1.15rem] flex items-center justify-center relative"
      style={{
        background: "linear-gradient(145deg, rgba(255, 216, 174, 0.46), rgba(255, 186, 140, 0.24))",
        border: "1px solid rgba(255, 231, 203, 0.5)",
        boxShadow: "0 14px 35px rgba(79, 40, 21, 0.35)",
      }}
    >
      <div
        className="absolute inset-1 rounded-[0.9rem]"
        style={{
          background: "radial-gradient(circle at 30% 25%, rgba(255,255,255,0.38), transparent 55%)",
        }}
      />
      <div className="relative" style={{ color: "#FCE4BF" }}>
        {children}
      </div>
    </motion.div>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  description,
  delay = 0,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-60px" });

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 30, scale: 0.97 }}
      animate={isInView ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 30, scale: 0.97 }}
      transition={{ duration: 0.65, delay, ease: [0.22, 1, 0.36, 1] }}
      className="relative group"
      data-testid={`card-feature-${title.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <motion.div
        whileHover={{ y: -5 }}
        className="rounded-3xl p-6 md:p-7 backdrop-blur-md border transition-all duration-300"
        style={{
          background: "linear-gradient(160deg, rgba(255, 220, 187, 0.1), rgba(255, 185, 152, 0.06))",
          borderColor: "rgba(255, 223, 186, 0.2)",
        }}
      >
        <StoryIcon>
          <Icon className="w-7 h-7" />
        </StoryIcon>
        <h3
          className="text-xl font-semibold mt-5 mb-2 tracking-tight"
          style={{ color: "#FFEFD8", fontFamily: "'Fraunces', serif" }}
        >
          {title}
        </h3>
        <p className="text-[15px] leading-relaxed" style={{ color: "rgba(255, 228, 202, 0.78)", fontFamily: "'Manrope', sans-serif" }}>
          {description}
        </p>
      </motion.div>
    </motion.div>
  );
}

function FloatingParticle({ delay, x, y, size }: { delay: number; x: string; y: string; size: number }) {
  return (
    <motion.div
      className="absolute rounded-full pointer-events-none"
      style={{
        left: x,
        top: y,
        width: size,
        height: size,
        background: "rgba(245, 197, 145, 0.35)",
        filter: "blur(1px)",
      }}
      animate={{
        y: [0, -24, 0],
        opacity: [0.2, 0.65, 0.2],
        scale: [1, 1.3, 1],
      }}
      transition={{
        duration: 4 + Math.random() * 3,
        delay,
        repeat: Infinity,
        ease: "easeInOut",
      }}
    />
  );
}

export default function MarketingLandingPage({ onGetStarted, onSignIn }: MarketingLandingPageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: containerRef });

  const heroOpacity = useTransform(scrollYProgress, [0, 0.14], [1, 0.22]);
  const heroScale = useTransform(scrollYProgress, [0, 0.16], [1, 0.94]);
  const storiesY = useTransform(scrollYProgress, [0.2, 0.8], [40, -30]);
  const companionMoments: Array<{
    title: string;
    label: string;
    body: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    {
      title: "When life feels heavy",
      label: "Late-night check-in",
      body: "You can unload, vent, or just sit in silence. Zee responds with empathy and steadiness, not generic scripts.",
      icon: IconComfort,
    },
    {
      title: "When something good happens",
      label: "Celebrate the small wins",
      body: "Big milestones and tiny wins are remembered and celebrated, so joy compounds over time.",
      icon: IconCelebrate,
    },
    {
      title: "When trust matters most",
      label: "A private companion space",
      body: "Privacy is core. Your conversations are yours, and the experience is built to protect that bond.",
      icon: IconSafeSpace,
    },
  ];

  return (
    <div
      ref={containerRef}
      className="w-full min-h-screen overflow-y-auto overflow-x-hidden relative"
      style={{ background: "#1B1414", fontFamily: "'Manrope', sans-serif" }}
      data-testid="landing-page"
      data-marketing-testid="marketing-landing-page"
    >
      <div className="fixed inset-0 pointer-events-none" style={{ zIndex: 0 }}>
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 22% 16%, rgba(197, 131, 90, 0.37), transparent 56%)" }} />
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 80% 14%, rgba(150, 98, 75, 0.28), transparent 52%)" }} />
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 50% 82%, rgba(110, 69, 60, 0.34), transparent 56%)" }} />
        <FloatingParticle delay={0} x="12%" y="20%" size={3} />
        <FloatingParticle delay={1.2} x="80%" y="16%" size={2} />
        <FloatingParticle delay={0.5} x="66%" y="34%" size={4} />
        <FloatingParticle delay={2} x="26%" y="58%" size={2} />
        <FloatingParticle delay={1.8} x="75%" y="72%" size={3} />
        <FloatingParticle delay={0.8} x="40%" y="82%" size={2} />
      </div>

      <div className="relative" style={{ zIndex: 1 }}>
        <nav className="fixed top-0 left-0 right-0 z-50 px-6 py-4">
          <div className="max-w-6xl mx-auto flex items-center justify-between rounded-2xl px-4 py-2 backdrop-blur-md border" style={{ background: "rgba(40, 26, 24, 0.46)", borderColor: "rgba(255, 217, 183, 0.16)" }}>
            <motion.div initial={{ opacity: 0, x: -18 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.6 }}>
              <span className="text-xl font-bold tracking-tight" style={{ color: "#FFD7A8", fontFamily: "'Fraunces', serif" }} data-testid="text-logo">
                ZeeMe
              </span>
            </motion.div>
            <motion.button
              initial={{ opacity: 0, x: 18 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6 }}
              whileHover={{ y: -1.5, scale: 1.03 }}
              whileTap={{ scale: 0.98 }}
              onClick={onSignIn}
              className="px-5 py-2 rounded-xl text-sm font-medium transition-all"
              style={{
                color: "#FFE2BE",
                background: "rgba(255, 206, 158, 0.12)",
                border: "1px solid rgba(255, 217, 172, 0.35)",
              }}
              data-testid="button-sign-in"
            >
              Sign in
            </motion.button>
          </div>
        </nav>

        <motion.section style={{ opacity: heroOpacity, scale: heroScale }} className="min-h-screen flex flex-col items-center justify-center px-6 pt-24 pb-14 relative">
          <motion.div
            initial={{ opacity: 0, scale: 0.65 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1.1, type: "spring", stiffness: 90, damping: 20 }}
            className="mb-10"
          >
            <CanvasOrb config={orbConfig} size={290} />
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35, duration: 0.85 }} className="text-center max-w-xl">
            <h1
              className="text-[2.7rem] md:text-[4.1rem] font-semibold mb-4 tracking-tight leading-[1.03]"
              style={{ color: "#FFEFD8", fontFamily: "'Fraunces', serif" }}
              data-testid="text-hero-title"
            >
              A softer kind of AI companionship
            </h1>
            <p className="text-lg md:text-xl leading-relaxed mb-2" style={{ color: "rgba(255, 228, 202, 0.86)" }} data-testid="text-hero-subtitle">
              Thoughtful chat, expressive live voice, and memory that remembers what matters to you.
            </p>
            <p className="text-[15px]" style={{ color: "rgba(255, 228, 202, 0.62)" }}>
              Warm, welcoming, and designed to feel like friendship.
            </p>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.75, duration: 0.6 }} className="mt-10 flex flex-col items-center gap-3">
            <motion.button
              onClick={onGetStarted}
              whileHover={{ y: -2, scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              className="px-11 py-4 rounded-2xl text-lg font-semibold shadow-lg flex items-center gap-2 relative overflow-hidden"
              style={{
                background: "linear-gradient(135deg, #FFD3A8, #F3B884)",
                color: "#2A1B17",
                boxShadow: "0 10px 34px rgba(251, 185, 137, 0.37)",
              }}
              data-testid="button-get-started"
            >
              <motion.span
                aria-hidden
                className="absolute inset-y-0 -left-10 w-8"
                style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent)" }}
                animate={{ x: [-20, 270] }}
                transition={{ duration: 2.2, repeat: Infinity, repeatDelay: 1.8, ease: "easeInOut" }}
              />
              Continue to welcome <ArrowRight className="w-5 h-5" />
            </motion.button>
            <span className="text-xs" style={{ color: "rgba(255, 224, 193, 0.55)" }}>
              Free to start. No credit card needed.
            </span>
          </motion.div>
        </motion.section>

        <section className="px-6 py-24 relative">
          <div className="max-w-5xl mx-auto">
            <RevealSection className="text-center mb-16">
              <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-medium mb-4" style={{ background: "rgba(255, 197, 150, 0.14)", color: "#FFD2A6", border: "1px solid rgba(255, 217, 174, 0.22)" }}>
                <Stars className="w-3.5 h-3.5" /> Built for emotional presence
              </span>
              <h2 className="text-3xl md:text-5xl font-semibold mb-4 tracking-tight" style={{ color: "#FFEFD8", fontFamily: "'Fraunces', serif" }}>
                Beautifully calm, deeply personal
              </h2>
              <p className="text-base max-w-2xl mx-auto" style={{ color: "rgba(255, 226, 198, 0.68)" }}>
                ZeeMe balances delight and trust with careful pacing, warm language, and companion-first interaction design.
              </p>
            </RevealSection>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <FeatureCard
                icon={IconEmpatheticChat}
                title="Conversations with emotional texture"
                description="Not just answers. Zee responds with rhythm, empathy, and tone that matches what you need in the moment."
                delay={0}
              />
              <FeatureCard
                icon={IconLiveVoice}
                title="Live voice that feels present"
                description="Natural interruptions, smooth pacing, and expressive responses make voice chats feel human and grounded."
                delay={0.08}
              />
              <FeatureCard
                icon={IconLivingMemory}
                title="Memory with continuity"
                description="Stories, goals, and details persist so each conversation feels connected rather than starting over."
                delay={0.16}
              />
              <FeatureCard
                icon={IconFriendship}
                title="Friendship-first experience"
                description="Every surface is designed for warmth and trust, from first interaction to long-term companionship."
                delay={0.24}
              />
            </div>
          </div>
        </section>

        <section className="px-6 py-24 relative overflow-hidden">
          <motion.div className="absolute inset-0" style={{ y: storiesY, background: "radial-gradient(ellipse at 50% 45%, rgba(149, 88, 64, 0.22) 0%, transparent 70%)" }} />
          <div className="max-w-5xl mx-auto relative">
            <RevealSection className="text-center mb-16">
              <h2 className="text-3xl md:text-5xl font-semibold mb-4 tracking-tight" style={{ color: "#FFEFD8", fontFamily: "'Fraunces', serif" }}>
                Moments that feel like being understood
              </h2>
              <p className="text-base max-w-xl mx-auto" style={{ color: "rgba(255, 226, 198, 0.68)" }}>
                From daily check-ins to midnight thoughts, ZeeMe meets you with consistent warmth and continuity.
              </p>
            </RevealSection>

            <div className="relative">
              <div
                className="hidden md:block absolute left-1/2 top-4 bottom-4 w-px -translate-x-1/2"
                style={{
                  background:
                    "linear-gradient(180deg, rgba(255, 214, 172, 0.05), rgba(255, 214, 172, 0.45), rgba(255, 214, 172, 0.05))",
                }}
              />
              <div className="space-y-7 md:space-y-10">
                {companionMoments.map((moment, index) => (
                  <RevealSection
                    key={moment.title}
                    delay={index * 0.06}
                    className={`relative ${
                      index % 2 === 0
                        ? "md:w-[calc(50%-1.35rem)] md:mr-auto"
                        : "md:w-[calc(50%-1.35rem)] md:ml-auto"
                    }`}
                  >
                    <motion.article
                      whileHover={{ y: -5 }}
                      className="relative rounded-[1.85rem] p-6 md:p-7 border backdrop-blur-md overflow-hidden"
                      style={{
                        background:
                          "linear-gradient(160deg, rgba(255, 223, 194, 0.1), rgba(255, 188, 158, 0.06))",
                        borderColor: "rgba(255, 224, 194, 0.2)",
                        boxShadow: "0 18px 45px rgba(43, 25, 24, 0.38)",
                      }}
                    >
                      <div
                        className="absolute right-4 top-4 text-[11px] px-2.5 py-1 rounded-full border tracking-wide uppercase"
                        style={{
                          color: "rgba(255, 232, 208, 0.72)",
                          borderColor: "rgba(255, 225, 197, 0.28)",
                          background: "rgba(255, 211, 171, 0.08)",
                        }}
                      >
                        Moment {index + 1}
                      </div>
                      <div
                        className="absolute -right-8 -bottom-8 w-32 h-32 rounded-full"
                        style={{
                          background:
                            "radial-gradient(circle, rgba(255, 202, 154, 0.2) 0%, rgba(255, 202, 154, 0) 70%)",
                        }}
                      />
                      <div className="relative flex items-start gap-4">
                        <StoryIcon>
                          <moment.icon className="w-7 h-7" />
                        </StoryIcon>
                        <div className="pt-1">
                          <p
                            className="text-xs tracking-wide uppercase mb-1.5"
                            style={{ color: "rgba(255, 229, 202, 0.58)" }}
                          >
                            {moment.label}
                          </p>
                          <h3
                            className="text-[1.7rem] leading-[1.15] font-semibold mb-2.5"
                            style={{ color: "#FFEFD8", fontFamily: "'Fraunces', serif" }}
                          >
                            {moment.title}
                          </h3>
                          <p
                            className="text-base leading-relaxed"
                            style={{ color: "rgba(255, 225, 196, 0.75)" }}
                          >
                            {moment.body}
                          </p>
                        </div>
                      </div>
                    </motion.article>
                  </RevealSection>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="px-6 py-24 relative">
          <div className="max-w-2xl mx-auto">
            <RevealSection className="text-center">
              <div
                className="rounded-3xl p-10 md:p-14 relative overflow-hidden"
                style={{
                  background: "linear-gradient(135deg, rgba(110, 67, 52, 0.47), rgba(59, 35, 35, 0.64))",
                  border: "1px solid rgba(255, 218, 182, 0.2)",
                }}
              >
                <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(circle at 50% 0%, rgba(255, 195, 149, 0.15) 0%, transparent 60%)" }} />
                <div className="relative">
                  <motion.div initial={{ scale: 0.82 }} whileInView={{ scale: 1 }} viewport={{ once: true }} transition={{ duration: 0.6, type: "spring" }} className="mx-auto mb-6" style={{ width: 120 }}>
                    <CanvasOrb config={orbConfig} size={120} />
                  </motion.div>
                  <h2 className="text-3xl md:text-4xl font-semibold mb-3 tracking-tight" style={{ color: "#FFEFD8", fontFamily: "'Fraunces', serif" }}>
                    Step into your welcome page
                  </h2>
                  <p className="text-base mb-8" style={{ color: "rgba(255, 226, 198, 0.68)" }}>
                    Sign up or sign in and continue into your full ZeeMe experience.
                  </p>
                  <motion.button
                    onClick={onGetStarted}
                    whileHover={{ y: -2, scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    className="px-10 py-4 rounded-2xl text-lg font-semibold shadow-lg"
                    style={{
                      background: "linear-gradient(135deg, #FFD3A8, #F3B884)",
                      color: "#2A1B17",
                      boxShadow: "0 8px 32px rgba(251, 185, 137, 0.35)",
                    }}
                  >
                    Continue to welcome
                  </motion.button>
                </div>
              </div>
            </RevealSection>
          </div>
        </section>
      </div>
    </div>
  );
}
