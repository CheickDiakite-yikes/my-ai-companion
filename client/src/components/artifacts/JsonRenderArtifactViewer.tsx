import { defineCatalog } from "@json-render/core";
import {
  ActionProvider,
  Renderer,
  StateProvider,
  ValidationProvider,
  VisibilityProvider,
  defineRegistry,
  schema as jsonRenderSchema,
} from "@json-render/react";
import { z } from "zod";
import type {
  ArtifactRenderMetadata,
  ArtifactRenderSpecV1,
} from "@shared/agent";

const zeeRenderCatalog = defineCatalog(jsonRenderSchema, {
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
      description: "Document list",
    },
    ZeeSlideDeck: {
      props: z.object({
        title: z.string(),
        subtitle: z.string().nullable(),
        slideCount: z.number().int().min(1).max(5),
      }),
      description: "Presentation shell",
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

const { registry } = defineRegistry(zeeRenderCatalog, {
  components: {
    ZeeDocShell: ({ props, children }) => (
      <article
        className="rounded-xl border p-5 sm:p-6"
        style={{
          borderColor: "var(--app-soft-card-border)",
          backgroundColor: "var(--app-soft-card-bg)",
          color: "var(--app-on-dark)",
        }}
      >
        <header className="mb-4">
          <h1 className="text-2xl font-semibold tracking-tight">{props.title}</h1>
          {props.subtitle ? (
            <p className="mt-1 text-sm opacity-75">{props.subtitle}</p>
          ) : null}
        </header>
        <div className="space-y-3 text-sm leading-relaxed">{children}</div>
      </article>
    ),
    ZeeHeading: ({ props }) => {
      const Tag = `h${Math.max(1, Math.min(4, props.level))}` as
        | "h1"
        | "h2"
        | "h3"
        | "h4";
      const headingClassName =
        props.level <= 2
          ? "text-lg font-semibold tracking-tight"
          : "text-base font-semibold";
      return <Tag className={headingClassName}>{props.text}</Tag>;
    },
    ZeeParagraph: ({ props }) => (
      <p className="whitespace-pre-wrap text-sm leading-relaxed">{props.text}</p>
    ),
    ZeeBulletList: ({ props }) => (
      <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed">
        {props.items.map((item, idx) => (
          <li key={`${item}-${idx}`}>{item}</li>
        ))}
      </ul>
    ),
    ZeeSlideDeck: ({ props, children }) => (
      <section className="space-y-4">
        <header>
          <h1 className="text-xl font-semibold tracking-tight">{props.title}</h1>
          {props.subtitle ? (
            <p className="mt-1 text-sm opacity-75">{props.subtitle}</p>
          ) : null}
          <p className="mt-2 text-xs uppercase tracking-wide opacity-70">
            {props.slideCount} slide{props.slideCount === 1 ? "" : "s"}
          </p>
        </header>
        <div className="space-y-3">{children}</div>
      </section>
    ),
    ZeeSlideCard: ({ props }) => (
      <article
        className="rounded-xl border p-3 sm:p-4"
        style={{
          borderColor: "var(--app-soft-card-border)",
          backgroundColor: "var(--app-soft-card-bg)",
          color: "var(--app-on-dark)",
        }}
      >
        <header className="mb-2 flex items-center justify-between gap-3">
          <span className="text-xs uppercase tracking-wide opacity-70">
            Slide {props.index}
          </span>
          <h2 className="text-sm font-semibold">{props.title}</h2>
        </header>
        {props.imageDataUrl ? (
          <img
            src={props.imageDataUrl}
            alt={props.title}
            className="w-full rounded-lg border object-cover"
            style={{
              borderColor: "var(--app-soft-card-border)",
              aspectRatio: "16 / 9",
            }}
          />
        ) : (
          <p className="whitespace-pre-wrap text-sm leading-relaxed">
            {props.body ?? "No slide body available."}
          </p>
        )}
      </article>
    ),
  },
});

function isArtifactRenderSpecV1(value: unknown): value is ArtifactRenderSpecV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const root = (value as Record<string, unknown>).root;
  const elements = (value as Record<string, unknown>).elements;
  if (typeof root !== "string" || root.trim().length === 0) return false;
  if (!elements || typeof elements !== "object" || Array.isArray(elements)) {
    return false;
  }
  return true;
}

function toArtifactRenderMetadata(value: unknown): ArtifactRenderMetadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const render = (value as Record<string, unknown>).render;
  if (!render || typeof render !== "object" || Array.isArray(render)) return null;

  const candidate = render as Record<string, unknown>;
  const engine = candidate.engine;
  const version = candidate.version;
  const catalog = candidate.catalog;
  const spec = candidate.spec;
  const validatedAt = candidate.validatedAt;
  const validationErrors = candidate.validationErrors;

  if (engine !== "json_render" || version !== "v1") return null;
  if (catalog !== "zee_doc_v1" && catalog !== "zee_presentation_v1") return null;
  if (!isArtifactRenderSpecV1(spec)) return null;
  if (typeof validatedAt !== "string" || validatedAt.trim().length === 0) return null;
  if (
    validationErrors !== undefined &&
    (!Array.isArray(validationErrors) ||
      validationErrors.some((entry) => typeof entry !== "string"))
  ) {
    return null;
  }

  return {
    engine,
    version,
    catalog,
    spec,
    validatedAt,
    validationErrors: Array.isArray(validationErrors)
      ? (validationErrors as string[])
      : undefined,
  };
}

export const JsonRenderArtifactViewer = ({
  metadata,
}: {
  metadata: unknown;
}) => {
  const renderMetadata = toArtifactRenderMetadata(metadata);

  if (!renderMetadata) {
    return (
      <div
        className="h-full overflow-auto rounded-xl border p-4 text-sm leading-relaxed"
        style={{
          borderColor: "var(--app-soft-card-border)",
          backgroundColor: "var(--app-soft-card-bg)",
        }}
      >
        <p className="opacity-80">
          Render model is unavailable for this artifact.
        </p>
      </div>
    );
  }

  if (renderMetadata.validationErrors && renderMetadata.validationErrors.length > 0) {
    return (
      <div
        className="h-full overflow-auto rounded-xl border p-4 text-sm leading-relaxed"
        style={{
          borderColor: "var(--app-soft-card-border)",
          backgroundColor: "var(--app-soft-card-bg)",
        }}
      >
        <p className="mb-2 font-semibold">Render model validation failed.</p>
        <ul className="list-disc space-y-1 pl-5">
          {renderMetadata.validationErrors.map((error, idx) => (
            <li key={`${error}-${idx}`}>{error}</li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div
      className="h-full overflow-auto rounded-xl border p-3 sm:p-4"
      style={{
        borderColor: "var(--app-soft-card-border)",
        backgroundColor: "var(--app-soft-card-bg)",
      }}
      data-testid="json-render-artifact-viewer"
    >
      <StateProvider initialState={renderMetadata.spec.state ?? {}}>
        <VisibilityProvider>
          <ValidationProvider>
            <ActionProvider>
              <Renderer spec={renderMetadata.spec} registry={registry} />
            </ActionProvider>
          </ValidationProvider>
        </VisibilityProvider>
      </StateProvider>
    </div>
  );
};
