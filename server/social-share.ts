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
};

const DEFAULT_TITLE = "Zeeme — Your AI Companion, Always Here for You";
const DEFAULT_DESCRIPTION =
  "Zeeme is your personal AI companion for voice and text chat. Talk, listen, and grow together with Zee — always here for you.";
const DEFAULT_IMAGE_PATH = "/zeeme-og.png?v=20260211";

const BLOG_ARCHIVE_SHARE: BlogShareEntry = {
  title: "ZeeMe Research Archive",
  description:
    "A curated mix of technical papers, field reports, and product stories on companion AI architecture, continuity, memory integrity, and reliability operations.",
  imagePath: "/blog/og/zeeme-archive-og.png",
  imageAlt: "ZeeMe Research Archive cover.",
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
  "meet-zee-2026": {
    title: "Meet Zee: Your Companion for Real Life",
    description:
      "Meet Zee, the companion built for everyday life: voice + text continuity, warm conversation, and reliability that holds up in real environments.",
    imagePath: "/blog/og/meet-zee-og.jpg",
    imageAlt: "Meet Zee product story cover.",
    imageType: "image/jpeg",
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
      imageType: "image/png",
      imageWidth: 1536,
      imageHeight: 1024,
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
      imageType: "image/png",
      imageWidth: 1536,
      imageHeight: 1024,
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
      imageType: "image/png",
      imageWidth: 1536,
      imageHeight: 1024,
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
      imageType: "image/png",
      imageWidth: 1536,
      imageHeight: 1024,
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
        imageWidth: 1536,
        imageHeight: 1024,
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
    imageType: "image/png",
    imageWidth: 1536,
    imageHeight: 1024,
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
