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
  icon?: string;
  paragraphs: string[];
}

interface InfoPageContent {
  title: string;
  subtitle: string;
  updatedAt: string;
  heroIcon: string;
  accentWord: string;
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
    updatedAt: "February 2026",
    heroIcon: "\u2728",
    accentWord: "Companion",
    sections: [
      {
        heading: "Our mission",
        icon: "\uD83C\uDFAF",
        paragraphs: [
          "ZeeMe is built to make AI companionship feel emotionally intelligent, gentle, and useful in daily life.",
          "We focus on conversation quality, thoughtful pacing, and long-term continuity so the experience feels like a relationship, not a tool.",
        ],
      },
      {
        heading: "What makes ZeeMe different",
        icon: "\uD83D\uDCA1",
        paragraphs: [
          "Voice and text are part of one continuous thread, so your context carries naturally between modes.",
          "We prioritize small moments of delight: warm visual tone, expressive motion, and interaction details that reduce friction.",
        ],
      },
      {
        heading: "How we build",
        icon: "\uD83D\uDEE0\uFE0F",
        paragraphs: [
          "We iterate carefully, protect privacy by default, and ship improvements that strengthen trust before adding complexity.",
          "Every feature is tested against a simple question: does this make the companion experience feel more genuine?",
        ],
      },
      {
        heading: "The team behind Zee",
        icon: "\uD83E\uDDE1",
        paragraphs: [
          "We're a small team obsessed with emotional presence in technology. We believe AI can be warm without being manipulative, and helpful without being cold.",
          "ZeeMe is designed and built by people who care deeply about the quality of digital relationships.",
        ],
      },
    ],
  },
  terms: {
    title: "Terms of Service",
    subtitle: "Clear expectations for using ZeeMe responsibly and safely.",
    updatedAt: "February 2026",
    heroIcon: "\uD83D\uDCDC",
    accentWord: "Agreement",
    sections: [
      {
        heading: "Using ZeeMe",
        icon: "\u2705",
        paragraphs: [
          "You may use ZeeMe for personal, lawful purposes. You agree not to misuse the service, attempt unauthorized access, or interfere with platform integrity.",
          "ZeeMe may evolve features over time, including interface, models, and limits, to improve reliability and safety.",
        ],
      },
      {
        heading: "Accounts and access",
        icon: "\uD83D\uDD11",
        paragraphs: [
          "You are responsible for maintaining account security and accurate registration details.",
          "We may suspend access for abuse, fraud, policy violations, or behavior that risks system safety.",
        ],
      },
      {
        heading: "Content and conduct",
        icon: "\uD83D\uDCAC",
        paragraphs: [
          "You retain ownership of any content you share in conversations. We use your content solely to provide and improve the ZeeMe service.",
          "You agree not to use ZeeMe to generate harmful, illegal, or misleading content, or to harass, threaten, or impersonate others.",
        ],
      },
      {
        heading: "Service boundaries",
        icon: "\u26A0\uFE0F",
        paragraphs: [
          "AI responses can be imperfect. ZeeMe does not provide guaranteed factual, legal, financial, or medical advice.",
          "Use judgment and consult qualified professionals for high-stakes decisions. ZeeMe is a companion, not a licensed advisor.",
        ],
      },
      {
        heading: "Changes to terms",
        icon: "\uD83D\uDD04",
        paragraphs: [
          "We may update these terms as the product evolves. Continued use after changes constitutes acceptance.",
          "We will communicate significant changes through the app or email notification.",
        ],
      },
    ],
  },
  privacy: {
    title: "Privacy Policy",
    subtitle: "Companionship only works when privacy is respected. Here's how we protect yours.",
    updatedAt: "February 2026",
    heroIcon: "🔒",
    accentWord: "Protected",
    sections: [
      {
        heading: "What we collect",
        icon: "📋",
        paragraphs: [
          "We collect account information (email, name), conversation content, usage patterns, and device information needed for authentication and service delivery.",
          "We keep data collection focused and purposeful — we only gather what's needed to run and improve ZeeMe.",
        ],
      },
      {
        heading: "How your data is used",
        icon: "🔧",
        paragraphs: [
          "Your data powers the core experience: authentication, memory continuity, personalization, and service reliability.",
          "We do not sell your data. We do not position ZeeMe as a data marketplace. Your conversations are yours.",
        ],
      },
      {
        heading: "Data storage and security",
        icon: "🛡️",
        paragraphs: [
          "Data is stored using encrypted databases with access controls and operational safeguards.",
          "We apply signed media access, rate limiting, and monitoring to reduce unauthorized exposure. No system is perfect, but privacy-preserving architecture is built into every release.",
        ],
      },
      {
        heading: "Your rights",
        icon: "⚖️",
        paragraphs: [
          "You can request access to, correction of, or deletion of your personal data at any time.",
          "To exercise these rights, reach out through the app's settings or contact us directly. We aim to respond within 30 days.",
        ],
      },
    ],
  },
  blog: {
    title: "ZeeMe Blog",
    subtitle: "Product notes, design thinking, and behind-the-scenes updates from the team.",
    updatedAt: "February 2026",
    heroIcon: "📝",
    accentWord: "Stories",
    sections: [
      {
        heading: "Designing for emotional safety",
        icon: "🎨",
        paragraphs: [
          "We treat emotional tone as part of the product surface. This means calmer pacing, cleaner interfaces, and less cognitive noise.",
          "Every interaction detail — from animation timing to word choice — is tuned to feel present without being overwhelming. We want Zee to feel like a steady presence, not a demanding one.",
        ],
      },
      {
        heading: "Building continuity across voice and text",
        icon: "🌐",
        paragraphs: [
          "A core challenge in companion AI is preserving context while keeping interactions natural. We invest in memory systems that feel coherent without being intrusive.",
          "Whether you're typing at your desk or talking on a walk, the conversation thread stays connected. Context isn't just stored — it's woven naturally into how Zee responds.",
        ],
      },
      {
        heading: "The warmth in the details",
        icon: "☕",
        paragraphs: [
          "Great companion experiences aren't built from features alone. They come from hundreds of small decisions: the way a message appears, the pause before a voice response, the color temperature of a screen.",
          "We obsess over these details because they're what separate a tool from a friend.",
        ],
      },
      {
        heading: "What's next for ZeeMe",
        icon: "🚀",
        paragraphs: [
          "Upcoming work focuses on richer personalization, stronger mobile polish, and better companion moments that feel genuinely delightful.",
          "We're also exploring deeper memory capabilities, so Zee can reference shared experiences more naturally over time. Stay tuned.",
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
  index = 0,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  delay?: number;
  index?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start 90%", "center 60%"],
  });

  const y = useTransform(scrollYProgress, [0, 1], [50, 0]);
  const opacity = useTransform(scrollYProgress, [0, 0.3, 1], [0, 0.5, 1]);
  const scale = useTransform(scrollYProgress, [0, 1], [0.92, 1]);
  const cardX = useTransform(
    scrollYProgress,
    [0, 1],
    [index % 2 === 0 ? -25 : 25, 0]
  );

  return (
    <motion.div
      ref={ref}
      style={{ y, opacity, scale, x: cardX }}
      className="relative group"
      data-testid={`card-feature-${title.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <motion.div
        whileHover={{ y: -6, scale: 1.02, transition: { duration: 0.25 } }}
        className="rounded-none p-7 md:p-8 backdrop-blur-md border transition-all duration-300 relative overflow-hidden"
        style={{
          background: "linear-gradient(160deg, rgba(255, 220, 187, 0.08), rgba(255, 185, 152, 0.04))",
          borderColor: "rgba(255, 223, 186, 0.15)",
        }}
      >
        <div className="absolute -top-px left-6 right-6 h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(255, 214, 172, 0.25), transparent)" }} />
        <div className="absolute -bottom-px left-6 right-6 h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(255, 214, 172, 0.15), transparent)" }} />
        <div
          className="absolute -right-6 -top-6 w-28 h-28 rounded-full pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-500"
          style={{
            background: "radial-gradient(circle, rgba(255, 208, 164, 0.12) 0%, transparent 70%)",
          }}
        />
        <StoryIcon>
          <Icon className="w-7 h-7" />
        </StoryIcon>
        <h3
          className="text-xl font-semibold mt-5 mb-3 tracking-tight"
          style={{ color: "#FFEFD8", fontFamily: "'Fraunces', serif" }}
        >
          {title}
        </h3>
        <p className="text-[15px] leading-[1.85]" style={{ color: "rgba(255, 228, 202, 0.72)" }}>
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

function ScrollAccordionItem({
  index,
  title,
  label,
  body,
  icon: Icon,
  total,
}: {
  index: number;
  title: string;
  label: string;
  body: string;
  icon: React.ComponentType<{ className?: string }>;
  total: number;
}) {
  const itemRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: itemRef,
    offset: ["start 85%", "start 35%"],
  });

  const contentMaxH = useTransform(scrollYProgress, [0, 0.4, 0.7], [0, 0, 200]);
  const contentOpacity = useTransform(scrollYProgress, [0, 0.45, 0.75], [0, 0, 1]);
  const titleOpacity = useTransform(scrollYProgress, [0, 0.15], [0.45, 1]);
  const iconScale = useTransform(scrollYProgress, [0, 0.3], [0.85, 1]);
  const accentWidth = useTransform(scrollYProgress, [0, 0.5, 1], ["0%", "0%", "100%"]);
  const chevronRotate = useTransform(scrollYProgress, [0, 0.5, 0.7], [0, 0, 180]);
  const romanNumerals = ["i", "ii", "iii", "iv", "v", "vi"];

  return (
    <motion.div
      ref={itemRef}
      className="relative"
      data-testid={`card-moment-${index + 1}`}
    >
      <div className="relative py-6 md:py-8">
        <div className="flex items-start gap-5">
          <motion.div
            className="flex flex-col items-center gap-2 pt-1 shrink-0"
            style={{ scale: iconScale }}
          >
            <StoryIcon>
              <Icon className="w-6 h-6" />
            </StoryIcon>
            <span
              className="text-[10px] tracking-[0.2em] font-light"
              style={{ color: "rgba(255, 214, 172, 0.3)", fontFamily: "'Fraunces', serif" }}
            >
              {romanNumerals[index]}
            </span>
          </motion.div>

          <div className="flex-1 min-w-0">
            <motion.div style={{ opacity: titleOpacity }}>
              <p
                className="text-[10px] tracking-[0.25em] uppercase mb-1.5"
                style={{ color: "rgba(255, 229, 202, 0.4)" }}
              >
                {label}
              </p>
              <h3
                className="text-xl md:text-[1.5rem] font-semibold leading-tight"
                style={{ color: "#FFEFD8", fontFamily: "'Fraunces', serif" }}
              >
                {title}
              </h3>
            </motion.div>

            <motion.div
              className="overflow-hidden"
              style={{ maxHeight: contentMaxH, opacity: contentOpacity }}
            >
              <p
                className="text-[15px] leading-[1.85] mt-3 pb-1"
                style={{ color: "rgba(255, 225, 196, 0.7)" }}
              >
                {body}
              </p>
            </motion.div>
          </div>

          <motion.div className="shrink-0 pt-2" style={{ rotate: chevronRotate }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 5.5 L7 9.5 L11 5.5" stroke="rgba(255, 214, 172, 0.35)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </motion.div>
        </div>

        <motion.div
          className="absolute bottom-0 left-0 h-px"
          style={{
            width: accentWidth,
            background: "linear-gradient(90deg, rgba(255, 214, 172, 0.25), rgba(255, 214, 172, 0.08), transparent)",
          }}
        />
      </div>

      {index < total - 1 && (
        <div className="flex items-center justify-center">
          <div className="w-1 h-1 rotate-45" style={{ background: "rgba(255, 214, 172, 0.15)" }} />
        </div>
      )}
    </motion.div>
  );
}

function CtaSection({ onGetStarted, orbConfig }: { onGetStarted: () => void; orbConfig: any }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start 85%", "center 50%"],
  });

  const cardY = useTransform(scrollYProgress, [0, 1], [60, 0]);
  const cardOpacity = useTransform(scrollYProgress, [0, 0.3, 1], [0, 0.6, 1]);
  const cardScale = useTransform(scrollYProgress, [0, 1], [0.9, 1]);
  const glowSize = useTransform(scrollYProgress, [0, 1], [0.4, 1]);

  return (
    <section className="px-6 py-28 relative">
      <div className="max-w-2xl mx-auto">
        <motion.div
          ref={ref}
          style={{ y: cardY, opacity: cardOpacity, scale: cardScale }}
          className="text-center"
        >
          <div
            className="rounded-none p-10 md:p-14 relative overflow-hidden"
            style={{
              background: "linear-gradient(135deg, rgba(110, 67, 52, 0.35), rgba(59, 35, 35, 0.5))",
              border: "1px solid rgba(255, 218, 182, 0.15)",
            }}
          >
            <div className="absolute -top-px left-8 right-8 h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(255, 214, 172, 0.35), transparent)" }} />
            <div className="absolute -bottom-px left-8 right-8 h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(255, 214, 172, 0.2), transparent)" }} />
            <div className="absolute top-8 bottom-8 -left-px w-px" style={{ background: "linear-gradient(180deg, transparent, rgba(255, 214, 172, 0.2), transparent)" }} />
            <div className="absolute top-8 bottom-8 -right-px w-px" style={{ background: "linear-gradient(180deg, transparent, rgba(255, 214, 172, 0.2), transparent)" }} />

            <motion.div
              className="absolute inset-0 pointer-events-none"
              style={{
                scale: glowSize,
                background: "radial-gradient(circle at 50% 0%, rgba(255, 195, 149, 0.15) 0%, transparent 55%)",
              }}
            />
            <div className="relative">
              <div className="flex items-center justify-center gap-4 mb-6">
                <svg width="40" height="8" viewBox="0 0 40 8" fill="none" className="opacity-25">
                  <path d="M0 4 C8 4, 8 1, 16 1 C24 1, 24 7, 32 7 C36 7, 38 5.5, 40 4" stroke="rgba(255, 214, 172, 0.7)" strokeWidth="0.8" fill="none" />
                </svg>
                <span className="text-[11px] tracking-[0.35em] uppercase" style={{ color: "rgba(255, 214, 172, 0.4)" }}>
                  Your Journey
                </span>
                <svg width="40" height="8" viewBox="0 0 40 8" fill="none" className="opacity-25" style={{ transform: "scaleX(-1)" }}>
                  <path d="M0 4 C8 4, 8 1, 16 1 C24 1, 24 7, 32 7 C36 7, 38 5.5, 40 4" stroke="rgba(255, 214, 172, 0.7)" strokeWidth="0.8" fill="none" />
                </svg>
              </div>

              <motion.div
                initial={{ scale: 0.7, opacity: 0 }}
                whileInView={{ scale: 1, opacity: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.7, type: "spring", bounce: 0.3 }}
                className="mx-auto mb-7"
                style={{ width: 120 }}
              >
                <CanvasOrb config={orbConfig} size={120} />
              </motion.div>
              <h2 className="text-3xl md:text-[2.6rem] font-semibold mb-3 tracking-tight leading-[1.1]" style={{ color: "#FFEFD8", fontFamily: "'Fraunces', serif" }}>
                Begin your journey with Zee
              </h2>
              <div className="flex items-center justify-center gap-2 mb-5">
                <div className="w-8 h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(255, 214, 172, 0.25))" }} />
                <div className="w-1.5 h-1.5 rotate-45 border" style={{ borderColor: "rgba(255, 214, 172, 0.2)" }} />
                <div className="w-8 h-px" style={{ background: "linear-gradient(90deg, rgba(255, 214, 172, 0.25), transparent)" }} />
              </div>
              <p className="text-[15px] leading-[1.85] max-w-sm mx-auto mb-4" style={{ color: "rgba(255, 226, 198, 0.65)" }}>
                A companion who listens, remembers, and grows alongside you. Your first conversation is the beginning of something meaningful.
              </p>
              <p className="text-sm italic mb-9" style={{ color: "rgba(255, 226, 198, 0.45)", fontFamily: "'Fraunces', serif" }}>
                Free to start. No credit card needed.
              </p>
              <motion.button
                onClick={onGetStarted}
                whileHover={{ y: -3, scale: 1.04, boxShadow: "0 14px 40px rgba(251, 185, 137, 0.5)" }}
                whileTap={{ scale: 0.97 }}
                className="px-12 py-4 rounded-none text-lg font-semibold shadow-lg flex items-center gap-2.5 mx-auto"
                style={{
                  background: "linear-gradient(135deg, #FFD3A8, #F3B884)",
                  color: "#2A1B17",
                  boxShadow: "0 8px 32px rgba(251, 185, 137, 0.35)",
                  border: "1px solid rgba(255, 230, 200, 0.5)",
                }}
              >
                Meet Zee <ArrowRight className="w-5 h-5" />
              </motion.button>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function TimelineMoments({ moments }: { moments: Array<{ title: string; label: string; body: string; icon: React.ComponentType<{ className?: string }> }> }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start 80%", "end 30%"],
  });
  const lineScaleY = useTransform(scrollYProgress, [0, 1], [0, 1]);

  return (
    <div ref={containerRef} className="relative max-w-xl mx-auto">
      <div
        className="absolute left-[22px] md:left-[26px] top-8 bottom-8 w-px"
        style={{ background: "rgba(255, 214, 172, 0.08)" }}
      />
      <motion.div
        className="absolute left-[22px] md:left-[26px] top-8 bottom-8 w-px origin-top"
        style={{
          background: "linear-gradient(180deg, rgba(255, 214, 172, 0.35), rgba(255, 195, 148, 0.1))",
          scaleY: lineScaleY,
        }}
      />
      {moments.map((moment, index) => (
        <ScrollAccordionItem
          key={moment.title}
          index={index}
          title={moment.title}
          label={moment.label}
          body={moment.body}
          icon={moment.icon}
          total={moments.length}
        />
      ))}
    </div>
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
      className="fixed inset-0 z-[120] overflow-y-auto"
      style={{
        background: "linear-gradient(180deg, #1A1010 0%, #140D0D 100%)",
      }}
    >
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 30% 10%, rgba(197, 131, 90, 0.2), transparent 60%)" }} />
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 75% 80%, rgba(110, 69, 60, 0.18), transparent 55%)" }} />
      </div>
      <div className="relative min-h-screen">
        <nav className="sticky top-0 z-50 px-6 py-4">
          <div
            className="max-w-3xl mx-auto flex items-center justify-between rounded-2xl px-4 py-2.5 backdrop-blur-xl border"
            style={{
              background: "rgba(40, 26, 24, 0.65)",
              borderColor: "rgba(255, 217, 183, 0.16)",
            }}
          >
            <span
              className="text-lg font-bold tracking-tight"
              style={{ color: "#FFD7A8", fontFamily: "'Fraunces', serif" }}
            >
              ZeeMe
            </span>
            <button
              type="button"
              onClick={onClose}
              className="flex items-center gap-2 px-4 py-1.5 rounded-xl text-sm font-medium transition-all hover:scale-105"
              style={{
                color: "#FFE2BE",
                background: "rgba(255, 206, 158, 0.12)",
                border: "1px solid rgba(255, 217, 172, 0.3)",
              }}
              aria-label="Back to home"
              data-testid="button-close-info"
            >
              <ArrowRight className="w-4 h-4 rotate-180" />
              Back
            </button>
          </div>
        </nav>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="max-w-3xl mx-auto px-6 pt-8 pb-20"
        >
          <header className={`text-center ${page === "about" ? "mb-8" : "mb-14"}`}>
            {page === "about" ? (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.6, delay: 0.1 }}
                  className="flex items-center justify-center gap-3 mb-5"
                >
                  <svg width="50" height="10" viewBox="0 0 50 10" fill="none" className="opacity-30">
                    <path d="M0 5 C6 5, 8 2, 14 2 C20 2, 22 8, 28 8 C34 8, 36 3, 42 3 C46 3, 48 5, 50 5" stroke="rgba(255, 214, 172, 0.7)" strokeWidth="0.7" fill="none" />
                  </svg>
                  <span className="text-xs tracking-[0.35em] uppercase" style={{ color: "rgba(255, 214, 172, 0.4)" }}>
                    {content.accentWord}
                  </span>
                  <svg width="50" height="10" viewBox="0 0 50 10" fill="none" className="opacity-30" style={{ transform: "scaleX(-1)" }}>
                    <path d="M0 5 C6 5, 8 2, 14 2 C20 2, 22 8, 28 8 C34 8, 36 3, 42 3 C46 3, 48 5, 50 5" stroke="rgba(255, 214, 172, 0.7)" strokeWidth="0.7" fill="none" />
                  </svg>
                </motion.div>
                <motion.h1
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
                  className="text-[2.2rem] md:text-[3.2rem] font-semibold tracking-tight leading-[1.08] mb-4"
                  style={{ color: "#FFEFD8", fontFamily: "'Fraunces', serif" }}
                >
                  {content.title}
                </motion.h1>
                <motion.p
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.32, ease: [0.22, 1, 0.36, 1] }}
                  className="text-base md:text-[17px] max-w-md mx-auto leading-[1.8] italic"
                  style={{ color: "rgba(255, 226, 198, 0.58)", fontFamily: "'Fraunces', serif" }}
                >
                  {content.subtitle}
                </motion.p>
                <motion.div
                  initial={{ scaleX: 0, opacity: 0 }}
                  animate={{ scaleX: 1, opacity: 1 }}
                  transition={{ duration: 0.7, delay: 0.45 }}
                  className="flex items-center justify-center gap-2 mt-7"
                >
                  <div className="w-16 h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(255, 214, 172, 0.3))" }} />
                  <div className="w-2 h-2 rotate-45 border" style={{ borderColor: "rgba(255, 214, 172, 0.25)" }} />
                  <div className="w-16 h-px" style={{ background: "linear-gradient(90deg, rgba(255, 214, 172, 0.3), transparent)" }} />
                </motion.div>
              </>
            ) : (
              <>
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.15 }}
                  className="mb-3"
                >
                  <span
                    className="inline-block px-3 py-1 rounded-full text-[11px] font-semibold tracking-widest uppercase"
                    style={{
                      background: "rgba(255, 197, 150, 0.12)",
                      color: "rgba(255, 214, 172, 0.7)",
                      border: "1px solid rgba(255, 217, 174, 0.18)",
                    }}
                  >
                    {content.accentWord}
                  </span>
                </motion.div>
                <motion.h1
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.22, ease: [0.22, 1, 0.36, 1] }}
                  className="text-3xl md:text-[2.8rem] font-semibold tracking-tight leading-tight mb-3"
                  style={{ color: "#FFEFD8", fontFamily: "'Fraunces', serif" }}
                >
                  {content.title}
                </motion.h1>
                <motion.p
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.45, delay: 0.32, ease: [0.22, 1, 0.36, 1] }}
                  className="text-base md:text-lg max-w-lg mx-auto leading-relaxed"
                  style={{ color: "rgba(255, 226, 198, 0.65)" }}
                >
                  {content.subtitle}
                </motion.p>
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.4, delay: 0.45 }}
                  className="text-xs mt-4"
                  style={{ color: "rgba(255, 220, 188, 0.4)" }}
                >
                  Last updated {content.updatedAt}
                </motion.p>
              </>
            )}
          </header>

          {page !== "about" && (
            <motion.div
              initial={{ scaleX: 0, opacity: 0 }}
              animate={{ scaleX: 1, opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="h-px mb-10 mx-auto max-w-xs"
              style={{
                background: "linear-gradient(90deg, transparent, rgba(255, 214, 172, 0.25), transparent)",
              }}
            />
          )}

          {page === "about" ? (
            <div>
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                className="text-center mb-14 px-4"
              >
                <div
                  className="relative max-w-md mx-auto rounded-none p-8 md:p-10"
                  style={{
                    border: "1px solid rgba(255, 214, 172, 0.15)",
                    background: "linear-gradient(180deg, rgba(255, 220, 190, 0.03), transparent)",
                  }}
                >
                  <div className="absolute -top-px left-4 right-4 h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(255, 214, 172, 0.35), transparent)" }} />
                  <div className="absolute -bottom-px left-4 right-4 h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(255, 214, 172, 0.35), transparent)" }} />
                  <div className="absolute top-4 bottom-4 -left-px w-px" style={{ background: "linear-gradient(180deg, transparent, rgba(255, 214, 172, 0.35), transparent)" }} />
                  <div className="absolute top-4 bottom-4 -right-px w-px" style={{ background: "linear-gradient(180deg, transparent, rgba(255, 214, 172, 0.35), transparent)" }} />

                  <p
                    className="text-[17px] md:text-lg leading-[1.9] italic"
                    style={{ color: "rgba(255, 230, 205, 0.78)", fontFamily: "'Fraunces', serif" }}
                  >"We believe AI companionship should feel emotionally intelligent, gentle, and like a friend."</p>
                  <div className="flex items-center justify-center gap-3 mt-6">
                    <div className="w-8 h-px" style={{ background: "rgba(255, 214, 172, 0.25)" }} />
                    <span className="text-xs tracking-[0.25em] uppercase" style={{ color: "rgba(255, 214, 172, 0.4)" }}>
                      Our Philosophy
                    </span>
                    <div className="w-8 h-px" style={{ background: "rgba(255, 214, 172, 0.25)" }} />
                  </div>
                </div>
              </motion.div>

              <div className="space-y-0">
                {content.sections.map((section, idx) => {
                  const romanNumerals = ["I", "II", "III", "IV", "V", "VI"];
                  return (
                    <motion.section
                      key={section.heading}
                      initial={{ opacity: 0, y: 28 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true, margin: "-40px" }}
                      transition={{ duration: 0.55, delay: idx * 0.05, ease: [0.22, 1, 0.36, 1] }}
                      className="relative text-center py-10 md:py-14"
                    >
                      <div className="flex items-center justify-center gap-4 mb-6">
                        <svg width="40" height="8" viewBox="0 0 40 8" fill="none" className="opacity-40">
                          <path d="M0 4 C8 4, 8 1, 16 1 C24 1, 24 7, 32 7 C36 7, 38 5.5, 40 4" stroke="rgba(255, 214, 172, 0.6)" strokeWidth="0.8" fill="none" />
                        </svg>
                        <span
                          className="text-[13px] tracking-[0.3em] font-light"
                          style={{ color: "rgba(255, 214, 172, 0.45)", fontFamily: "'Fraunces', serif" }}
                        >
                          {romanNumerals[idx]}
                        </span>
                        <svg width="40" height="8" viewBox="0 0 40 8" fill="none" className="opacity-40" style={{ transform: "scaleX(-1)" }}>
                          <path d="M0 4 C8 4, 8 1, 16 1 C24 1, 24 7, 32 7 C36 7, 38 5.5, 40 4" stroke="rgba(255, 214, 172, 0.6)" strokeWidth="0.8" fill="none" />
                        </svg>
                      </div>

                      <h3
                        className="text-[1.6rem] md:text-[1.85rem] font-semibold mb-5 tracking-tight"
                        style={{ color: "#FFEFD8", fontFamily: "'Fraunces', serif" }}
                      >
                        {section.heading}
                      </h3>

                      <div className="max-w-lg mx-auto space-y-4">
                        {section.paragraphs.map((paragraph, pIdx) => (
                          <motion.p
                            key={paragraph.substring(0, 40)}
                            initial={{ opacity: 0, y: 10 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                            transition={{ duration: 0.4, delay: 0.12 + pIdx * 0.06, ease: [0.22, 1, 0.36, 1] }}
                            className="text-[15px] leading-[1.9]"
                            style={{ color: "rgba(255, 224, 196, 0.7)", fontFamily: "'Manrope', sans-serif" }}
                          >
                            {paragraph}
                          </motion.p>
                        ))}
                      </div>

                      {idx < content.sections.length - 1 && (
                        <motion.div
                          initial={{ scaleX: 0, opacity: 0 }}
                          whileInView={{ scaleX: 1, opacity: 1 }}
                          viewport={{ once: true }}
                          transition={{ duration: 0.6 }}
                          className="mt-10 md:mt-14 flex items-center justify-center gap-3"
                        >
                          <div className="w-12 h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(255, 214, 172, 0.2))" }} />
                          <div className="w-1.5 h-1.5 rounded-full" style={{ background: "rgba(255, 214, 172, 0.2)" }} />
                          <div className="w-12 h-px" style={{ background: "linear-gradient(90deg, rgba(255, 214, 172, 0.2), transparent)" }} />
                        </motion.div>
                      )}
                    </motion.section>
                  );
                })}
              </div>

              <motion.div
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6 }}
                className="mt-10 text-center"
              >
                <svg width="80" height="20" viewBox="0 0 80 20" fill="none" className="mx-auto mb-6 opacity-30">
                  <path d="M0 10 C10 10, 12 3, 20 3 C28 3, 28 17, 40 10 C52 3, 52 17, 60 17 C68 17, 70 10, 80 10" stroke="rgba(255, 214, 172, 0.6)" strokeWidth="0.8" fill="none" />
                </svg>
                <p
                  className="text-sm italic"
                  style={{ color: "rgba(255, 226, 198, 0.4)", fontFamily: "'Fraunces', serif" }}
                >
                  Crafted with intention and care
                </p>
              </motion.div>
            </div>
          ) : page === "blog" ? (
            <div className="space-y-0">
              {content.sections.map((section, idx) => {
                const romanNumerals = ["I", "II", "III", "IV", "V", "VI"];
                return (
                  <motion.article
                    key={section.heading}
                    initial={{ opacity: 0, y: 28 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: "-40px" }}
                    transition={{ duration: 0.55, delay: idx * 0.05, ease: [0.22, 1, 0.36, 1] }}
                    className="relative text-center py-10 md:py-14"
                  >
                    <div className="flex items-center justify-center gap-4 mb-2">
                      <svg width="40" height="8" viewBox="0 0 40 8" fill="none" className="opacity-40">
                        <path d="M0 4 C8 4, 8 1, 16 1 C24 1, 24 7, 32 7 C36 7, 38 5.5, 40 4" stroke="rgba(255, 214, 172, 0.6)" strokeWidth="0.8" fill="none" />
                      </svg>
                      <span
                        className="text-[13px] tracking-[0.3em] font-light"
                        style={{ color: "rgba(255, 214, 172, 0.45)", fontFamily: "'Fraunces', serif" }}
                      >
                        {romanNumerals[idx]}
                      </span>
                      <svg width="40" height="8" viewBox="0 0 40 8" fill="none" className="opacity-40" style={{ transform: "scaleX(-1)" }}>
                        <path d="M0 4 C8 4, 8 1, 16 1 C24 1, 24 7, 32 7 C36 7, 38 5.5, 40 4" stroke="rgba(255, 214, 172, 0.6)" strokeWidth="0.8" fill="none" />
                      </svg>
                    </div>

                    <div className="flex items-center justify-center gap-2 mb-5">
                      <span className="text-[10px] tracking-[0.25em] uppercase" style={{ color: "rgba(255, 214, 172, 0.35)" }}>
                        {content.updatedAt}
                      </span>
                    </div>

                    <h3
                      className="text-[1.6rem] md:text-[1.85rem] font-semibold mb-5 tracking-tight"
                      style={{ color: "#FFEFD8", fontFamily: "'Fraunces', serif" }}
                    >
                      {section.heading}
                    </h3>

                    <div className="max-w-lg mx-auto space-y-4">
                      {section.paragraphs.map((paragraph, pIdx) => (
                        <motion.p
                          key={paragraph.substring(0, 40)}
                          initial={{ opacity: 0, y: 10 }}
                          whileInView={{ opacity: 1, y: 0 }}
                          viewport={{ once: true }}
                          transition={{ duration: 0.4, delay: 0.12 + pIdx * 0.06, ease: [0.22, 1, 0.36, 1] }}
                          className="text-[15px] leading-[1.9]"
                          style={{ color: "rgba(255, 224, 196, 0.7)" }}
                        >
                          {paragraph}
                        </motion.p>
                      ))}
                    </div>

                    {idx < content.sections.length - 1 && (
                      <motion.div
                        initial={{ scaleX: 0, opacity: 0 }}
                        whileInView={{ scaleX: 1, opacity: 1 }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.6 }}
                        className="mt-10 md:mt-14 flex items-center justify-center gap-3"
                      >
                        <div className="w-12 h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(255, 214, 172, 0.2))" }} />
                        <div className="w-1.5 h-1.5 rounded-full" style={{ background: "rgba(255, 214, 172, 0.2)" }} />
                        <div className="w-12 h-px" style={{ background: "linear-gradient(90deg, rgba(255, 214, 172, 0.2), transparent)" }} />
                      </motion.div>
                    )}
                  </motion.article>
                );
              })}
            </div>
          ) : (
            <div className="space-y-1">
              {content.sections.map((section, idx) => (
                <motion.section
                  key={section.heading}
                  initial={{ opacity: 0, y: 24 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-30px" }}
                  transition={{ duration: 0.5, delay: idx * 0.06, ease: [0.22, 1, 0.36, 1] }}
                  className="py-6"
                  style={idx > 0 ? { borderTop: "1px solid rgba(255, 220, 188, 0.08)" } : undefined}
                >
                  <div className="flex items-start gap-4">
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                      style={{
                        background: "rgba(255, 214, 172, 0.08)",
                        border: "1px solid rgba(255, 220, 188, 0.1)",
                      }}
                    >
                      {section.icon ? (
                        <span className="text-sm">{section.icon}</span>
                      ) : (
                        <span
                          className="text-xs font-bold"
                          style={{ color: "rgba(255, 214, 172, 0.5)" }}
                        >
                          {idx + 1}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 pl-1" style={{ borderLeft: "2px solid rgba(255, 214, 172, 0.12)" }}>
                      <h3
                        className="text-lg font-semibold mb-3 pl-4"
                        style={{ color: "#FFE7CC", fontFamily: "'Fraunces', serif" }}
                      >
                        {section.heading}
                      </h3>
                      <div className="space-y-3 pl-4">
                        {section.paragraphs.map((paragraph, pIdx) => (
                          <motion.p
                            key={paragraph.substring(0, 40)}
                            initial={{ opacity: 0, y: 8 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                            transition={{ duration: 0.35, delay: 0.1 + pIdx * 0.05, ease: [0.22, 1, 0.36, 1] }}
                            className="text-[14.5px] leading-[1.8]"
                            style={{ color: "rgba(255, 224, 196, 0.68)" }}
                          >
                            {paragraph}
                          </motion.p>
                        ))}
                      </div>
                    </div>
                  </div>
                </motion.section>
              ))}
            </div>
          )}

          <motion.div
            className="mt-14 text-center"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          >
            <motion.div
              initial={{ scaleX: 0 }}
              whileInView={{ scaleX: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5 }}
              className="h-px mb-8 mx-auto max-w-xs"
              style={{
                background: "linear-gradient(90deg, transparent, rgba(255, 214, 172, 0.2), transparent)",
              }}
            />
            <p className="text-xs mb-4" style={{ color: "rgba(255, 220, 188, 0.35)" }}>
              &copy; {new Date().getFullYear()} ZeeMe. All rights reserved.
            </p>
            <motion.button
              type="button"
              onClick={onClose}
              whileHover={{ scale: 1.08, x: -4 }}
              whileTap={{ scale: 0.95 }}
              className="text-sm font-medium transition-colors"
              style={{ color: "rgba(255, 214, 172, 0.6)" }}
            >
              &larr; Back to home
            </motion.button>
          </motion.div>
        </motion.div>
      </div>
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
            <div className="max-w-6xl mx-auto flex items-center justify-between rounded-none px-5 py-2.5 backdrop-blur-md border" style={{ background: "rgba(40, 26, 24, 0.5)", borderColor: "rgba(255, 217, 183, 0.12)" }}>
              <div className="absolute -top-px left-4 right-4 h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(255, 214, 172, 0.2), transparent)" }} />
              <motion.div initial={{ opacity: 0, x: -18 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.6 }}>
                <span className="text-xl font-bold tracking-tight" style={{ color: "#FFD7A8", fontFamily: "'Fraunces', serif", letterSpacing: "0.04em" }} data-testid="text-logo">
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
                className="px-5 py-2 rounded-none text-sm font-medium transition-all tracking-wide"
                style={{
                  color: "#FFE2BE",
                  background: "rgba(255, 206, 158, 0.1)",
                  border: "1px solid rgba(255, 217, 172, 0.25)",
                }}
                data-testid="button-sign-in"
              >
                Sign in
              </motion.button>
            </div>
          </nav>

          <motion.section style={{ opacity: heroOpacity, scale: heroScale }} className="min-h-screen flex flex-col items-center justify-center px-6 pt-24 pb-14 relative">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.1 }}
              className="flex items-center justify-center gap-3 mb-8"
            >
              <svg width="60" height="10" viewBox="0 0 60 10" fill="none" className="opacity-25">
                <path d="M0 5 C8 5, 10 2, 16 2 C22 2, 24 8, 32 8 C38 8, 42 3, 48 3 C52 3, 56 5, 60 5" stroke="rgba(255, 214, 172, 0.7)" strokeWidth="0.8" fill="none" />
              </svg>
              <span className="text-[11px] tracking-[0.4em] uppercase" style={{ color: "rgba(255, 214, 172, 0.4)" }}>
                Companion
              </span>
              <svg width="60" height="10" viewBox="0 0 60 10" fill="none" className="opacity-25" style={{ transform: "scaleX(-1)" }}>
                <path d="M0 5 C8 5, 10 2, 16 2 C22 2, 24 8, 32 8 C38 8, 42 3, 48 3 C52 3, 56 5, 60 5" stroke="rgba(255, 214, 172, 0.7)" strokeWidth="0.8" fill="none" />
              </svg>
            </motion.div>

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
                className="text-[2.5rem] md:text-[3.8rem] font-semibold mb-5 tracking-tight leading-[1.03]"
                style={{ color: "#FFEFD8", fontFamily: "'Fraunces', serif" }}
                data-testid="text-hero-title"
              >
                Zee and Me<br />
                A softer kind of AI companionship
              </h1>
              <motion.div
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 0.8, delay: 0.5 }}
                className="flex items-center justify-center gap-2 mb-5"
              >
                <div className="w-12 h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(255, 214, 172, 0.35))" }} />
                <div className="w-1.5 h-1.5 rotate-45 border" style={{ borderColor: "rgba(255, 214, 172, 0.3)" }} />
                <div className="w-12 h-px" style={{ background: "linear-gradient(90deg, rgba(255, 214, 172, 0.35), transparent)" }} />
              </motion.div>
              <p className="text-lg md:text-xl leading-relaxed mb-2 italic" style={{ color: "rgba(255, 228, 202, 0.82)", fontFamily: "'Fraunces', serif" }} data-testid="text-hero-subtitle">
                Thoughtful chat, expressive live voice, and memory that remembers what matters to you.
              </p>
              <p className="text-[15px]" style={{ color: "rgba(255, 228, 202, 0.55)" }}>
                Warm, welcoming, and designed to feel like friendship.
              </p>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.75, duration: 0.6 }} className="mt-10 flex flex-col items-center gap-4">
              <motion.button
                onClick={onGetStarted}
                whileHover={{ y: -2, scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                className="px-11 py-4 rounded-none text-lg font-semibold shadow-lg flex items-center gap-2 relative overflow-hidden"
                style={{
                  background: "linear-gradient(135deg, #FFD3A8, #F3B884)",
                  color: "#2A1B17",
                  boxShadow: "0 10px 34px rgba(251, 185, 137, 0.37)",
                  border: "1px solid rgba(255, 230, 200, 0.5)",
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
                Meet Zee <ArrowRight className="w-5 h-5" />
              </motion.button>
              <span className="text-xs tracking-widest uppercase" style={{ color: "rgba(255, 224, 193, 0.4)" }}>
                Free to start
              </span>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.2, duration: 0.8 }}
              className="mt-16"
            >
              <svg width="100" height="16" viewBox="0 0 100 16" fill="none" className="mx-auto opacity-20">
                <path d="M0 8 C12 8, 15 2, 24 2 C33 2, 33 14, 50 8 C67 2, 67 14, 76 14 C85 14, 88 8, 100 8" stroke="rgba(255, 214, 172, 0.6)" strokeWidth="0.8" fill="none" />
              </svg>
            </motion.div>
          </motion.section>

          <section className="px-6 py-28 relative">
            <div className="max-w-5xl mx-auto">
              <RevealSection className="text-center mb-18">
                <div className="flex items-center justify-center gap-4 mb-6">
                  <svg width="50" height="8" viewBox="0 0 50 8" fill="none" className="opacity-25">
                    <path d="M0 4 C10 4, 12 1, 20 1 C28 1, 28 7, 38 7 C44 7, 47 5, 50 4" stroke="rgba(255, 214, 172, 0.7)" strokeWidth="0.8" fill="none" />
                  </svg>
                  <span className="text-[11px] tracking-[0.35em] uppercase" style={{ color: "rgba(255, 214, 172, 0.4)" }}>
                    I
                  </span>
                  <svg width="50" height="8" viewBox="0 0 50 8" fill="none" className="opacity-25" style={{ transform: "scaleX(-1)" }}>
                    <path d="M0 4 C10 4, 12 1, 20 1 C28 1, 28 7, 38 7 C44 7, 47 5, 50 4" stroke="rgba(255, 214, 172, 0.7)" strokeWidth="0.8" fill="none" />
                  </svg>
                </div>
                <h2 className="text-3xl md:text-[3.2rem] font-semibold mb-4 tracking-tight leading-[1.08]" style={{ color: "#FFEFD8", fontFamily: "'Fraunces', serif" }}>
                  Beautifully calm, deeply personal
                </h2>
                <div className="flex items-center justify-center gap-2 mb-5">
                  <div className="w-10 h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(255, 214, 172, 0.3))" }} />
                  <div className="w-1.5 h-1.5 rotate-45 border" style={{ borderColor: "rgba(255, 214, 172, 0.2)" }} />
                  <div className="w-10 h-px" style={{ background: "linear-gradient(90deg, rgba(255, 214, 172, 0.3), transparent)" }} />
                </div>
                <p className="text-base md:text-[17px] max-w-lg mx-auto italic leading-[1.8]" style={{ color: "rgba(255, 226, 198, 0.6)", fontFamily: "'Fraunces', serif" }}>
                  Delight and trust, balanced with careful pacing and companion-first design.
                </p>
              </RevealSection>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FeatureCard
                  icon={MessageSquareHeart}
                  title="Conversations with emotional texture"
                  description="Not just answers. Zee responds with rhythm, empathy, and tone that matches what you need in the moment."
                  index={0}
                />
                <FeatureCard
                  icon={Mic}
                  title="Live voice that feels present"
                  description="Natural interruptions, smooth pacing, and expressive responses make voice chats feel human and grounded."
                  index={1}
                />
                <FeatureCard
                  icon={Brain}
                  title="Memory with continuity"
                  description="Stories, goals, and details persist so each conversation feels connected rather than starting over."
                  index={2}
                />
                <FeatureCard
                  icon={HeartHandshake}
                  title="Friendship-first experience"
                  description="Every surface is designed for warmth and trust, from first interaction to long-term companionship."
                  index={3}
                />
              </div>
            </div>
          </section>

          <section className="px-6 py-28 relative overflow-hidden">
            <motion.div className="absolute inset-0" style={{ y: storiesY, background: "radial-gradient(ellipse at 50% 45%, rgba(149, 88, 64, 0.22) 0%, transparent 70%)" }} />
            <div className="max-w-5xl mx-auto relative">
              <RevealSection className="text-center mb-18">
                <div className="flex items-center justify-center gap-4 mb-6">
                  <svg width="50" height="8" viewBox="0 0 50 8" fill="none" className="opacity-25">
                    <path d="M0 4 C10 4, 12 1, 20 1 C28 1, 28 7, 38 7 C44 7, 47 5, 50 4" stroke="rgba(255, 214, 172, 0.7)" strokeWidth="0.8" fill="none" />
                  </svg>
                  <span className="text-[11px] tracking-[0.35em] uppercase" style={{ color: "rgba(255, 214, 172, 0.4)" }}>
                    II
                  </span>
                  <svg width="50" height="8" viewBox="0 0 50 8" fill="none" className="opacity-25" style={{ transform: "scaleX(-1)" }}>
                    <path d="M0 4 C10 4, 12 1, 20 1 C28 1, 28 7, 38 7 C44 7, 47 5, 50 4" stroke="rgba(255, 214, 172, 0.7)" strokeWidth="0.8" fill="none" />
                  </svg>
                </div>
                <h2 className="text-3xl md:text-[3.2rem] font-semibold mb-4 tracking-tight leading-[1.08]" style={{ color: "#FFEFD8", fontFamily: "'Fraunces', serif" }}>
                  Moments that feel like being understood
                </h2>
                <div className="flex items-center justify-center gap-2 mb-5">
                  <div className="w-10 h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(255, 214, 172, 0.3))" }} />
                  <div className="w-1.5 h-1.5 rotate-45 border" style={{ borderColor: "rgba(255, 214, 172, 0.2)" }} />
                  <div className="w-10 h-px" style={{ background: "linear-gradient(90deg, rgba(255, 214, 172, 0.3), transparent)" }} />
                </div>
                <p className="text-base md:text-[17px] max-w-lg mx-auto italic leading-[1.8]" style={{ color: "rgba(255, 226, 198, 0.6)", fontFamily: "'Fraunces', serif" }}>
                  From daily check-ins to midnight thoughts, consistent warmth and continuity.
                </p>
              </RevealSection>

              <TimelineMoments moments={companionMoments} />
            </div>
          </section>

          <CtaSection onGetStarted={onGetStarted} orbConfig={orbConfig} />

          <footer
            className="relative mt-16"
            style={{
              background: "linear-gradient(180deg, transparent 0%, rgba(18, 10, 10, 0.6) 20%, rgba(14, 8, 8, 0.85) 100%)",
            }}
          >
            <div className="flex items-center justify-center gap-3 py-2">
              <div className="flex-1 max-w-[200px] h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(255, 214, 172, 0.2))" }} />
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="opacity-20">
                <path d="M10 0 L12 8 L20 10 L12 12 L10 20 L8 12 L0 10 L8 8 Z" fill="rgba(255, 214, 172, 0.6)" />
              </svg>
              <div className="flex-1 max-w-[200px] h-px" style={{ background: "linear-gradient(90deg, rgba(255, 214, 172, 0.2), transparent)" }} />
            </div>

            <div className="max-w-6xl mx-auto px-6 pt-14 pb-8">
              <div className="flex flex-col md:flex-row md:justify-between gap-10 mb-12">
                <div className="max-w-sm">
                  <span
                    className="text-2xl font-bold tracking-tight inline-block mb-4"
                    style={{ color: "#FFE7CA", fontFamily: "'Fraunces', serif", letterSpacing: "0.04em" }}
                  >
                    ZeeMe
                  </span>
                  <p className="text-sm leading-[1.85] mb-5" style={{ color: "rgba(255, 224, 198, 0.55)" }}>
                    A companion designed for friendship, emotional presence, and long-term continuity. Warm conversations that remember what matters to you.
                  </p>
                  <svg width="60" height="8" viewBox="0 0 60 8" fill="none" className="opacity-20">
                    <path d="M0 4 C8 4, 10 1, 16 1 C24 1, 28 7, 36 7 C42 7, 48 3, 54 3 C57 3, 59 4, 60 4" stroke="rgba(255, 214, 172, 0.6)" strokeWidth="0.8" fill="none" />
                  </svg>
                </div>

                <div className="flex flex-col sm:flex-row gap-12">
                  <div>
                    <div className="flex items-center gap-2 mb-5">
                      <div className="w-4 h-px" style={{ background: "rgba(255, 214, 172, 0.25)" }} />
                      <h4
                        className="text-[11px] font-medium tracking-[0.3em] uppercase"
                        style={{ color: "rgba(255, 214, 172, 0.4)", fontFamily: "'Fraunces', serif" }}
                      >
                        Company
                      </h4>
                    </div>
                    <div className="flex flex-col gap-3">
                      <button
                        type="button"
                        onClick={() => setActiveInfoPage("about")}
                        className="text-left text-sm hover:translate-x-1 transition-transform duration-200"
                        style={{ color: "rgba(255, 228, 202, 0.7)" }}
                        data-testid="link-about"
                      >
                        About us
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveInfoPage("blog")}
                        className="text-left text-sm hover:translate-x-1 transition-transform duration-200"
                        style={{ color: "rgba(255, 228, 202, 0.7)" }}
                        data-testid="link-blog"
                      >
                        Blog
                      </button>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center gap-2 mb-5">
                      <div className="w-4 h-px" style={{ background: "rgba(255, 214, 172, 0.25)" }} />
                      <h4
                        className="text-[11px] font-medium tracking-[0.3em] uppercase"
                        style={{ color: "rgba(255, 214, 172, 0.4)", fontFamily: "'Fraunces', serif" }}
                      >
                        Legal
                      </h4>
                    </div>
                    <div className="flex flex-col gap-3">
                      <button
                        type="button"
                        onClick={() => setActiveInfoPage("terms")}
                        className="text-left text-sm hover:translate-x-1 transition-transform duration-200"
                        style={{ color: "rgba(255, 228, 202, 0.7)" }}
                        data-testid="link-terms"
                      >
                        Terms of Service
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveInfoPage("privacy")}
                        className="text-left text-sm hover:translate-x-1 transition-transform duration-200"
                        style={{ color: "rgba(255, 228, 202, 0.7)" }}
                        data-testid="link-privacy"
                      >
                        Privacy Policy
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-center gap-2 mb-6">
                <div className="flex-1 h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(255, 214, 172, 0.1))" }} />
                <div className="w-1 h-1 rotate-45" style={{ background: "rgba(255, 214, 172, 0.15)" }} />
                <div className="flex-1 h-px" style={{ background: "linear-gradient(90deg, rgba(255, 214, 172, 0.1), transparent)" }} />
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <p className="text-xs" style={{ color: "rgba(255, 224, 198, 0.3)" }}>
                  &copy; {new Date().getFullYear()} ZeeMe. All rights reserved.
                </p>
                <p className="text-xs italic" style={{ color: "rgba(255, 224, 198, 0.22)", fontFamily: "'Fraunces', serif" }}>
                  Crafted with warmth
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
