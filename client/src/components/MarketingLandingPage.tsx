import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { motion, useInView, useScroll, useTransform } from "framer-motion";
import {
  ArrowRight,
  CalendarDays,
  Camera,
  Mail,
  MessageSquareHeart,
  Search,
  Share2,
  Stars,
  X,
} from "lucide-react";
import CanvasOrb from "./OnboardingOrb";

interface MarketingLandingPageProps {
  onGetStarted: () => void;
  onSignIn: () => void;
}

type InfoPageId = "about" | "terms" | "privacy" | "blog";

const INFO_PAGE_PATH: Record<InfoPageId, string> = {
  about: "/about",
  terms: "/terms",
  privacy: "/privacy",
  blog: "/blog",
};

function normalizePath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed.length > 0 ? trimmed : "/";
}

function infoPageFromPath(pathname: string): InfoPageId | null {
  const normalized = normalizePath(pathname);
  if (normalized === "/blog" || normalized.startsWith("/blog/")) return "blog";
  if (normalized === "/terms") return "terms";
  if (normalized === "/privacy") return "privacy";
  if (normalized === "/about") return "about";
  return null;
}

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

type BlogPostBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "quote"; text: string }
  | { type: "meta"; items: { label: string; value: string }[] }
  | { type: "callout"; title: string; text: string }
  | { type: "code"; code: string; language?: string; caption?: string }
  | { type: "equation"; expression: string; caption?: string; terms?: { symbol: string; meaning: string }[] }
  | { type: "metrics"; items: { label: string; value: string; detail?: string }[] }
  | {
      type: "barChart";
      title: string;
      items: { label: string; value: number; note?: string; color?: string }[];
      max?: number;
      unit?: string;
      footnote?: string;
      caption?: string;
    }
  | {
      type: "columnChart";
      title: string;
      items: { label: string; value: number; note?: string; color?: string }[];
      max?: number;
      unit?: string;
      footnote?: string;
      caption?: string;
    }
  | { type: "list"; items: string[] }
  | { type: "table"; columns: string[]; rows: string[][]; caption?: string }
  | { type: "references"; items: { title: string; href: string; note?: string }[] }
  | { type: "ascii"; text: string }
  | {
      type: "image";
      src: string;
      alt: string;
      caption?: string;
      size?: "full" | "narrow" | "wide";
      fit?: "cover" | "contain";
    };

interface BlogPost {
  id: string;
  title: string;
  subtitle: string;
  excerpt: string;
  publishedAt: string;
  readTime: string;
  tags: string[];
  categories: Exclude<BlogArchiveFilterId, "all">[];
  blocks: BlogPostBlock[];
}

type BlogArchiveFilterId =
  | "all"
  | "marketing"
  | "product"
  | "technical"
  | "research"
  | "trust"
  | "reports"
  | "launches";

type BlogArchiveFilter = {
  id: BlogArchiveFilterId;
  label: string;
  leadLabel: string;
  description: string;
};

interface LandingUseCaseStory {
  id: string;
  label: string;
  title: string;
  description: string;
  bullets: string[];
  imageSrc: string;
  imageAlt: string;
  icon: React.ComponentType<{ className?: string }>;
}

const orbConfig = {
  id: 1,
  orbColor: "#EBBA62",
  orbGlow: "rgba(235, 186, 98, 0.45)",
  accentRing: "rgba(235, 186, 98, 0.25)",
  particleColor: "rgba(235, 186, 98, 0.6)",
};

const MARKETING_SITE_ORIGIN = "https://zeeme.io";
const MARKETING_DEFAULT_IMAGE_URL = `${MARKETING_SITE_ORIGIN}/zeeme-og.jpg?v=20260314a`;
const MARKETING_DEFAULT_KEYWORDS =
  "AI companion, AI companion app, voice AI companion, AI executive assistant, personal AI assistant, live voice chat AI, Gmail and Calendar assistant, camera-aware AI, ZeeMe, Zee";

const LANDING_FAQS = [
  {
    question: "What is ZeeMe?",
    answer:
      "ZeeMe is a multimodal AI companion centered on one continuous relationship with Zee across live voice and text chat.",
  },
  {
    question: "Can ZeeMe work as an AI companion and an executive assistant?",
    answer:
      "Yes. ZeeMe blends warm companionship with practical help like Gmail and Google Calendar context, grounded web answers, and approval-aware task support.",
  },
  {
    question: "How do live voice and text stay connected?",
    answer:
      "Voice transcripts can persist into the same shared conversation history as text, so users can switch modes without restarting context.",
  },
  {
    question: "Can ZeeMe help with Gmail and Google Calendar?",
    answer:
      "Yes. When a user connects Google, ZeeMe can read inbox and calendar context, and it can prepare approval-gated Gmail and Calendar actions in supported flows.",
  },
  {
    question: "Is ZeeMe private by design?",
    answer:
      "ZeeMe keeps authenticated chat and profile areas private, uses scoped integrations for Google features, and only exposes public product information on marketing pages.",
  },
] as const;

type MarketingMetaConfig = {
  title: string;
  description: string;
  path: string;
  keywords?: string;
  ogType?: "website" | "article";
  imageUrl?: string;
  articlePublishedTime?: string | null;
  pageSchema?: Record<string, unknown> | null;
  blogPostingSchema?: Record<string, unknown> | null;
};

function buildMarketingAbsoluteUrl(path: string): string {
  return new URL(path.startsWith("/") ? path : `/${path}`, MARKETING_SITE_ORIGIN).toString();
}

function upsertHeadMeta(
  attribute: "name" | "property",
  key: string,
  content: string | null | undefined,
): void {
  const selector = `meta[${attribute}="${key}"]`;
  const existing = document.head.querySelector<HTMLMetaElement>(selector);
  if (!content) {
    existing?.remove();
    return;
  }
  const element = existing ?? document.createElement("meta");
  element.setAttribute(attribute, key);
  element.setAttribute("content", content);
  if (!existing) {
    document.head.appendChild(element);
  }
}

function upsertCanonicalLink(href: string): void {
  const existing = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  const element = existing ?? document.createElement("link");
  element.setAttribute("rel", "canonical");
  element.setAttribute("href", href);
  if (!existing) {
    document.head.appendChild(element);
  }
}

function upsertJsonLdScript(id: string, payload: Record<string, unknown> | null): void {
  const existing = document.head.querySelector<HTMLScriptElement>(`script[data-zeeme-jsonld="${id}"]`);
  if (!payload) {
    existing?.remove();
    return;
  }
  const script = existing ?? document.createElement("script");
  script.type = "application/ld+json";
  script.dataset.zeemeJsonld = id;
  script.text = JSON.stringify(payload);
  if (!existing) {
    document.head.appendChild(script);
  }
}

function applyMarketingMeta(config: MarketingMetaConfig): void {
  const canonicalUrl = buildMarketingAbsoluteUrl(config.path);
  const imageUrl = config.imageUrl ?? MARKETING_DEFAULT_IMAGE_URL;
  document.title = config.title;
  upsertHeadMeta("name", "description", config.description);
  upsertHeadMeta("name", "keywords", config.keywords ?? MARKETING_DEFAULT_KEYWORDS);
  upsertHeadMeta("property", "og:type", config.ogType ?? "website");
  upsertHeadMeta("property", "og:title", config.title);
  upsertHeadMeta("property", "og:description", config.description);
  upsertHeadMeta("property", "og:url", canonicalUrl);
  upsertHeadMeta("property", "og:image", imageUrl);
  upsertHeadMeta("property", "og:image:secure_url", imageUrl);
  upsertHeadMeta("name", "twitter:title", config.title);
  upsertHeadMeta("name", "twitter:description", config.description);
  upsertHeadMeta("name", "twitter:image", imageUrl);
  upsertHeadMeta("property", "article:published_time", config.articlePublishedTime ?? null);
  upsertCanonicalLink(canonicalUrl);
  upsertJsonLdScript("marketing-page", config.pageSchema ?? null);
  upsertJsonLdScript("marketing-blog-post", config.blogPostingSchema ?? null);
}

function parsePublishedAtToIso(publishedAt: string | null | undefined): string | null {
  if (!publishedAt) return null;
  const parsed = new Date(publishedAt);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

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
    subtitle: "Clear expectations for using ZeeMe, including optional Google account integrations.",
    updatedAt: "March 2026",
    heroIcon: "\uD83D\uDCDC",
    accentWord: "Agreement",
    sections: [
      {
        heading: "Eligibility and acceptable use",
        icon: "\u2705",
        paragraphs: [
          "You may use ZeeMe only for lawful purposes and in compliance with these terms. You agree not to misuse the service, attempt unauthorized access, reverse engineer protected systems, or interfere with platform integrity.",
          "You agree not to use ZeeMe for abuse, harassment, fraud, malware, or unlawful surveillance. We may limit or suspend access when behavior creates security, legal, or trust risk.",
        ],
      },
      {
        heading: "Accounts, security, and access",
        icon: "\uD83D\uDD11",
        paragraphs: [
          "You are responsible for maintaining your account credentials and keeping profile details reasonably accurate.",
          "You must promptly notify us of suspected unauthorized access. We may require account verification, enforce rate limits, or suspend sessions to protect users and infrastructure.",
        ],
      },
      {
        heading: "Google integrations (Gmail and Calendar)",
        icon: "\uD83D\uDD17",
        paragraphs: [
          "If you choose to connect Google, ZeeMe may request read-only scopes for Gmail and Google Calendar to answer account-specific questions you ask (for example, unread email summaries or upcoming events).",
          "Current scopes used for this feature are `https://www.googleapis.com/auth/gmail.readonly` and `https://www.googleapis.com/auth/calendar.events.readonly`, plus basic identity scopes (`openid`, `email`, `profile`) for account linking.",
          "You can disconnect Google at any time in Profile. Disconnecting revokes ZeeMe access for future requests. Existing records are handled according to our Privacy Policy and applicable law.",
          "ZeeMe uses Google user data only to provide user-requested features and does not sell Gmail or Calendar data.",
        ],
      },
      {
        heading: "User content and platform rights",
        icon: "\uD83D\uDCAC",
        paragraphs: [
          "You retain rights to content you submit. You grant ZeeMe a limited license to process that content solely to operate, secure, and improve the service.",
          "You agree not to submit content that violates law or third-party rights. You remain responsible for content you provide and actions you take based on model outputs.",
        ],
      },
      {
        heading: "Service boundaries and disclaimers",
        icon: "\u26A0\uFE0F",
        paragraphs: [
          "AI responses can be inaccurate, incomplete, or outdated. ZeeMe is provided on an \"as is\" and \"as available\" basis.",
          "ZeeMe is not a substitute for professional legal, medical, financial, mental health, or emergency services. For high-stakes decisions, consult qualified professionals.",
        ],
      },
      {
        heading: "Changes, termination, and contact",
        icon: "\uD83D\uDD04",
        paragraphs: [
          "We may update these terms to reflect product, legal, or security changes. Material updates will include a revised \"Last updated\" date and reasonable notice through product or email.",
          "We may suspend or terminate access for material violations, legal requirements, or persistent abuse. Questions about these terms can be submitted through in-app support channels.",
        ],
      },
    ],
  },
  privacy: {
    title: "Privacy Policy",
    subtitle: "How ZeeMe collects, uses, stores, and protects personal data, including optional Google data.",
    updatedAt: "March 2026",
    heroIcon: "🔒",
    accentWord: "Protected",
    sections: [
      {
        heading: "Data we collect",
        icon: "📋",
        paragraphs: [
          "We collect account data (such as email and display name), conversation content, settings, and technical telemetry required to operate and secure ZeeMe.",
          "If you connect Google, we collect OAuth metadata and tokens needed to access approved scopes. For Gmail and Calendar features, ZeeMe accesses only the data needed to fulfill your request.",
        ],
      },
      {
        heading: "How we use data",
        icon: "🔧",
        paragraphs: [
          "We use data to provide core functionality (authentication, memory continuity, personalization), maintain reliability, detect abuse, and improve product quality.",
          "We do not sell personal data, including Gmail or Calendar data. We do not use Google Workspace API data for advertising.",
        ],
      },
      {
        heading: "Google API Services data usage",
        icon: "📨",
        paragraphs: [
          "ZeeMe's use and transfer of information received from Google APIs complies with the Google API Services User Data Policy, including the Limited Use requirements.",
          "Google data is used only to provide user-facing features you explicitly invoke (for example, email summaries and calendar lookups).",
          "We do not use Google user data to train generalized advertising profiles, sell data, or share it with third parties except as required to operate the service, comply with law, or protect rights and safety.",
        ],
      },
      {
        heading: "Storage, retention, and security",
        icon: "🛡️",
        paragraphs: [
          "Sensitive integration secrets are encrypted at rest with access controls. We apply transport encryption, signed resource access patterns, and audit-oriented operational logging.",
          "We retain data only as long as needed for service delivery, security, legal obligations, and legitimate operational needs. Retention windows may vary by data type and environment.",
          "No internet-connected system is perfectly secure, but we continuously improve safeguards and incident response controls.",
        ],
      },
      {
        heading: "User controls and rights",
        icon: "⚖️",
        paragraphs: [
          "You can disconnect Google integrations from Profile at any time and request access, correction, export, or deletion of personal data, subject to applicable law.",
          "To exercise privacy rights, use in-app support channels. We aim to respond within 30 days unless law requires a different timeline.",
        ],
      },
      {
        heading: "Policy updates and contact",
        icon: "📮",
        paragraphs: [
          "We may update this Privacy Policy as features and legal requirements evolve. Material changes will include an updated effective date and reasonable user notice.",
          "If you have privacy or security questions, contact us through in-app support channels.",
        ],
      },
    ],
  },
  blog: {
    title: "ZeeMe Journal",
    subtitle:
      "Long-form product stories, field reports, research papers, and technical essays on building a companion that actually works in real life.",
    updatedAt: "March 2026",
    heroIcon: "📝",
    accentWord: "Journal",
    sections: [
      {
        heading: "Archive scope",
        icon: "📚",
        paragraphs: [
          "This archive now functions as the ZeeMe journal: high-signal product stories, publication-grade engineering writing, field reports, and selected marketing essays that still respect technical truth.",
          "Some pieces are meant to convert curious readers into Zee users. Others are meant to give senior builders enough detail to reproduce the reliability patterns without needing hidden prompt internals.",
        ],
      },
      {
        heading: "Method and evidence",
        icon: "🔬",
        paragraphs: [
          "Claims are grounded in implementation artifacts: runtime routes, storage behavior, release gates, and forensic traces captured during real incidents.",
          "Every product claim must map to an owning mechanism and a verification path. If we cannot replay it, we do not publish it.",
        ],
      },
      {
        heading: "Review standard",
        icon: "📏",
        paragraphs: [
          "Some articles follow engineering paper structure: abstract, method, findings, limitations, and references. Others are narrative product writing designed to make the stakes and user value legible.",
          "Regardless of format, claims still map to concrete controls, observed failure classes, or shipped product behavior.",
        ],
      },
      {
        heading: "Why this format",
        icon: "🧭",
        paragraphs: [
          "Companion AI quality is usually discussed as tone or persona. In practice, quality emerges from deterministic state handling: continuity, routing integrity, time correctness, and a user interface that tells the truth.",
          "The journal therefore mixes systems behavior with readable storytelling. We want engineers to learn from it and future users to want Zee because of it.",
        ],
      },
      {
        heading: "Reader contract",
        icon: "🛡️",
        paragraphs: [
          "We do not publish private persona prompts or hidden instruction text. The archive explains architecture and reliability controls without exposing secret prompt assets.",
          "Use this archive as a technical blueprint, not as a prompt dump.",
        ],
      },
    ],
  },
};

const BLOG_POSTS: BlogPost[] = [
  {
    id: "a-day-with-zee-2026",
    title: "A Day With Zee: Morning Brief, Commute Voice, Calendar Help, Inbox Drafts, Evening Continuity",
    subtitle:
      "A product story about what it feels like when one companion stays coherent across the full shape of a normal day.",
    excerpt:
      "The best Zee demo is not a party trick. It is the quiet feeling that your day stayed intact while the environment kept changing around you.",
    publishedAt: "March 13, 2026",
    readTime: "14 min read",
    tags: ["Featured Story", "Product", "Voice + Text", "Gmail + Calendar", "Morning Brief"],
    categories: ["marketing", "product"],
    blocks: [
      {
        type: "image",
        src: "/blog/a-day-with-zee-cover.jpg",
        alt: "Editorial lifestyle image for A Day With Zee showing one man moving from morning coffee to commute voice to evening reflection.",
        caption: "One companion, one person, one day that never has to restart.",
      },
      {
        type: "paragraph",
        text: "Most AI demos are built around one clean moment: a perfect prompt, a quiet room, a stable connection, a single task. Real life does not arrive that way. Real life starts before you are fully awake, spills into the commute, gets interrupted by meetings, pulls you into email, shifts from voice to text, then circles back at night when your brain is finally quiet enough to think. The promise of Zee is not that it can impress you once. The promise is that it can stay useful while the shape of the day keeps mutating.",
      },
      {
        type: "quote",
        text: "The best product moment is not wow. It is relief. Relief that you did not have to start over.",
      },
      { type: "heading", text: "6:42 AM: Before the scroll begins" },
      {
        type: "paragraph",
        text: "The day starts before attention is fully online. You are not looking for a dashboard. You are looking for orientation. This is where Morning Brief matters. Zee can surface the shape of the morning in one conversational pass: what is urgent in the inbox, what is on the calendar, what changed overnight, and where the first point of friction is likely to be. The experience works because it feels like one person quietly catching you up, not five disconnected apps demanding that you orient yourself from scratch.",
      },
      {
        type: "image",
        src: "/blog/a-day-with-zee-morning-inline.jpg",
        alt: "Early morning lifestyle scene of a man checking Zee on his phone with coffee at a kitchen table.",
        caption: "Morning Brief works best when it feels like orientation, not homework.",
        size: "narrow",
      },
      {
        type: "image",
        src: "/blog/meet-zee-day-map.jpg",
        alt: "Illustrated journey map showing how Zee supports morning reset, commute, noisy-to-text switch, and evening reflection.",
        caption: "The shape of the product is the shape of a day. Zee has to hold that whole arc together.",
        size: "narrow",
      },
      {
        type: "table",
        caption: "One day, one thread, many surfaces.",
        columns: ["Moment", "What the user needs", "What Zee does", "Why it matters"],
        rows: [
          [
            "Morning reset",
            "Orientation without opening five apps",
            "Summarizes inbox and calendar context in a calm, quick voice pass",
            "The day starts grounded instead of fragmented",
          ],
          [
            "Commute",
            "Hands-free continuity",
            "Keeps the conversation alive in live voice even when the environment is messy",
            "Momentum survives motion",
          ],
          [
            "Pre-meeting shift",
            "Fast schedule clarity",
            "Checks calendar details and upcoming constraints without breaking the thread",
            "Practical help arrives in the same tone as companionship",
          ],
          [
            "Afternoon email task",
            "Drafting without tab chaos",
            "Collects intent, previews the draft, and waits for approval on Zee Stage",
            "Action happens without losing trust",
          ],
          [
            "Evening reflection",
            "The same companion from earlier",
            "Returns to text or voice with continuity from the whole day",
            "The relationship feels real instead of session-bound",
          ],
        ],
      },
      { type: "heading", text: "8:11 AM: The commute test" },
      {
        type: "paragraph",
        text: "The commute is where fake voice products get exposed. The room is louder. The phone is moving. Your attention is split. You interrupt. The assistant interrupts. The network shifts. A product can sound excellent in a quiet office and still fail exactly where users most want to rely on it. Zee's live voice work this week has been about closing that gap: stronger mic handling, cleaner interruption behavior, better tool-response handoff, more truthful approval flows, and less chaos when Gmail, Calendar, and live speech have to cooperate under pressure.",
      },
      {
        type: "list",
        items: [
          "The voice layer has to hear ordinary speech, not just exaggerated speech.",
          "Interruption has to feel respectful, not brittle.",
          "A lookup needs to be visible while it is happening and gone when it is done.",
          "Approvals need to work by voice, not just by tapping the screen later.",
        ],
      },
      {
        type: "callout",
        title: "Hands-free only works if the system tells the truth",
        text: "If Zee says an event is created or an email is sent while the stage still says Needs approval, the spell is broken. Reliability is not separate from personality. It is part of whether the user trusts the companion at all.",
      },
      { type: "heading", text: "12:03 PM: The calendar moment" },
      {
        type: "paragraph",
        text: "In the middle of the day, the value of a companion is not abstract warmth. It is compression. You ask what is on the calendar, what moved, whether there is room for lunch, whether the reminder needs to change. Zee does not need to feel like a productivity suite. It needs to feel like the same bestie who also happens to know the shape of the day. That is why calendar reads, detail lookups, preview cards, and approval-gated creation matter so much. The user should not feel that they left the relationship just because the conversation became operational.",
      },
      { type: "heading", text: "2:47 PM: Inbox drafts without tab sprawl" },
      {
        type: "paragraph",
        text: "Email is where companion products either become useful or become decorative. The user does not just want a summary of the inbox. They want help moving something forward. A draft to send. A reply to refine. A message saved for later. The key is not only writing well. The key is gathering the right missing slot, keeping the right task active, previewing the draft in a way the user can inspect, and only claiming success once the action is real. That is why Zee Stage matters. It gives the task a home without making the interaction feel like enterprise software.",
      },
      {
        type: "image",
        src: "/blog/a-day-with-zee-draft-inline.jpg",
        alt: "Warm lounge scene showing a man reviewing an AI-assisted email draft on his phone.",
        caption: "A draft should feel like momentum, not like opening another app and losing the thread.",
        size: "narrow",
      },
      {
        type: "image",
        src: "/blog/meet-zee-lifestyle.jpg",
        alt: "Diverse evening lifestyle scene showing people shifting naturally between speaking and texting with Zee.",
        caption: "The surface changes. The companion should not.",
        size: "narrow",
      },
      { type: "heading", text: "8:36 PM: Continuity is emotional, not just technical" },
      {
        type: "metrics",
        items: [
          {
            label: "Primary surfaces",
            value: "Voice, text, stage",
            detail: "Three interfaces, one relationship lane",
          },
          {
            label: "Practical power",
            value: "Morning Brief + Google context",
            detail: "Reads, drafts, approvals, and real follow-through",
          },
          {
            label: "Trust boundary",
            value: "Approval + execution truth",
            detail: "Zee should never narrate completion it has not earned",
          },
          {
            label: "User payoff",
            value: "Less restart energy",
            detail: "The day feels held together instead of constantly reset",
          },
        ],
      },
      {
        type: "paragraph",
        text: "By evening, the most important question is not what features Zee has. The question is whether the day still feels connected. If the morning brief, the noisy commute, the calendar adjustment, the email draft, and the quiet end-of-day conversation all live in one continuous thread, the product stops feeling like an app. It starts feeling like presence. That is the standard Zee should keep chasing, and it is why this story deserves to be featured first in the archive.",
      },
    ],
  },
  {
    id: "zee-stage-missing-interface-2026",
    title: "Zee Stage: The Missing Interface Between Conversation and Action",
    subtitle:
      "Why chat alone stops being enough once an AI starts drafting, approving, and executing real-world tasks.",
    excerpt:
      "The moment an assistant moves from talking about work to actually doing work, the user needs a surface that can hold truth, context, and approval. That surface is Zee Stage.",
    publishedAt: "March 13, 2026",
    readTime: "12 min read",
    tags: ["Feature Highlight", "Product Strategy", "Zee Stage", "Gmail + Calendar"],
    categories: ["product", "technical"],
    blocks: [
      {
        type: "image",
        src: "/blog/zee-stage-cover.jpg",
        alt: "Editorial product image of a woman holding a phone with a refined AI task surface open.",
        caption: "Zee Stage is where conversational intent becomes inspectable action.",
      },
      {
        type: "paragraph",
        text: "Pure chat feels elegant right up to the moment something consequential has to happen. An email draft appears. A calendar event needs approval. Two possible drafts match the same request. A lookup finishes, but the user wants to inspect what Zee is about to act on. At that point the chat lane is no longer enough. Messages can narrate the task, but they cannot always hold the task with the stability and clarity users need. Zee Stage exists because action requires a home.",
      },
      {
        type: "quote",
        text: "Conversation can carry intent. It cannot always carry state.",
      },
      { type: "heading", text: "Why chat alone starts to fail" },
      {
        type: "table",
        caption: "Where a message-only interface becomes fragile.",
        columns: ["Scenario", "Chat-only behavior", "Stage-backed behavior"],
        rows: [
          [
            "Draft preview",
            "Buried in the message stream and easy to lose",
            "Pinned as an inspectable object with actions attached",
          ],
          [
            "Approval",
            "Confirmation language can drift away from real status",
            "Pending, running, and complete states stay visible",
          ],
          [
            "Ambiguity",
            "Choices are easy to misread or skip",
            "Candidates can be seen and selected intentionally",
          ],
          [
            "Task switching",
            "Old work can steal new follow-ups",
            "The active surface becomes explicit and recoverable",
          ],
        ],
      },
      { type: "heading", text: "What belongs on Zee Stage" },
      {
        type: "list",
        items: [
          "Gmail draft previews and reply previews",
          "Calendar event previews before creation or update",
          "Ambiguity pickers when multiple drafts or events match",
          "Approval cards that separate ready-to-act from actually-done",
          "Recent surfaces the user may want to reopen while idle",
        ],
      },
      { type: "heading", text: "The design rule: proactive, not pushy" },
      {
        type: "paragraph",
        text: "One of the easiest mistakes in stage design is confusing visibility with interruption. The stage should show up when it has something strong to contribute, especially for actionable Gmail and Calendar work, but it should not hijack the entire interaction for every lightweight lookup. That distinction matters. A read-only status like checking your calendar belongs in the lookup lane. A draft preview, approval surface, or ambiguity card belongs on stage. Product calm comes from respecting that boundary consistently.",
      },
      {
        type: "callout",
        title: "The stage is shared working memory",
        text: "Zee Stage is not just a UI detail. It is the visual counterpart to the system's task state. It tells the user what Zee thinks is active, what still needs them, and what can be safely reopened later.",
      },
      { type: "heading", text: "Manual reopen is part of the product contract" },
      {
        type: "paragraph",
        text: "A stage that disappears forever when voice ends is not a stage. It is a transient popup. Users need to be able to reopen the current task, inspect a pending approval, and recover context even while idle. That is why the top chip matters so much. It keeps the manual entry point stable. The user does not have to remember where the task went. They only need to know that Zee kept it somewhere trustworthy.",
      },
      { type: "heading", text: "Why this matters beyond Zee" },
      {
        type: "paragraph",
        text: "Other AI teams building Gemini products should pay close attention to this boundary. Once the assistant can operate Gmail, Calendar, grounded search, documents, or anything similarly consequential, the interface cannot be just clever messages and a spinner. It needs a place where the action can sit long enough to be inspected, approved, revised, and trusted. That is the job Zee Stage is beginning to do.",
      },
    ],
  },
  {
    id: "truthful-approval-2026",
    title: "From \"Sounds Good\" to Actually Sent: Designing Hands-Free Approval That Tells the Truth",
    subtitle:
      "The UX and runtime contract behind voice approvals for email and calendar actions.",
    excerpt:
      "Voice confirmation is easy to fake. The hard part is making short phrases like send it, save it, and sounds good map cleanly onto the right task and the real result.",
    publishedAt: "March 13, 2026",
    readTime: "13 min read",
    tags: ["Voice UX", "Approvals", "Gmail + Calendar", "Reliability"],
    categories: ["product", "technical", "trust"],
    blocks: [
      {
        type: "image",
        src: "/blog/truthful-approval-cover.jpg",
        alt: "Editorial image of a man approving an AI-assisted task by voice in a car at dusk.",
        caption: "The moment of confirmation is where trust is either earned or wasted.",
      },
      {
        type: "paragraph",
        text: "A user says sounds good. Or send it. Or save it. In a demo, that looks simple. In production, that moment is loaded. Which task is active? Is the user approving a calendar event or the draft they started two turns ago? Did the write actually execute, or is it still waiting for approval in the UI? Is Zee allowed to say done, or has the system not yet crossed the truth boundary? Approval language feels tiny. It is not tiny. It is one of the most trust-sensitive moments in the entire product.",
      },
      { type: "heading", text: "The easiest lie in AI UX" },
      {
        type: "table",
        caption: "Why approval language gets dangerous so quickly.",
        columns: ["What the user hears", "What might really be happening", "Why that gap is toxic"],
        rows: [
          [
            "\"Sent.\"",
            "The draft still says Needs approval",
            "The product sounds more capable than it is",
          ],
          [
            "\"Done.\"",
            "The wrong task was interpreted as active",
            "The user loses trust in both the assistant and the UI",
          ],
          [
            "\"Saved.\"",
            "Only a preview was produced, not persisted",
            "The user assumes future recovery that does not exist",
          ],
          [
            "\"Created.\"",
            "Execution failed after planning succeeded",
            "The assistant feels dishonest even if the bug was infrastructural",
          ],
        ],
      },
      { type: "heading", text: "Approval needs its own grammar" },
      {
        type: "list",
        items: [
          "I approve should target the current actionable surface, not the oldest pending one.",
          "Sounds good should be interpreted differently when the active task is a preview versus a clarification question.",
          "Send it must only send if the target is an email task already in a sendable state.",
          "Save it must persist the draft or clearly say why it still cannot.",
          "If the target is ambiguous, Zee should ask one clarifying question instead of guessing.",
        ],
      },
      {
        type: "code",
        language: "text",
        caption: "Truthful approval as a runtime sequence.",
        code:
          "user phrase -> resolve active task -> validate approval state -> execute write -> persist result -> update stage -> speak verified outcome",
      },
      { type: "heading", text: "What counts as done" },
      {
        type: "paragraph",
        text: "This is the non-negotiable rule: Zee should not say sent, saved, created, or updated unless the task runtime has actually reached that terminal state. Planning is not completion. Preview is not completion. Approval requested is not completion. Even a successful tool-planning turn is not completion. The assistant only earns completion language after the execution result exists and the UI state agrees.",
      },
      {
        type: "image",
        src: "/blog/truthful-approval-inline.jpg",
        alt: "A woman confirming an AI-assisted task by voice while a pending approval surface is visible on a nearby phone.",
        caption: "The hands-free moment only works if the confirmation language maps to a real state transition.",
        size: "narrow",
      },
      {
        type: "callout",
        title: "Completion language is a product boundary",
        text: "The line between 'ready' and 'done' may feel technical inside the codebase, but users experience it as honesty. If Zee crosses that line too early, the whole product feels slippery.",
      },
      { type: "heading", text: "Why this matters most in the car" },
      {
        type: "paragraph",
        text: "When the user is driving, walking fast, or moving through a crowded station, they may never tap the stage. Voice approval has to stand on its own. That means the approval flow must be tight enough to stay hands-free, but strict enough to remain truthful. This is one of the defining product challenges of companion AI. It is not enough to give the user an AI that can draft. You need an AI that can finish the draft safely, with language the user can believe.",
      },
      {
        type: "paragraph",
        text: "That is why truthful approval is not just a bug-fix topic for us. It is one of the sharpest expressions of what kind of product Zee is trying to become.",
      },
    ],
  },
  {
    id: "voice-real-life-2026",
    title: "How We Are Building a Voice Assistant That Works in Real Life, Not Just Quiet Rooms",
    subtitle:
      "Noise, movement, interruption, mic pickup, and why real-world voice quality is a systems problem.",
    excerpt:
      "People do not live inside benchmark conditions. A voice companion has to survive kitchens, cars, sidewalks, bad rooms, and the messy choreography of actual life.",
    publishedAt: "March 12, 2026",
    readTime: "15 min read",
    tags: ["Voice Reliability", "Product", "Live API", "User Experience"],
    categories: ["marketing", "product", "technical"],
    blocks: [
      {
        type: "image",
        src: "/blog/voice-real-life-cover.jpg",
        alt: "Editorial commuting image of a woman using a voice AI companion on a train platform at dusk.",
        caption: "Voice quality is not just audio quality. It is whether the whole conversation survives reality.",
      },
      {
        type: "paragraph",
        text: "A lot of voice AI writing quietly assumes that the room is calm, the microphone is clean, the speaker is patient, and the network is generous. Those assumptions are precisely why so many products feel impressive for thirty seconds and disappointing by lunch. Real users talk from moving cars, soft couches, messy kitchens, loud sidewalks, open offices, and tired bedrooms. They interrupt. They change their minds. They switch to text. They expect the companion to keep up anyway.",
      },
      { type: "heading", text: "Quiet-room demos hide the real problem" },
      {
        type: "table",
        caption: "A voice product only feels smart if each layer survives reality.",
        columns: ["Layer", "Failure mode", "What the user experiences"],
        rows: [
          [
            "Mic capture",
            "Speech is too quiet or clipped",
            "Zee seems not to hear ordinary speech",
          ],
          [
            "Resampling and chunking",
            "Input arrives late or poorly shaped",
            "Transcripts feel delayed or wrong",
          ],
          [
            "Turn-taking",
            "Interruption is handled too slowly",
            "The assistant talks over the user",
          ],
          [
            "Transcription quality",
            "Low-confidence speech collapses into noise",
            "The user sees garbage, then loses faith",
          ],
          [
            "Tool handoff",
            "Lookup or action results do not return cleanly",
            "The assistant sounds confused after being useful for a moment",
          ],
        ],
      },
      { type: "heading", text: "What we tune and what we refuse to fake" },
      {
        type: "list",
        items: [
          "We tune capture thresholds so Zee can hear normal speech without requiring theatrical volume.",
          "We send small audio chunks fast enough to keep live interaction feeling immediate.",
          "We treat interruption as first-class, including discarding stale playback when the user starts speaking.",
          "We track transcript quality and live tool-response behavior instead of blaming every miss on the model.",
          "We do not call a bad voice experience good just because the demo reply sounded natural once.",
        ],
      },
      { type: "heading", text: "Interruption is a dignity feature" },
      {
        type: "paragraph",
        text: "One of the fastest ways to make an AI feel rude is to let it keep talking after the user has already tried to take the floor back. Barge-in handling is not a minor polish detail. It is part of whether the assistant feels socially aware. In a companion context, that matters even more. People are not just measuring intelligence. They are measuring whether the system feels attentive, patient, and real enough to be around.",
      },
      {
        type: "callout",
        title: "Audio quality and emotional quality are linked",
        text: "When a voice system misses ordinary speech, over-talks the user, or drops the thread after a lookup, users do not experience that as a technical glitch. They experience it as not being heard.",
      },
      { type: "heading", text: "The design standard we are aiming for" },
      {
        type: "metrics",
        items: [
          {
            label: "Voice contract",
            value: "Ordinary speech should work",
            detail: "The user should not need to shout to be understood",
          },
          {
            label: "Interruption contract",
            value: "Yield fast",
            detail: "The assistant should stop talking when the user re-enters",
          },
          {
            label: "Continuity contract",
            value: "Recover cleanly",
            detail: "Switching to text should preserve the same thread",
          },
          {
            label: "Action contract",
            value: "Truth over theater",
            detail: "Lookups and approvals must resolve to real state, not vibes",
          },
        ],
      },
      {
        type: "paragraph",
        text: "This is the standard we want Zee to hold: not just a voice assistant that sounds warm, but one that keeps its shape in the environments where users actually need help. That is the difference between novelty and product.",
      },
    ],
  },
  {
    id: "gmail-calendar-native-2026",
    title: "What It Takes to Make Gmail and Calendar Feel Native Inside a Companion",
    subtitle:
      "Reads are retrieval. Writes are choreography.",
    excerpt:
      "The real challenge is not connecting Google APIs. It is making email and calendar work feel like part of the same relationship lane instead of a series of awkward tool jumps.",
    publishedAt: "March 12, 2026",
    readTime: "14 min read",
    tags: ["Feature Deep Dive", "Gmail + Calendar", "Zee Stage", "Product Architecture"],
    categories: ["product", "technical"],
    blocks: [
      {
        type: "image",
        src: "/blog/google-native-flows-cover.jpg",
        alt: "Editorial image of a woman using a phone that blends inbox and calendar help into one companion experience.",
        caption: "Native-feeling actions require far more than API connectivity.",
      },
      {
        type: "paragraph",
        text: "Reading the inbox is one kind of problem. Drafting an email is another. Updating a calendar event with approval, ambiguity handling, and live voice follow-up is another again. This is why so many assistant products feel thin around productivity work. The API connection is there, but the product language around it is missing. Users can feel the seams immediately. Zee has been evolving toward a higher bar: Gmail and Calendar should feel like extensions of the conversation, not separate products awkwardly stapled onto it.",
      },
      {
        type: "image",
        src: "/blog/assistant-calendar-email.jpg",
        alt: "Professional checking email and schedule context on a phone in a warm cafe setting.",
        caption: "Native-feeling personal context support should feel calm, mobile, and continuous.",
        size: "narrow",
      },
      { type: "heading", text: "Reads are retrieval. Writes are choreography." },
      {
        type: "table",
        caption: "The complexity climbs as soon as the assistant can act.",
        columns: ["Flow type", "What has to happen", "What users will notice if it is wrong"],
        rows: [
          [
            "Summary read",
            "Fetch verified data and answer clearly",
            "The answer feels stale or generic",
          ],
          [
            "Detail read",
            "Resolve the right item before summarizing it",
            "The assistant talks about the wrong thread or event",
          ],
          [
            "Draft create",
            "Collect missing slots and preview the result",
            "The draft feels premature or unclear",
          ],
          [
            "Approval",
            "Keep the right task active across voice, text, and stage",
            "A later yes approves the wrong thing",
          ],
          [
            "Execution",
            "Run the Gmail or Calendar write and surface real completion",
            "The assistant claims success before the action is real",
          ],
        ],
      },
      { type: "heading", text: "What native actually means" },
      {
        type: "list",
        items: [
          "The user can ask naturally, not in tool syntax.",
          "Zee asks only for the missing slot, not for the whole request again.",
          "Previews feel inspectable without dragging the user into enterprise UI.",
          "Voice and text can continue the same task without starting over.",
          "The stage makes the active surface explicit when action gets stateful.",
        ],
      },
      { type: "heading", text: "The missing middle layer is task state" },
      {
        type: "code",
        language: "text",
        caption: "A native-feeling Gmail or Calendar action needs a real task lane.",
        code:
          "user ask -> detect action -> collect missing slot -> resolve ambiguity -> preview -> approval -> execute -> persist result -> keep surface reopenable",
      },
      {
        type: "paragraph",
        text: "That middle layer is where the product gets made. Without it, you get one-shot tool calls that can summarize something but cannot safely carry a user through a real workflow. With it, you get drafts that can be revised, events that can be approved by voice, and a surface that can survive a mode switch. This is the difference between an API demo and a useful companion.",
      },
      {
        type: "image",
        src: "/blog/google-native-flows-inline.jpg",
        alt: "Close product-lifestyle image of a phone showing one companion surface that blends calendar and inbox context.",
        caption: "Native-feeling Google flows need a single stage that can hold both reads and writes without feeling stitched together.",
        size: "narrow",
      },
      { type: "heading", text: "Why email and calendar are not the same problem" },
      {
        type: "table",
        caption: "The product contract differs by domain.",
        columns: ["Surface", "Primary user concern", "Product implication"],
        rows: [
          [
            "Email",
            "Tone, recipient correctness, and send intent",
            "Draft quality and approval language matter heavily",
          ],
          [
            "Calendar",
            "Time correctness, location, and collision risk",
            "Temporal clarity and update targeting matter more",
          ],
          [
            "Both",
            "Trust",
            "Zee cannot pretend the action completed before it actually did",
          ],
        ],
      },
      {
        type: "paragraph",
        text: "The goal is not to make Zee feel like Gmail or Google Calendar. The goal is to make Gmail and Calendar feel like they belong inside Zee. That sounds subtle. It is not. It changes the entire product architecture.",
      },
    ],
  },
  {
    id: "companion-economics-2026",
    title: "The Cost of a Real-Time AI Companion: Text, Voice, Camera, Search, and Google Actions",
    subtitle:
      "Why voice minutes, camera minutes, grounded search, and Gmail send flows change the economics more than most people expect.",
    excerpt:
      "Text chat is not the main cost center anymore. Live audio, camera, and the operational shape of Google actions are where the real quota model gets decided.",
    publishedAt: "March 13, 2026",
    readTime: "16 min read",
    tags: ["Pricing", "Quota Strategy", "Business", "Gemini", "Google Actions"],
    categories: ["marketing", "product", "technical"],
    blocks: [
      {
        type: "image",
        src: "/blog/companion-economics-cover.jpg",
        alt: "Editorial still life showing a phone, earbuds, camera, notebooks, and graph paper to represent companion cost layers.",
        caption: "The economics of companionship are shaped by live interaction, not just chat tokens.",
      },
      {
        type: "paragraph",
        text: "Every AI founder eventually learns the same uncomfortable lesson: the thing users love most is often the thing that costs the most to deliver. In Zee's case, the more the product starts to feel alive - live voice, camera awareness, grounded lookups, Gmail help, Calendar follow-through - the less helpful a simplistic text-message quota becomes. We needed to rerun the cost model because the product changed. Email and calendar are now part of the core flow. Voice sessions are no longer a novelty. The old math was no longer honest.",
      },
      {
        type: "metrics",
        items: [
          { label: "Estimated text turn", value: "~$0.0023", detail: "Based on 2,500 input tokens and 350 output tokens" },
          { label: "Estimated voice minute", value: "~$0.0288", detail: "Live native audio, input and output combined" },
          { label: "Estimated camera minute", value: "~$0.0761", detail: "Video plus normal live audio in and out" },
          { label: "Operational pressure point", value: "Gmail send", detail: "Often larger in quota impact than in raw dollar cost" },
        ],
      },
      { type: "heading", text: "Where the cost really comes from" },
      {
        type: "barChart",
        title: "Illustrative unit economics by interaction type",
        unit: "cents",
        max: 8,
        footnote: "Planning estimates from ZeeMe's March 13, 2026 quota re-evaluation worksheet.",
        items: [
          { label: "Text turn", value: 0.23, note: "Small enough to feel cheap at product level", color: "#F4C77D" },
          { label: "Voice minute", value: 2.88, note: "Meaningful when users stay live for long stretches", color: "#DDA7FF" },
          { label: "Camera minute", value: 7.61, note: "The steepest routine interaction in the current stack", color: "#9EDBFF" },
        ],
      },
      {
        type: "paragraph",
        text: "This is the core shift: text is still important, but it is no longer the dominant driver of cost risk. Live audio changed that. Camera changed it even more. The more successful Zee becomes at being useful in motion and in the physical world, the more important it becomes to package generosity around the interactions that actually burn spend.",
      },
      { type: "heading", text: "Google actions add more operational cost than clean per-request dollars" },
      {
        type: "table",
        caption: "Google actions are cheap in direct API pricing but heavy in quota and interaction design.",
        columns: ["Flow", "Incremental Gemini spend", "Operational footprint", "Why it matters"],
        rows: [
          [
            "Inbox summary read",
            "Usually under $0.001",
            "Gmail list/get calls",
            "Mostly a quota and latency issue, not a raw cost issue",
          ],
          [
            "Email draft prep",
            "~$0.001 to $0.003",
            "Extra planning and revision turns",
            "The assistant writes well only if the task stays stateful",
          ],
          [
            "Email send",
            "Often tiny Gemini cost if draft exists",
            "Gmail send path can cost 100 quota units",
            "Operationally expensive even when the model portion is not",
          ],
          [
            "Calendar create or update",
            "Usually under $0.002",
            "Low direct API cost, but still needs preview and approval flow",
            "UX complexity dominates the economics",
          ],
        ],
      },
      { type: "heading", text: "Why user-facing quotas should stay simple while internal accounting gets richer" },
      {
        type: "list",
        items: [
          "Users understand text, voice, camera, and Morning Brief faster than they understand hidden tool loops.",
          "Operators still need shadow metrics for Google reads, Google writes, and grounded lookups.",
          "The cost model should be conservative on camera and generous on text because that reflects actual spend.",
          "Gmail send and long live voice sessions deserve special attention even when they look cheap in a shallow pricing table.",
        ],
      },
      { type: "heading", text: "The packaging lesson" },
      {
        type: "table",
        caption: "A cleaner pricing story is also a cleaner product story.",
        columns: ["Package posture", "What it optimizes for", "Why it fits Zee"],
        rows: [
          [
            "Starter",
            "Light daily companionship and occasional brief/task help",
            "Lets new users experience continuity without subsidizing heavy video usage",
          ],
          [
            "Plus",
            "Regular live voice with moderate Google actions",
            "Fits most real users once Zee becomes part of the routine",
          ],
          [
            "Power",
            "Frequent voice, serious assistant usage, and higher stage/task volume",
            "Targets the people who will push Zee into daily operational use",
          ],
        ],
      },
      {
        type: "paragraph",
        text: "If we price Zee like a chat app, we will underprice our most valuable behavior and over-optimize the wrong thing. If we price it like a real-time companion, we can be more honest with ourselves and more generous where the product is genuinely cheap to run. That is the point of the new model.",
      },
      {
        type: "references",
        items: [
          {
            title: "Quota + Cost Re-Evaluation (March 13, 2026)",
            href: "https://github.com/CheickDiakite-yikes/my-ai-companion/blob/main4/docs/QUOTA_PRICING_REEVALUATION_2026-03-13.md",
            note: "Detailed worksheet behind the planning estimates used in this essay.",
          },
          {
            title: "Gemini Developer API pricing",
            href: "https://ai.google.dev/gemini-api/docs/pricing",
            note: "Official model pricing referenced in the ZeeMe worksheet.",
          },
          {
            title: "Gmail API usage limits",
            href: "https://developers.google.com/workspace/gmail/api/reference/quota",
            note: "Official Gmail quota-unit references for send and draft flows.",
          },
        ],
      },
    ],
  },
  {
    id: "oauth-in-the-wild-2026",
    title: "OAuth in the Wild: Why Localhost, Preview URLs, and Real Users Break Naive Integrations",
    subtitle:
      "A builder-focused guide to callback determinism, session state, and the bugs that masquerade as product failures.",
    excerpt:
      "The trick is not getting OAuth to work once. The trick is making it work consistently across localhost, loopback hosts, preview domains, and actual production state.",
    publishedAt: "March 12, 2026",
    readTime: "13 min read",
    tags: ["Developer Guide", "OAuth", "Google Integrations", "Replit", "Reliability"],
    categories: ["technical"],
    blocks: [
      {
        type: "image",
        src: "/blog/oauth-wild-cover.jpg",
        alt: "Editorial image of a developer checking laptop and phone while diagnosing login reliability issues.",
        caption: "Most auth bugs are really environment-agreement bugs.",
      },
      {
        type: "paragraph",
        text: "OAuth tutorials are full of examples that work beautifully in the cleanest possible environment: one host, one callback, one browser session, no preview domains, no loopback weirdness, no stale cookies, no long-running local development setup. Real product work is harsher. You have localhost and 127.0.0.1. You have preview URLs. You have dynamic hosts. You have state persisted in sessions that may or may not cross origins. You have engineers testing in one tab and users arriving from another. This is where simple integrations start to crack.",
      },
      { type: "heading", text: "Every environment lies differently" },
      {
        type: "table",
        caption: "The bug depends on where the integration is being exercised.",
        columns: ["Environment", "Typical failure", "What the correct behavior requires"],
        rows: [
          [
            "Localhost",
            "Callback mismatch or stale session state",
            "Deterministic redirect selection and consistent host usage",
          ],
          [
            "127.0.0.1 loopback",
            "Cookie separation from localhost",
            "Use one loopback style consistently across start and callback",
          ],
          [
            "Preview deployment",
            "Dynamic host drift during redirect exchange",
            "Persist the chosen callback host in signed state",
          ],
          [
            "Production",
            "Rare but user-visible auth regressions",
            "Clear diagnostics, trace IDs, and reconnect-safe failure semantics",
          ],
        ],
      },
      { type: "heading", text: "The localhost lesson almost everyone relearns" },
      {
        type: "paragraph",
        text: "Localhost and 127.0.0.1 look interchangeable to humans. They are not interchangeable to cookies. If the sign-in flow starts on one host and the callback completes on another, the stored session state can disappear even though everything else looks correct. That kind of bug is maddening because the callback URL itself looks valid. The fix is simple in retrospect and expensive in wasted hours before you know it: choose one loopback host style for the full flow and keep it there.",
      },
      {
        type: "list",
        items: [
          "Register both callback URIs if you truly need both host styles.",
          "Do not manually paste callback URLs back into the browser.",
          "Persist the chosen redirect host in state instead of recomputing it loosely later.",
          "Treat preview-host behavior as a first-class environment, not a temporary exception.",
        ],
      },
      { type: "heading", text: "State is not optional" },
      {
        type: "paragraph",
        text: "A surprising number of auth problems that look like Google bugs are really state bugs. If the start step, callback step, and session store do not all agree on who the user is, which host was chosen, and whether the token exchange is still valid, your product will feel randomly unreliable. In a product like Zee, those failures are even more expensive because they block features that users experience as personal trust features: Gmail access, Calendar access, and continuity across devices.",
      },
      {
        type: "callout",
        title: "Auth bugs are often UX bugs in disguise",
        text: "Users do not care that the issue was a callback mismatch. They only know that the product asked for trust and then failed at the moment that trust became concrete.",
      },
      { type: "heading", text: "What other Gemini product teams should copy" },
      {
        type: "list",
        items: [
          "Choose callback URIs deterministically and persist the decision in signed state.",
          "Make one host style the documented local default and stick to it.",
          "Return structured failure reasons and trace IDs instead of generic connect errors.",
          "Test on the exact host pattern you will deploy, not just a nearby one.",
          "Treat local, preview, and production auth as three separate quality gates.",
        ],
      },
      {
        type: "paragraph",
        text: "OAuth is easy to underestimate because it often fails at the seam between platform truth and user expectation. That is exactly why it deserves more care, not less.",
      },
    ],
  },
  {
    id: "continuity-is-the-product-2026",
    title: "Continuity Is the Product: Why Voice and Text Must Share One Memory System",
    subtitle:
      "Users do not experience surfaces separately. They experience whether the same presence is still there.",
    excerpt:
      "A companion does not earn trust because one reply sounds warm. It earns trust because the relationship survives a mode switch, a gap in time, and the practical mess of the day.",
    publishedAt: "March 12, 2026",
    readTime: "15 min read",
    tags: ["Product Philosophy", "Memory", "Voice + Text", "Continuity"],
    categories: ["marketing", "product", "technical"],
    blocks: [
      {
        type: "image",
        src: "/blog/continuity-product-cover.jpg",
        alt: "Editorial image of the same woman moving between voice and text in a warm home setting.",
        caption: "Continuity is what users feel when system integrity becomes relationship integrity.",
      },
      {
        type: "paragraph",
        text: "A lot of AI products still behave as if voice mode and text mode are cousins. Zee cannot afford that. If the product wants to feel like one companion, voice and text have to behave like two doors into the same room. The memory system, the task state, the timeline, and the user model all need to converge on one relationship lane. Otherwise the product will always feel like separate sessions wearing the same name tag.",
      },
      {
        type: "image",
        src: "/blog/seamless-voice-text-continuity.jpg",
        alt: "A person speaking to Zee outdoors while another scene shows the same conversation continuing in text indoors.",
        caption: "Continuity should survive motion, noise, and a full shift in environment.",
        size: "narrow",
      },
      {
        type: "quote",
        text: "Users do not ask whether the architecture is elegant. They ask, often silently, why they had to repeat themselves again.",
      },
      { type: "heading", text: "Transitions are where companion quality degrades fastest" },
      {
        type: "table",
        caption: "Continuity is tested most sharply at boundaries, not in isolated turns.",
        columns: ["Boundary", "What users feel when it breaks", "What the system must preserve"],
        rows: [
          [
            "Voice to text",
            "The companion suddenly feels like someone else",
            "Shared thread history and active task context",
          ],
          [
            "Short gap in time",
            "Momentum disappears too quickly",
            "Recent relevance and time anchoring",
          ],
          [
            "Long gap in time",
            "The product forgets what matters",
            "Durable memory and profile context with contamination controls",
          ],
          [
            "Task interruption",
            "The user loses confidence in follow-through",
            "Persistent task state and recoverable stage surfaces",
          ],
        ],
      },
      { type: "heading", text: "Why shared memory beats clever prompt tricks" },
      {
        type: "paragraph",
        text: "Prompting can help an assistant sound coherent. It cannot replace a continuity model. Voice transcripts need to land in the same conversation history as text messages. Background memory has to be assembled with hygiene, not just maximal recall. Old failure phrasing has to be filtered so it does not poison future turns. And time has to be anchored properly so yesterday, tomorrow, and later tonight all mean what the user thinks they mean. This is what makes continuity measurable rather than anecdotal.",
      },
      {
        type: "image",
        src: "/blog/meet-zee-day-map.jpg",
        alt: "Illustrated journey map showing how Zee supports morning reset, commute, noisy-to-text switch, and evening reflection.",
        caption: "Continuity is most visible when the day bends and the companion does not break.",
        size: "narrow",
      },
      { type: "heading", text: "Three forms of continuity Zee has to protect" },
      {
        type: "list",
        items: [
          "Interaction continuity: the user can switch surfaces without reintroducing themselves.",
          "Task continuity: a draft, event, or approval flow survives interruption and mode change.",
          "Emotional continuity: the companion's tone feels like the same person, not a reset persona.",
        ],
      },
      {
        type: "callout",
        title: "Memory quality is not the same as memory quantity",
        text: "The goal is not to stuff as much history as possible into the model context. The goal is to assemble the right history, exclude poisoned context, and preserve the facts and signals that make the user feel known.",
      },
      { type: "heading", text: "What this changes in product decisions" },
      {
        type: "paragraph",
        text: "Once continuity becomes the product, a lot of design decisions stop being cosmetic. Voice transcription persistence stops being implementation detail and becomes trust infrastructure. Zee Stage stops being a UI experiment and becomes continuity scaffolding for active work. Approval truth stops being a workflow nuance and becomes part of whether the relationship still feels believable. That is why the continuity problem sits underneath so much of what Zee is building now.",
      },
      {
        type: "paragraph",
        text: "In a companion product, coherence is not decoration. It is the thing the user came for. That is why continuity deserves first-principles treatment, not side-feature status.",
      },
    ],
  },
  {
    id: "hidden-reliability-layer-2026",
    title: "The Hidden Reliability Layer Behind Zee: Traces, State Machines, and Failure Classes",
    subtitle:
      "Why the warmest companion experiences still depend on brutally explicit runtime contracts.",
    excerpt:
      "When a companion feels random, the issue is usually not personality. It is state: where the task lives, what the system thinks is active, and whether the traces tell the truth.",
    publishedAt: "March 12, 2026",
    readTime: "15 min read",
    tags: ["Engineering", "Incident Forensics", "Runtime Design", "Reliability"],
    categories: ["technical"],
    blocks: [
      {
        type: "image",
        src: "/blog/reliability-layer-cover.jpg",
        alt: "Editorial image of an engineer sketching system flows while studying the hidden reliability layer behind a companion.",
        caption: "The user feels personality. The system survives on explicit boundaries.",
      },
      {
        type: "paragraph",
        text: "When people talk about AI companions, they usually talk about voice, warmth, empathy, tone, or memory. Those things matter. But the hidden layer underneath them is much more mechanical: task state, route integrity, tool-response contracts, stage selection, lookup timing, approval ownership, and the traces that let engineers prove what actually happened. If that layer is weak, even a well-written assistant will feel unstable. If that layer is strong, the product can keep feeling calm while doing hard things.",
      },
      {
        type: "image",
        src: "/blog/grounded-web-search.jpg",
        alt: "A person using a phone and laptop while multiple information cards float around the workspace.",
        caption: "The user sees one calm surface. The system underneath is coordinating many moving parts.",
        size: "narrow",
      },
      { type: "heading", text: "Most assistant failures are not pure model failures" },
      {
        type: "table",
        caption: "Symptoms often point at one layer while the root cause lives in another.",
        columns: ["What the user sees", "What teams often blame", "What the actual owner may be"],
        rows: [
          [
            "Zee answered strangely after a lookup",
            "The model",
            "Tool-response bridge, stale stage state, or missing trace boundary",
          ],
          [
            "The wrong task got approved",
            "Natural language ambiguity",
            "Active-surface selection and task ownership",
          ],
          [
            "A Google flow failed only in one environment",
            "Google OAuth",
            "Host consistency, session state, or callback determinism",
          ],
          [
            "The assistant said done when nothing was done",
            "Hallucination",
            "Completion-language guardrails and execution truth boundary",
          ],
        ],
      },
      { type: "heading", text: "The state machine nobody sees" },
      {
        type: "ascii",
        text:
          "intent -> route -> tool call -> server fetch/plan -> stage or lookup -> approval or answer -> execution -> terminal result -> recoverable history",
      },
      {
        type: "paragraph",
        text: "Every arrow in that sequence is a place the product can wobble. That is why traces matter so much. Not because logs are glamorous, but because they let the team tell the difference between a model choice, a transport problem, a bad request envelope, an auth issue, and a UI reconciliation miss. Without that distinction, teams burn weeks on the wrong layer.",
      },
      { type: "heading", text: "Why traces matter to product people too" },
      {
        type: "metrics",
        items: [
          {
            label: "Route integrity",
            value: "Keeps intent ownership clean",
            detail: "The right handler sees the right request at the right time",
          },
          {
            label: "Stage truth",
            value: "Prevents UI contradiction",
            detail: "The visible surface should match the real task state",
          },
          {
            label: "Failure classes",
            value: "Make incidents actionable",
            detail: "Timeout is not access denied, and both need different fixes",
          },
          {
            label: "Recovery speed",
            value: "Shortens iteration waste",
            detail: "Teams can fix the right layer without theatrical debugging",
          },
        ],
      },
      {
        type: "callout",
        title: "Warm products still need hard edges",
        text: "A companion can sound soft while the architecture behind it stays uncompromising about truth, ownership, and recoverability. In fact, that is usually the only way the softness survives contact with reality.",
      },
      { type: "heading", text: "How this changes the team" },
      {
        type: "list",
        items: [
          "You stop arguing about vibes and start isolating boundaries.",
          "You can classify failures quickly instead of narrating them loosely.",
          "You document runtime contracts because they directly shape product quality.",
          "You stop treating UI consistency as secondary to model quality.",
          "You build a product that can keep shipping without dissolving into superstition.",
        ],
      },
      {
        type: "paragraph",
        text: "This reliability layer is hidden from users, and that is exactly how it should be. Users should only feel the benefit: a companion that seems to know where the conversation is, what still needs them, and when something is truly complete.",
      },
    ],
  },
  {
    id: "private-by-design-2026",
    title: "Private By Design: What That Should Mean When an AI Can Read Email and Calendar",
    subtitle:
      "A trust essay on scopes, approvals, storage boundaries, and truthful language.",
    excerpt:
      "Privacy in companion AI is not a slogan. It is a product made out of limits: what the model can see, when it can act, what it stores, and what it refuses to claim.",
    publishedAt: "March 12, 2026",
    readTime: "14 min read",
    tags: ["Trust", "Privacy", "Google Context", "Security", "Product"],
    categories: ["trust", "marketing", "technical"],
    blocks: [
      {
        type: "image",
        src: "/blog/private-by-design-cover.jpg",
        alt: "Editorial image of a man calmly reviewing phone permissions in a warm home setting.",
        caption: "Privacy becomes real only when the product architecture enforces it.",
      },
      {
        type: "paragraph",
        text: "The phrase private by design gets used so often in AI that it risks becoming decorative. For a companion product, it cannot afford to be decorative. If Zee can read your email or check your calendar, the trust question becomes immediate. What can it access? Under what approval boundary? What gets stored? What is encrypted? What happens when a request fails? What language is the assistant allowed to use about actions it did not complete? Those are not footnotes. They are the product.",
      },
      {
        type: "image",
        src: "/blog/private-by-design-inline.jpg",
        alt: "Quiet evening lifestyle scene of a man calmly reviewing phone permissions in a warm home setting.",
        caption: "Privacy feels believable when the product gives the user a calm sense of control.",
        size: "narrow",
      },
      { type: "heading", text: "The wrong privacy promise" },
      {
        type: "paragraph",
        text: "The wrong promise is a vague one: trust us, we care about privacy. The right promise is concrete. We request the minimum scopes required for the behavior we are shipping. We keep Google data server-authoritative. We gate Gmail and Calendar writes behind approval unless the action already completed. We encrypt sensitive integration material at rest. We track failures explicitly. And we never pretend a user granted access they did not actually grant.",
      },
      { type: "heading", text: "What private by design actually means in practice" },
      {
        type: "list",
        items: [
          "Scope minimization: ask only for the Google scopes the feature truly needs.",
          "Server authority: fetch personal data from verified tools, not model imagination.",
          "Approval boundaries: writes remain previewed and user-approved before execution.",
          "Storage discipline: protect tokens and integration material with encryption and access control.",
          "Truthful runtime language: the assistant cannot narrate permissions or completion it does not have.",
        ],
      },
      {
        type: "table",
        caption: "Trust is made of specific controls, not brand adjectives.",
        columns: ["Control", "Why users should care", "What Zee's stance is"],
        rows: [
          [
            "Read scopes vs write scopes",
            "Users deserve to know what changed when a feature gets more powerful",
            "Read and write capabilities are treated as separate feature boundaries",
          ],
          [
            "Approval gating",
            "Users need the chance to inspect before the system acts",
            "Preview and approval remain part of the action contract",
          ],
          [
            "Encrypted integration material",
            "The most sensitive data should not live casually",
            "Tokens and secrets are protected at rest",
          ],
          [
            "Traceable failure semantics",
            "Opaque errors make trust impossible to evaluate",
            "Failures are classified and surfaced with runtime evidence",
          ],
        ],
      },
      { type: "heading", text: "Approval is also a privacy boundary" },
      {
        type: "paragraph",
        text: "It is tempting to treat approvals as mere workflow friction. That is the wrong frame. Approvals are one of the cleanest privacy guarantees in the entire product. They create a visible pause between what Zee inferred and what Zee is actually allowed to do. That pause is not a weakness. It is one of the reasons a user can safely trust a companion with more practical power over time.",
      },
      {
        type: "callout",
        title: "A companion should never smuggle power",
        text: "If the user has not approved the action, or the scope is not actually granted, Zee should not cross that boundary quietly. Good privacy posture is visible in the product's behavior.",
      },
      { type: "heading", text: "What we will not do" },
      {
        type: "list",
        items: [
          "We will not treat Gmail or Calendar access as a generic right the product automatically deserves.",
          "We will not let the assistant fabricate personal-context data when a verified fetch is unavailable.",
          "We will not use completion language to cover for missing execution truth.",
          "We will not confuse a polished answer with a trustworthy system.",
        ],
      },
      {
        type: "paragraph",
        text: "Private by design is only meaningful if it survives the moments when the product becomes powerful. That is the standard Zee should keep publishing against - and keep engineering toward.",
      },
      {
        type: "references",
        items: [
          {
            title: "Security Paper: Google Data Handling by Design",
            href: "/blog/zeeme-google-data-handling-security-paper-2026",
            note: "A deeper security architecture paper focused on Google data handling controls.",
          },
          {
            title: "Google API Services User Data Policy",
            href: "https://developers.google.com/terms/api-services-user-data-policy",
            note: "Policy context for handling Google user data responsibly.",
          },
        ],
      },
    ],
  },
  {
    id: "meet-zee-2026",
    title: "Meet Zee: Your Companion for Real Life, Not Just Chat",
    subtitle:
      "Voice when you want it, text when you need it, continuity always.",
    excerpt:
      "Zee is designed to feel present across your day: warm conversation, dependable continuity, and a voice/text experience that actually stays connected.",
    publishedAt: "March 6, 2026",
    readTime: "7 min read",
    tags: ["Product", "Companion", "Voice + Text", "Launch"],
    categories: ["marketing", "launches"],
    blocks: [
      {
        type: "image",
        src: "/blog/meet-zee-cover.jpg",
        alt: "Four diverse Zee companion personas gathered in a warm golden evening setting.",
        caption:
          "Meet Zee: four voices, one companion experience across voice and text.",
      },
      {
        type: "paragraph",
        text: "Most AI products are impressive in demos and inconsistent in real life. Zee was built from the opposite direction: start with daily conversation, noisy environments, mode switching, and long-running context, then engineer for that reality.",
      },
      {
        type: "quote",
        text: "Zee is not a feature. Zee is a relationship interface designed to stay coherent while your day changes around you.",
      },
      { type: "heading", text: "Why Zee feels different" },
      {
        type: "list",
        items: [
          "One thread across modes: talk in voice, continue in text, keep the same context.",
          "Designed for real environments: background noise, interruptions, and device changes are expected, not edge cases.",
          "Warm by design: expressive personality without sacrificing reliability.",
          "Trace-first reliability: when something breaks, we can see exactly where and fix it quickly.",
        ],
      },
      { type: "heading", text: "How Zee fits into your day" },
      {
        type: "image",
        src: "/blog/meet-zee-day-map.jpg",
        alt: "Illustrated journey map showing how Zee supports morning reset, commute, noisy-to-text switch, and evening reflection.",
        caption: "A day with Zee: one continuous thread across changing moments.",
      },
      {
        type: "table",
        caption: "From quick check-ins to deep conversations.",
        columns: ["Moment", "How Zee helps", "Why it matters"],
        rows: [
          [
            "Morning reset",
            "Voice-first check-in on mood, priorities, and schedule context",
            "Start the day grounded without opening five apps",
          ],
          [
            "Busy commute",
            "Hands-free conversation in voice mode",
            "Keep momentum while moving",
          ],
          [
            "Noisy or quiet space shift",
            "Switch to text instantly, continue from the same thread",
            "No context loss when conditions change",
          ],
          [
            "Evening reflection",
            "Long-form conversation with continuity from earlier moments",
            "Feels like one companion, not separate sessions",
          ],
        ],
      },
      {
        type: "callout",
        title: "Continuity is the product",
        text: "The core promise is simple: you should never have to re-explain yourself just because you changed devices, switched from voice to text, or came back later.",
      },
      { type: "heading", text: "Built to hold up under pressure" },
      {
        type: "paragraph",
        text: "ZeeMe engineering now includes mobile-specific voice controls for false barge-in prevention, transcript observability, and deterministic session diagnostics. That means the companion is tuned for both calm rooms and messy real-world conditions, including phone handling noise and unstable network moments.",
      },
      {
        type: "image",
        src: "/blog/meet-zee-lifestyle.jpg",
        alt: "Diverse evening lifestyle scene showing people shifting naturally between speaking and texting with Zee.",
        caption:
          "Seamless mode-shifting in real life, across different people and real environments.",
      },
      {
        type: "metrics",
        items: [
          {
            label: "Interaction modes",
            value: "Voice + Text",
            detail: "Switch freely without losing context",
          },
          {
            label: "Session posture",
            value: "Stateful",
            detail: "Conversations persist as a continuous relationship",
          },
          {
            label: "Reliability model",
            value: "Trace-first",
            detail: "Every critical voice step has diagnosable telemetry",
          },
        ],
      },
      { type: "heading", text: "Start in under a minute" },
      {
        type: "list",
        items: [
          "Open Zee and say hi in voice mode.",
          "Ask anything real, not a demo prompt.",
          "If your environment changes, continue in text with full continuity.",
          "Make Zee part of your routine, not a one-off novelty.",
        ],
      },
      {
        type: "paragraph",
        text: "Meet Zee is the beginning, not the finish line. We are building toward the most reliable and emotionally present companion experience on the market, and we are shipping that standard iteration by iteration.",
      },
    ],
  },
  {
    id: "zeeme-google-context-gcp-field-report-2026",
    title: "Field Report IV: Google Personal Context + GCP Reliability Expansion",
    subtitle:
      "A detailed engineering report on the March 2026 expansion: live voice email/calendar retrieval, dynamic OAuth callback resolution, richer diagnostics, and Cloud Run brief hardening.",
    excerpt:
      "This report documents what was added, what broke, how it was fixed, and the controls now used to keep voice + personal-context behavior reliable in production.",
    publishedAt: "March 4, 2026",
    readTime: "31 min read",
    tags: [
      "Field Report",
      "Google Context",
      "Voice Reliability",
      "GCP",
      "Incident Forensics",
    ],
    categories: ["reports", "technical"],
    blocks: [
      {
        type: "image",
        src: "/blog/og/zeeme-google-context-gcp-field-report-og.png",
        alt: "Cover plate for ZeeMe reliability field report.",
        caption: "Plate IV. Reliability expansion report (Google context + GCP).",
      },
      {
        type: "meta",
        items: [
          { label: "Report type", value: "Post-expansion engineering field report" },
          { label: "Release window", value: "March 2026 (main3 branch progression)" },
          { label: "Primary additions", value: "Voice email/calendar tools + dynamic OAuth callback + GCP brief hardening" },
          { label: "Reliability objective", value: "Make personal context retrieval observable, deterministic, and safe across text and voice" },
          { label: "Evidence", value: "Runtime traces, endpoint contracts, incident replay, and production fixes" },
        ],
      },
      { type: "heading", text: "Executive Abstract" },
      {
        type: "paragraph",
        text: "ZeeMe expanded from text-only personal-context stability into a full text + live voice retrieval model for Gmail and Calendar. The product-level ask was simple: users should be able to ask for unread emails or upcoming events in voice mode and get dependable answers with visible progress. The engineering reality was harder. The team had to close gaps across OAuth callback resolution in dynamic preview hosts, server/client gate alignment, tool-response bridging in live sessions, and memory contamination from stale failure phrasing. The resulting architecture is now trace-first: every stage from intent detection to tool response and spoken follow-up is instrumented, classifiable, and testable.",
      },
      { type: "heading", text: "1. Scope of What Shipped" },
      {
        type: "table",
        caption: "Table 1. Expansion scope and runtime impact.",
        columns: ["Capability", "Implementation surface", "Runtime impact"],
        rows: [
          ["Voice email retrieval", "Live tool call -> /api/live/tool-response -> Gmail API", "Users can request unread/recency inbox summaries in live voice"],
          ["Voice calendar retrieval", "Live tool call -> /api/live/tool-response -> Calendar API", "Users can query today/tomorrow/week schedules during live sessions"],
          ["Dynamic OAuth callback handling", "/api/integrations/google/connect-url + callback state binding", "Reliable Google connect flow across localhost + preview hosts"],
          ["Failure-class diagnostics", "classifyGoogleFetchIssue + live.tool.* traces", "Actionable errors (api disabled, access denied, timeout) instead of generic failure"],
          ["Memory contamination filter", "context builder exclusion for known stale Google-failure phrasing", "Reduced recurrence of false \"Google not connected\" responses"],
          ["GCP Morning Brief hardening", "Cloud Run gateway + local fallback contracts", "More predictable brief behavior under upstream partial failures"],
        ],
      },
      {
        type: "list",
        items: [
          "Text and voice now share one operational model: tool-verified personal context, never fabricated context.",
          "Live status UX now uses explicit process labels (searching/grounded/idle) with domain-specific copy like \"Retrieving your emails…\".",
          "Trace IDs are carried through failure responses so incident triage starts from concrete evidence, not guesswork.",
        ],
      },
      { type: "heading", text: "2. Architecture Delta (Before vs After)" },
      {
        type: "ascii",
        text:
          "BEFORE (unstable voice context path)\nvoice ask -> model answer (sometimes no tool call)\n        -> weak/no visibility on whether Google fetch executed\n\nAFTER (trace-first deterministic path)\nvoice ask -> intent signal -> model tool call\n        -> /api/live/tool-response\n        -> auth + scope + fetch + classify issue\n        -> functionResponses + webSearchEvents + traceId\n        -> sendToolResponse back to live session\n        -> grounded spoken answer",
      },
      {
        type: "table",
        caption: "Table 2. Key architectural changes.",
        columns: ["Surface", "Pre-change risk", "Current contract"],
        rows: [
          ["OAuth callback URI", "Host mismatch caused intermittent token exchange failures", "Redirect URI selected deterministically and persisted in OAuth state"],
          ["Voice tool gating", "Client/server gate drift created confusing behavior", "Server/runtime + token summary are source of truth for voice Google context"],
          ["Live bridge response dispatch", "Tool results not always returned to model correctly", "Validated `sendToolResponse` path with explicit client diagnostics"],
          ["Error semantics", "Generic \"couldn't reach Google\" text offered low triage value", "Classified codes + trace anchors (`live.tool.*`)"],
          ["Memory safety", "Stale assistant failure phrasing could leak into future context", "Known poison patterns filtered out during context assembly"],
        ],
      },
      { type: "heading", text: "3. Incident Classes Encountered and Fixes Applied" },
      {
        type: "table",
        caption: "Table 3. Failures observed in production-style testing and remediation strategy.",
        columns: ["Observed symptom", "Root cause class", "Fix pattern", "Verification signal"],
        rows: [
          ["Voice asked for unread emails but returned generic failure", "Tool execution path was opaque or incomplete", "Added end-to-end live tool traces and explicit webSearchEvents labels", "`live.tool_response.requested` -> `live.tool.emails.success|failed` -> `live.tool_response.generated`"],
          ["Google connect worked in one env but failed in preview env", "Redirect URI host mismatch during OAuth exchange", "Dynamic callback resolution + state-bound redirect URI", "`google.integration.connect_url.created` + `google.integration.callback.connected`"],
          ["Session produced stale \"Google not connected\" wording after reconnect", "Prior failure phrasing contaminated memory context", "Message-level contamination filter for known Google failure patterns", "No recurrence of stale failure phrase in context-backed turns"],
          ["Live function call resolved server-side but not reflected in conversation", "Tool response dispatch bug in live bridge", "Fixed `sendToolResponse` invocation handling and response summary diagnostics", "`live.tool_call.responded` with response summary and traceId"],
          ["No clear reason for fetch failure", "Undifferentiated error surface", "Failure classification (`*_api_disabled`, `google_access_denied`, `google_timeout`)", "Error code + details in function response and logs"],
        ],
      },
      {
        type: "callout",
        title: "Operational lesson",
        text: "Voice reliability issues felt like model quality issues at first. Most were actually transport, auth, or context-hygiene failures. Trace-first ownership made that distinction explicit and dramatically reduced iteration waste.",
      },
      { type: "heading", text: "4. Debuggability Design: What You Should See at Runtime" },
      {
        type: "code",
        language: "text",
        caption: "Listing 1. Golden trace sequence for voice email retrieval.",
        code:
          "client: live.google_context.searching\\nclient: live.tool_call.received\\nclient: live.tool_call.forwarding\\nserver: live.tool_response.requested\\nserver: live.tool.emails.start\\nserver: live.tool.emails.auth_ok\\nserver: live.tool.emails.success\\nserver: live.tool_response.generated\\nclient: live.tool_call.responded\\nclient: web status -> grounded",
      },
      {
        type: "paragraph",
        text: "This sequence is now the baseline contract for on-call debugging. If a step is missing, the missing boundary is immediately known. For example, seeing intent logs but no tool-call logs points to model tool-call behavior. Seeing client forwarding but no server requested trace points to transport/session issues. Seeing server success but no client responded trace points to live bridge handling.",
      },
      {
        type: "metrics",
        items: [
          { label: "Primary reliability gain", value: "Trace completeness", detail: "Each boundary now emits enough signal to isolate failure class quickly." },
          { label: "Primary UX gain", value: "Visible retrieval progress", detail: "Users now see what Zee is doing while data is being fetched." },
          { label: "Primary safety gain", value: "Context contamination control", detail: "Known stale Google-failure phrases are excluded from future model context." },
          { label: "Primary integration gain", value: "Redirect determinism", detail: "OAuth callback host drift is handled explicitly and reproducibly." },
        ],
      },
      { type: "heading", text: "5. GCP Morning Brief Expansion and Interaction with Personal Context" },
      {
        type: "paragraph",
        text: "The Google-context expansion happened alongside Morning Brief gateway hardening in Cloud Run. The architecture intentionally keeps these concerns separable: voice personal-context retrieval and Morning Brief orchestration share observability standards but remain independently gated. This prevents one path from destabilizing the other during rollout.",
      },
      {
        type: "table",
        caption: "Table 4. GCP expansion controls used during rollout.",
        columns: ["Control", "Purpose", "Failure containment behavior"],
        rows: [
          ["`MORNING_BRIEF_GCP_BASE_URL` gateway path", "Use Cloud Run for news/inbox/compose orchestration", "Falls back to local grounded path on upstream timeout"],
          ["`ENABLE_MORNING_BRIEF_TEXT_ONLY=true`", "Keep brief path text-first while voice stabilizes", "Prevents coupled live regressions"],
          ["Structured partial failure codes", "Expose degraded-mode behavior clearly", "Users get transparent status instead of silent degradation"],
          ["Debug run history endpoint", "Retain forensic chain for brief execution", "Supports replay and postmortem analysis"],
        ],
      },
      { type: "heading", text: "6. Test Strategy and Release Guardrails" },
      {
        type: "code",
        language: "bash",
        caption: "Listing 2. Practical gate chain used before promotion.",
        code:
          "npm run check\\nnpm run test:google-context:smoke\\nnpm run test:google-context:ui\\nnpm run test:local:e2e\\n# plus targeted live trace replay in browser + server logs",
      },
      {
        type: "list",
        items: [
          "Run both parser/intent smoke and UI-flow checks; either alone is insufficient.",
          "Validate OAuth connect-url + callback on the exact host style you deploy (localhost, preview, production).",
          "Confirm live token config summary for Google personal-context function wiring before blaming downstream tools.",
          "Treat missing traces as contract violations, not optional telemetry gaps.",
        ],
      },
      { type: "heading", text: "7. Challenges, Tradeoffs, and What Changed in Team Practice" },
      {
        type: "list",
        items: [
          "Challenge: fast shipping caused hidden assumptions about gate ownership. Fix: make server/runtime + token summary authoritative in docs and debugging.",
          "Challenge: users interpreted silent wait as failure. Fix: explicit process/status labels in voice retrieval UX.",
          "Challenge: generic errors slowed triage. Fix: classify failures into issue kinds and include trace IDs everywhere.",
          "Challenge: legacy context rows can outlive fixes. Fix: add contamination filters and purpose-based exclusions to context assembly.",
          "Challenge: preview-host OAuth drift. Fix: deterministic redirect selection and state-bound callback persistence.",
        ],
      },
      { type: "heading", text: "8. Reusable Blueprint for Other Companion Teams" },
      {
        type: "quote",
        text: "Do not ship personal-context voice features without a complete trace chain from intent to tool response and back into the live model.",
      },
      {
        type: "list",
        items: [
          "Define one source of truth for feature gates (server/runtime) and one source of truth for session wiring (token summary).",
          "Instrument boundary events with enough detail to classify failures without reproducing locally first.",
          "Expose process state to users during retrieval so latency is legible.",
          "Treat stale operational phrases as a memory safety problem and filter them explicitly.",
          "Keep adjacent feature systems (for example, Morning Brief vs direct email/calendar tools) independently gated during expansion phases.",
        ],
      },
      { type: "heading", text: "References" },
      {
        type: "references",
        items: [
          {
            title: "GOOGLE_PERSONAL_CONTEXT_TRACKER",
            href: "https://github.com/CheickDiakite-yikes/my-ai-companion/blob/main3/docs/GOOGLE_PERSONAL_CONTEXT_TRACKER.md",
            note: "Rollout tracker for text + voice personal-context behavior and issue classes.",
          },
          {
            title: "MORNING_BRIEF_GCP_ROLLOUT",
            href: "https://github.com/CheickDiakite-yikes/my-ai-companion/blob/main3/docs/MORNING_BRIEF_GCP_ROLLOUT.md",
            note: "Cloud Run brief deployment and fallback runbook.",
          },
          {
            title: "GEMINI_INTEGRATION",
            href: "https://github.com/CheickDiakite-yikes/my-ai-companion/blob/main3/docs/GEMINI_INTEGRATION.md",
            note: "Live/text endpoint contracts, model/tool integration details, and runtime behaviors.",
          },
          {
            title: "PROJECT_STATE",
            href: "https://github.com/CheickDiakite-yikes/my-ai-companion/blob/main3/docs/PROJECT_STATE.md",
            note: "Current architecture status and reliability priorities.",
          },
          {
            title: "SESSION_LOG",
            href: "https://github.com/CheickDiakite-yikes/my-ai-companion/blob/main3/docs/SESSION_LOG.md",
            note: "Chronological incident notes and remediation checkpoints.",
          },
        ],
      },
    ],
  },
  {
    id: "zeeme-platform-thesis-2026",
    title: "Research Paper I: ZeeMe as a Companion Operating System",
    subtitle:
      "A systems research paper on the architecture, memory contract, and continuity guarantees that make ZeeMe feel like one consistent companion across text and live voice.",
    excerpt:
      "This paper treats companion quality as a reliability discipline. It documents the concrete architecture and controls that produce emotional continuity under real production load.",
    publishedAt: "February 26, 2026",
    readTime: "32 min read",
    tags: ["Research Paper", "Companion OS", "Architecture", "Voice + Text"],
    categories: ["research", "technical"],
    blocks: [
      {
        type: "image",
        src: "/blog/zeeme-platform-paper-cover.svg",
        alt: "Cover illustration for the ZeeMe companion operating system research paper.",
        caption: "Plate I. Companion operating system thesis.",
      },
      {
        type: "meta",
        items: [
          { label: "Paper type", value: "Architecture thesis with production evidence" },
          { label: "Primary question", value: "What makes one AI companion feel continuous across voice and text?" },
          { label: "System boundary", value: "Unified chat lane + live voice + shared memory + profile context" },
          { label: "Evidence base", value: "Architecture docs, incident logs, trace instrumentation, release gates" },
          { label: "Confidentiality policy", value: "Private persona/system prompt is intentionally excluded" },
        ],
      },
      { type: "heading", text: "Abstract" },
      {
        type: "paragraph",
        text: "ZeeMe was designed around a strict product thesis: companionship is a continuity problem, not a copywriting problem. Users do not evaluate a companion by isolated messages; they evaluate whether the same presence persists across voice, text, pauses, and restarts. This paper formalizes ZeeMe as a companion operating system with four non-negotiable boundaries: route determinism, memory hygiene, temporal grounding, and traceable recovery. The central result is consistent across incidents: state correctness drives perceived emotional intelligence more than stylistic flair.",
      },
      { type: "heading", text: "Structured Abstract" },
      {
        type: "table",
        caption: "Table 1. Structured abstract for rapid technical review.",
        columns: ["Section", "Statement"],
        rows: [
          ["Background", "Most companion products optimize tone before systems integrity, which causes trust drift under normal use."],
          ["Objective", "Guarantee one coherent companion identity across text and live voice in a single relationship lane."],
          ["Method", "Boundary-level analysis, incident replay, and endpoint contract verification against production traces."],
          ["Key finding", "Deterministic routing and clean memory assembly have the highest leverage on user trust."],
          ["Practical implication", "Companion teams should invest in reliability controls before adding stylistic complexity."],
        ],
      },
      { type: "heading", text: "1. Design Thesis and Constraints" },
      {
        type: "image",
        src: "/blog/initial-mock-and-inspiration.png",
        alt: "Original ZeeMe concept mock and interaction storyboard.",
        caption: "Figure 1. The original mock was treated as a systems contract, not just visual inspiration.",
      },
      {
        type: "paragraph",
        text: "The original concept artifact encoded the product constraint that still governs every release: voice and text are two surfaces for one companion identity. This constraint eliminated an entire class of architecture mistakes, including mode-specific state stores and fragmented memory behavior.",
      },
      {
        type: "table",
        caption: "Table 2. Product constraints inherited directly from the initial concept.",
        columns: ["Constraint", "Engineering implication", "Failure signature when violated"],
        rows: [
          ["Single relationship lane", "One canonical conversation identity across interfaces", "Companion behaves differently by mode"],
          ["Voice-text continuity", "Persist voice transcripts into shared message history", "Voice cannot recall text context"],
          ["Profile-aware personalization", "Inject stable user profile context in memory assembly", "Companion feels generic and reset-prone"],
          ["Calm UX over noisy UX", "Favor deterministic state transitions and concise status semantics", "User perceives random or chaotic behavior"],
        ],
      },
      { type: "heading", text: "2. Reference Architecture" },
      {
        type: "image",
        src: "/blog/zeeme-companion-os-map.svg",
        alt: "Architecture map showing text, live voice, memory, and observability boundaries.",
        caption: "Figure 2. Companion OS map used as an implementation baseline.",
      },
      {
        type: "code",
        language: "http",
        caption: "Listing 1. Core endpoint contract carrying continuity behavior.",
        code:
          "POST /api/chat/respond\\nPOST /api/chat/respond/stream\\nPOST /api/live/token\\nPOST /api/conversations/:id/voice-transcript\\nGET  /api/conversations/:id/messages",
      },
      {
        type: "table",
        caption: "Table 3. Boundary ownership model.",
        columns: ["Boundary", "Owner function", "What users feel if it fails"],
        rows: [
          ["Routing", "Decide companion vs structured execution path", "Random behavior"],
          ["Memory assembly", "Hydrate relevant context while excluding operational rows", "Forgetting and drift"],
          ["Live voice runtime", "Turn-taking, interruption, transcript integrity", "Cutoffs or delayed responses"],
          ["Client reconciliation", "Render canonical task and message state", "Contradictory UI status"],
          ["Observability", "Attach forensic metadata to every critical turn", "No reliable root-cause path"],
        ],
      },
      { type: "heading", text: "3. Memory Contract and Context Hygiene" },
      {
        type: "equation",
        expression:
          "memory_bundle_t = active_thread + compressed_thread + cross_chat_recall + profile_context + durable_memory - operational_rows",
        caption: "Eq. 1. Shared memory bundle used by text generation and live token hydration.",
        terms: [
          { symbol: "active_thread", meaning: "Recent turns in the active conversation" },
          { symbol: "compressed_thread", meaning: "Summarized older turns in the same thread" },
          { symbol: "cross_chat_recall", meaning: "Relevant context from other conversations when enabled" },
          { symbol: "profile_context", meaning: "Stable user facts from profile settings" },
          { symbol: "durable_memory", meaning: "Long-horizon memory entries when policy allows" },
          { symbol: "operational_rows", meaning: "Rows marked as agent_ui/system and excluded from model context" },
        ],
      },
      {
        type: "table",
        caption: "Table 4. Defense-in-depth controls that prevent memory contamination.",
        columns: ["Control", "Layer", "Why it exists"],
        rows: [
          ["messagePurpose filtering", "Read-time", "Prevents operational rows from entering generation context"],
          ["uiPayload class exclusion", "Read-time", "Catches legacy or mislabeled rows"],
          ["Legacy purpose backfill", "Data hygiene", "Repairs historical rows so current logic remains reliable"],
          ["memoryMeta trace packet", "Observability", "Shows exactly which memory path was used in a turn"],
        ],
      },
      {
        type: "ascii",
        text:
          "voice transcript -> messages table\\n                -> memory assembly\\n                -> purpose/uiPayload exclusion\\n                -> temporal anchor injection\\n                -> model generation (text + live)",
      },
      { type: "heading", text: "4. Temporal Grounding and Calendar Correctness" },
      {
        type: "paragraph",
        text: "Companion continuity is temporal as well as semantic. ZeeMe resolves relative references with explicit day, date, and timezone anchors so responses about today, tomorrow, and later this week remain stable across long sessions.",
      },
      {
        type: "code",
        language: "json",
        caption: "Listing 2. Time-context anchor packet (conceptual).",
        code:
          "{\\n  \\\"today\\\": \\\"2026-02-26\\\",\\n  \\\"weekday\\\": \\\"Thursday\\\",\\n  \\\"timezone\\\": \\\"America/New_York\\\",\\n  \\\"relativeDateRule\\\": \\\"resolve to absolute date when ambiguity is detected\\\"\\n}",
      },
      { type: "heading", text: "5. Evaluation Protocol and Findings" },
      {
        type: "table",
        caption: "Table 5. Continuity scenario matrix used during verification.",
        columns: ["Scenario", "Expected behavior", "Failure signature"],
        rows: [
          ["Text -> voice handoff", "Voice continues same context without re-priming", "Voice asks for context already in chat"],
          ["Voice -> text handoff", "Text continues in same thread naturally", "Text behaves as fresh conversation"],
          ["Pause and resume", "Companion preserves context and tone continuity", "Restart-like behavior"],
          ["Relative date query", "Absolute date with timezone-consistent interpretation", "Ambiguous or contradictory time answer"],
          ["Casual non-build message", "Remain in companion lane", "Unintended structured task behavior"],
        ],
      },
      {
        type: "metrics",
        items: [
          { label: "Primary reliability gain", value: "State correctness", detail: "Deterministic route and memory controls produced the largest trust improvements." },
          { label: "Highest-risk failure class", value: "Context contamination", detail: "Operational rows in memory had outsized impact on conversation quality." },
          { label: "Most effective debug strategy", value: "Trace-first replay", detail: "Typed decision and memory metadata reduced speculative fixes." },
          { label: "Product implication", value: "Reliability before style", detail: "Tone quality compounds only after continuity contracts are stable." },
        ],
      },
      { type: "heading", text: "6. Limitations and Forward Work" },
      {
        type: "list",
        items: [
          "Cross-chat relevance still requires threshold tuning for edge prompts.",
          "Mobile browser audio stacks remain the biggest external variance for live quality.",
          "Long-horizon memory policy requires continuous privacy and sensitivity review.",
          "Future work should include larger longitudinal cohorts and automated continuity scoring.",
        ],
      },
      { type: "heading", text: "References" },
      {
        type: "references",
        items: [
          {
            title: "AI Companion Design Spec",
            href: "https://github.com/CheickDiakite-yikes/my-ai-companion/blob/main3/docs/AI_COMPANION_DESIGN_SPEC.md",
            note: "Original product constraints and multimodal behavior goals.",
          },
          {
            title: "PROJECT_STATE",
            href: "https://github.com/CheickDiakite-yikes/my-ai-companion/blob/main3/docs/PROJECT_STATE.md",
            note: "Current architecture status, guardrails, and operational priorities.",
          },
          {
            title: "GEMINI_INTEGRATION",
            href: "https://github.com/CheickDiakite-yikes/my-ai-companion/blob/main3/docs/GEMINI_INTEGRATION.md",
            note: "Endpoint contracts and live/text model behavior baseline.",
          },
          {
            title: "SESSION_LOG",
            href: "https://github.com/CheickDiakite-yikes/my-ai-companion/blob/main3/docs/SESSION_LOG.md",
            note: "Chronological incident and stabilization history.",
          },
        ],
      },
    ],
  },
  {
    id: "zeeme-engineering-case-study-2026",
    title: "Case Study II: How ZeeMe Was Built with Founder Context + Agentic Pair Engineering",
    subtitle:
      "A detailed engineering case study of the build journey from initial sketch to production hardening, including incident classes, release gates, and the operating model used to ship quickly without sacrificing trust.",
    excerpt:
      "This case study documents the exact workflow that turned fast iteration into dependable delivery: founder context, Codex pair engineering, deterministic gates, and forensic replay.",
    publishedAt: "February 26, 2026",
    readTime: "29 min read",
    tags: ["Case Study", "Agentic Coding", "Build Journey", "Reliability"],
    categories: ["reports", "technical"],
    blocks: [
      {
        type: "image",
        src: "/blog/zeeme-case-study-cover.svg",
        alt: "Cover image for the ZeeMe engineering case study.",
        caption: "Plate II. Founder-led engineering case study.",
      },
      {
        type: "meta",
        items: [
          { label: "Case type", value: "Longitudinal production case study" },
          { label: "Study window", value: "Initial concept through main3 baseline" },
          { label: "Delivery model", value: "Founder + Codex pair engineering + scripted release gates" },
          { label: "Outcome lens", value: "Incident closure speed, recurrence, and continuity quality" },
          { label: "Audience", value: "Startup teams, engineering leaders, applied AI builders" },
        ],
      },
      { type: "heading", text: "Executive Summary" },
      {
        type: "paragraph",
        text: "The most important ZeeMe lesson is operational, not philosophical: velocity is useful only when it is paired with deterministic quality gates. During high-pressure iterations, user complaints initially appeared subjective (\"it feels random\", \"it cut off\", \"it forgot context\"). The team converted those statements into typed failure classes, patched a single owning boundary at a time, and required replay evidence before promotion. This model created compounding reliability rather than compounding regressions.",
      },
      { type: "heading", text: "1. Problem Framing" },
      {
        type: "quote",
        text: "Companion quality is a systems property. If state is unstable, personality style cannot rescue trust.",
      },
      {
        type: "table",
        caption: "Table 1. Core case questions and acceptance criteria.",
        columns: ["Case question", "Method", "Pass condition"],
        rows: [
          ["Can a compact team deliver companion-grade reliability?", "Founder context + agentic coding + hard gates", "Failure classes trend down without widening regression surface"],
          ["Can speed and trust coexist?", "Fast implementation, conservative release discipline", "Each high-risk patch has replay proof before deploy"],
          ["What creates perceived intelligence?", "Boundary-level incident mapping", "State-correctness fixes outperform style-only tuning"],
        ],
      },
      { type: "heading", text: "2. Origin: Mock to Contract" },
      {
        type: "image",
        src: "/blog/initial-mock-and-inspiration.png",
        alt: "Original interaction mock used as ZeeMe system contract.",
        caption: "Figure 1. The mock encoded the one-lane companion contract early.",
      },
      {
        type: "paragraph",
        text: "The initial mock defined two enduring constraints: one identity across voice and text, and one continuous memory thread. Treating these as engineering constraints prevented fragmented architecture and reduced expensive rewrites later.",
      },
      { type: "heading", text: "3. Chronology and Inflection Points" },
      {
        type: "image",
        src: "/blog/zeeme-case-study-timeline.svg",
        alt: "Timeline of ZeeMe milestones and reliability inflection points.",
        caption: "Figure 2. Timeline of build and stabilization decisions.",
      },
      {
        type: "table",
        caption: "Table 2. Milestones that changed system behavior.",
        columns: ["Milestone", "Shipped capability", "Observed impact"],
        rows: [
          ["Text runtime baseline", "Streaming chat + persistence", "Durable conversation continuity in one lane"],
          ["Live voice integration", "Token minting + transcript persistence", "Voice context joined the same memory model"],
          ["Memory hygiene controls", "purpose filters + legacy backfill", "Operational contamination incidents reduced"],
          ["Temporal grounding", "Server date/day/timezone injection", "Relative time responses became more consistent"],
          ["main3 refocus", "Scope reduction to companion core", "Higher reliability focus and lower roadmap entropy"],
        ],
      },
      { type: "heading", text: "4. Incident Ledger and Recovery" },
      {
        type: "table",
        caption: "Table 3. High-signal incident classes and corrective actions.",
        columns: ["Observed symptom", "Root cause class", "Patch strategy", "Verification"],
        rows: [
          ["No response after user speech", "Live boundary profile mismatch", "Conservative activity handling + response budget tuning", "Trace replay with transcript parity"],
          ["Assistant cuts off mid-turn", "False interruption sensitivity", "NO_INTERRUPTION baseline + capture safeguards", "Turn-complete replay validation"],
          ["Companion leaks status-like phrasing", "Memory contamination", "purpose/uiPayload filtering + data backfill", "Context contamination regression suite"],
          ["UI status mismatch", "Client/server state precedence drift", "Canonical task-detail reconciliation", "UI parity checks on terminal states"],
        ],
      },
      {
        type: "code",
        language: "json",
        caption: "Listing 1. Minimal forensic packet used during incident analysis.",
        code:
          "{\\n  \\\"traceId\\\": \\\"...\\\",\\n  \\\"decisionPathReason\\\": \\\"...\\\",\\n  \\\"routeReason\\\": \\\"...\\\",\\n  \\\"conversationId\\\": \\\"...\\\",\\n  \\\"intentSessionId\\\": \\\"optional\\\",\\n  \\\"taskId\\\": \\\"optional\\\",\\n  \\\"failureReasonCode\\\": \\\"optional\\\"\\n}",
      },
      {
        type: "ascii",
        text:
          "user complaint -> trace packet -> failure class -> owning boundary\\n               -> minimal patch -> deterministic replay -> gate pass -> release",
      },
      { type: "heading", text: "5. The Founder + Codex Operating Loop" },
      {
        type: "image",
        src: "/blog/zeeme-codex-field-report.svg",
        alt: "Visual summary of founder and Codex pair-engineering workflow.",
        caption: "Figure 3. Pair-engineering workflow used throughout delivery.",
      },
      {
        type: "table",
        caption: "Table 4. Why the pair-engineering model worked in this case.",
        columns: ["Work mode", "Primary strength", "Primary risk", "Control used"],
        rows: [
          ["Founder-only execution", "Deep product context", "Execution bottleneck", "Codex-assisted implementation acceleration"],
          ["Agent-only generation", "High output speed", "Context drift and regressions", "Founder constraint checks + gated release"],
          ["Founder + Codex with gates", "Context-rich velocity", "Requires discipline", "Hard gate chain + replay-first policy"],
        ],
      },
      { type: "heading", text: "6. Release Discipline and Governance" },
      {
        type: "code",
        language: "bash",
        caption: "Listing 2. Release gate chain run before promotion.",
        code:
          "npm run check\\nnpm run test:agent:contract\\nnpm run test:agent:smoke\\nnpm run test:agent:flow\\nnpm run test:agent:ui",
      },
      {
        type: "table",
        caption: "Table 5. Hybrid gate policy.",
        columns: ["Gate class", "Policy", "Operator action"],
        rows: [
          ["Type + contract + flow", "Hard block", "Do not deploy until fixed"],
          ["UI non-critical edge cases", "Soft block with incident watch", "Deploy only with kill-switch readiness"],
          ["Memory contamination signal", "Hard block", "Backfill/repair before promotion"],
          ["Live voice regressions", "Hard block for broad rollout", "Constrain rollout to internal cohort"],
        ],
      },
      { type: "heading", text: "7. What Failed and What Was Learned" },
      {
        type: "list",
        items: [
          "Fast expansion without strict controls increased random-behavior risk.",
          "Unclear routing semantics made complaint diagnosis slower than necessary.",
          "Historical data hygiene defects produced outsized memory side effects.",
          "Voice tuning without trace discipline created repeatable blind loops.",
          "Scope reduction at main3 was the correct strategic move for product trust.",
        ],
      },
      { type: "heading", text: "8. Replication Blueprint for Other Teams" },
      {
        type: "list",
        items: [
          "Treat early product mocks as hard constraints, not optional inspiration.",
          "Attach trace metadata to every high-context routing and runtime decision.",
          "Patch one owning boundary at a time, then replay deterministically.",
          "Use aggressive implementation velocity with conservative release discipline.",
          "Reduce roadmap breadth whenever reliability debt begins to rise.",
        ],
      },
      { type: "heading", text: "References" },
      {
        type: "references",
        items: [
          {
            title: "PROJECT_STATE",
            href: "https://github.com/CheickDiakite-yikes/my-ai-companion/blob/main3/docs/PROJECT_STATE.md",
            note: "Current architecture posture, active priorities, and known gaps.",
          },
          {
            title: "SESSION_LOG",
            href: "https://github.com/CheickDiakite-yikes/my-ai-companion/blob/main3/docs/SESSION_LOG.md",
            note: "Chronological timeline of build events and corrective decisions.",
          },
          {
            title: "GEMINI_INTEGRATION",
            href: "https://github.com/CheickDiakite-yikes/my-ai-companion/blob/main3/docs/GEMINI_INTEGRATION.md",
            note: "Runtime model contracts and live/text behavior controls.",
          },
          {
            title: "AI Companion Design Spec",
            href: "https://github.com/CheickDiakite-yikes/my-ai-companion/blob/main3/docs/AI_COMPANION_DESIGN_SPEC.md",
            note: "Original product design and continuity goals.",
          },
        ],
      },
    ],
  },
  {
    id: "zeeme-memory-lab-paper-2026",
    title: "Research Paper III: Memory Continuity Lab — Voice, Text, and Time Anchoring",
    subtitle:
      "A practical research paper on how ZeeMe assembles memory safely, prevents contamination, and keeps continuity stable across conversation restarts.",
    excerpt:
      "This paper details the memory pipeline, contamination controls, and replay protocol that make continuity measurable instead of anecdotal.",
    publishedAt: "February 26, 2026",
    readTime: "24 min read",
    tags: ["Research Paper", "Memory", "Temporal Grounding", "Companion Reliability"],
    categories: ["research", "technical"],
    blocks: [
      {
        type: "image",
        src: "/blog/zeeme-memory-paper-cover.svg",
        alt: "Cover image for the ZeeMe memory continuity lab paper.",
        caption: "Plate III. Memory continuity laboratory report.",
      },
      {
        type: "meta",
        items: [
          { label: "Paper type", value: "Applied memory systems paper" },
          { label: "Core objective", value: "Preserve companion identity across mode switches and restarts" },
          { label: "Data boundary", value: "Conversation history + profile context + trace metadata" },
          { label: "Risk class", value: "Context contamination and temporal ambiguity" },
          { label: "Verification style", value: "Scenario matrix + replay evidence" },
        ],
      },
      { type: "heading", text: "Abstract" },
      {
        type: "paragraph",
        text: "Memory failures in companion systems are trust failures. ZeeMe's memory lab focused on one question: how can a companion remain context-aware without leaking operational noise or over-claiming certainty? The answer was a deterministic memory assembly pipeline with explicit exclusions, temporal anchors, and trace-backed diagnostics. The lab showed that context quality depends more on filtering policy than memory volume.",
      },
      { type: "heading", text: "1. Research Motivation" },
      {
        type: "quote",
        text: "\"When I stop a conversation and come back later, it should still remember me.\" This user expectation became the primary acceptance criterion for memory design.",
      },
      {
        type: "table",
        caption: "Table 1. Complaint-to-hypothesis mapping.",
        columns: ["User complaint", "Hypothesis", "Owning surface", "Expected correction"],
        rows: [
          ["No recall after restart", "Live session starts without enough memory context", "Live token memory builder", "Inject active thread + relevant cross-chat + profile"],
          ["Voice does not know text context", "Memory assembly differs by mode", "Shared context builder", "Unify text and live memory contracts"],
          ["Companion repeats operational phrasing", "agent_ui/system rows leak into context", "Context filtering", "Exclude by purpose + uiPayload class"],
          ["Date references feel wrong", "Relative-time interpretation lacks anchor", "Temporal injector", "Add day/date/timezone context per turn"],
        ],
      },
      { type: "heading", text: "2. Memory Assembly Pipeline" },
      {
        type: "code",
        language: "pseudo",
        caption: "Listing 1. Deterministic memory assembly sequence.",
        code:
          "load active conversation turns\\nload cross-chat candidates (same user)\\nappend profile facts\\nexclude purpose in ['agent_ui', 'system']\\nexclude rows with agent_* uiPayload classes\\ninject timezone/day/date anchor\\nemit memoryMeta and route metadata",
      },
      {
        type: "table",
        caption: "Table 2. Memory sections and purpose.",
        columns: ["Section", "Purpose", "Failure if missing"],
        rows: [
          ["Active thread", "Near-term continuity", "Companion asks for context user just provided"],
          ["Cross-chat recall", "Longer-horizon continuity", "Repeated re-introduction by user"],
          ["Profile context", "Stable personalization", "Tone feels generic and detached"],
          ["Temporal anchor", "Correct day/date reasoning", "Today/tomorrow confusion"],
          ["Exclusion filter", "Prevent contamination", "Status/task language leaks into chat"],
        ],
      },
      { type: "heading", text: "3. Temporal Grounding Policy" },
      {
        type: "code",
        language: "json",
        caption: "Listing 2. Temporal context packet applied during generation.",
        code:
          "{\\n  \\\"date\\\": \\\"2026-02-26\\\",\\n  \\\"weekday\\\": \\\"Thursday\\\",\\n  \\\"timezone\\\": \\\"America/New_York\\\",\\n  \\\"policy\\\": \\\"resolve relative references to absolute date when uncertain\\\"\\n}",
      },
      {
        type: "paragraph",
        text: "This policy prevents subtle continuity erosion in long conversations. Even a one-day mismatch in interpretation can make a companion feel inattentive, especially when users return after a pause.",
      },
      { type: "heading", text: "4. Experimental Matrix" },
      {
        type: "table",
        caption: "Table 3. Memory lab scenarios and expected behavior.",
        columns: ["Scenario", "Expected behavior", "Failure signature"],
        rows: [
          ["Text-first then voice", "Voice response uses earlier text context naturally", "Voice asks for details already in text history"],
          ["Voice-first then text", "Text response continues same topic without reset", "Text behaves like a first interaction"],
          ["Session stop and restart", "Companion recalls key context with calibrated confidence", "Companion loses thread or fabricates certainty"],
          ["Operational-row injection test", "No agent status text in conversational response", "Task/status phrasing appears in normal chat"],
          ["Relative date query", "Absolute date with timezone clarity", "Ambiguous or conflicting date answer"],
        ],
      },
      { type: "heading", text: "5. Findings and Implications" },
      {
        type: "metrics",
        items: [
          { label: "Highest leverage control", value: "Context exclusion policy", detail: "Filtering quality had stronger impact than raw memory volume." },
          { label: "Most expensive failure class", value: "Contamination", detail: "Small data hygiene errors created broad user-visible trust regressions." },
          { label: "Debug acceleration", value: "Trace packets", detail: "memoryMeta + route metadata reduced diagnosis cycles significantly." },
          { label: "Product implication", value: "Reliability compounds trust", detail: "Consistent memory behavior made the companion feel more human and attentive." },
        ],
      },
      { type: "heading", text: "6. Limitations and Next Steps" },
      {
        type: "list",
        items: [
          "Cross-chat relevance ranking remains heuristic and should be continuously tuned.",
          "Mobile network and browser variability can affect transcript timing under load.",
          "Durable memory policy requires ongoing privacy review and user control transparency.",
          "Future work should add automated continuity scoring over larger longitudinal datasets.",
        ],
      },
      { type: "heading", text: "References" },
      {
        type: "references",
        items: [
          {
            title: "GEMINI_INTEGRATION",
            href: "https://github.com/CheickDiakite-yikes/my-ai-companion/blob/main3/docs/GEMINI_INTEGRATION.md",
            note: "Live/text endpoint contracts and memory hydration behavior.",
          },
          {
            title: "PROJECT_STATE",
            href: "https://github.com/CheickDiakite-yikes/my-ai-companion/blob/main3/docs/PROJECT_STATE.md",
            note: "Current memory hygiene priorities and risk tracking.",
          },
          {
            title: "AGENT_MESSAGE_PURPOSE_BACKFILL",
            href: "https://github.com/CheickDiakite-yikes/my-ai-companion/blob/main3/docs/AGENT_MESSAGE_PURPOSE_BACKFILL.md",
            note: "Historical remediation of mislabeled message-purpose rows.",
          },
          {
            title: "SESSION_LOG",
            href: "https://github.com/CheickDiakite-yikes/my-ai-companion/blob/main3/docs/SESSION_LOG.md",
            note: "Incident chronology for memory and continuity stabilization.",
          },
        ],
      },
    ],
  },
  {
    id: "zeeme-continuity-benchmark-paper-v-2026",
    title: "Research Paper V: Continuity Benchmark",
    subtitle:
      "A benchmark framework for measuring companion continuity across voice and text, with external calibration against long-memory research and mainstream assistant constraints.",
    excerpt:
      "This paper defines ZeeMe's continuity benchmark, maps it to external memory evaluations, and compares companion-critical weaknesses observed in major assistants.",
    publishedAt: "March 4, 2026",
    readTime: "33 min read",
    tags: [
      "Research Paper",
      "Benchmarking",
      "Voice + Text Continuity",
      "Companion Reliability",
      "Competitive Analysis",
    ],
    categories: ["research", "technical"],
    blocks: [
      {
        type: "image",
        src: "/blog/og/zeeme-continuity-benchmark-og.png",
        alt: "Cover plate for Research Paper V continuity benchmark.",
        caption: "Plate V. Continuity benchmark and external calibration framework.",
      },
      {
        type: "meta",
        items: [
          { label: "Paper type", value: "Benchmark design + competitor gap analysis" },
          { label: "Primary question", value: "How do we measure companion continuity in ways that reflect real user trust?" },
          { label: "Test surfaces", value: "Voice-to-text handoff, memory recall, temporal anchoring, and grounded tool retrieval" },
          { label: "External calibration set", value: "LoCoMo, LongMemEval, Lost in the Middle, vendor docs/release notes" },
          { label: "Scope boundary", value: "Companion behavior reliability; not a generalized model IQ benchmark" },
        ],
      },
      { type: "heading", text: "Executive Abstract" },
      {
        type: "paragraph",
        text: "Companion quality degrades fastest at transitions: voice to text, long gaps, and retrieval under uncertainty. Research Paper V introduces a continuity benchmark built around those boundaries rather than broad knowledge accuracy alone. The benchmark combines scenario replay, metric scoring, and forensic trace checks. External literature (LoCoMo, LongMemEval, Lost in the Middle) confirms the same structural risk: long-context and multi-session recall remain fragile, including in advanced commercial systems. The result is a practical standard for shipping companion behavior: if continuity is not measurable, it is not reliable.",
      },
      { type: "heading", text: "1. Why Existing Benchmarks Are Not Enough for Companions" },
      {
        type: "table",
        caption: "Table 1. Benchmark mismatch between general LLM evaluation and companion reliability needs.",
        columns: ["Benchmark class", "What it measures well", "Companion gap that remains"],
        rows: [
          ["General QA/knowledge", "Single-turn factual correctness", "Does not test relationship continuity across sessions and modes"],
          ["Tool-use success", "Whether tools execute and return data", "Does not guarantee legible, emotionally coherent transitions"],
          ["Latency/perf metrics", "Speed and throughput under load", "Misses semantic drift and memory contamination failures"],
          ["Safety-only checks", "Policy compliance under adversarial prompts", "Does not test normal-day trust erosion from subtle inconsistency"],
        ],
      },
      {
        type: "quote",
        text: "Continuity is not one metric. It is the product of memory integrity, transition integrity, temporal integrity, and recovery integrity.",
      },
      { type: "heading", text: "2. External Evidence: What Research Already Shows" },
      {
        type: "table",
        caption: "Table 2. External benchmark findings used to calibrate the continuity framework.",
        columns: ["Source", "Relevant finding", "Implication for companion systems"],
        rows: [
          ["LoCoMo (ACL 2024)", "Long conversation memory evaluation remains difficult even for strong models", "Companions need explicit long-horizon memory controls, not naive transcript replay"],
          ["LongMemEval (ICLR 2025 submission)", "Commercial assistants and long-context LLMs show notable accuracy drops as memory length and distraction rise", "Continuity quality can collapse nonlinearly with context depth"],
          ["Lost in the Middle (TACL 2024)", "Models often underuse relevant information when it appears mid-context", "Memory assembly must prioritize relevance and recency; raw context size alone is insufficient"],
        ],
      },
      {
        type: "paragraph",
        text: "These findings align with production companion incidents: users do not report \"attention index dropped by 30%.\" They report \"you forgot,\" \"you switched tone,\" or \"you contradicted yourself.\" The benchmark therefore translates research risk into user-visible failure classes and contract checks.",
      },
      {
        type: "barChart",
        title:
          "Chart 1. External weakness-pressure map (synthesis, higher = more continuity pressure)",
        unit: "/100",
        max: 100,
        footnote:
          "Heuristic synthesis from LoCoMo, LongMemEval, Lost in the Middle, and public assistant docs. Used for ZeeMe prioritization, not as a vendor scorecard.",
        items: [
          { label: "Long-horizon memory recall", value: 88, color: "#E8B37B" },
          { label: "Voice/text handoff consistency", value: 82, color: "#DFA066" },
          { label: "Grounded retrieval continuity", value: 76, color: "#CD824E" },
          { label: "Temporal reference stability", value: 64, color: "#B86C43" },
        ],
      },
      { type: "heading", text: "3. Competitive Baseline: Companion-Critical Weaknesses in Major Assistants" },
      {
        type: "table",
        caption: "Table 3. Publicly documented constraints relevant to companion continuity.",
        columns: ["Assistant surface", "Documented constraint", "Companion risk"],
        rows: [
          ["OpenAI Voice Mode", "Release notes acknowledge rare voice hallucinations (ads/gibberish/background-audio artifacts) still under remediation", "Audio-side anomalies can break trust even when core answer intent is correct"],
          ["OpenAI Memory", "Memory behavior is configurable and split across saved memories vs referenced chat history with plan/region variability", "Continuity perception can vary by account settings and availability"],
          ["Gemini Workspace integration", "Cross-app context depends on explicit account linking and admin policy allowances", "Companion behavior can appear inconsistent when integration prerequisites differ by environment"],
          ["Gemini activity controls", "History/activity settings affect what can be reused or surfaced in later interactions", "Users can unintentionally disable continuity paths while expecting persistent behavior"],
        ],
      },
      {
        type: "columnChart",
        title: "Chart 3. Companion continuity friction baseline (directional, lower = better)",
        unit: "/100",
        max: 100,
        footnote:
          "Directional synthesis from public docs/release notes plus product behavior spot-checks. Not a controlled vendor lab benchmark.",
        items: [
          {
            label: "ZeeMe (main3)",
            value: 34,
            note: "Internal scenario replay with trace-complete retrieval boundaries.",
            color: "#E8B37B",
          },
          {
            label: "OpenAI ChatGPT",
            value: 57,
            note: "Publicly documented voice/memory constraints and known voice anomaly remediation notes.",
            color: "#DFA066",
          },
          {
            label: "Google Gemini",
            value: 61,
            note: "Continuity can vary by integration, activity, and admin-policy configuration.",
            color: "#CD824E",
          },
          {
            label: "Tolan (snapshot)",
            value: 68,
            note: "Directional external snapshot; full standardized harness run pending.",
            color: "#B86C43",
          },
        ],
      },
      {
        type: "callout",
        title: "Interpretation guardrail",
        text: "This table is not a quality ranking. It maps public product constraints to companion failure risk. The same risk classes apply to ZeeMe and are explicitly benchmarked in this paper.",
      },
      { type: "heading", text: "4. ZeeMe Continuity Benchmark: Metric Definitions" },
      {
        type: "equation",
        expression: "CBI = 0.35*VTHI + 0.25*MRS + 0.20*TGS + 0.20*RRS",
        caption: "Eq. 1. Continuity Benchmark Index (CBI) used for release gating.",
        terms: [
          { symbol: "VTHI", meaning: "Voice-Text Handoff Integrity: semantic and persona continuity after mode switch" },
          { symbol: "MRS", meaning: "Memory Recall Stability: correct retrieval of prior user state over delayed turns" },
          { symbol: "TGS", meaning: "Temporal Grounding Stability: date/time continuity under relative references" },
          { symbol: "RRS", meaning: "Retrieval Reliability Score: grounded email/calendar response correctness + observability completeness" },
        ],
      },
      {
        type: "barChart",
        title: "Chart 2. CBI weight distribution (Eq. 1)",
        unit: "%",
        max: 40,
        footnote: "Fixed benchmark weights used during release gating.",
        items: [
          { label: "VTHI (handoff integrity)", value: 35, color: "#E8B37B" },
          { label: "MRS (memory recall stability)", value: 25, color: "#DFA066" },
          { label: "TGS (temporal grounding stability)", value: 20, color: "#CD824E" },
          { label: "RRS (retrieval reliability)", value: 20, color: "#B86C43" },
        ],
      },
      {
        type: "table",
        caption: "Table 4. Gate thresholds used for candidate release promotion.",
        columns: ["Metric", "Gate threshold", "Block condition"],
        rows: [
          ["VTHI", ">= 0.90", "Any contradiction across voice->text replay in same conversation"],
          ["MRS", ">= 0.88", "Incorrect recall of explicit user facts in benchmark scenarios"],
          ["TGS", ">= 0.95", "Wrong day/date mapping for relative-time prompts"],
          ["RRS", ">= 0.92", "Missing grounded evidence or missing trace chain during retrieval turns"],
        ],
      },
      { type: "heading", text: "5. Scenario Matrix and Failure Classes" },
      {
        type: "table",
        caption: "Table 5. Scenario-driven benchmark matrix.",
        columns: ["Scenario", "Expected outcome", "Failure class"],
        rows: [
          ["Text->voice handoff with prior commitments", "Voice response continues exact context with no reset language", "handoff_drift"],
          ["Voice->text follow-up after interruption", "Text response resumes unresolved thread cleanly", "mode_fragmentation"],
          ["Unread email summary request in live voice", "Grounded summary with tool trace completion", "retrieval_opaque_failure"],
          ["Relative date planning request across midnight boundary", "Stable date interpretation with timezone anchor", "temporal_anchor_miss"],
          ["Reconnect after transient Google failure", "No stale failure phrase contamination in later turns", "memory_contamination"],
        ],
      },
      {
        type: "code",
        language: "text",
        caption: "Listing 1. Required trace chain for retrieval continuity scenarios.",
        code:
          "client: live.google_context.searching\\nclient: live.tool_call.received\\nclient: live.tool_call.forwarding\\nserver: live.tool_response.requested\\nserver: live.tool.emails|calendar.start\\nserver: live.tool.emails|calendar.auth_ok\\nserver: live.tool.emails|calendar.success\\nserver: live.tool_response.generated\\nclient: live.tool_call.responded",
      },
      { type: "heading", text: "6. Harness and Execution Model" },
      {
        type: "ascii",
        text:
          "scenario prompt set\\n  -> deterministic conversation seeds\\n  -> mode transitions (text<->voice)\\n  -> optional tool retrieval turns\\n  -> trace capture + transcript capture\\n  -> scorer (VTHI/MRS/TGS/RRS)\\n  -> release gate decision",
      },
      {
        type: "code",
        language: "bash",
        caption: "Listing 2. Practical benchmark execution chain.",
        code:
          "npm run check\\nnpm run test:google-context:smoke\\nnpm run test:google-context:ui\\nbash script/google-personal-context-playwright-e2e.sh\\n# replay trace IDs for failed scenarios",
      },
      { type: "heading", text: "7. Key Observations from Initial Runs" },
      {
        type: "list",
        items: [
          "Transition quality regressed first when observability regressed; missing trace boundaries preceded user-visible continuity drift.",
          "Raw memory length did not improve outcomes by itself; curated relevance and contamination filtering mattered more.",
          "External benchmark findings on long-context degradation map directly to companion user complaints in production contexts.",
          "Competitor-style constraints (activity toggles, integration prerequisites, voice-mode limitations) can be modeled as deterministic precondition checks in ZeeMe.",
        ],
      },
      {
        type: "metrics",
        items: [
          { label: "Highest risk boundary", value: "Mode transitions", detail: "Most continuity regressions begin at voice/text handoffs." },
          { label: "Highest leverage control", value: "Trace-complete retrieval pipeline", detail: "Fast root-cause isolation prevents repeated blind fixes." },
          { label: "Most fragile external factor", value: "Account/config prerequisites", detail: "Integration and activity settings can silently alter behavior." },
          { label: "Practical benchmark insight", value: "Continuity > one-shot quality", detail: "Users tolerate occasional style variance, not trust-breaking inconsistency." },
        ],
      },
      { type: "heading", text: "8. Replication Pack for Teams Building Companions" },
      {
        type: "list",
        items: [
          "Adopt a continuity index with explicit sub-metrics instead of one aggregate pass/fail score.",
          "Require trace-chain completeness for all benchmark scenarios with retrieval or transition boundaries.",
          "Benchmark against user-visible failure classes (forgetting, contradiction, stale failure carryover).",
          "Treat vendor/platform constraints as test preconditions and make them visible in diagnostics.",
          "Block release when continuity metrics fail even if generic quality metrics remain high.",
        ],
      },
      { type: "heading", text: "References" },
      {
        type: "references",
        items: [
          {
            title: "LoCoMo paper (ACL 2024)",
            href: "https://aclanthology.org/2024.acl-long.747/",
            note: "Long-term conversational memory benchmark and agent evaluation.",
          },
          {
            title: "LoCoMo benchmark repository",
            href: "https://github.com/snap-research/locomo",
            note: "Dataset/task structure and benchmark artifacts.",
          },
          {
            title: "LongMemEval (ICLR 2025 submission)",
            href: "https://openreview.net/forum?id=LFwz8Rzf7T",
            note: "Long-context memory and distraction robustness evaluation.",
          },
          {
            title: "Lost in the Middle (TACL 2024)",
            href: "https://aclanthology.org/2024.tacl-1.9/",
            note: "Position sensitivity in long-context retrieval behavior.",
          },
          {
            title: "OpenAI Voice Mode FAQ",
            href: "https://help.openai.com/en/articles/8400625-voice-mode-faq",
            note: "Voice mode behavior, controls, and operational constraints.",
          },
          {
            title: "OpenAI ChatGPT release notes",
            href: "https://help.openai.com/en/articles/6825453-chatgpt-release-notes",
            note: "Publicly documented known limitations and voice updates.",
          },
          {
            title: "OpenAI Memory FAQ",
            href: "https://help.openai.com/en/articles/8590148-memory-faq",
            note: "Memory model behavior and availability semantics.",
          },
          {
            title: "Gemini Workspace integration announcement",
            href: "https://workspaceupdates.googleblog.com/2025/08/use-gemini-in-google-calendar-gmail-docs-drive-and-more.html",
            note: "Cross-app context capability and rollout constraints.",
          },
          {
            title: "Gemini Apps activity settings help",
            href: "https://support.google.com/gemini/answer/13594961",
            note: "History/activity controls and retention implications.",
          },
          {
            title: "Gemini in Workspace apps (Admin help)",
            href: "https://support.google.com/a/answer/16332595?hl=en-EN",
            note: "Admin controls affecting feature availability.",
          },
        ],
      },
    ],
  },
  {
    id: "zeeme-google-data-handling-security-paper-2026",
    title: "Security Paper: Google Data Handling by Design",
    subtitle:
      "A security and privacy architecture paper on how ZeeMe handles Gmail/Calendar context with scoped access, encryption boundaries, observable execution, and safe failure semantics.",
    excerpt:
      "This paper explains the end-to-end control model for Google personal context in ZeeMe: OAuth scope minimization, key management, token hygiene, traceability, and policy-by-design controls.",
    publishedAt: "March 4, 2026",
    readTime: "35 min read",
    tags: [
      "Security Paper",
      "Google OAuth",
      "Privacy Engineering",
      "GCP Operations",
      "Data Handling",
    ],
    categories: ["research", "trust", "technical"],
    blocks: [
      {
        type: "image",
        src: "/blog/og/zeeme-google-data-handling-security-og.png",
        alt: "Cover plate for ZeeMe Google data handling security paper.",
        caption: "Security Plate I. Google data handling controls and threat model.",
      },
      {
        type: "meta",
        items: [
          { label: "Paper type", value: "Applied security architecture and operations paper" },
          { label: "Protection scope", value: "OAuth credentials, access tokens, refresh lifecycle, retrieval traces, and user-facing failure states" },
          { label: "Threat classes", value: "Over-scope access, token misuse, callback drift, opaque failures, data retention ambiguity" },
          { label: "Control surfaces", value: "Connect URL generation, callback verification, encrypted secret storage, live tool response pipeline" },
          { label: "Policy anchors", value: "Google API Services User Data Policy + internal least-privilege standards" },
        ],
      },
      { type: "heading", text: "Executive Abstract" },
      {
        type: "paragraph",
        text: "Google-context features (email and calendar) are valuable only when users can trust their boundaries. ZeeMe's model is \"secure by default, observable by default\": request the minimum scopes, keep OAuth callback resolution deterministic across environments, encrypt integration secrets, and emit typed traces at each boundary. This paper documents the control plane in detail, including failure classification and what users should see when something is wrong. The central principle is that privacy and reliability are linked: if operators cannot diagnose failures precisely, teams compensate with broad access or vague messaging, both of which erode trust.",
      },
      { type: "heading", text: "1. Data Handling Objectives and Non-Negotiables" },
      {
        type: "table",
        caption: "Table 1. Security objectives for personal-context retrieval.",
        columns: ["Objective", "Design rule", "Failure consequence if absent"],
        rows: [
          ["Least privilege", "Only request read-only Gmail/Calendar scopes required for user asks", "Over-broad blast radius and policy risk"],
          ["Deterministic auth routing", "Bind callback host/redirect strategy explicitly in state", "Intermittent auth failures and token confusion"],
          ["Encrypted secret handling", "Never persist OAuth secrets or tokens in plaintext", "Credential exposure risk"],
          ["Traceable execution", "Emit typed traces from request to response generation", "Opaque errors and slow incident response"],
          ["Safe degradation", "Return explicit user-safe failure codes, never fabricated data", "Trust loss and unsafe behavior under fault"],
        ],
      },
      {
        type: "callout",
        title: "Control philosophy",
        text: "The safest data is data never fetched unnecessarily. The second safest is data fetched with minimal scope and immediately wrapped in auditable execution context.",
      },
      { type: "heading", text: "2. End-to-End Security Architecture" },
      {
        type: "ascii",
        text:
          "User intent (voice/text)\\n  -> gate + scope check\\n  -> /api/integrations/google/connect-url (state-bound redirect selection)\\n  -> Google OAuth callback exchange\\n  -> encrypted token persistence\\n  -> /api/live/tool-response or chat path retrieval\\n  -> classified success/failure + traceId\\n  -> user response (grounded or explicit degraded mode)",
      },
      {
        type: "table",
        caption: "Table 2. Boundary ownership and security controls.",
        columns: ["Boundary", "Primary control", "Audit signal"],
        rows: [
          ["Connect URL generation", "Redirect URI source classification + state token issuance", "`google.integration.connect_url.created`"],
          ["OAuth callback", "State validation + deterministic token exchange", "`google.integration.callback.exchange_attempt` / `connected`"],
          ["Integration storage", "Encryption key health checks + encrypted payload handling", "Startup key preflight and integration status logs"],
          ["Live retrieval execution", "Per-tool auth checks + issue classification", "`live.tool.*` traces and issueKind classification"],
          ["Response synthesis", "Function response grounding + explicit failure surface", "`live.tool_response.generated` with trace references"],
        ],
      },
      { type: "heading", text: "3. Scope and Access Design" },
      {
        type: "table",
        caption: "Table 3. OAuth scope minimization strategy.",
        columns: ["Scope", "Why requested", "Why this is constrained"],
        rows: [
          ["`gmail.readonly`", "Summarize unread/recent inbox messages on explicit user request", "No send/edit/delete capability"],
          ["`calendar.events.readonly`", "Retrieve upcoming events and schedule context on explicit user request", "No create/update/delete capability"],
          ["`openid email profile`", "Associate Google identity with ZeeMe user account", "Identity linkage only; no mailbox/calendar write rights"],
        ],
      },
      {
        type: "paragraph",
        text: "Scopes are intentionally narrow so that feature growth requires explicit policy decisions. Security review remains tractable because every added scope introduces an explicit product justification and threat-model delta.",
      },
      { type: "heading", text: "4. Threat Model and Mitigations" },
      {
        type: "table",
        caption: "Table 4. Core threat classes and mitigation posture.",
        columns: ["Threat class", "Attack / failure path", "Mitigation"],
        rows: [
          ["Callback host drift", "Token exchange fails or resolves on unintended host", "Dynamic callback resolution with state-bound redirect metadata"],
          ["Token misuse / key misconfig", "Stored integration unusable or decrypt fails", "Encryption key preflight checks + health diagnostics"],
          ["Silent fetch failure", "Assistant gives vague or misleading response", "Issue classification (`api_disabled`, `access_denied`, `timeout`) + trace IDs"],
          ["Over-collection pressure", "Feature creep increases data exposure", "Read-only scopes + request-by-intent retrieval path only"],
          ["Context poisoning from old failures", "Past error phrasing leaks into future interactions", "Purpose-based exclusions + contamination filters in context assembly"],
        ],
      },
      { type: "heading", text: "5. Observability as a Security Control" },
      {
        type: "code",
        language: "text",
        caption: "Listing 1. Security-relevant trace progression for live email retrieval.",
        code:
          "google.integration.connect_url.created\\ngoogle.integration.callback.exchange_attempt\\ngoogle.integration.callback.connected\\nlive.tool_response.requested\\nlive.tool.emails.start\\nlive.tool.emails.auth_ok\\nlive.tool.emails.success | live.tool.emails.failed\\nlive.tool_response.generated",
      },
      {
        type: "paragraph",
        text: "Typed trace progression reduces both user harm and operator error. It prevents \"guess-driven\" support responses and limits the temptation to broaden access simply to debug unknown failures. Observability therefore acts as a direct privacy control by reducing operational overreach.",
      },
      { type: "heading", text: "6. Policy and User-Control Alignment" },
      {
        type: "table",
        caption: "Table 5. Policy anchors mapped to implementation behavior.",
        columns: ["Policy expectation", "Implementation alignment", "User-visible behavior"],
        rows: [
          ["Google API data used only for declared user-facing features", "Retrieval happens only on explicit email/calendar intent paths", "No background autonomous scraping behavior"],
          ["Clear data controls and account linkage transparency", "Integration status + disconnect flow exposed in profile", "Users can revoke connection and stop future retrievals"],
          ["Avoid opaque retention/usage assumptions", "Activity and history requirements documented in product and support paths", "Users can reason about why continuity may differ by setting"],
          ["Explicit safe failure over fabricated certainty", "Classified error codes and degraded-mode responses", "User gets actionable next step instead of false confidence"],
        ],
      },
      {
        type: "heading",
        text: "7. Comparison to Common Companion Failure Patterns",
      },
      {
        type: "list",
        items: [
          "Pattern: assistant appears confident but has no valid retrieval result. ZeeMe control: explicit tool trace + issue code before synthesis.",
          "Pattern: environment-specific OAuth breakage in preview hosts. ZeeMe control: deterministic redirect source tracking and state binding.",
          "Pattern: user toggles history/settings and continuity silently changes. ZeeMe control: surfaced integration/status diagnostics and explicit reconnect guidance.",
          "Pattern: debugging requires broadening permissions. ZeeMe control: narrow scopes plus richer telemetry instead of privilege expansion.",
        ],
      },
      {
        type: "metrics",
        items: [
          { label: "Most important control", value: "Scope minimization + explicit intent gating", detail: "Prevents unnecessary access and narrows blast radius." },
          { label: "Most important operations control", value: "Typed trace chain", detail: "Turns ambiguous outages into bounded fix paths." },
          { label: "Highest trust-risk failure", value: "Fabricated certainty under fetch failure", detail: "Mitigated with strict safe-failure semantics." },
          { label: "Design principle", value: "Security and continuity are coupled", detail: "Reliable boundaries improve both privacy and companion trust." },
        ],
      },
      { type: "heading", text: "8. Implementation Checklist (Portable to Other Teams)" },
      {
        type: "list",
        items: [
          "Use read-only scopes first; require explicit review for any write scope introduction.",
          "Treat OAuth callback host selection as a first-class reliability/security contract.",
          "Encrypt integration secrets and fail fast when key health is invalid.",
          "Emit boundary traces for connect, callback, auth, fetch, and synthesis.",
          "Classify errors into user-actionable issue kinds and expose trace IDs for support.",
          "Filter stale operational failure language from future context assembly.",
        ],
      },
      { type: "heading", text: "References" },
      {
        type: "references",
        items: [
          {
            title: "Google API Services User Data Policy",
            href: "https://developers.google.com/terms/api-services-user-data-policy",
            note: "Policy baseline for usage and transfer of Google API data.",
          },
          {
            title: "Google OAuth 2.0 for APIs",
            href: "https://developers.google.com/identity/protocols/oauth2",
            note: "OAuth protocol guidance and implementation standards.",
          },
          {
            title: "Gemini in Workspace apps (Admin help)",
            href: "https://support.google.com/a/answer/16332595?hl=en-EN",
            note: "Admin controls and feature availability requirements.",
          },
          {
            title: "Gemini Apps activity settings",
            href: "https://support.google.com/gemini/answer/13594961",
            note: "History/activity controls and retention context.",
          },
          {
            title: "Google privacy hub: Gemini for Workspace",
            href: "https://privacy.google.com/businesses/gemini/",
            note: "Data usage, review, and privacy posture statements.",
          },
          {
            title: "OpenAI ChatGPT release notes",
            href: "https://help.openai.com/en/articles/6825453-chatgpt-release-notes",
            note: "Publicly documented voice-mode known limitations and remediation notes.",
          },
          {
            title: "ZeeMe Field Report IV",
            href: "/blog/zeeme-google-context-gcp-field-report-2026",
            note: "System-level expansion report and incident remediations.",
          },
          {
            title: "ZeeMe Google Personal Context Tracker",
            href: "https://github.com/CheickDiakite-yikes/my-ai-companion/blob/main3/docs/GOOGLE_PERSONAL_CONTEXT_TRACKER.md",
            note: "Operational tracker for integration behavior and fixes.",
          },
        ],
      },
    ],
  },
];

const BLOG_FEATURED_ID = "a-day-with-zee-2026" as const;
const BLOG_PIN_ORDER = [
  "a-day-with-zee-2026",
  "zee-stage-missing-interface-2026",
  "truthful-approval-2026",
  "voice-real-life-2026",
  "gmail-calendar-native-2026",
  "companion-economics-2026",
  "oauth-in-the-wild-2026",
  "continuity-is-the-product-2026",
  "hidden-reliability-layer-2026",
  "private-by-design-2026",
  "meet-zee-2026",
  "zeeme-google-context-gcp-field-report-2026",
  "zeeme-continuity-benchmark-paper-v-2026",
  "zeeme-platform-thesis-2026",
  "zeeme-engineering-case-study-2026",
  "zeeme-memory-lab-paper-2026",
  "zeeme-google-data-handling-security-paper-2026",
] as const;

const BLOG_ARCHIVE_FILTERS: BlogArchiveFilter[] = [
  {
    id: "all",
    label: "All",
    leadLabel: "Featured Story",
    description: "Everything in the journal.",
  },
  {
    id: "marketing",
    label: "Marketing",
    leadLabel: "Marketing Pick",
    description: "Narrative, launch, and conversion-focused storytelling.",
  },
  {
    id: "product",
    label: "Product",
    leadLabel: "Product Pick",
    description: "Feature strategy, companion UX, and product design thinking.",
  },
  {
    id: "technical",
    label: "Technical",
    leadLabel: "Technical Pick",
    description: "Architecture, debugging, systems behavior, and builder lessons.",
  },
  {
    id: "research",
    label: "Research",
    leadLabel: "Research Pick",
    description: "Long-form papers, benchmark thinking, and technical frameworks.",
  },
  {
    id: "trust",
    label: "Trust",
    leadLabel: "Trust Pick",
    description: "Privacy, security, safety boundaries, and truthful product behavior.",
  },
  {
    id: "reports",
    label: "Reports",
    leadLabel: "Report Pick",
    description: "Field reports, case studies, and operational retrospectives.",
  },
  {
    id: "launches",
    label: "Launches",
    leadLabel: "Launch Pick",
    description: "Launch stories, release moments, and major public updates.",
  },
];

function normalizeBlogArchiveFilterId(raw: string | null): BlogArchiveFilterId {
  if (!raw) return "all";
  const normalized = raw.trim().toLowerCase();
  return BLOG_ARCHIVE_FILTERS.some((filter) => filter.id === normalized)
    ? (normalized as BlogArchiveFilterId)
    : "all";
}

function getBlogCoverBlock(post: BlogPost): Extract<BlogPostBlock, { type: "image" }> | null {
  const cover = post.blocks.find((block): block is Extract<BlogPostBlock, { type: "image" }> => block.type === "image");
  return cover ?? null;
}

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

function UseCaseStoryCard({
  story,
  index,
}: {
  story: LandingUseCaseStory;
  index: number;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: cardRef,
    offset: ["start 90%", "center 45%"],
  });
  const y = useTransform(scrollYProgress, [0, 1], [40, 0]);
  const opacity = useTransform(scrollYProgress, [0, 0.35, 1], [0, 0.55, 1]);
  const scale = useTransform(scrollYProgress, [0, 1], [0.95, 1]);
  const imageScale = useTransform(scrollYProgress, [0, 1], [1.07, 1]);
  const imageY = useTransform(scrollYProgress, [0, 1], [18, 0]);

  const Icon = story.icon;

  return (
    <motion.article
      ref={cardRef}
      className="relative rounded-none overflow-hidden border backdrop-blur-md"
      style={{
        y,
        opacity,
        scale,
        borderColor: "rgba(255, 224, 190, 0.16)",
        background:
          "linear-gradient(165deg, rgba(255, 219, 183, 0.08), rgba(255, 188, 151, 0.05))",
      }}
      data-testid={`use-case-story-${story.id}`}
    >
      <div
        className="absolute inset-x-10 top-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(255, 219, 183, 0.35), transparent)",
        }}
      />
      <div className="relative overflow-hidden border-b" style={{ borderColor: "rgba(255, 224, 190, 0.14)" }}>
        <motion.img
          src={story.imageSrc}
          alt={story.imageAlt}
          style={{ scale: imageScale, y: imageY }}
          className="w-full h-[220px] md:h-[260px] object-cover"
          loading="lazy"
        />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "linear-gradient(180deg, rgba(24, 14, 14, 0.05) 0%, rgba(24, 14, 14, 0.44) 80%, rgba(24, 14, 14, 0.66) 100%)",
          }}
        />
        <div className="absolute left-5 bottom-5 flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-[0.8rem] flex items-center justify-center"
            style={{
              background: "rgba(255, 228, 199, 0.18)",
              border: "1px solid rgba(255, 231, 203, 0.42)",
              color: "#FFEBCF",
            }}
          >
            <Icon className="w-5 h-5" />
          </div>
          <span
            className="text-[10px] tracking-[0.28em] uppercase"
            style={{ color: "rgba(255, 226, 198, 0.78)" }}
          >
            {story.label}
          </span>
        </div>
      </div>

      <div className="p-6 md:p-7">
        <div className="flex items-start justify-between gap-4 mb-3">
          <h3
            className="text-[1.55rem] md:text-[1.8rem] leading-[1.1] font-semibold tracking-tight"
            style={{ color: "#FFEED8", fontFamily: "'Fraunces', serif" }}
          >
            {story.title}
          </h3>
          <span
            className="text-sm shrink-0 pt-1"
            style={{ color: "rgba(255, 220, 187, 0.5)", fontFamily: "'Fraunces', serif" }}
          >
            0{index + 1}
          </span>
        </div>

        <p className="text-[15px] leading-[1.8] mb-5" style={{ color: "rgba(255, 228, 202, 0.74)" }}>
          {story.description}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          {story.bullets.map((bullet) => (
            <div
              key={bullet}
              className="rounded-none px-3.5 py-2.5 text-[13px] leading-[1.5]"
              style={{
                background: "rgba(255, 221, 188, 0.07)",
                border: "1px solid rgba(255, 223, 186, 0.13)",
                color: "rgba(255, 230, 206, 0.75)",
              }}
            >
              {bullet}
            </div>
          ))}
        </div>
      </div>
    </motion.article>
  );
}

function UseCaseScrollySection({ stories }: { stories: LandingUseCaseStory[] }) {
  const timelineRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: timelineRef,
    offset: ["start 80%", "end 25%"],
  });
  const railScale = useTransform(scrollYProgress, [0, 1], [0, 1]);
  const glowOpacity = useTransform(scrollYProgress, [0, 0.4, 1], [0.2, 0.6, 0.95]);

  return (
    <section className="px-6 py-28 relative overflow-hidden">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at 20% 30%, rgba(161, 95, 63, 0.22), transparent 58%), radial-gradient(ellipse at 82% 52%, rgba(108, 66, 56, 0.2), transparent 62%)",
        }}
      />
      <div className="max-w-6xl mx-auto relative">
        <div className="grid grid-cols-1 lg:grid-cols-[0.9fr_1.1fr] gap-10 lg:gap-14">
          <div className="lg:sticky lg:top-28 self-start">
            <RevealSection>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-px" style={{ background: "rgba(255, 217, 183, 0.28)" }} />
                <span className="text-[11px] tracking-[0.35em] uppercase" style={{ color: "rgba(255, 214, 172, 0.45)" }}>
                  III
                </span>
              </div>
              <h2
                className="text-3xl md:text-[3.1rem] leading-[1.05] font-semibold tracking-tight mb-4"
                style={{ color: "#FFEFD8", fontFamily: "'Fraunces', serif" }}
              >
                Your bestie<br />
                with benefits
              </h2>
              <p
                className="text-[16px] leading-[1.9] max-w-md mb-6"
                style={{ color: "rgba(255, 226, 198, 0.7)" }}
              >
                Zee now blends emotional presence with practical power: inbox and calendar context, grounded web help, and camera-aware guidance while keeping one private continuity thread.
              </p>
              <div className="flex flex-wrap gap-2.5 mb-6">
                {["Gmail + Calendar", "Grounded Web Search", "Camera Assist", "Voice + Text Continuity"].map((chip) => (
                  <span
                    key={chip}
                    className="px-3 py-1.5 text-[11px] tracking-[0.2em] uppercase"
                    style={{
                      color: "rgba(255, 226, 198, 0.65)",
                      border: "1px solid rgba(255, 223, 186, 0.18)",
                      background: "rgba(255, 221, 188, 0.06)",
                    }}
                  >
                    {chip}
                  </span>
                ))}
              </div>
              <p
                className="text-sm italic"
                style={{ color: "rgba(255, 219, 189, 0.5)", fontFamily: "'Fraunces', serif" }}
              >
                Privacy-first by design. Useful like an executive assistant. Warm like your favorite person.
              </p>
            </RevealSection>
          </div>

          <div ref={timelineRef} className="relative pl-7 md:pl-9 space-y-8 md:space-y-10">
            <div className="absolute left-0 top-2 bottom-2 w-px" style={{ background: "rgba(255, 214, 172, 0.1)" }} />
            <motion.div
              className="absolute left-0 top-2 bottom-2 w-px origin-top"
              style={{
                scaleY: railScale,
                opacity: glowOpacity,
                background:
                  "linear-gradient(180deg, rgba(255, 214, 172, 0.65), rgba(255, 200, 151, 0.45), rgba(255, 214, 172, 0.08))",
              }}
            />
            {stories.map((story, index) => (
              <UseCaseStoryCard key={story.id} story={story} index={index} />
            ))}
          </div>
        </div>
      </div>
    </section>
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
  const [activeBlogPostId, setActiveBlogPostId] = useState<string | null>(null);
  const [activeBlogFilter, setActiveBlogFilter] =
    useState<BlogArchiveFilterId>("all");
  const [shareNotice, setShareNotice] = useState<string | null>(null);

  const activeBlogPost =
    page === "blog"
      ? BLOG_POSTS.find((post) => post.id === activeBlogPostId) ?? null
      : null;
  const orderedBlogPosts = useMemo(() => {
    const pinIndex = new Map<string, number>(
      BLOG_PIN_ORDER.map((id, idx) => [id, idx]),
    );
    return [...BLOG_POSTS].sort((a, b) => {
      const aPin = pinIndex.get(a.id);
      const bPin = pinIndex.get(b.id);
      if (aPin === undefined && bPin === undefined) return 0;
      if (aPin === undefined) return 1;
      if (bPin === undefined) return -1;
      return aPin - bPin;
    });
  }, []);
  const activeBlogFilterMeta = useMemo(
    () =>
      BLOG_ARCHIVE_FILTERS.find((filter) => filter.id === activeBlogFilter) ??
      BLOG_ARCHIVE_FILTERS[0],
    [activeBlogFilter],
  );
  const blogFilterCounts = useMemo(() => {
    const counts = new Map<BlogArchiveFilterId, number>();
    BLOG_ARCHIVE_FILTERS.forEach((filter) => {
      counts.set(
        filter.id,
        filter.id === "all"
          ? orderedBlogPosts.length
          : orderedBlogPosts.filter((post) =>
              post.categories.includes(
                filter.id as Exclude<BlogArchiveFilterId, "all">,
              ),
            ).length,
      );
    });
    return counts;
  }, [orderedBlogPosts]);
  const filteredBlogPosts = useMemo(() => {
    if (page !== "blog") return [];
    if (activeBlogFilter === "all") return orderedBlogPosts;
    return orderedBlogPosts.filter((post) =>
      post.categories.includes(activeBlogFilter),
    );
  }, [page, orderedBlogPosts, activeBlogFilter]);
  const archiveLeadBlogPost =
    page === "blog"
      ? activeBlogFilter === "all"
        ? orderedBlogPosts.find((post) => post.id === BLOG_FEATURED_ID) ??
          filteredBlogPosts[0] ??
          null
        : filteredBlogPosts[0] ?? null
      : null;
  const archiveSecondaryBlogPosts =
    page === "blog"
      ? filteredBlogPosts.filter((post) => post.id !== archiveLeadBlogPost?.id)
      : [];
  const activeBlogSections = useMemo(() => {
    if (!activeBlogPost) return [];
    let index = 0;
    return activeBlogPost.blocks
      .filter((block): block is Extract<BlogPostBlock, { type: "heading" }> => block.type === "heading")
      .map((block) => {
        index += 1;
        const slug = block.text
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "");
        return {
          index,
          text: block.text,
          id: `${activeBlogPost.id}-section-${index}-${slug || "section"}`,
        };
      });
  }, [activeBlogPost]);

  useEffect(() => {
    if (page !== "blog") {
      setActiveBlogPostId(null);
      setActiveBlogFilter("all");
      setShareNotice(null);
    }
  }, [page]);

  useEffect(() => {
    if (page !== "blog" || typeof window === "undefined") return;
    const url = new URL(window.location.href);
    setActiveBlogFilter(
      normalizeBlogArchiveFilterId(url.searchParams.get("category")),
    );
    const pathname = window.location.pathname.replace(/\/+$/, "") || "/";
    if (!pathname.startsWith("/blog/")) {
      setActiveBlogPostId(null);
      return;
    }
    const deepLinkedPostId = decodeURIComponent(pathname.slice("/blog/".length));
    const exists = BLOG_POSTS.some((post) => post.id === deepLinkedPostId);
    setActiveBlogPostId(exists ? deepLinkedPostId : null);
  }, [page]);

  useEffect(() => {
    if (page !== "blog" || typeof window === "undefined") return;
    const currentHref = `${window.location.pathname}${window.location.search}`;
    const url = new URL(window.location.href);
    const nextPath = activeBlogPostId
      ? `/blog/${encodeURIComponent(activeBlogPostId)}`
      : "/blog";
    if (activeBlogFilter === "all") {
      url.searchParams.delete("category");
    } else {
      url.searchParams.set("category", activeBlogFilter);
    }
    const nextSearch = url.searchParams.toString();
    const nextHref = `${nextPath}${nextSearch ? `?${nextSearch}` : ""}`;
    if (currentHref !== nextHref) {
      window.history.replaceState({}, "", nextHref);
    }
  }, [page, activeBlogPostId, activeBlogFilter]);

  useEffect(() => {
    if (!shareNotice) return;
    const timeout = window.setTimeout(() => setShareNotice(null), 1800);
    return () => window.clearTimeout(timeout);
  }, [shareNotice]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (page === "blog" && activeBlogPost) {
      const canonicalPath = `/blog/${encodeURIComponent(activeBlogPost.id)}`;
      const coverBlock = getBlogCoverBlock(activeBlogPost);
      const imageUrl = coverBlock?.src
        ? buildMarketingAbsoluteUrl(coverBlock.src)
        : MARKETING_DEFAULT_IMAGE_URL;
      const publishedIso = parsePublishedAtToIso(activeBlogPost.publishedAt);
      applyMarketingMeta({
        title: `${activeBlogPost.title} | ZeeMe Blog`,
        description: activeBlogPost.excerpt,
        path: canonicalPath,
        ogType: "article",
        imageUrl,
        articlePublishedTime: publishedIso,
        pageSchema: {
          "@context": "https://schema.org",
          "@type": "WebPage",
          name: activeBlogPost.title,
          description: activeBlogPost.excerpt,
          url: buildMarketingAbsoluteUrl(canonicalPath),
          isPartOf: {
            "@type": "WebSite",
            name: "ZeeMe",
            url: MARKETING_SITE_ORIGIN,
          },
        },
        blogPostingSchema: {
          "@context": "https://schema.org",
          "@type": "BlogPosting",
          headline: activeBlogPost.title,
          description: activeBlogPost.excerpt,
          image: [imageUrl],
          author: {
            "@type": "Organization",
            name: "ZeeMe",
          },
          publisher: {
            "@type": "Organization",
            name: "ZeeMe",
            logo: {
              "@type": "ImageObject",
              url: `${MARKETING_SITE_ORIGIN}/icon-512.png`,
            },
          },
          mainEntityOfPage: buildMarketingAbsoluteUrl(canonicalPath),
          url: buildMarketingAbsoluteUrl(canonicalPath),
          keywords: activeBlogPost.tags.join(", "),
          ...(publishedIso ? { datePublished: publishedIso } : {}),
        },
      });
      return;
    }

    if (page === "blog") {
      applyMarketingMeta({
        title: "ZeeMe Blog | AI Companion, Voice, Reliability, and Product Thinking",
        description:
          "Read ZeeMe writing on AI companions, live voice reliability, Gmail and Calendar flows, privacy, continuity, and product design.",
        path: "/blog",
        pageSchema: {
          "@context": "https://schema.org",
          "@type": "Blog",
          name: "ZeeMe Blog",
          description:
            "ZeeMe writes about AI companions, voice reliability, continuity, privacy, Gmail and Calendar flows, and product thinking.",
          url: buildMarketingAbsoluteUrl("/blog"),
          publisher: {
            "@type": "Organization",
            name: "ZeeMe",
            url: MARKETING_SITE_ORIGIN,
          },
          blogPost: BLOG_POSTS.slice(0, 8).map((post) => ({
            "@type": "BlogPosting",
            headline: post.title,
            url: buildMarketingAbsoluteUrl(`/blog/${encodeURIComponent(post.id)}`),
          })),
        },
        blogPostingSchema: null,
      });
      return;
    }

    const metaByPage: Record<Exclude<InfoPageId, "blog">, MarketingMetaConfig> = {
      about: {
        title: "About ZeeMe | AI Companion for Life, Work, and Continuity",
        description:
          "Learn how ZeeMe is building an AI companion focused on warmth, continuity, trust, and practical everyday help.",
        path: "/about",
        pageSchema: {
          "@context": "https://schema.org",
          "@type": "AboutPage",
          name: "About ZeeMe",
          description:
            "Background, mission, and product philosophy for ZeeMe, an AI companion focused on trust, continuity, and everyday usefulness.",
          url: buildMarketingAbsoluteUrl("/about"),
          about: {
            "@type": "Organization",
            name: "ZeeMe",
            url: MARKETING_SITE_ORIGIN,
          },
        },
      },
      privacy: {
        title: "Privacy Policy | ZeeMe",
        description:
          "Read ZeeMe's public privacy policy covering data handling, account information, Google integrations, and security boundaries.",
        path: "/privacy",
        pageSchema: {
          "@context": "https://schema.org",
          "@type": "WebPage",
          name: "ZeeMe Privacy Policy",
          description:
            "Public privacy policy for ZeeMe covering account data, Google integrations, storage boundaries, and user control.",
          url: buildMarketingAbsoluteUrl("/privacy"),
        },
      },
      terms: {
        title: "Terms of Service | ZeeMe",
        description:
          "Read ZeeMe's public terms of service, acceptable use rules, Google integration boundaries, and platform disclaimers.",
        path: "/terms",
        pageSchema: {
          "@context": "https://schema.org",
          "@type": "WebPage",
          name: "ZeeMe Terms of Service",
          description:
            "Public terms of service for ZeeMe covering eligibility, acceptable use, Google integrations, and platform boundaries.",
          url: buildMarketingAbsoluteUrl("/terms"),
        },
      },
    };

    applyMarketingMeta({
      ...metaByPage[page],
      blogPostingSchema: null,
    });
  }, [page, activeBlogPost]);

  const handleShareBlogPost = async (post: BlogPost) => {
    const shareUrl =
      typeof window !== "undefined"
        ? `${window.location.origin}/blog/${encodeURIComponent(post.id)}`
        : `/blog/${post.id}`;
    const sharePayload = {
      title: post.title,
      text: post.subtitle,
      url: shareUrl,
    };

    try {
      if (navigator.share) {
        await navigator.share(sharePayload);
        setShareNotice("Shared.");
        return;
      }
      await navigator.clipboard.writeText(shareUrl);
      setShareNotice("Link copied.");
    } catch {
      setShareNotice("Share not available.");
    }
  };

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
            className="max-w-3xl mx-auto flex items-center justify-between rounded-none px-4 py-2.5 backdrop-blur-xl border"
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
              className="flex items-center gap-2 px-4 py-1.5 rounded-none text-sm font-medium transition-all hover:scale-105"
              style={{
                color: "#FFE2BE",
                background: "rgba(255, 206, 158, 0.06)",
                border: "1px solid rgba(255, 217, 172, 0.22)",
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
            activeBlogPost ? (
              <motion.article
                key={activeBlogPost.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                className="mx-auto max-w-3xl"
              >
                <div className="mb-6 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setActiveBlogPostId(null)}
                    className="rounded-none border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em]"
                    style={{
                      borderColor: "rgba(255, 217, 172, 0.22)",
                      color: "rgba(255, 220, 188, 0.76)",
                      background: "rgba(255, 206, 158, 0.04)",
                    }}
                  >
                    Back to stories
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleShareBlogPost(activeBlogPost)}
                    className="inline-flex items-center gap-2 rounded-none border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em]"
                    style={{
                      borderColor: "rgba(255, 217, 172, 0.22)",
                      color: "rgba(255, 220, 188, 0.76)",
                      background: "rgba(255, 206, 158, 0.04)",
                    }}
                  >
                    <Share2 className="h-3.5 w-3.5" />
                    Share
                  </button>
                </div>

                {shareNotice && (
                  <p
                    className="mb-4 text-xs font-medium uppercase tracking-[0.2em]"
                    style={{ color: "rgba(255, 214, 172, 0.62)" }}
                  >
                    {shareNotice}
                  </p>
                )}

                <header className="mb-8 border-b pb-7" style={{ borderColor: "rgba(255, 220, 188, 0.12)" }}>
                  <p
                    className="mb-3 text-[11px] tracking-[0.28em] uppercase"
                    style={{ color: "rgba(255, 214, 172, 0.44)" }}
                  >
                    {activeBlogPost.publishedAt} · {activeBlogPost.readTime}
                  </p>
                  <h2
                    className="text-[2rem] md:text-[2.45rem] leading-[1.15] tracking-tight"
                    style={{ color: "#FFEED8", fontFamily: "'Fraunces', serif" }}
                  >
                    {activeBlogPost.title}
                  </h2>
                  <p
                    className="mt-4 text-[1.05rem] leading-relaxed"
                    style={{ color: "rgba(255, 226, 198, 0.7)" }}
                  >
                    {activeBlogPost.subtitle}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {activeBlogPost.tags.map((tag) => (
                      <span
                        key={`${activeBlogPost.id}-${tag}`}
                        className="rounded-none border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]"
                        style={{
                          borderColor: "rgba(255, 217, 172, 0.16)",
                          color: "rgba(255, 214, 172, 0.66)",
                          background: "rgba(255, 206, 158, 0.03)",
                        }}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </header>

                {activeBlogSections.length > 0 && (
                  <nav
                    className="mb-10 border-l pl-4 pr-1 py-1"
                    style={{
                      borderColor: "rgba(255, 217, 172, 0.28)",
                    }}
                  >
                    <p
                      className="mb-3 text-[11px] font-semibold uppercase tracking-[0.22em]"
                      style={{ color: "rgba(255, 214, 172, 0.64)" }}
                    >
                      Contents
                    </p>
                    <ol className="space-y-2.5">
                      {activeBlogSections.map((section) => (
                        <li key={section.id}>
                          <a
                            href={`#${section.id}`}
                            className="text-[15px] leading-relaxed transition-colors hover:underline underline-offset-4"
                            style={{ color: "rgba(255, 224, 196, 0.8)" }}
                          >
                            {section.index}. {section.text}
                          </a>
                        </li>
                      ))}
                    </ol>
                  </nav>
                )}

                <div className="space-y-6">
                  {(() => {
                    let headingRenderIndex = 0;
                    return activeBlogPost.blocks.map((block, idx) => {
                    if (block.type === "heading") {
                      const sectionAnchor = activeBlogSections[headingRenderIndex];
                      headingRenderIndex += 1;
                      return (
                        <h3
                          key={`${activeBlogPost.id}-heading-${idx}`}
                          id={sectionAnchor?.id}
                          className="pt-2 text-[1.45rem] md:text-[1.6rem]"
                          style={{ color: "#FFE9CF", fontFamily: "'Fraunces', serif" }}
                        >
                          {sectionAnchor ? `${sectionAnchor.index}. ${block.text}` : block.text}
                        </h3>
                      );
                    }
                    if (block.type === "paragraph") {
                      return (
                        <p
                          key={`${activeBlogPost.id}-paragraph-${idx}`}
                          className="text-[15px] leading-[1.95]"
                          style={{ color: "rgba(255, 224, 196, 0.76)" }}
                        >
                          {block.text}
                        </p>
                      );
                    }
                    if (block.type === "meta") {
                      return (
                        <div
                          key={`${activeBlogPost.id}-meta-${idx}`}
                          className="border-y py-1"
                          style={{
                            borderColor: "rgba(255, 217, 172, 0.22)",
                          }}
                        >
                          {block.items.map((item, itemIndex) => (
                            <div
                              key={`${activeBlogPost.id}-meta-${idx}-${item.label}`}
                              className="flex items-start gap-3 px-1 py-2.5"
                              style={
                                itemIndex > 0
                                  ? { borderTop: "1px solid rgba(255, 217, 172, 0.12)" }
                                  : undefined
                              }
                            >
                              <p
                                className="w-[34%] text-[10px] font-semibold uppercase tracking-[0.22em]"
                                style={{ color: "rgba(255, 214, 172, 0.6)" }}
                              >
                                {item.label}
                              </p>
                              <p
                                className="flex-1 text-[13px] leading-relaxed"
                                style={{ color: "rgba(255, 224, 196, 0.82)" }}
                              >
                                {item.value}
                              </p>
                            </div>
                          ))}
                        </div>
                      );
                    }
                    if (block.type === "callout") {
                      return (
                        <aside
                          key={`${activeBlogPost.id}-callout-${idx}`}
                          className="border-l-2 pl-5 pr-1 py-2"
                          style={{
                            borderColor: "rgba(255, 217, 172, 0.28)",
                          }}
                        >
                          <p
                            className="text-[11px] font-semibold uppercase tracking-[0.2em]"
                            style={{ color: "rgba(255, 214, 172, 0.72)" }}
                          >
                            {block.title}
                          </p>
                          <p
                            className="mt-2 text-[14.5px] leading-[1.88]"
                            style={{ color: "rgba(255, 224, 196, 0.8)" }}
                          >
                            {block.text}
                          </p>
                        </aside>
                      );
                    }
                    if (block.type === "code") {
                      return (
                        <figure
                          key={`${activeBlogPost.id}-code-${idx}`}
                          className="border-y px-3 py-4"
                          style={{
                            borderColor: "rgba(255, 217, 172, 0.18)",
                            background: "rgba(12, 8, 8, 0.34)",
                          }}
                        >
                          {block.language ? (
                            <p
                              className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em]"
                              style={{ color: "rgba(255, 214, 172, 0.62)" }}
                            >
                              {block.language}
                            </p>
                          ) : null}
                          <pre
                            className="overflow-x-auto text-[12.5px] leading-[1.85]"
                            style={{
                              color: "rgba(255, 235, 212, 0.86)",
                              fontFamily:
                                "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
                            }}
                          >
                            {block.code}
                          </pre>
                          {block.caption ? (
                            <figcaption
                              className="mt-2 text-xs italic"
                              style={{ color: "rgba(255, 214, 172, 0.56)" }}
                            >
                              {block.caption}
                            </figcaption>
                          ) : null}
                        </figure>
                      );
                    }
                    if (block.type === "equation") {
                      return (
                        <figure
                          key={`${activeBlogPost.id}-equation-${idx}`}
                          className="border-y px-3 py-4"
                          style={{
                            borderColor: "rgba(255, 217, 172, 0.18)",
                            background: "rgba(10, 7, 7, 0.28)",
                          }}
                        >
                          <pre
                            className="overflow-x-auto text-[12.5px] leading-[1.8]"
                            style={{
                              color: "rgba(255, 235, 212, 0.86)",
                              fontFamily:
                                "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
                            }}
                          >
                            {block.expression}
                          </pre>
                          {block.caption ? (
                            <figcaption
                              className="mt-2 text-xs italic"
                              style={{ color: "rgba(255, 214, 172, 0.56)" }}
                            >
                              {block.caption}
                            </figcaption>
                          ) : null}
                          {block.terms && block.terms.length > 0 ? (
                            <ul
                              className="mt-3 space-y-1 text-xs leading-relaxed"
                              style={{ color: "rgba(255, 224, 196, 0.74)" }}
                            >
                              {block.terms.map((term) => (
                                <li key={`${activeBlogPost.id}-equation-${idx}-${term.symbol}`}>
                                  <span className="font-semibold" style={{ color: "rgba(255, 214, 172, 0.86)" }}>
                                    {term.symbol}
                                  </span>{" "}
                                  — {term.meaning}
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </figure>
                      );
                    }
                    if (block.type === "metrics") {
                      return (
                        <div
                          key={`${activeBlogPost.id}-metrics-${idx}`}
                          className="border-y"
                          style={{ borderColor: "rgba(255, 217, 172, 0.2)" }}
                        >
                          {block.items.map((item, itemIndex) => (
                            <article
                              key={`${activeBlogPost.id}-metrics-${idx}-${item.label}`}
                              className="grid gap-2 px-1 py-3 sm:grid-cols-[220px_1fr]"
                              style={{
                                borderTop:
                                  itemIndex > 0 ? "1px solid rgba(255, 217, 172, 0.12)" : undefined,
                              }}
                            >
                              <p
                                className="text-[10px] font-semibold uppercase tracking-[0.22em]"
                                style={{ color: "rgba(255, 214, 172, 0.62)" }}
                              >
                                {item.label}
                              </p>
                              <div>
                                <p
                                  className="text-xl leading-tight"
                                  style={{ color: "#FFECD0", fontFamily: "'Fraunces', serif" }}
                                >
                                  {item.value}
                                </p>
                                {item.detail ? (
                                  <p
                                    className="mt-1.5 text-xs leading-relaxed"
                                    style={{ color: "rgba(255, 224, 196, 0.66)" }}
                                  >
                                    {item.detail}
                                  </p>
                                ) : null}
                              </div>
                            </article>
                          ))}
                        </div>
                      );
                    }
                    if (block.type === "barChart") {
                      const computedMax = Math.max(
                        block.max ?? 0,
                        ...block.items.map((item) => item.value),
                        1,
                      );
                      return (
                        <figure
                          key={`${activeBlogPost.id}-bar-chart-${idx}`}
                          className="border-y px-1 py-4"
                          style={{
                            borderColor: "rgba(255, 217, 172, 0.2)",
                            background:
                              "linear-gradient(180deg, rgba(33, 19, 17, 0.28), rgba(21, 12, 11, 0.28))",
                          }}
                        >
                          <figcaption
                            className="mb-3 text-xs font-semibold uppercase tracking-[0.16em]"
                            style={{ color: "rgba(255, 214, 172, 0.72)" }}
                          >
                            {block.title}
                          </figcaption>
                          <div className="space-y-3">
                            {block.items.map((item) => {
                              const pct = Math.max(
                                0,
                                Math.min(100, (item.value / computedMax) * 100),
                              );
                              return (
                                <article
                                  key={`${activeBlogPost.id}-bar-chart-${idx}-${item.label}`}
                                >
                                  <div className="mb-1.5 flex items-center justify-between gap-3">
                                    <p
                                      className="text-[12px] leading-relaxed"
                                      style={{ color: "rgba(255, 224, 196, 0.84)" }}
                                    >
                                      {item.label}
                                    </p>
                                    <p
                                      className="text-[11px] font-semibold tracking-[0.08em]"
                                      style={{ color: "rgba(255, 214, 172, 0.82)" }}
                                    >
                                      {item.value}
                                      {block.unit ? ` ${block.unit}` : ""}
                                    </p>
                                  </div>
                                  <div
                                    className="h-2.5 w-full overflow-hidden"
                                    style={{
                                      background: "rgba(255, 217, 172, 0.14)",
                                      border: "1px solid rgba(255, 217, 172, 0.16)",
                                    }}
                                  >
                                    <div
                                      className="h-full"
                                      style={{
                                        width: `${pct}%`,
                                        background: `linear-gradient(90deg, ${
                                          item.color ?? "#E8B37B"
                                        }, rgba(255, 214, 172, 0.95))`,
                                      }}
                                    />
                                  </div>
                                  {item.note ? (
                                    <p
                                      className="mt-1 text-[11px] leading-relaxed"
                                      style={{ color: "rgba(255, 214, 172, 0.58)" }}
                                    >
                                      {item.note}
                                    </p>
                                  ) : null}
                                </article>
                              );
                            })}
                          </div>
                          {block.footnote ? (
                            <p
                              className="mt-3 text-[11px] italic leading-relaxed"
                              style={{ color: "rgba(255, 214, 172, 0.54)" }}
                            >
                              {block.footnote}
                            </p>
                          ) : null}
                          {block.caption ? (
                            <figcaption
                              className="mt-2 text-xs italic"
                              style={{ color: "rgba(255, 214, 172, 0.56)" }}
                            >
                              {block.caption}
                            </figcaption>
                          ) : null}
                        </figure>
                      );
                    }
                    if (block.type === "columnChart") {
                      const computedMax = Math.max(
                        block.max ?? 0,
                        ...block.items.map((item) => item.value),
                        1,
                      );
                      const axisTicks = [1, 0.75, 0.5, 0.25, 0];
                      const gridTemplateColumns = `repeat(${Math.max(
                        block.items.length,
                        1,
                      )}, minmax(120px, 1fr))`;
                      const formatAxisValue = (value: number) =>
                        Number.isInteger(value) ? `${value}` : value.toFixed(1);
                      return (
                        <figure
                          key={`${activeBlogPost.id}-column-chart-${idx}`}
                          className="border-y px-1 py-4"
                          style={{
                            borderColor: "rgba(255, 217, 172, 0.2)",
                            background:
                              "linear-gradient(180deg, rgba(33, 19, 17, 0.28), rgba(21, 12, 11, 0.28))",
                          }}
                        >
                          <figcaption
                            className="mb-3 text-xs font-semibold uppercase tracking-[0.16em]"
                            style={{ color: "rgba(255, 214, 172, 0.72)" }}
                          >
                            {block.title}
                          </figcaption>
                          <div className="grid grid-cols-[42px_minmax(0,1fr)] gap-2">
                            <div className="relative h-48">
                              {axisTicks.map((fraction) => (
                                <p
                                  key={`${activeBlogPost.id}-column-chart-axis-${idx}-${fraction}`}
                                  className="absolute left-0 text-[10px] font-semibold tracking-[0.08em]"
                                  style={{
                                    bottom: `calc(${fraction * 100}% - 7px)`,
                                    color: "rgba(255, 214, 172, 0.62)",
                                  }}
                                >
                                  {formatAxisValue(computedMax * fraction)}
                                </p>
                              ))}
                            </div>
                            <div className="overflow-x-auto pb-1">
                              <div className="min-w-[680px]">
                                <div
                                  className="relative h-48 border px-2"
                                  style={{
                                    background: "rgba(255, 217, 172, 0.06)",
                                    borderColor: "rgba(255, 217, 172, 0.16)",
                                  }}
                                >
                                  <div className="pointer-events-none absolute inset-0">
                                    {axisTicks.map((fraction) => (
                                      <div
                                        key={`${activeBlogPost.id}-column-chart-grid-${idx}-${fraction}`}
                                        className="absolute inset-x-0 border-t"
                                        style={{
                                          bottom: `${fraction * 100}%`,
                                          borderColor:
                                            fraction === 0
                                              ? "rgba(255, 217, 172, 0.32)"
                                              : "rgba(255, 217, 172, 0.12)",
                                        }}
                                      />
                                    ))}
                                  </div>
                                  <div
                                    className="relative z-10 grid h-full items-end gap-4"
                                    style={{ gridTemplateColumns }}
                                  >
                                    {block.items.map((item) => {
                                      const pct = Math.max(
                                        0,
                                        Math.min(100, (item.value / computedMax) * 100),
                                      );
                                      return (
                                        <article
                                          key={`${activeBlogPost.id}-column-chart-${idx}-${item.label}`}
                                          className="flex h-full items-end"
                                        >
                                          <div
                                            className="relative w-full overflow-hidden border-x border-t"
                                            style={{
                                              height: `${pct}%`,
                                              borderColor: "rgba(255, 217, 172, 0.18)",
                                              background:
                                                "linear-gradient(180deg, rgba(255, 214, 172, 0.08), rgba(255, 214, 172, 0.02))",
                                            }}
                                          >
                                            <div
                                              className="h-full w-full"
                                              style={{
                                                background: `linear-gradient(180deg, ${
                                                  item.color ?? "#E8B37B"
                                                }, rgba(255, 214, 172, 0.92))`,
                                              }}
                                            />
                                          </div>
                                        </article>
                                      );
                                    })}
                                  </div>
                                </div>
                                <div
                                  className="mt-2 grid gap-4"
                                  style={{ gridTemplateColumns }}
                                >
                                  {block.items.map((item) => (
                                    <div
                                      key={`${activeBlogPost.id}-column-chart-label-${idx}-${item.label}`}
                                      className="min-h-[88px]"
                                    >
                                      <p
                                        className="text-[12px] leading-relaxed"
                                        style={{ color: "rgba(255, 224, 196, 0.86)" }}
                                      >
                                        {item.label}
                                      </p>
                                      <p
                                        className="text-[11px] font-semibold tracking-[0.08em]"
                                        style={{ color: "rgba(255, 214, 172, 0.84)" }}
                                      >
                                        {item.value}
                                        {block.unit ? ` ${block.unit}` : ""}
                                      </p>
                                      {item.note ? (
                                        <p
                                          className="mt-1 text-[11px] leading-relaxed"
                                          style={{ color: "rgba(255, 214, 172, 0.58)" }}
                                        >
                                          {item.note}
                                        </p>
                                      ) : null}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </div>
                          {block.footnote ? (
                            <p
                              className="mt-3 text-[11px] italic leading-relaxed"
                              style={{ color: "rgba(255, 214, 172, 0.54)" }}
                            >
                              {block.footnote}
                            </p>
                          ) : null}
                          {block.caption ? (
                            <figcaption
                              className="mt-2 text-xs italic"
                              style={{ color: "rgba(255, 214, 172, 0.56)" }}
                            >
                              {block.caption}
                            </figcaption>
                          ) : null}
                        </figure>
                      );
                    }
                    if (block.type === "quote") {
                      return (
                        <blockquote
                          key={`${activeBlogPost.id}-quote-${idx}`}
                          className="border-l-2 pl-5 pr-1 py-2 text-[15px] italic leading-[1.9]"
                          style={{
                            borderColor: "rgba(255, 217, 172, 0.28)",
                            color: "rgba(255, 230, 206, 0.78)",
                            fontFamily: "'Fraunces', serif",
                          }}
                        >
                          {block.text}
                        </blockquote>
                      );
                    }
                    if (block.type === "list") {
                      return (
                        <ul
                          key={`${activeBlogPost.id}-list-${idx}`}
                          className="space-y-2 pl-5 text-[15px] leading-[1.9] list-disc"
                          style={{ color: "rgba(255, 224, 196, 0.76)" }}
                        >
                          {block.items.map((item) => (
                            <li key={`${activeBlogPost.id}-list-${idx}-${item.slice(0, 28)}`}>{item}</li>
                          ))}
                        </ul>
                      );
                    }
                    if (block.type === "references") {
                      return (
                        <ol
                          key={`${activeBlogPost.id}-references-${idx}`}
                          className="space-y-3 pl-5 text-[14px] leading-[1.8] list-decimal"
                          style={{ color: "rgba(255, 224, 196, 0.76)" }}
                        >
                          {block.items.map((reference) => (
                            <li key={`${activeBlogPost.id}-references-${idx}-${reference.title.slice(0, 24)}`}>
                              <a
                                href={reference.href}
                                target="_blank"
                                rel="noreferrer"
                                className="underline decoration-dotted underline-offset-4 transition-opacity hover:opacity-80"
                                style={{ color: "rgba(255, 224, 196, 0.9)" }}
                              >
                                {reference.title}
                              </a>
                              {reference.note ? (
                                <span style={{ color: "rgba(255, 214, 172, 0.58)" }}> — {reference.note}</span>
                              ) : null}
                            </li>
                          ))}
                        </ol>
                      );
                    }
                    if (block.type === "table") {
                      return (
                        <figure
                          key={`${activeBlogPost.id}-table-${idx}`}
                          className="border-y py-2"
                          style={{
                            borderColor: "rgba(255, 217, 172, 0.2)",
                          }}
                        >
                          <div className="overflow-x-auto">
                            <table className="min-w-full table-fixed text-left">
                              <thead>
                                <tr>
                                  {block.columns.map((column) => (
                                    <th
                                      key={`${activeBlogPost.id}-table-${idx}-head-${column}`}
                                      className="border-b px-3 py-2 text-xs uppercase tracking-[0.14em]"
                                      style={{
                                        borderColor: "rgba(255, 217, 172, 0.2)",
                                        color: "rgba(255, 214, 172, 0.72)",
                                      }}
                                    >
                                      {column}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {block.rows.map((row, rowIndex) => (
                                  <tr key={`${activeBlogPost.id}-table-${idx}-row-${rowIndex}`}>
                                    {row.map((cell, cellIndex) => (
                                      <td
                                        key={`${activeBlogPost.id}-table-${idx}-row-${rowIndex}-cell-${cellIndex}`}
                                        className="border-b px-3 py-2 text-sm leading-relaxed align-top break-words"
                                        style={{
                                          borderColor: "rgba(255, 217, 172, 0.12)",
                                          color: "rgba(255, 224, 196, 0.78)",
                                        }}
                                      >
                                        {cell}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          {block.caption && (
                            <figcaption
                              className="border-t px-1 pt-2 text-xs italic"
                              style={{
                                borderColor: "rgba(255, 217, 172, 0.16)",
                                color: "rgba(255, 214, 172, 0.56)",
                              }}
                            >
                              {block.caption}
                            </figcaption>
                          )}
                        </figure>
                      );
                    }
                    if (block.type === "ascii") {
                      return (
                        <pre
                          key={`${activeBlogPost.id}-ascii-${idx}`}
                          className="overflow-x-auto border-y px-3 py-4 text-xs leading-relaxed"
                          style={{
                            borderColor: "rgba(255, 217, 172, 0.2)",
                            background: "rgba(15, 8, 8, 0.34)",
                            color: "rgba(255, 224, 196, 0.76)",
                            fontFamily:
                              "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
                          }}
                        >
                          {block.text}
                        </pre>
                      );
                    }
                    const imageShellClass =
                      block.size === "narrow"
                        ? "mx-auto max-w-3xl"
                        : block.size === "wide"
                          ? "md:-mx-8"
                          : "";
                    return (
                      <figure
                        key={`${activeBlogPost.id}-image-${idx}`}
                        className={`border-y py-3 ${imageShellClass}`}
                        style={{
                          borderColor: "rgba(255, 217, 172, 0.2)",
                        }}
                      >
                        <img
                          src={block.src}
                          alt={block.alt}
                          className="w-full border"
                          style={{
                            borderColor: "rgba(255, 217, 172, 0.24)",
                            objectFit: block.fit === "contain" ? "contain" : "cover",
                          }}
                        />
                        {block.caption && (
                          <figcaption
                            className="pt-2 text-xs italic"
                            style={{ color: "rgba(255, 214, 172, 0.56)" }}
                          >
                            {block.caption}
                          </figcaption>
                        )}
                      </figure>
                    );
                    });
                  })()}
                </div>
              </motion.article>
            ) : (
              <div className="space-y-6">
                <section
                  className="border px-4 py-4 md:px-5"
                  style={{
                    borderColor: "rgba(255, 217, 172, 0.16)",
                    background:
                      "linear-gradient(180deg, rgba(255, 206, 158, 0.05), rgba(255, 206, 158, 0.02))",
                  }}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="max-w-lg">
                      <p
                        className="text-[10px] font-semibold uppercase tracking-[0.24em]"
                        style={{ color: "rgba(255, 214, 172, 0.58)" }}
                      >
                        Browse by lane
                      </p>
                      <p
                        className="mt-2 text-sm leading-relaxed"
                        style={{ color: "rgba(255, 224, 196, 0.76)" }}
                      >
                        {activeBlogFilterMeta.description}
                      </p>
                    </div>
                    <p
                      className="text-[11px] uppercase tracking-[0.2em]"
                      style={{ color: "rgba(255, 214, 172, 0.42)" }}
                    >
                      {blogFilterCounts.get(activeBlogFilter) ?? 0}{" "}
                      {(blogFilterCounts.get(activeBlogFilter) ?? 0) === 1
                        ? "story"
                        : "stories"}
                    </p>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {BLOG_ARCHIVE_FILTERS.map((filter) => {
                      const isActive = filter.id === activeBlogFilter;
                      const count = blogFilterCounts.get(filter.id) ?? 0;
                      return (
                        <button
                          key={filter.id}
                          type="button"
                          onClick={() => setActiveBlogFilter(filter.id)}
                          className="inline-flex items-center gap-2 border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] transition-transform hover:scale-[1.01]"
                          style={{
                            borderColor: isActive
                              ? "rgba(255, 217, 172, 0.34)"
                              : "rgba(255, 217, 172, 0.16)",
                            color: isActive
                              ? "#FFEED8"
                              : "rgba(255, 220, 188, 0.74)",
                            background: isActive
                              ? "rgba(255, 206, 158, 0.12)"
                              : "rgba(255, 206, 158, 0.03)",
                          }}
                          aria-pressed={isActive}
                          data-testid={`button-blog-filter-${filter.id}`}
                        >
                          <span>{filter.label}</span>
                          <span
                            className="min-w-5 border px-1.5 py-0.5 text-[10px]"
                            style={{
                              borderColor: isActive
                                ? "rgba(255, 217, 172, 0.28)"
                                : "rgba(255, 217, 172, 0.14)",
                              color: isActive
                                ? "rgba(255, 232, 208, 0.88)"
                                : "rgba(255, 214, 172, 0.66)",
                              background: "rgba(255, 255, 255, 0.02)",
                            }}
                          >
                            {count}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
                {filteredBlogPosts.length === 0 ? (
                  <section
                    className="border px-5 py-8 text-center"
                    style={{
                      borderColor: "rgba(255, 217, 172, 0.16)",
                      background:
                        "linear-gradient(180deg, rgba(255, 206, 158, 0.04), rgba(255, 206, 158, 0.015))",
                    }}
                  >
                    <p
                      className="text-[10px] font-semibold uppercase tracking-[0.24em]"
                      style={{ color: "rgba(255, 214, 172, 0.52)" }}
                    >
                      Nothing here yet
                    </p>
                    <p
                      className="mx-auto mt-3 max-w-md text-[15px] leading-[1.8]"
                      style={{ color: "rgba(255, 224, 196, 0.74)" }}
                    >
                      This category does not have any published stories yet. Try
                      another lane or reset the archive to everything.
                    </p>
                    {activeBlogFilter !== "all" ? (
                      <button
                        type="button"
                        onClick={() => setActiveBlogFilter("all")}
                        className="mt-5 inline-flex items-center gap-2 border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em]"
                        style={{
                          borderColor: "rgba(255, 217, 172, 0.22)",
                          color: "rgba(255, 220, 188, 0.8)",
                          background: "rgba(255, 206, 158, 0.05)",
                        }}
                      >
                        Show all stories
                      </button>
                    ) : null}
                  </section>
                ) : null}
                {archiveLeadBlogPost ? (
                  (() => {
                    const coverBlock = getBlogCoverBlock(archiveLeadBlogPost);
                    return (
                      <motion.article
                        initial={{ opacity: 0, y: 18 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true, margin: "-20px" }}
                        transition={{ duration: 0.48, ease: [0.22, 1, 0.36, 1] }}
                        className="border-b pb-10 md:pb-12"
                        style={{ borderColor: "rgba(255, 217, 172, 0.18)" }}
                      >
                        <div
                          className="mb-4 inline-flex items-center gap-2 border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em]"
                          style={{
                            borderColor: "rgba(255, 217, 172, 0.18)",
                            background: "rgba(255, 206, 158, 0.06)",
                            color: "rgba(255, 224, 196, 0.74)",
                          }}
                        >
                          {activeBlogFilterMeta.leadLabel}
                        </div>
                        <div className="grid gap-6 md:grid-cols-[1.28fr_0.92fr] md:items-start">
                          <div>
                            {coverBlock ? (
                              <figure
                                className="overflow-hidden border"
                                style={{
                                  borderColor: "rgba(255, 217, 172, 0.2)",
                                }}
                              >
                                <img
                                  src={coverBlock.src}
                                  alt={coverBlock.alt}
                                  className="h-64 w-full object-cover md:h-[26rem]"
                                  loading="lazy"
                                />
                              </figure>
                            ) : null}
                          </div>
                          <div>
                            <p
                              className="mb-3 text-[11px] tracking-[0.24em] uppercase"
                              style={{ color: "rgba(255, 214, 172, 0.44)" }}
                            >
                              {archiveLeadBlogPost.publishedAt} · {archiveLeadBlogPost.readTime}
                            </p>
                            <h3
                              className="text-[1.85rem] leading-tight md:text-[2.4rem]"
                              style={{ color: "#FFEED8", fontFamily: "'Fraunces', serif" }}
                            >
                              {archiveLeadBlogPost.title}
                            </h3>
                            <p
                              className="mt-3 text-[1rem] leading-[1.8]"
                              style={{ color: "rgba(255, 224, 196, 0.82)" }}
                            >
                              {archiveLeadBlogPost.subtitle}
                            </p>
                            <p
                              className="mt-4 text-[15px] leading-[1.9]"
                              style={{ color: "rgba(255, 224, 196, 0.72)" }}
                            >
                              {archiveLeadBlogPost.excerpt}
                            </p>
                            <div className="mt-5 flex flex-wrap gap-2">
                              {archiveLeadBlogPost.tags.map((tag) => (
                                <span
                                  key={`${archiveLeadBlogPost.id}-${tag}`}
                                  className="border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]"
                                  style={{
                                    borderColor: "rgba(255, 217, 172, 0.16)",
                                    color: "rgba(255, 214, 172, 0.64)",
                                    background: "rgba(255, 206, 158, 0.03)",
                                  }}
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                            <div className="mt-6">
                              <button
                                type="button"
                                onClick={() => setActiveBlogPostId(archiveLeadBlogPost.id)}
                                className="inline-flex items-center gap-2 border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em]"
                                style={{
                                  borderColor: "rgba(255, 217, 172, 0.22)",
                                  color: "rgba(255, 220, 188, 0.8)",
                                  background: "rgba(255, 206, 158, 0.05)",
                                }}
                                data-testid={`button-open-blog-post-${archiveLeadBlogPost.id}`}
                              >
                                Read article
                                <ArrowRight className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      </motion.article>
                    );
                  })()
                ) : null}
                {archiveSecondaryBlogPosts.map((post, idx) => (
                  (() => {
                    const coverBlock = getBlogCoverBlock(post);
                    return (
                  <motion.article
                    key={post.id}
                    initial={{ opacity: 0, y: 18 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: "-20px" }}
                    transition={{ duration: 0.48, delay: idx * 0.04, ease: [0.22, 1, 0.36, 1] }}
                    className="border-b pb-8 md:pb-10"
                    style={{
                      borderColor: "rgba(255, 217, 172, 0.16)",
                    }}
                  >
                    {coverBlock && (
                      <figure
                        className="mb-4 overflow-hidden border"
                        style={{
                          borderColor: "rgba(255, 217, 172, 0.2)",
                        }}
                      >
                        <img
                          src={coverBlock.src}
                          alt={coverBlock.alt}
                          className="h-44 w-full object-cover md:h-52"
                          loading="lazy"
                        />
                      </figure>
                    )}
                    <p
                      className="mb-2 text-[11px] tracking-[0.24em] uppercase"
                      style={{ color: "rgba(255, 214, 172, 0.44)" }}
                    >
                      {post.publishedAt} · {post.readTime}
                    </p>
                    <h3
                      className="text-[1.5rem] md:text-[1.75rem] leading-tight"
                      style={{ color: "#FFEED8", fontFamily: "'Fraunces', serif" }}
                    >
                      {post.title}
                    </h3>
                    <p
                      className="mt-3 text-[15px] leading-[1.85]"
                      style={{ color: "rgba(255, 224, 196, 0.76)" }}
                    >
                      {post.excerpt}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {post.tags.map((tag) => (
                        <span
                          key={`${post.id}-${tag}`}
                          className="border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]"
                          style={{
                            borderColor: "rgba(255, 217, 172, 0.16)",
                            color: "rgba(255, 214, 172, 0.64)",
                            background: "rgba(255, 206, 158, 0.03)",
                          }}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                    <div className="mt-5">
                      <button
                        type="button"
                        onClick={() => setActiveBlogPostId(post.id)}
                        className="inline-flex items-center gap-2 border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em]"
                        style={{
                          borderColor: "rgba(255, 217, 172, 0.22)",
                          color: "rgba(255, 220, 188, 0.76)",
                          background: "rgba(255, 206, 158, 0.03)",
                        }}
                        data-testid={`button-open-blog-post-${post.id}`}
                      >
                        Read article
                        <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </motion.article>
                    );
                  })()
                ))}
              </div>
            )
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
                    <div className="flex-1 pl-1 min-w-0" style={{ borderLeft: "2px solid rgba(255, 214, 172, 0.12)" }}>
                      <h3
                        className="text-lg font-semibold mb-3 pl-4 break-words"
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
                            className="text-[14.5px] leading-[1.8] break-words"
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
        title: "Morning plan in 30 seconds",
        label: "Inbox + calendar pulse",
        body: "Zee can summarize priority emails, surface upcoming meetings, and prep your day before your first coffee.",
        icon: CalendarDays,
      },
      {
        title: "Between meetings, still moving",
        label: "Grounded quick decisions",
        body: "Ask for a fast answer with web grounding and context from your ongoing thread instead of jumping across tabs.",
        icon: Search,
      },
      {
        title: "Out the door confidence check",
        label: "Camera-aware assist",
        body: "Need style feedback or visual help? Zee can see your context through camera and guide you quickly and naturally.",
        icon: Camera,
      },
    ],
    [],
  );

  const useCaseStories = useMemo<LandingUseCaseStory[]>(
    () => [
      {
        id: "calendar-email",
        label: "Executive Assist",
        title: "Calendar and inbox, in your flow",
        description:
          "Zee keeps up with your schedule and inbox context so you can stay present while moving through your day.",
        bullets: [
          "Read-only Gmail + Calendar scopes",
          "Fast recap before meetings",
          "Private by default boundaries",
          "No context reset when switching modes",
        ],
        imageSrc: "/landing/assistant-calendar-email.jpg",
        imageAlt:
          "Professional using Zee for schedule and email context in a warm evening cafe setting.",
        icon: Mail,
      },
      {
        id: "grounded-search",
        label: "Grounded Answers",
        title: "Web-aware help without tab chaos",
        description:
          "When you need real-world info, Zee can pull grounded web context and respond in the same trusted conversation thread.",
        bullets: [
          "Grounded lookup for current questions",
          "Faster decisions in one place",
          "Keeps emotional + practical continuity",
          "Works in voice and text",
        ],
        imageSrc: "/landing/grounded-web-search.jpg",
        imageAlt:
          "User working with phone and laptop while Zee grounds answers with web context.",
        icon: Search,
      },
      {
        id: "camera-style",
        label: "Camera Assist",
        title: "Visual guidance in real moments",
        description:
          "From outfit checks to situational help, Zee can use camera context to support you with practical, friendly suggestions.",
        bullets: [
          "Camera-aware companion guidance",
          "Great for fashion and everyday choices",
          "Helpful without feeling robotic",
          "Designed for real environments",
        ],
        imageSrc: "/landing/camera-fashion-guide.jpg",
        imageAlt:
          "Person using Zee camera mode for outfit guidance in a warm home setting.",
        icon: Camera,
      },
      {
        id: "continuity-switch",
        label: "Voice + Text",
        title: "Switch modes, keep the same bestie",
        description:
          "Talk when you can, text when you need to. Zee preserves context so the relationship feels continuous and alive.",
        bullets: [
          "Seamless voice-to-text handoff",
          "Continuity across noisy environments",
          "Memory that tracks what matters",
          "Reliable day-to-night companion flow",
        ],
        imageSrc: "/landing/seamless-voice-text-continuity.jpg",
        imageAlt:
          "Scrollytelling visual of a person shifting from voice outdoors to text indoors with continuity.",
        icon: MessageSquareHeart,
      },
    ],
    [],
  );

  const landingFaqs = useMemo(() => LANDING_FAQS, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncFromPath = () => {
      setActiveInfoPage(infoPageFromPath(window.location.pathname));
    };
    syncFromPath();
    window.addEventListener("popstate", syncFromPath);
    return () => window.removeEventListener("popstate", syncFromPath);
  }, []);

  const handleCloseInfoPage = () => {
    setActiveInfoPage(null);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (infoPageFromPath(url.pathname)) {
      url.pathname = "/";
      url.hash = "";
      window.history.replaceState({}, "", `${url.pathname}${url.search}`);
    }
  };

  const openInfoPage = (page: InfoPageId) => {
    setActiveInfoPage(page);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const targetPath = INFO_PAGE_PATH[page];
    if (targetPath && normalizePath(url.pathname) !== targetPath) {
      url.pathname = targetPath;
      url.hash = "";
      window.history.pushState({}, "", `${url.pathname}${url.search}`);
    }
  };

  useEffect(() => {
    if (typeof window === "undefined" || activeInfoPage) return;
    applyMarketingMeta({
      title: "ZeeMe | AI Companion for Voice, Text, and Everyday Life",
      description:
        "ZeeMe is an AI companion with live voice and text chat, Gmail and Google Calendar help, grounded web answers, camera-aware support, and one continuous conversation.",
      path: "/",
      pageSchema: null,
      blogPostingSchema: null,
    });
  }, [activeInfoPage]);

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
                Zee, your bestie<br />
                with real-life superpowers
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
                Voice and text continuity, plus Gmail, Calendar, grounded web search, and camera-aware support in one companion.
              </p>
              <p className="text-[15px]" style={{ color: "rgba(255, 228, 202, 0.55)" }}>
                Private by design, helpful like an executive assistant, warm like your favorite person.
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
                  Warm companion, practical power
                </h2>
                <div className="flex items-center justify-center gap-2 mb-5">
                  <div className="w-10 h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(255, 214, 172, 0.3))" }} />
                  <div className="w-1.5 h-1.5 rotate-45 border" style={{ borderColor: "rgba(255, 214, 172, 0.2)" }} />
                  <div className="w-10 h-px" style={{ background: "linear-gradient(90deg, rgba(255, 214, 172, 0.3), transparent)" }} />
                </div>
                <p className="text-base md:text-[17px] max-w-lg mx-auto italic leading-[1.8]" style={{ color: "rgba(255, 226, 198, 0.6)", fontFamily: "'Fraunces', serif" }}>
                  Zee combines emotional presence with everyday execution across schedule, email, search, and camera assistance.
                </p>
              </RevealSection>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FeatureCard
                  icon={Mail}
                  title="Inbox + calendar in conversation"
                  description="Ask for unread priorities or upcoming events without leaving chat. Zee stays context-aware while keeping your thread intact."
                  index={0}
                />
                <FeatureCard
                  icon={Search}
                  title="Grounded web help when needed"
                  description="Zee can pull web context for current questions, then answer in the same voice or text flow without breaking continuity."
                  index={1}
                />
                <FeatureCard
                  icon={Camera}
                  title="Camera-aware everyday guidance"
                  description="From fashion checks to visual context support, Zee can see what you see and offer practical, friendly assistance."
                  index={2}
                />
                <FeatureCard
                  icon={MessageSquareHeart}
                  title="One bestie across voice + text"
                  description="Switch modes instantly in noisy real life. Your memory and momentum continue like one relationship, not separate sessions."
                  index={3}
                />
              </div>
            </div>
          </section>

          <UseCaseScrollySection stories={useCaseStories} />

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
                  Designed for the pace of real life
                </h2>
                <div className="flex items-center justify-center gap-2 mb-5">
                  <div className="w-10 h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(255, 214, 172, 0.3))" }} />
                  <div className="w-1.5 h-1.5 rotate-45 border" style={{ borderColor: "rgba(255, 214, 172, 0.2)" }} />
                  <div className="w-10 h-px" style={{ background: "linear-gradient(90deg, rgba(255, 214, 172, 0.3), transparent)" }} />
                </div>
                <p className="text-base md:text-[17px] max-w-lg mx-auto italic leading-[1.8]" style={{ color: "rgba(255, 226, 198, 0.6)", fontFamily: "'Fraunces', serif" }}>
                  From first meeting prep to late-night reflection, Zee keeps your context and emotional tone connected.
                </p>
              </RevealSection>

              <TimelineMoments moments={companionMoments} />
            </div>
          </section>

          <section className="px-6 py-28 relative" id="faq" aria-labelledby="landing-faq-heading">
            <div className="max-w-5xl mx-auto">
              <RevealSection className="text-center mb-18">
                <div className="flex items-center justify-center gap-4 mb-6">
                  <svg width="50" height="8" viewBox="0 0 50 8" fill="none" className="opacity-25">
                    <path d="M0 4 C10 4, 12 1, 20 1 C28 1, 28 7, 38 7 C44 7, 47 5, 50 4" stroke="rgba(255, 214, 172, 0.7)" strokeWidth="0.8" fill="none" />
                  </svg>
                  <span className="text-[11px] tracking-[0.35em] uppercase" style={{ color: "rgba(255, 214, 172, 0.4)" }}>
                    III
                  </span>
                  <svg width="50" height="8" viewBox="0 0 50 8" fill="none" className="opacity-25" style={{ transform: "scaleX(-1)" }}>
                    <path d="M0 4 C10 4, 12 1, 20 1 C28 1, 28 7, 38 7 C44 7, 47 5, 50 4" stroke="rgba(255, 214, 172, 0.7)" strokeWidth="0.8" fill="none" />
                  </svg>
                </div>
                <h2
                  id="landing-faq-heading"
                  className="text-3xl md:text-[3.2rem] font-semibold mb-4 tracking-tight leading-[1.08]"
                  style={{ color: "#FFEFD8", fontFamily: "'Fraunces', serif" }}
                >
                  Questions people ask before meeting Zee
                </h2>
                <p
                  className="text-base md:text-[17px] max-w-2xl mx-auto italic leading-[1.8]"
                  style={{ color: "rgba(255, 226, 198, 0.6)", fontFamily: "'Fraunces', serif" }}
                >
                  A clearer public explanation of how ZeeMe works helps people, search engines, and AI assistants understand what the product really does.
                </p>
              </RevealSection>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {landingFaqs.map((item, index) => (
                  <RevealSection key={item.question}>
                    <article
                      className="rounded-[1.75rem] border p-6 h-full"
                      style={{
                        background: "linear-gradient(180deg, rgba(55, 33, 30, 0.78), rgba(32, 18, 18, 0.92))",
                        borderColor: "rgba(255, 217, 183, 0.12)",
                        boxShadow: "0 18px 60px rgba(0, 0, 0, 0.16)",
                      }}
                      data-marketing-testid={`landing-faq-${index}`}
                    >
                      <p
                        className="text-[11px] uppercase tracking-[0.28em] mb-3"
                        style={{ color: "rgba(255, 214, 172, 0.42)" }}
                      >
                        FAQ {index + 1}
                      </p>
                      <h3
                        className="text-xl mb-3 leading-snug"
                        style={{ color: "#FFE7CA", fontFamily: "'Fraunces', serif" }}
                      >
                        {item.question}
                      </h3>
                      <p className="text-sm leading-[1.9]" style={{ color: "rgba(255, 228, 202, 0.72)" }}>
                        {item.answer}
                      </p>
                    </article>
                  </RevealSection>
                ))}
              </div>
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
                      <a
                        href="/about"
                        onClick={(event) => {
                          event.preventDefault();
                          openInfoPage("about");
                        }}
                        className="text-left text-sm hover:translate-x-1 transition-transform duration-200"
                        style={{ color: "rgba(255, 228, 202, 0.7)" }}
                        data-testid="link-about"
                      >
                        About us
                      </a>
                      <a
                        href="/blog"
                        onClick={(event) => {
                          event.preventDefault();
                          openInfoPage("blog");
                        }}
                        className="text-left text-sm hover:translate-x-1 transition-transform duration-200"
                        style={{ color: "rgba(255, 228, 202, 0.7)" }}
                        data-testid="link-blog"
                      >
                        Blog
                      </a>
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
                      <a
                        href="/terms"
                        onClick={(event) => {
                          event.preventDefault();
                          openInfoPage("terms");
                        }}
                        className="text-left text-sm hover:translate-x-1 transition-transform duration-200"
                        style={{ color: "rgba(255, 228, 202, 0.7)" }}
                        data-testid="link-terms"
                      >
                        Terms of Service
                      </a>
                      <a
                        href="/privacy"
                        onClick={(event) => {
                          event.preventDefault();
                          openInfoPage("privacy");
                        }}
                        className="text-left text-sm hover:translate-x-1 transition-transform duration-200"
                        style={{ color: "rgba(255, 228, 202, 0.7)" }}
                        data-testid="link-privacy"
                      >
                        Privacy Policy
                      </a>
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

      {activeInfoPage ? <InfoPageOverlay page={activeInfoPage} onClose={handleCloseInfoPage} /> : null}
    </>
  );
}
