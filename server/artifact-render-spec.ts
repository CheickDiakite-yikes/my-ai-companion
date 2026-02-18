import {
  autoFixSpec,
  defineCatalog,
  formatSpecIssues,
  validateSpec,
} from "@json-render/core";
import { schema as reactSchema } from "@json-render/react";
import { z } from "zod";
import type { ArtifactRenderMetadata, ArtifactRenderSpecV1 } from "@shared/agent";

export interface PresentationSlideRenderInput {
  index: number;
  title: string;
  body: string;
  imageDataUrl: string | null;
}

type CatalogId = "zee_doc_v1" | "zee_presentation_v1";

type DocumentBlock =
  | {
      kind: "heading";
      level: 1 | 2 | 3 | 4;
      text: string;
    }
  | {
      kind: "paragraph";
      text: string;
    }
  | {
      kind: "list";
      ordered: boolean;
      items: string[];
    }
  | {
      kind: "table";
      headers: string[];
      rows: string[][];
    }
  | {
      kind: "hr";
    };

const renderCatalog = defineCatalog(reactSchema, {
  components: {
    ZeeDocShell: {
      props: z.object({
        title: z.string(),
        subtitle: z.string().nullable(),
      }),
      description: "Document shell",
    },
    ZeeHeading: {
      props: z.object({
        level: z.number().int().min(1).max(4),
        text: z.string(),
      }),
      description: "Document heading",
    },
    ZeeParagraph: {
      props: z.object({
        text: z.string(),
      }),
      description: "Document paragraph",
    },
    ZeeBulletList: {
      props: z.object({
        items: z.array(z.string()).min(1),
      }),
      description: "Document bullet list",
    },
    ZeeSlideDeck: {
      props: z.object({
        title: z.string(),
        subtitle: z.string().nullable(),
        slideCount: z.number().int().min(1).max(5),
      }),
      description: "Presentation slide deck container",
    },
    ZeeSlideCard: {
      props: z.object({
        index: z.number().int().min(1).max(5),
        title: z.string(),
        body: z.string().nullable(),
        imageDataUrl: z.string().nullable(),
      }),
      description: "Presentation slide card",
    },
  },
  actions: {},
});

function ensureSpec(spec: ArtifactRenderSpecV1): ArtifactRenderSpecV1 {
  const fixed = autoFixSpec(spec).spec as ArtifactRenderSpecV1;
  return fixed;
}

function validateRenderSpec(
  spec: ArtifactRenderSpecV1,
): { valid: boolean; errors: string[] } {
  const structural = validateSpec(spec, { checkOrphans: true });
  const catalogResult = renderCatalog.validate(spec);
  const errors: string[] = [];

  if (!structural.valid) {
    for (const issue of structural.issues) {
      errors.push(`[${issue.code}] ${issue.message}`);
    }
  }

  if (!catalogResult.success) {
    const details = catalogResult.error?.issues ?? [];
    if (details.length > 0) {
      for (const issue of details) {
        const path =
          issue.path.length > 0
            ? issue.path
                .map((segment) =>
                  typeof segment === "number"
                    ? `[${segment}]`
                    : `.${String(segment)}`,
                )
                .join("")
                .replace(/^\./, "")
            : "spec";
        errors.push(`[catalog:${path}] ${issue.message}`);
      }
    } else {
      const formatted = formatSpecIssues(structural.issues);
      if (formatted.trim().length > 0) {
        errors.push(formatted.trim());
      } else {
        errors.push("Catalog validation failed");
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inlineMarkdownToHtml(input: string): string {
  return escapeHtml(input)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
}

function parseTableRow(line: string): string[] {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  return /^\|?(\s*:?-{2,}:?\s*\|)+\s*:?-{2,}:?\s*\|?\s*$/.test(line);
}

function isTableRow(line: string): boolean {
  return /^\|.+\|/.test(line.trim());
}

function markdownToBlocks(markdown: string): DocumentBlock[] {
  const blocks: DocumentBlock[] = [];
  const lines = markdown.split(/\r?\n/);
  let activeParagraph: string[] = [];
  let activeList: string[] = [];
  let activeListOrdered = false;

  const flushParagraph = () => {
    if (activeParagraph.length === 0) return;
    blocks.push({
      kind: "paragraph",
      text: activeParagraph.join("\n").trim(),
    });
    activeParagraph = [];
  };

  const flushList = () => {
    if (activeList.length === 0) return;
    blocks.push({
      kind: "list",
      ordered: activeListOrdered,
      items: [...activeList],
    });
    activeList = [];
    activeListOrdered = false;
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      flushList();
      i++;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(trimmed)) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "hr" });
      i++;
      continue;
    }

    if (isTableRow(trimmed)) {
      const headerLine = trimmed;
      const nextIdx = i + 1;
      if (nextIdx < lines.length && isTableSeparator(lines[nextIdx].trim())) {
        flushParagraph();
        flushList();
        const headers = parseTableRow(headerLine);
        const tableRows: string[][] = [];
        i = nextIdx + 1;
        while (i < lines.length && isTableRow(lines[i].trim())) {
          tableRows.push(parseTableRow(lines[i].trim()));
          i++;
        }
        blocks.push({ kind: "table", headers, rows: tableRows });
        continue;
      }
    }

    const headingMatch = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      const level = Math.max(
        1,
        Math.min(4, headingMatch[1].length),
      ) as 1 | 2 | 3 | 4;
      blocks.push({
        kind: "heading",
        level,
        text: headingMatch[2].trim(),
      });
      i++;
      continue;
    }

    const unorderedMatch = trimmed.match(/^[-*]\s+(.*)$/);
    if (unorderedMatch) {
      flushParagraph();
      if (activeList.length > 0 && activeListOrdered) {
        flushList();
      }
      activeListOrdered = false;
      activeList.push(unorderedMatch[1].trim());
      i++;
      continue;
    }

    const orderedMatch = trimmed.match(/^\d+[.)]\s+(.*)$/);
    if (orderedMatch) {
      flushParagraph();
      if (activeList.length > 0 && !activeListOrdered) {
        flushList();
      }
      activeListOrdered = true;
      activeList.push(orderedMatch[1].trim());
      i++;
      continue;
    }

    flushList();
    activeParagraph.push(trimmed);
    i++;
  }

  flushParagraph();
  flushList();

  if (blocks.length === 0) {
    blocks.push({
      kind: "paragraph",
      text: "No content was generated.",
    });
  }

  return blocks;
}

function buildDocumentSpec(input: {
  title: string;
  subtitle: string | null;
  markdown: string;
}): ArtifactRenderSpecV1 {
  const blocks = markdownToBlocks(input.markdown);
  const elements: ArtifactRenderSpecV1["elements"] = {
    "doc-shell": {
      type: "ZeeDocShell",
      props: {
        title: input.title,
        subtitle: input.subtitle,
      },
      children: [],
    },
  };

  blocks.forEach((block, index) => {
    const key = `doc-block-${index + 1}`;
    let element: ArtifactRenderSpecV1["elements"][string];
    if (block.kind === "heading") {
      element = {
        type: "ZeeHeading",
        props: { level: block.level, text: block.text },
        children: [],
      };
    } else if (block.kind === "list") {
      element = {
        type: "ZeeBulletList",
        props: { items: block.items },
        children: [],
      };
    } else if (block.kind === "table" || block.kind === "hr") {
      element = {
        type: "ZeeParagraph",
        props: { text: block.kind === "hr" ? "---" : "[table]" },
        children: [],
      };
    } else {
      element = {
        type: "ZeeParagraph",
        props: { text: block.text },
        children: [],
      };
    }
    Object.defineProperty(elements, key, { value: element, writable: true, enumerable: true, configurable: true });
    elements["doc-shell"].children?.push(key);
  });

  return {
    root: "doc-shell",
    elements,
  };
}

function buildPresentationSpec(input: {
  title: string;
  subtitle: string | null;
  slides: PresentationSlideRenderInput[];
}): ArtifactRenderSpecV1 {
  const elements: ArtifactRenderSpecV1["elements"] = {
    "deck-shell": {
      type: "ZeeSlideDeck",
      props: {
        title: input.title,
        subtitle: input.subtitle,
        slideCount: input.slides.length,
      },
      children: [],
    },
  };

  input.slides.forEach((slide, index) => {
    const key = `slide-${index + 1}`;
    const element = {
      type: "ZeeSlideCard" as const,
      props: {
        index: slide.index,
        title: slide.title,
        body: slide.body || null,
        imageDataUrl: slide.imageDataUrl,
      },
      children: [] as string[],
    };
    Object.defineProperty(elements, key, { value: element, writable: true, enumerable: true, configurable: true });
    elements["deck-shell"].children?.push(key);
  });

  return {
    root: "deck-shell",
    elements,
  };
}

function renderDocumentHtml(input: {
  title: string;
  subtitle: string | null;
  markdown: string;
}): string {
  const blocks = markdownToBlocks(input.markdown);
  const bodyHtml = blocks
    .map((block) => {
      if (block.kind === "heading") {
        return `<h${block.level}>${inlineMarkdownToHtml(block.text)}</h${block.level}>`;
      }
      if (block.kind === "list") {
        const items = block.items
          .map((item) => `<li>${inlineMarkdownToHtml(item)}</li>`)
          .join("");
        const tag = block.ordered ? "ol" : "ul";
        return `<${tag}>${items}</${tag}>`;
      }
      if (block.kind === "table") {
        const headerCells = block.headers
          .map((h) => `<th>${inlineMarkdownToHtml(h)}</th>`)
          .join("");
        const bodyRows = block.rows
          .map(
            (row) =>
              `<tr>${row.map((cell) => `<td>${inlineMarkdownToHtml(cell)}</td>`).join("")}</tr>`,
          )
          .join("");
        return `<div class="table-wrap"><table><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table></div>`;
      }
      if (block.kind === "hr") {
        return `<hr />`;
      }
      return block.text
        .split("\n")
        .map((line) => `<p>${inlineMarkdownToHtml(line)}</p>`)
        .join("");
    })
    .join("\n");

  const subtitleHtml = input.subtitle
    ? `<p class="subtitle">${escapeHtml(input.subtitle)}</p>`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(input.title)}</title>
    <style>
      :root { color-scheme: light; }
      body {
        margin: 0;
        padding: 24px;
        font-family: "DM Sans", sans-serif;
        background: #f7f0df;
        color: #2a1d10;
      }
      .shell {
        max-width: 800px;
        margin: 0 auto;
        background: rgba(255, 255, 255, 0.84);
        border: 1px solid rgba(42, 29, 16, 0.16);
        border-radius: 16px;
        padding: 24px;
      }
      h1, h2, h3, h4 {
        font-family: "Outfit", sans-serif;
        margin: 0 0 12px;
      }
      .subtitle {
        margin: 0 0 16px;
        opacity: 0.75;
      }
      p, li { line-height: 1.6; }
      code {
        background: rgba(0, 0, 0, 0.07);
        border-radius: 6px;
        padding: 0.1em 0.35em;
      }
      ul, ol {
        margin: 0 0 16px;
        padding-left: 24px;
      }
      ol { list-style-type: decimal; }
      hr {
        border: none;
        border-top: 1px solid rgba(42, 29, 16, 0.18);
        margin: 20px 0;
      }
      .table-wrap {
        overflow-x: auto;
        margin: 16px 0;
        border-radius: 10px;
        border: 1px solid rgba(42, 29, 16, 0.15);
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.92em;
      }
      thead {
        background: rgba(42, 29, 16, 0.07);
      }
      th {
        text-align: left;
        font-weight: 600;
        padding: 10px 14px;
        border-bottom: 2px solid rgba(42, 29, 16, 0.18);
        white-space: nowrap;
      }
      td {
        padding: 8px 14px;
        border-bottom: 1px solid rgba(42, 29, 16, 0.09);
      }
      tbody tr:last-child td {
        border-bottom: none;
      }
      tbody tr:nth-child(even) {
        background: rgba(42, 29, 16, 0.025);
      }
    </style>
  </head>
  <body>
    <article class="shell">
      <h1>${escapeHtml(input.title)}</h1>
      ${subtitleHtml}
      ${bodyHtml}
    </article>
  </body>
</html>`;
}

function renderPresentationHtml(input: {
  title: string;
  subtitle: string | null;
  slides: PresentationSlideRenderInput[];
}): string {
  const subtitleHtml = input.subtitle
    ? `<p class="deck-subtitle">${escapeHtml(input.subtitle)}</p>`
    : "";

  const slidesHtml = input.slides
    .map((slide) => {
      const body = (slide.body || "")
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0)
        .map((line) => `<p>${inlineMarkdownToHtml(line.trim())}</p>`)
        .join("");
      return `<section class="slide">
  <header class="slide-head">
    <span class="slide-index">Slide ${slide.index}</span>
    <h2>${escapeHtml(slide.title)}</h2>
  </header>
  ${
    slide.imageDataUrl
      ? `<img class="slide-image" src="${slide.imageDataUrl}" alt="${escapeHtml(slide.title)}" />`
      : `<article class="slide-body">${body || "<p>Slide content unavailable.</p>"}</article>`
  }
</section>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(input.title)}</title>
    <style>
      :root { color-scheme: light; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: 20px;
        font-family: "DM Sans", sans-serif;
        background: #f5ecda;
        color: #2a1d10;
      }
      .deck-header {
        width: 100%;
        max-width: 960px;
        margin: 0 auto 16px;
      }
      .deck-header h1 {
        margin: 0;
        font-family: "Outfit", sans-serif;
      }
      .deck-subtitle {
        margin: 8px 0 0;
        opacity: 0.74;
      }
      .slide {
        width: 100%;
        max-width: 960px;
        margin: 0 auto 18px;
        background: rgba(255, 255, 255, 0.88);
        border: 1px solid rgba(42, 29, 16, 0.15);
        border-radius: 16px;
        padding: 16px;
        page-break-after: always;
      }
      .slide:last-child {
        page-break-after: auto;
      }
      .slide-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 10px;
      }
      .slide-head h2 {
        margin: 0;
        font-family: "Outfit", sans-serif;
      }
      .slide-index {
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        opacity: 0.7;
      }
      .slide-image {
        width: 100%;
        aspect-ratio: 16 / 9;
        object-fit: cover;
        border-radius: 12px;
        border: 1px solid rgba(42, 29, 16, 0.18);
        background: #e7dcc6;
      }
      .slide-body p {
        margin: 0 0 10px;
        line-height: 1.58;
      }
      @media print {
        body { background: #fff; padding: 0; }
        .slide {
          border: none;
          border-radius: 0;
          margin: 0;
          min-height: 100vh;
        }
      }
    </style>
  </head>
  <body>
    <header class="deck-header">
      <h1>${escapeHtml(input.title)}</h1>
      ${subtitleHtml}
    </header>
    ${slidesHtml}
  </body>
</html>`;
}

function buildRenderMetadata(input: {
  catalog: CatalogId;
  spec: ArtifactRenderSpecV1;
  errors: string[];
}): ArtifactRenderMetadata {
  const metadata: ArtifactRenderMetadata = {
    engine: "json_render",
    version: "v1",
    catalog: input.catalog,
    spec: input.spec,
    validatedAt: new Date().toISOString(),
  };
  if (input.errors.length > 0) {
    metadata.validationErrors = input.errors.slice(0, 12);
  }
  return metadata;
}

export function buildDocumentRenderPayload(input: {
  title: string;
  subtitle?: string | null;
  markdown: string;
}): {
  metadata: ArtifactRenderMetadata;
  html: string;
  valid: boolean;
  validationErrors: string[];
} {
  const spec = ensureSpec(
    buildDocumentSpec({
      title: input.title,
      subtitle: input.subtitle ?? null,
      markdown: input.markdown,
    }),
  );
  const validation = validateRenderSpec(spec);
  return {
    metadata: buildRenderMetadata({
      catalog: "zee_doc_v1",
      spec,
      errors: validation.errors,
    }),
    html: renderDocumentHtml({
      title: input.title,
      subtitle: input.subtitle ?? null,
      markdown: input.markdown,
    }),
    valid: validation.valid,
    validationErrors: validation.errors,
  };
}

export function buildPresentationRenderPayload(input: {
  title: string;
  subtitle?: string | null;
  slides: PresentationSlideRenderInput[];
}): {
  metadata: ArtifactRenderMetadata;
  html: string;
  valid: boolean;
  validationErrors: string[];
} {
  const spec = ensureSpec(
    buildPresentationSpec({
      title: input.title,
      subtitle: input.subtitle ?? null,
      slides: input.slides,
    }),
  );
  const validation = validateRenderSpec(spec);
  return {
    metadata: buildRenderMetadata({
      catalog: "zee_presentation_v1",
      spec,
      errors: validation.errors,
    }),
    html: renderPresentationHtml({
      title: input.title,
      subtitle: input.subtitle ?? null,
      slides: input.slides,
    }),
    valid: validation.valid,
    validationErrors: validation.errors,
  };
}
