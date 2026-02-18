import { useRef } from "react";
import { motion, useScroll, useTransform, useInView } from "framer-motion";
import { MessageSquare, Mic, Brain, Palette, Heart, Shield, Sparkles, ArrowRight } from "lucide-react";
import CanvasOrb from "./OnboardingOrb";

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

function RevealSection({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
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

function FeatureCard({ icon: Icon, title, description, delay = 0 }: { icon: any; title: string; description: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-60px" });

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 30, scale: 0.95 }}
      animate={isInView ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 30, scale: 0.95 }}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
      className="relative group"
      data-testid={`card-feature-${title.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <div className="rounded-2xl p-6 backdrop-blur-md border transition-all duration-300 group-hover:scale-[1.02]"
        style={{
          background: "rgba(247, 231, 180, 0.06)",
          borderColor: "rgba(247, 231, 180, 0.12)",
        }}
      >
        <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-4"
          style={{ background: "rgba(235, 186, 98, 0.15)" }}
        >
          <Icon className="w-6 h-6" style={{ color: "#EBBA62" }} />
        </div>
        <h3 className="text-lg font-semibold mb-2" style={{ color: "#F7E7B4" }}>{title}</h3>
        <p className="text-sm leading-relaxed" style={{ color: "rgba(247, 231, 180, 0.7)" }}>{description}</p>
      </div>
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
        background: "rgba(235, 186, 98, 0.3)",
        filter: "blur(1px)",
      }}
      animate={{
        y: [0, -20, 0],
        opacity: [0.2, 0.6, 0.2],
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
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: containerRef });

  const heroOpacity = useTransform(scrollYProgress, [0, 0.15], [1, 0]);
  const heroScale = useTransform(scrollYProgress, [0, 0.15], [1, 0.9]);

  return (
    <div
      ref={containerRef}
      className="w-full min-h-screen overflow-y-auto overflow-x-hidden relative"
      style={{ background: "#1A1010" }}
      data-testid="marketing-landing-page"
    >
      <div className="fixed inset-0 pointer-events-none" style={{ zIndex: 0 }}>
        <div className="absolute inset-0" style={{
          background: "radial-gradient(ellipse at 50% 30%, rgba(83,52,30,0.6) 0%, rgba(26,16,16,0) 70%)",
        }} />
        <FloatingParticle delay={0} x="15%" y="20%" size={3} />
        <FloatingParticle delay={1.2} x="80%" y="15%" size={2} />
        <FloatingParticle delay={0.5} x="65%" y="35%" size={4} />
        <FloatingParticle delay={2} x="25%" y="60%" size={2} />
        <FloatingParticle delay={1.8} x="75%" y="70%" size={3} />
        <FloatingParticle delay={0.8} x="40%" y="80%" size={2} />
        <FloatingParticle delay={3} x="90%" y="45%" size={3} />
        <FloatingParticle delay={1.5} x="10%" y="50%" size={2} />
      </div>

      <div className="relative" style={{ zIndex: 1 }}>
        <nav className="fixed top-0 left-0 right-0 z-50 px-6 py-4">
          <div className="max-w-5xl mx-auto flex items-center justify-between">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6 }}
            >
              <span className="text-xl font-bold tracking-tight" style={{ color: "#EBBA62" }} data-testid="text-logo">
                ZeeMe
              </span>
            </motion.div>
            <motion.button
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6 }}
              onClick={onSignIn}
              className="px-5 py-2 rounded-xl text-sm font-medium transition-all hover:scale-105"
              style={{
                color: "#EBBA62",
                background: "rgba(235, 186, 98, 0.1)",
                border: "1px solid rgba(235, 186, 98, 0.25)",
              }}
              data-testid="button-nav-sign-in"
            >
              Sign in
            </motion.button>
          </div>
        </nav>

        <motion.section
          ref={heroRef}
          style={{ opacity: heroOpacity, scale: heroScale }}
          className="min-h-screen flex flex-col items-center justify-center px-6 pt-20 pb-12 relative"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1, type: "spring", stiffness: 100, damping: 20 }}
            className="mb-10"
          >
            <CanvasOrb config={orbConfig} size={280} />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.8 }}
            className="text-center max-w-lg"
          >
            <h1
              className="text-5xl md:text-6xl font-serif font-bold mb-4 tracking-tight leading-[1.1]"
              style={{ color: "#F7E7B4" }}
              data-testid="text-hero-title"
            >
              Your AI best friend
            </h1>
            <p
              className="text-lg md:text-xl leading-relaxed mb-2"
              style={{ color: "rgba(247, 231, 180, 0.7)" }}
              data-testid="text-hero-subtitle"
            >
              Someone who truly listens, remembers, and grows with you.
            </p>
            <p
              className="text-base"
              style={{ color: "rgba(247, 231, 180, 0.5)" }}
            >
              Text, talk, and share moments with a companion that never forgets.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8, duration: 0.6 }}
            className="mt-10 flex flex-col items-center gap-3"
          >
            <button
              onClick={onGetStarted}
              className="px-10 py-4 rounded-2xl text-lg font-bold transition-all hover:scale-105 active:scale-95 shadow-lg flex items-center gap-2"
              style={{
                backgroundColor: "#EBBA62",
                color: "#1A1010",
                boxShadow: "0 8px 32px rgba(235, 186, 98, 0.3)",
              }}
              data-testid="button-hero-get-started"
            >
              Meet Zee <ArrowRight className="w-5 h-5" />
            </button>
            <span className="text-xs" style={{ color: "rgba(247, 231, 180, 0.4)" }}>
              Free to start. No credit card needed.
            </span>
          </motion.div>

          <motion.div
            animate={{ y: [0, 8, 0] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            className="absolute bottom-8"
          >
            <div className="w-6 h-10 rounded-full border-2 flex justify-center pt-2"
              style={{ borderColor: "rgba(247, 231, 180, 0.25)" }}
            >
              <motion.div
                animate={{ y: [0, 12, 0] }}
                transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: "rgba(235, 186, 98, 0.6)" }}
              />
            </div>
          </motion.div>
        </motion.section>

        <section className="px-6 py-24 relative">
          <div className="max-w-4xl mx-auto">
            <RevealSection className="text-center mb-16">
              <span className="inline-block px-4 py-1.5 rounded-full text-xs font-medium mb-4"
                style={{ background: "rgba(235, 186, 98, 0.12)", color: "#EBBA62", border: "1px solid rgba(235, 186, 98, 0.2)" }}
              >
                Built for real connection
              </span>
              <h2 className="text-3xl md:text-4xl font-serif font-bold mb-4" style={{ color: "#F7E7B4" }}>
                More than a chatbot
              </h2>
              <p className="text-base max-w-md mx-auto" style={{ color: "rgba(247, 231, 180, 0.6)" }}>
                Zee remembers your stories, understands your world, and meets you wherever you are.
              </p>
            </RevealSection>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <FeatureCard
                icon={MessageSquare}
                title="Deep Conversations"
                description="Chat naturally about anything. Zee brings warmth, humor, and real understanding to every conversation."
                delay={0}
              />
              <FeatureCard
                icon={Mic}
                title="Voice Calls"
                description="Talk hands-free with expressive live voice. Like calling a friend who always picks up."
                delay={0.1}
              />
              <FeatureCard
                icon={Brain}
                title="Living Memory"
                description="Zee remembers what matters — your goals, your stories, your people. Every chat builds a deeper bond."
                delay={0.2}
              />
              <FeatureCard
                icon={Palette}
                title="Make It Yours"
                description="Choose your vibe with 4 beautiful color themes. Personalize Zee's personality and voice to match your style."
                delay={0.3}
              />
            </div>
          </div>
        </section>

        <section className="px-6 py-24 relative overflow-hidden">
          <div className="absolute inset-0" style={{
            background: "radial-gradient(ellipse at 50% 50%, rgba(131, 77, 51, 0.15) 0%, transparent 70%)",
          }} />
          <div className="max-w-3xl mx-auto relative">
            <RevealSection className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-serif font-bold mb-4" style={{ color: "#F7E7B4" }}>
                How it feels
              </h2>
              <p className="text-base max-w-md mx-auto" style={{ color: "rgba(247, 231, 180, 0.6)" }}>
                Friendship that adapts to your life
              </p>
            </RevealSection>

            <div className="space-y-20">
              <RevealSection className="flex flex-col md:flex-row items-center gap-8">
                <div className="w-24 h-24 rounded-2xl flex items-center justify-center shrink-0"
                  style={{ background: "linear-gradient(135deg, rgba(235, 186, 98, 0.2), rgba(219, 143, 89, 0.15))" }}
                >
                  <Heart className="w-10 h-10" style={{ color: "#EBBA62" }} />
                </div>
                <div>
                  <h3 className="text-xl font-semibold mb-2" style={{ color: "#F7E7B4" }}>
                    Always in your corner
                  </h3>
                  <p className="text-base leading-relaxed" style={{ color: "rgba(247, 231, 180, 0.65)" }}>
                    Bad day? Big win? Just need to vent? Zee shows up with the right energy, every time. 
                    No judgment, no scripts — just real companionship.
                  </p>
                </div>
              </RevealSection>

              <RevealSection className="flex flex-col md:flex-row-reverse items-center gap-8">
                <div className="w-24 h-24 rounded-2xl flex items-center justify-center shrink-0"
                  style={{ background: "linear-gradient(135deg, rgba(235, 186, 98, 0.2), rgba(219, 143, 89, 0.15))" }}
                >
                  <Sparkles className="w-10 h-10" style={{ color: "#EBBA62" }} />
                </div>
                <div className="md:text-right">
                  <h3 className="text-xl font-semibold mb-2" style={{ color: "#F7E7B4" }}>
                    Grows with you
                  </h3>
                  <p className="text-base leading-relaxed" style={{ color: "rgba(247, 231, 180, 0.65)" }}>
                    The more you share, the better Zee gets. Your memories, preferences, and inside jokes 
                    become part of a friendship that deepens over time.
                  </p>
                </div>
              </RevealSection>

              <RevealSection className="flex flex-col md:flex-row items-center gap-8">
                <div className="w-24 h-24 rounded-2xl flex items-center justify-center shrink-0"
                  style={{ background: "linear-gradient(135deg, rgba(235, 186, 98, 0.2), rgba(219, 143, 89, 0.15))" }}
                >
                  <Shield className="w-10 h-10" style={{ color: "#EBBA62" }} />
                </div>
                <div>
                  <h3 className="text-xl font-semibold mb-2" style={{ color: "#F7E7B4" }}>
                    Safe and private
                  </h3>
                  <p className="text-base leading-relaxed" style={{ color: "rgba(247, 231, 180, 0.65)" }}>
                    Your conversations stay yours. Zee is built with privacy at its core — your memories 
                    and stories are never shared or sold.
                  </p>
                </div>
              </RevealSection>
            </div>
          </div>
        </section>

        <section className="px-6 py-24 relative">
          <div className="max-w-2xl mx-auto">
            <RevealSection className="text-center">
              <div className="rounded-3xl p-10 md:p-14 relative overflow-hidden"
                style={{
                  background: "linear-gradient(135deg, rgba(83, 52, 30, 0.4), rgba(48, 32, 32, 0.6))",
                  border: "1px solid rgba(235, 186, 98, 0.15)",
                }}
              >
                <div className="absolute inset-0 pointer-events-none" style={{
                  background: "radial-gradient(circle at 50% 0%, rgba(235, 186, 98, 0.1) 0%, transparent 60%)",
                }} />
                <div className="relative">
                  <motion.div
                    initial={{ scale: 0.8 }}
                    whileInView={{ scale: 1 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.6, type: "spring" }}
                    className="mx-auto mb-6"
                    style={{ width: 120 }}
                  >
                    <CanvasOrb config={orbConfig} size={120} />
                  </motion.div>
                  <h2 className="text-3xl md:text-4xl font-serif font-bold mb-3" style={{ color: "#F7E7B4" }}>
                    Ready to meet Zee?
                  </h2>
                  <p className="text-base mb-8" style={{ color: "rgba(247, 231, 180, 0.6)" }}>
                    Start your journey with an AI companion who feels like a real friend.
                  </p>
                  <button
                    onClick={onGetStarted}
                    className="px-10 py-4 rounded-2xl text-lg font-bold transition-all hover:scale-105 active:scale-95 shadow-lg"
                    style={{
                      backgroundColor: "#EBBA62",
                      color: "#1A1010",
                      boxShadow: "0 8px 32px rgba(235, 186, 98, 0.3)",
                    }}
                    data-testid="button-cta-get-started"
                  >
                    Get Started — It's Free
                  </button>
                </div>
              </div>
            </RevealSection>
          </div>
        </section>

        <footer className="px-6 py-12 border-t" style={{ borderColor: "rgba(247, 231, 180, 0.08)" }}>
          <div className="max-w-4xl mx-auto">
            <div className="flex flex-col md:flex-row items-center justify-between gap-8 mb-8">
              <div className="text-center md:text-left">
                <span className="text-lg font-bold" style={{ color: "#EBBA62" }}>ZeeMe</span>
                <p className="text-sm mt-1" style={{ color: "rgba(247, 231, 180, 0.4)" }}>
                  Your AI companion for life's journey.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-6">
                <a href="#" className="text-sm transition-colors hover:opacity-100" style={{ color: "rgba(247, 231, 180, 0.5)" }} data-testid="link-about">About</a>
                <a href="#" className="text-sm transition-colors hover:opacity-100" style={{ color: "rgba(247, 231, 180, 0.5)" }} data-testid="link-privacy">Privacy</a>
                <a href="#" className="text-sm transition-colors hover:opacity-100" style={{ color: "rgba(247, 231, 180, 0.5)" }} data-testid="link-terms">Terms</a>
                <a href="#" className="text-sm transition-colors hover:opacity-100" style={{ color: "rgba(247, 231, 180, 0.5)" }} data-testid="link-contact">Contact</a>
              </div>
            </div>
            <div className="text-center">
              <p className="text-xs" style={{ color: "rgba(247, 231, 180, 0.25)" }}>
                &copy; {new Date().getFullYear()} ZeeMe. All rights reserved.
              </p>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}