import type { Request } from "express";

type ShareMeta = {
  title: string;
  description: string;
  canonicalUrl: string;
  ogType: "website" | "article";
  imageUrl: string;
  imageType: string;
  imageWidth: number;
  imageHeight: number;
  imageAlt: string;
  twitterCard: "summary_large_image";
};

type BlogShareEntry = {
  title: string;
  description: string;
  imagePath: string;
  imageAlt: string;
  imageType?: string;
  imageWidth?: number;
  imageHeight?: number;
};

const DEFAULT_TITLE = "Zeeme — Your AI Companion, Always Here for You";
const DEFAULT_DESCRIPTION =
  "Zeeme is your personal AI companion for voice and text chat. Talk, listen, and grow together with Zee — always here for you.";
const DEFAULT_IMAGE_PATH = "/zeeme-og.jpg?v=20260313b";
const DEFAULT_IMAGE_TYPE = "image/jpeg";
const DEFAULT_IMAGE_WIDTH = 1200;
const DEFAULT_IMAGE_HEIGHT = 630;

const BLOG_ARCHIVE_SHARE: BlogShareEntry = {
  title: "ZeeMe Journal",
  description:
    "Long-form product stories, field reports, research papers, and technical essays on building a companion that actually works in real life.",
  imagePath: "/blog/og/zeeme-archive-og.png",
  imageAlt: "ZeeMe Journal cover.",
};

const ABOUT_SHARE: BlogShareEntry = {
  title: "About ZeeMe",
  description:
    "Learn what ZeeMe is building: a warm, reliable AI companion experience across voice and text.",
  imagePath: DEFAULT_IMAGE_PATH,
  imageAlt: "ZeeMe companion brand cover.",
};

const TERMS_SHARE: BlogShareEntry = {
  title: "ZeeMe Terms of Service",
  description:
    "Terms covering account usage, platform boundaries, and optional Google integrations for Gmail and Calendar.",
  imagePath: DEFAULT_IMAGE_PATH,
  imageAlt: "ZeeMe Terms of Service page preview.",
};

const PRIVACY_SHARE: BlogShareEntry = {
  title: "ZeeMe Privacy Policy",
  description:
    "How ZeeMe handles personal data, Google API data usage, retention, and user privacy controls.",
  imagePath: DEFAULT_IMAGE_PATH,
  imageAlt: "ZeeMe Privacy Policy page preview.",
};

const BLOG_POST_SHARE: Record<string, BlogShareEntry> = {
  "a-day-with-zee-2026": {
    title: "A Day With Zee",
    description:
      "A narrative product story about Morning Brief, commute voice, calendar help, inbox drafts, and evening continuity in one Zee relationship lane.",
    imagePath: "/blog/a-day-with-zee-cover.jpg",
    imageAlt:
      "Editorial lifestyle image for A Day With Zee showing one man moving from morning coffee to commute voice to evening reflection.",
    imageType: "image/jpeg",
    imageWidth: 1536,
    imageHeight: 1024,
  },
  "zee-stage-missing-interface-2026": {
    title: "Zee Stage: The Missing Interface Between Conversation and Action",
    description:
      "Why chat alone breaks once an AI starts drafting, approving, and executing real tasks, and how Zee Stage closes that gap.",
    imagePath: "/blog/zee-stage-cover.jpg",
    imageAlt:
      "Editorial product image of a woman holding a phone with a refined AI task surface open.",
    imageType: "image/jpeg",
    imageWidth: 1536,
    imageHeight: 1024,
  },
  "truthful-approval-2026": {
    title: "From Sounds Good to Actually Sent",
    description:
      "A long-form essay on hands-free approval, truthful execution language, and the UX contract behind voice-driven Gmail and Calendar actions.",
    imagePath: "/blog/truthful-approval-cover.jpg",
    imageAlt:
      "Editorial image of a man approving an AI-assisted task by voice in a car at dusk.",
    imageType: "image/jpeg",
    imageWidth: 1536,
    imageHeight: 1024,
  },
  "voice-real-life-2026": {
    title: "Voice That Works in Real Life, Not Just Quiet Rooms",
    description:
      "An engineering and product essay on noise, interruption, mic tuning, and what it takes to make a voice companion trustworthy outside demos.",
    imagePath: "/blog/voice-real-life-cover.jpg",
    imageAlt:
      "Editorial commuting image of a woman using a voice AI companion on a train platform at dusk.",
    imageType: "image/jpeg",
    imageWidth: 1536,
    imageHeight: 1024,
  },
  "gmail-calendar-native-2026": {
    title: "What It Takes to Make Gmail and Calendar Feel Native Inside a Companion",
    description:
      "A feature deep dive on ambiguity, preview state, approvals, and why native-feeling Google flows require more than API calls.",
    imagePath: "/blog/google-native-flows-cover.jpg",
    imageAlt:
      "Editorial image of a woman using a phone that blends inbox and calendar help into one companion experience.",
    imageType: "image/jpeg",
    imageWidth: 1536,
    imageHeight: 1024,
  },
  "companion-economics-2026": {
    title: "The Cost of a Real-Time AI Companion",
    description:
      "A practical look at the economics of text, live voice, camera, grounded search, and Google actions in a modern companion product.",
    imagePath: "/blog/companion-economics-cover.jpg",
    imageAlt:
      "Editorial still life showing a phone, earbuds, camera, notebooks, and graph paper to represent companion cost layers.",
    imageType: "image/jpeg",
    imageWidth: 1536,
    imageHeight: 1024,
  },
  "oauth-in-the-wild-2026": {
    title: "OAuth in the Wild",
    description:
      "A builder-focused guide to localhost, preview URLs, callback determinism, and the bugs that happen when environments drift.",
    imagePath: "/blog/oauth-wild-cover.jpg",
    imageAlt:
      "Editorial image of a developer checking laptop and phone while diagnosing login reliability issues.",
    imageType: "image/jpeg",
    imageWidth: 1536,
    imageHeight: 1024,
  },
  "continuity-is-the-product-2026": {
    title: "Continuity Is the Product",
    description:
      "Why voice and text must share one memory system if a companion is going to feel like the same presence across the day.",
    imagePath: "/blog/continuity-product-cover.jpg",
    imageAlt:
      "Editorial image of the same woman moving between voice and text in a warm home setting.",
    imageType: "image/jpeg",
    imageWidth: 1536,
    imageHeight: 1024,
  },
  "hidden-reliability-layer-2026": {
    title: "The Hidden Reliability Layer Behind Zee",
    description:
      "A deep dive into traces, state machines, and failure classes that keep a warm companion from feeling random.",
    imagePath: "/blog/reliability-layer-cover.jpg",
    imageAlt:
      "Editorial image of an engineer sketching system flows while studying the hidden reliability layer behind a companion.",
    imageType: "image/jpeg",
    imageWidth: 1536,
    imageHeight: 1024,
  },
  "private-by-design-2026": {
    title: "Private By Design",
    description:
      "A trust essay on scopes, approvals, storage boundaries, and what privacy should mean when an AI can read your inbox and calendar.",
    imagePath: "/blog/private-by-design-cover.jpg",
    imageAlt:
      "Editorial image of a man calmly reviewing phone permissions in a warm home setting.",
    imageType: "image/jpeg",
    imageWidth: 1536,
    imageHeight: 1024,
  },
  "meet-zee-2026": {
    title: "Meet Zee: Your Companion for Real Life",
    description:
      "Meet Zee, the companion built for everyday life: voice + text continuity, warm conversation, and reliability that holds up in real environments.",
    imagePath: "/blog/og/meet-zee-og.jpg",
    imageAlt:
      "Diverse lifestyle scene showing voice and text continuity with Zee in a warm evening setting.",
    imageType: "image/jpeg",
    imageWidth: 1200,
    imageHeight: 630,
  },
  "zeeme-google-data-handling-security-paper-2026": {
    title: "Security Paper: Google Data Handling by Design",
    description:
      "A security architecture paper on ZeeMe's Google personal-context controls: OAuth scope minimization, token handling, traceability, and safe failure semantics.",
    imagePath: "/blog/og/zeeme-google-data-handling-security-og.png",
    imageAlt:
      "Cover image for ZeeMe Security Paper on Google data handling by design.",
  },
  "zeeme-continuity-benchmark-paper-v-2026": {
    title: "Research Paper V: Continuity Benchmark",
    description:
      "A benchmark framework for companion continuity across voice and text, calibrated against long-memory research and major assistant constraints.",
    imagePath: "/blog/og/zeeme-continuity-benchmark-og.png",
    imageAlt:
      "Cover image for ZeeMe Research Paper V continuity benchmark.",
  },
  "zeeme-google-context-gcp-field-report-2026": {
    title:
      "Field Report IV: Google Personal Context + GCP Reliability Expansion",
    description:
      "A detailed engineering report on voice email/calendar retrieval, dynamic OAuth callback routing, diagnostics, and Cloud Run reliability hardening.",
    imagePath: "/blog/og/zeeme-google-context-gcp-field-report-og.png",
    imageAlt:
      "Cover image for ZeeMe Field Report IV on Google personal context and GCP reliability.",
  },
  "zeeme-platform-thesis-2026": {
    title: "Research Paper I: ZeeMe as a Companion Operating System",
    description:
      "A systems research paper on architecture, memory contracts, and continuity guarantees across voice and text.",
    imagePath: "/blog/og/zeeme-platform-thesis-og.png",
    imageAlt: "Cover illustration for ZeeMe companion operating system research paper.",
  },
  "zeeme-engineering-case-study-2026": {
    title:
      "Case Study II: How ZeeMe Was Built with Founder Context + Agentic Pair Engineering",
    description:
      "A detailed engineering case study on build chronology, incident classes, release gates, and reliability hardening.",
    imagePath: "/blog/og/zeeme-engineering-case-study-og.png",
    imageAlt: "Cover image for ZeeMe engineering case study.",
  },
  "zeeme-memory-lab-paper-2026": {
    title:
      "Research Paper III: Memory Continuity Lab — Voice, Text, and Time Anchoring",
    description:
      "A practical research paper on safe memory assembly, contamination controls, and continuity replay protocols.",
    imagePath: "/blog/og/zeeme-memory-lab-og.png",
    imageAlt: "Cover image for ZeeMe memory continuity lab paper.",
  },
};

function escapeHtmlAttr(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function withLeadingSlash(pathname: string): string {
  if (!pathname) return "/";
  return pathname.startsWith("/") ? pathname : `/${pathname}`;
}

function normalizePathname(pathname: string): string {
  const withSlash = withLeadingSlash(pathname);
  if (withSlash.length > 1 && withSlash.endsWith("/")) {
    return withSlash.slice(0, -1);
  }
  return withSlash;
}

function replaceMetaTag(
  html: string,
  pattern: RegExp,
  replacement: string,
): string {
  if (!pattern.test(html)) return html;
  return html.replace(pattern, replacement);
}

function joinUrl(origin: string, pathname: string): string {
  return `${origin}${withLeadingSlash(pathname)}`;
}

export function resolveRequestOrigin(req: Request): string {
  const configured = process.env.PUBLIC_APP_ORIGIN?.trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  const forwardedProto = req.headers["x-forwarded-proto"];
  const protoFromForwarded =
    typeof forwardedProto === "string" && forwardedProto.length > 0
      ? forwardedProto.split(",")[0]?.trim()
      : null;
  const proto = protoFromForwarded || req.protocol || "https";
  const host = req.get("host") || "localhost:5000";
  return `${proto}://${host}`;
}

export function resolveShareMetaForPath(
  pathname: string,
  origin: string,
): ShareMeta {
  const normalizedPath = normalizePathname(pathname);
  const canonicalUrl = joinUrl(origin, normalizedPath);

  if (normalizedPath === "/about") {
    return {
      title: `${ABOUT_SHARE.title} — Zeeme`,
      description: ABOUT_SHARE.description,
      canonicalUrl,
      ogType: "website",
      imageUrl: joinUrl(origin, ABOUT_SHARE.imagePath),
      imageType: DEFAULT_IMAGE_TYPE,
      imageWidth: DEFAULT_IMAGE_WIDTH,
      imageHeight: DEFAULT_IMAGE_HEIGHT,
      imageAlt: ABOUT_SHARE.imageAlt,
      twitterCard: "summary_large_image",
    };
  }

  if (normalizedPath === "/terms") {
    return {
      title: `${TERMS_SHARE.title} — Zeeme`,
      description: TERMS_SHARE.description,
      canonicalUrl,
      ogType: "website",
      imageUrl: joinUrl(origin, TERMS_SHARE.imagePath),
      imageType: DEFAULT_IMAGE_TYPE,
      imageWidth: DEFAULT_IMAGE_WIDTH,
      imageHeight: DEFAULT_IMAGE_HEIGHT,
      imageAlt: TERMS_SHARE.imageAlt,
      twitterCard: "summary_large_image",
    };
  }

  if (normalizedPath === "/privacy") {
    return {
      title: `${PRIVACY_SHARE.title} — Zeeme`,
      description: PRIVACY_SHARE.description,
      canonicalUrl,
      ogType: "website",
      imageUrl: joinUrl(origin, PRIVACY_SHARE.imagePath),
      imageType: DEFAULT_IMAGE_TYPE,
      imageWidth: DEFAULT_IMAGE_WIDTH,
      imageHeight: DEFAULT_IMAGE_HEIGHT,
      imageAlt: PRIVACY_SHARE.imageAlt,
      twitterCard: "summary_large_image",
    };
  }

  if (normalizedPath === "/blog") {
    return {
      title: `${BLOG_ARCHIVE_SHARE.title} — Zeeme`,
      description: BLOG_ARCHIVE_SHARE.description,
      canonicalUrl,
      ogType: "website",
      imageUrl: joinUrl(origin, BLOG_ARCHIVE_SHARE.imagePath),
      imageType: BLOG_ARCHIVE_SHARE.imageType ?? "image/png",
      imageWidth: BLOG_ARCHIVE_SHARE.imageWidth ?? 1536,
      imageHeight: BLOG_ARCHIVE_SHARE.imageHeight ?? 1024,
      imageAlt: BLOG_ARCHIVE_SHARE.imageAlt,
      twitterCard: "summary_large_image",
    };
  }

  if (normalizedPath.startsWith("/blog/")) {
    const slug = decodeURIComponent(normalizedPath.slice("/blog/".length));
    const blogMeta = BLOG_POST_SHARE[slug];
    if (blogMeta) {
      return {
        title: `${blogMeta.title} — Zeeme`,
        description: blogMeta.description,
        canonicalUrl,
        ogType: "article",
        imageUrl: joinUrl(origin, blogMeta.imagePath),
        imageType: blogMeta.imageType ?? "image/png",
        imageWidth: blogMeta.imageWidth ?? 1536,
        imageHeight: blogMeta.imageHeight ?? 1024,
        imageAlt: blogMeta.imageAlt,
        twitterCard: "summary_large_image",
      };
    }
  }

  return {
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    canonicalUrl: joinUrl(origin, "/"),
    ogType: "website",
    imageUrl: joinUrl(origin, DEFAULT_IMAGE_PATH),
    imageType: DEFAULT_IMAGE_TYPE,
    imageWidth: DEFAULT_IMAGE_WIDTH,
    imageHeight: DEFAULT_IMAGE_HEIGHT,
    imageAlt: "Zeeme — Zee and Me. Your AI companion, always here for you.",
    twitterCard: "summary_large_image",
  };
}

export function injectShareMeta(template: string, meta: ShareMeta): string {
  const title = escapeHtmlAttr(meta.title);
  const description = escapeHtmlAttr(meta.description);
  const canonicalUrl = escapeHtmlAttr(meta.canonicalUrl);
  const imageUrl = escapeHtmlAttr(meta.imageUrl);
  const imageType = escapeHtmlAttr(meta.imageType);
  const imageAlt = escapeHtmlAttr(meta.imageAlt);

  let output = template;

  output = replaceMetaTag(output, /<title>[\s\S]*?<\/title>/i, `<title>${title}</title>`);
  output = replaceMetaTag(
    output,
    /<meta name="description" content="[^"]*"\s*\/?>/i,
    `<meta name="description" content="${description}" />`,
  );
  output = replaceMetaTag(
    output,
    /<link rel="canonical" href="[^"]*"\s*\/?>/i,
    `<link rel="canonical" href="${canonicalUrl}" />`,
  );
  output = replaceMetaTag(
    output,
    /<meta property="og:type" content="[^"]*"\s*\/?>/i,
    `<meta property="og:type" content="${meta.ogType}" />`,
  );
  output = replaceMetaTag(
    output,
    /<meta property="og:title" content="[^"]*"\s*\/?>/i,
    `<meta property="og:title" content="${title}" />`,
  );
  output = replaceMetaTag(
    output,
    /<meta property="og:description" content="[^"]*"\s*\/?>/i,
    `<meta property="og:description" content="${description}" />`,
  );
  output = replaceMetaTag(
    output,
    /<meta property="og:url" content="[^"]*"\s*\/?>/i,
    `<meta property="og:url" content="${canonicalUrl}" />`,
  );
  output = replaceMetaTag(
    output,
    /<meta property="og:image" content="[^"]*"\s*\/?>/i,
    `<meta property="og:image" content="${imageUrl}" />`,
  );
  output = replaceMetaTag(
    output,
    /<meta property="og:image:secure_url" content="[^"]*"\s*\/?>/i,
    `<meta property="og:image:secure_url" content="${imageUrl}" />`,
  );
  output = replaceMetaTag(
    output,
    /<meta property="og:image:type" content="[^"]*"\s*\/?>/i,
    `<meta property="og:image:type" content="${imageType}" />`,
  );
  output = replaceMetaTag(
    output,
    /<meta property="og:image:width" content="[^"]*"\s*\/?>/i,
    `<meta property="og:image:width" content="${meta.imageWidth}" />`,
  );
  output = replaceMetaTag(
    output,
    /<meta property="og:image:height" content="[^"]*"\s*\/?>/i,
    `<meta property="og:image:height" content="${meta.imageHeight}" />`,
  );
  output = replaceMetaTag(
    output,
    /<meta property="og:image:alt" content="[^"]*"\s*\/?>/i,
    `<meta property="og:image:alt" content="${imageAlt}" />`,
  );
  output = replaceMetaTag(
    output,
    /<meta name="twitter:card" content="[^"]*"\s*\/?>/i,
    `<meta name="twitter:card" content="${meta.twitterCard}" />`,
  );
  output = replaceMetaTag(
    output,
    /<meta name="twitter:title" content="[^"]*"\s*\/?>/i,
    `<meta name="twitter:title" content="${title}" />`,
  );
  output = replaceMetaTag(
    output,
    /<meta name="twitter:description" content="[^"]*"\s*\/?>/i,
    `<meta name="twitter:description" content="${description}" />`,
  );
  output = replaceMetaTag(
    output,
    /<meta name="twitter:image" content="[^"]*"\s*\/?>/i,
    `<meta name="twitter:image" content="${imageUrl}" />`,
  );
  output = replaceMetaTag(
    output,
    /<meta name="twitter:image:alt" content="[^"]*"\s*\/?>/i,
    `<meta name="twitter:image:alt" content="${imageAlt}" />`,
  );

  return output;
}
