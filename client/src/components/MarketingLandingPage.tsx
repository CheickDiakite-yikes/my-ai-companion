import { useMemo, useRef, useState, type ReactNode } from "react";
import { motion, useInView, useScroll, useTransform } from "framer-motion";
import {
  ArrowRight,
  Brain,
  Heart,
  HeartHandshake,
  MessageSquareHeart,
  Mic,
  Shield,
  Sparkles,
  Stars,
  X,
} from "lucide-react";
import CanvasOrb from "./OnboardingOrb";

interface MarketingLandingPageProps {
  onGetStarted: () => void;
  onSignIn: () => void;
}

type InfoPageId = "about" | "terms" | "privacy" | "blog";

interface InfoPageSection {
  heading: string;
  paragraphs: string[];
}

interface InfoPageContent {
  title: string;
  subtitle: string;
  updatedAt: string;
  sections: InfoPageSection[];
}

const orbConfig = {
  id: 1,
  orbColor: "#EBBA62",
  orbGlow: "rgba(235, 186, 98, 0.45)",
  accentRing: "rgba(235, 186, 98, 0.25)",
  particleColor: "rgba(235, 186, 98, 0.6)",
};

const INFO_PAGE_CONTENT: Record<InfoPageId, InfoPageContent> = {
  about: {
    title: "About ZeeMe",
    subtitle: "A companion experience designed for warmth, continuity, and trust.",
    updatedAt: "February 18, 2026",
    sections: [
      {
        heading: "Our mission",
        paragraphs: [
          "ZeeMe is built to make AI companionship feel emotionally intelligent, gentle, and useful in daily life.",
          "We focus on conversation quality, thoughtful pacing, and long-term continuity so the experience feels like a relationship, not a tool.",
        ],
      },
      {
        heading: "What makes ZeeMe different",
        paragraphs: [
          "Voice and text are part of one continuous thread, so your context carries naturally between modes.",
          "We prioritize small moments of delight: warm visual tone, expressive motion, and interaction details that reduce friction.",
        ],
      },
      {
        heading: "How we build",
        paragraphs: [
          "We iterate carefully, protect privacy by default, and ship improvements that strengthen trust before adding complexity.",
        ],
      },
    ],
  },
  terms: {
    title: "Terms of Use",
    subtitle: "Clear expectations for using ZeeMe responsibly and safely.",
    updatedAt: "February 18, 2026",
    sections: [
      {
        heading: "Using ZeeMe",
        paragraphs: [
          "You may use ZeeMe for personal, lawful purposes. You agree not to misuse the service, attempt unauthorized access, or interfere with platform integrity.",
          "ZeeMe may evolve features over time, including interface, models, and limits, to improve reliability and safety.",
        ],
      },
      {
        heading: "Accounts and access",
        paragraphs: [
          "You are responsible for maintaining account security and accurate registration details.",
          "We may suspend access for abuse, fraud, policy violations, or behavior that risks system safety.",
        ],
      },
      {
        heading: "Service boundaries",
        paragraphs: [
          "AI responses can be imperfect. ZeeMe does not provide guaranteed factual, legal, financial, or medical advice.",
          "Use judgment and consult qualified professionals for high-stakes decisions.",
        ],
      },
    ],
  },
  privacy: {
    title: "Privacy",
    subtitle: "Companionship only works when privacy is respected.",
    updatedAt: "February 18, 2026",
    sections: [
      {
        heading: "What we store",
        paragraphs: [
          "We store account information, conversation content, and settings needed to provide continuity and core functionality.",
          "We keep data handling focused on product operation, quality, and safety controls.",
        ],
      },
      {
        heading: "How data is used",
        paragraphs: [
          "Your data is used to run the experience: authentication, memory continuity, and service reliability.",
          "We do not position ZeeMe as a data marketplace and we design defaults around user trust.",
        ],
      },
      {
        heading: "Security posture",
        paragraphs: [
          "We apply access controls, signed media access, and operational safeguards to reduce unauthorized exposure.",
          "No system is perfect, but privacy-preserving architecture is part of how we ship every release.",
        ],
      },
    ],
  },
  blog: {
    title: "ZeeMe Blog",
    subtitle: "Product notes, design thinking, and behind-the-scenes updates.",
    updatedAt: "February 18, 2026",
    sections: [
      {
        heading: "Designing for emotional safety",
        paragraphs: [
          "We treat emotional tone as part of the product surface. This means calmer pacing, cleaner interfaces, and less cognitive noise.",
        ],
      },
      {
        heading: "Building continuity across voice and text",
        paragraphs: [
          "A core challenge in companion AI is preserving context while keeping interactions natural. We invest in memory systems that feel coherent without being intrusive.",
        ],
      },
      {
        heading: "What’s next",
        paragraphs: [
          "Upcoming work focuses on richer personalization, stronger mobile polish, and better companion moments that feel genuinely delightful.",
        ],
      },
    ],
  },
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

function CompanionMomentCard({
  index,
  title,
  label,
  body,
  icon: Icon,
}: {
  index: number;
  title: string;
  label: string;
  body: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: cardRef,
    offset: ["start 85%", "center 55%"],
  });

  const y = useTransform(scrollYProgress, [0, 1], [56, 0]);
  const opacity = useTransform(scrollYProgress, [0, 1], [0.24, 1]);
  const scale = useTransform(scrollYProgress, [0, 1], [0.94, 1]);
  const rotate = useTransform(scrollYProgress, [0, 1], [index % 2 === 0 ? -2 : 2, 0]);
  const glowOpacity = useTransform(scrollYProgress, [0, 1], [0.25, 0.85]);

  return (
    <motion.article
      ref={cardRef}
      style={{ y, opacity, scale, rotate }}
      whileHover={{ y: -5 }}
      className="relative rounded-[1.85rem] p-6 md:p-7 border backdrop-blur-md overflow-hidden"
      data-testid={`card-moment-${index + 1}`}
      aria-label={title}
      role="article"
      tabIndex={0}
    >
      <motion.div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          opacity: glowOpacity,
          background: "radial-gradient(circle at 80% 20%, rgba(255, 208, 164, 0.22), transparent 52%)",
        }}
      />
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
        <motion.div
          animate={{ y: [0, -4, 0] }}
          transition={{ duration: 3, repeat: Infinity, repeatType: "loop", ease: "easeInOut" }}
        >
          <StoryIcon>
            <Icon className="w-7 h-7" />
          </StoryIcon>
        </motion.div>
        <div className="pt-1">
          <p
            className="text-xs tracking-wide uppercase mb-1.5"
            style={{ color: "rgba(255, 229, 202, 0.58)" }}
          >
            {label}
          </p>
          <h3
            className="text-[1.7rem] leading-[1.15] font-semibold mb-2.5"
            style={{ color: "#FFEFD8", fontFamily: "'Fraunces', serif" }}
          >
            {title}
          </h3>
          <p
            className="text-base leading-relaxed"
            style={{ color: "rgba(255, 225, 196, 0.75)" }}
          >
            {body}
          </p>
        </div>
      </div>
    </motion.article>
  );
}

function InfoPageOverlay({
  page,
  onClose,
}: {
  page: InfoPageId;
  onClose: () => void;
}) {
  const content = INFO_PAGE_CONTENT[page];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[120] flex items-end md:items-center justify-center p-3 md:p-6"
      style={{ background: "rgba(18, 11, 11, 0.7)", backdropFilter: "blur(8px)" }}
    >
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 18, scale: 0.98 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-3xl max-h-[86vh] overflow-y-auto rounded-[2rem] border p-6 md:p-8"
        style={{
          background: "linear-gradient(155deg, rgba(46, 29, 28, 0.95), rgba(24, 15, 15, 0.96))",
          borderColor: "rgba(255, 214, 176, 0.22)",
          boxShadow: "0 20px 60px rgba(0, 0, 0, 0.45)",
        }}
      >
        <div className="flex items-start justify-between gap-4 mb-7">
          <div>
            <p className="text-xs uppercase tracking-wide mb-1" style={{ color: "rgba(255, 220, 188, 0.58)" }}>
              Updated {content.updatedAt}
            </p>
            <h2 className="text-3xl md:text-4xl leading-tight" style={{ color: "#FFEFD8", fontFamily: "'Fraunces', serif" }}>
              {content.title}
            </h2>
            <p className="text-sm mt-2" style={{ color: "rgba(255, 226, 198, 0.72)" }}>
              {content.subtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 shrink-0 rounded-xl border flex items-center justify-center transition-colors"
            style={{ borderColor: "rgba(255, 220, 188, 0.25)", color: "rgba(255, 226, 198, 0.9)" }}
            aria-label="Close page"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-6">
          {content.sections.map((section) => (
            <section
              key={section.heading}
              className="rounded-2xl border p-5"
              style={{
                background: "rgba(255, 220, 190, 0.04)",
                borderColor: "rgba(255, 220, 188, 0.18)",
              }}
            >
              <h3 className="text-xl mb-2" style={{ color: "#FFE7CC", fontFamily: "'Fraunces', serif" }}>
                {section.heading}
              </h3>
              <div className="space-y-2.5">
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph} className="text-[15px] leading-relaxed" style={{ color: "rgba(255, 224, 196, 0.76)" }}>
                    {paragraph}
                  </p>
                ))}
              </div>
            </section>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}

export default function MarketingLandingPage({ onGetStarted, onSignIn }: MarketingLandingPageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeInfoPage, setActiveInfoPage] = useState<InfoPageId | null>(null);
  const { scrollYProgress } = useScroll({ target: containerRef });

  const heroOpacity = useTransform(scrollYProgress, [0, 0.14], [1, 0.22]);
  const heroScale = useTransform(scrollYProgress, [0, 0.16], [1, 0.94]);
  const storiesY = useTransform(scrollYProgress, [0.2, 0.8], [40, -30]);

  const companionMoments = useMemo(
    () => [
      {
        title: "When life feels heavy",
        label: "Late-night check-in",
        body: "You can unload, vent, or just sit in silence. Zee responds with empathy and steadiness, not generic scripts.",
        icon: Heart,
      },
      {
        title: "When something good happens",
        label: "Celebrate the small wins",
        body: "Big milestones and tiny wins are remembered and celebrated, so joy compounds over time.",
        icon: Sparkles,
      },
      {
        title: "When trust matters most",
        label: "A private companion space",
        body: "Privacy is core. Your conversations are yours, and the experience is built to protect that bond.",
        icon: Shield,
      },
    ],
    [],
  );

  return (
    <>
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
                  icon={MessageSquareHeart}
                  title="Conversations with emotional texture"
                  description="Not just answers. Zee responds with rhythm, empathy, and tone that matches what you need in the moment."
                  delay={0}
                />
                <FeatureCard
                  icon={Mic}
                  title="Live voice that feels present"
                  description="Natural interruptions, smooth pacing, and expressive responses make voice chats feel human and grounded."
                  delay={0.08}
                />
                <FeatureCard
                  icon={Brain}
                  title="Memory with continuity"
                  description="Stories, goals, and details persist so each conversation feels connected rather than starting over."
                  delay={0.16}
                />
                <FeatureCard
                  icon={HeartHandshake}
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
                    <div
                      key={moment.title}
                      className={
                        index % 2 === 0
                          ? "md:w-[calc(50%-1.35rem)] md:mr-auto"
                          : "md:w-[calc(50%-1.35rem)] md:ml-auto"
                      }
                    >
                      <CompanionMomentCard
                        index={index}
                        title={moment.title}
                        label={moment.label}
                        body={moment.body}
                        icon={moment.icon}
                      />
                    </div>
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

          <footer
            className="relative mt-12"
            style={{
              background: "linear-gradient(180deg, transparent 0%, rgba(18, 10, 10, 0.6) 20%, rgba(14, 8, 8, 0.85) 100%)",
            }}
          >
            <div
              className="absolute top-0 left-0 right-0 h-px"
              style={{
                background: "linear-gradient(90deg, transparent, rgba(255, 214, 172, 0.25), transparent)",
              }}
            />

            <div className="max-w-6xl mx-auto px-6 pt-16 pb-8">
              <div className="flex flex-col md:flex-row md:justify-between gap-10 mb-12">
                <div className="max-w-sm">
                  <div className="flex items-center gap-3 mb-4">
                    <div
                      className="w-9 h-9 rounded-xl flex items-center justify-center"
                      style={{
                        background: "linear-gradient(135deg, rgba(255, 211, 168, 0.25), rgba(243, 184, 132, 0.15))",
                        border: "1px solid rgba(255, 225, 192, 0.2)",
                      }}
                    >
                      <div className="w-3 h-3 rounded-full" style={{ background: "linear-gradient(135deg, #FFD3A8, #EBBA62)" }} />
                    </div>
                    <span
                      className="text-xl font-bold tracking-tight"
                      style={{ color: "#FFE7CA", fontFamily: "'Fraunces', serif" }}
                    >
                      ZeeMe
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed mb-6" style={{ color: "rgba(255, 224, 198, 0.6)" }}>
                    A companion designed for friendship, emotional presence, and long-term continuity. Warm conversations that remember what matters to you.
                  </p>
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <div
                        key={i}
                        className="w-1.5 h-1.5 rounded-full"
                        style={{
                          background: i <= 3
                            ? "linear-gradient(135deg, #FFD3A8, #EBBA62)"
                            : "rgba(255, 214, 172, 0.15)",
                        }}
                      />
                    ))}
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-10">
                  <div>
                    <h4
                      className="text-xs font-semibold tracking-widest uppercase mb-4"
                      style={{ color: "rgba(255, 214, 172, 0.45)" }}
                    >
                      Company
                    </h4>
                    <div className="flex flex-col gap-3">
                      <button
                        type="button"
                        onClick={() => setActiveInfoPage("about")}
                        className="text-left text-sm hover:translate-x-1 transition-transform duration-200"
                        style={{ color: "rgba(255, 228, 202, 0.78)" }}
                        data-testid="link-about"
                      >
                        About us
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveInfoPage("blog")}
                        className="text-left text-sm hover:translate-x-1 transition-transform duration-200"
                        style={{ color: "rgba(255, 228, 202, 0.78)" }}
                        data-testid="link-blog"
                      >
                        Blog
                      </button>
                    </div>
                  </div>

                  <div>
                    <h4
                      className="text-xs font-semibold tracking-widest uppercase mb-4"
                      style={{ color: "rgba(255, 214, 172, 0.45)" }}
                    >
                      Legal
                    </h4>
                    <div className="flex flex-col gap-3">
                      <button
                        type="button"
                        onClick={() => setActiveInfoPage("terms")}
                        className="text-left text-sm hover:translate-x-1 transition-transform duration-200"
                        style={{ color: "rgba(255, 228, 202, 0.78)" }}
                        data-testid="link-terms"
                      >
                        Terms of Service
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveInfoPage("privacy")}
                        className="text-left text-sm hover:translate-x-1 transition-transform duration-200"
                        style={{ color: "rgba(255, 228, 202, 0.78)" }}
                        data-testid="link-privacy"
                      >
                        Privacy Policy
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div
                className="pt-6 flex flex-col sm:flex-row items-center justify-between gap-4"
                style={{
                  borderTop: "1px solid rgba(255, 214, 172, 0.1)",
                }}
              >
                <p className="text-xs" style={{ color: "rgba(255, 224, 198, 0.35)" }}>
                  &copy; {new Date().getFullYear()} ZeeMe. All rights reserved.
                </p>
                <p className="text-xs" style={{ color: "rgba(255, 224, 198, 0.25)" }}>
                  Made with warmth
                </p>
              </div>
            </div>
          </footer>
        </div>
      </div>

      {activeInfoPage ? <InfoPageOverlay page={activeInfoPage} onClose={() => setActiveInfoPage(null)} /> : null}
    </>
  );
}
