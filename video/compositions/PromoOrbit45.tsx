import React from "react";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export type PromoOrbitProps = {
  userName: string;
};

const RELATIONSHIP_WORDS = [
  "Bestie",
  "Homie",
  "Friend",
  "Assistant",
  "Helper",
  "Confidant",
] as const;

const SCENE_DURATIONS = [210, 300, 390, 300, 210] as const;
const TRANSITION_FRAMES = 15;

export const PROMO_DURATION_IN_FRAMES =
  SCENE_DURATIONS.reduce((sum, frames) => sum + frames, 0) -
  TRANSITION_FRAMES * (SCENE_DURATIONS.length - 1);

type SceneTheme = {
  bgGradient: string;
  orbColor: string;
  orbGlow: string;
  ringColor: string;
  particleColor: string;
  titleColor: string;
  subtitleColor: string;
  accentColor: string;
  buttonBorder: string;
  buttonGlow: string;
};

const THEMES: readonly SceneTheme[] = [
  {
    bgGradient:
      "radial-gradient(120% 80% at 50% 5%, rgba(138, 204, 214, 0.85) 0%, rgba(31, 67, 94, 0.85) 45%, rgba(1, 7, 24, 1) 100%)",
    orbColor: "#55EFE5",
    orbGlow: "rgba(85, 239, 229, 0.55)",
    ringColor: "rgba(112, 247, 236, 0.22)",
    particleColor: "rgba(125, 255, 248, 0.78)",
    titleColor: "#EAF3FF",
    subtitleColor: "rgba(215, 232, 246, 0.9)",
    accentColor: "#5BF5EA",
    buttonBorder: "rgba(143, 227, 235, 0.55)",
    buttonGlow: "rgba(66, 247, 235, 0.45)",
  },
  {
    bgGradient:
      "radial-gradient(120% 80% at 50% 5%, rgba(231, 166, 153, 0.9) 0%, rgba(101, 56, 71, 0.88) 45%, rgba(18, 3, 19, 1) 100%)",
    orbColor: "#FF963E",
    orbGlow: "rgba(255, 150, 62, 0.55)",
    ringColor: "rgba(255, 182, 122, 0.2)",
    particleColor: "rgba(255, 187, 122, 0.76)",
    titleColor: "#FFE8CF",
    subtitleColor: "rgba(248, 214, 186, 0.92)",
    accentColor: "#FFAB58",
    buttonBorder: "rgba(245, 184, 134, 0.5)",
    buttonGlow: "rgba(255, 149, 74, 0.42)",
  },
  {
    bgGradient:
      "radial-gradient(120% 80% at 50% 5%, rgba(157, 135, 231, 0.92) 0%, rgba(74, 53, 126, 0.9) 45%, rgba(13, 6, 37, 1) 100%)",
    orbColor: "#B575FF",
    orbGlow: "rgba(181, 117, 255, 0.58)",
    ringColor: "rgba(211, 173, 255, 0.2)",
    particleColor: "rgba(216, 174, 255, 0.78)",
    titleColor: "#F3E6FF",
    subtitleColor: "rgba(224, 198, 255, 0.9)",
    accentColor: "#C684FF",
    buttonBorder: "rgba(202, 160, 255, 0.52)",
    buttonGlow: "rgba(176, 112, 255, 0.48)",
  },
];

const PARTICLE_POINTS = [
  { x: 0.12, y: 0.16, size: 6, phase: 0.1 },
  { x: 0.2, y: 0.22, size: 5, phase: 0.9 },
  { x: 0.3, y: 0.18, size: 4, phase: 1.2 },
  { x: 0.42, y: 0.2, size: 5, phase: 2.1 },
  { x: 0.57, y: 0.16, size: 4, phase: 2.8 },
  { x: 0.68, y: 0.22, size: 6, phase: 3.4 },
  { x: 0.78, y: 0.19, size: 5, phase: 4.0 },
  { x: 0.86, y: 0.15, size: 4, phase: 4.9 },
  { x: 0.2, y: 0.36, size: 4, phase: 1.8 },
  { x: 0.32, y: 0.39, size: 6, phase: 2.4 },
  { x: 0.5, y: 0.41, size: 5, phase: 3.2 },
  { x: 0.7, y: 0.38, size: 4, phase: 4.4 },
  { x: 0.82, y: 0.34, size: 5, phase: 5.0 },
] as const;

const FONT_DISPLAY = '"Fraunces", "Iowan Old Style", "Times New Roman", serif';
const FONT_BODY = '"Sora", "Avenir Next", "Segoe UI", sans-serif';

const timing = linearTiming({ durationInFrames: TRANSITION_FRAMES });

const FrameGrain: React.FC = () => {
  return (
    <AbsoluteFill
      style={{
        mixBlendMode: "screen",
        opacity: 0.05,
        backgroundImage:
          "radial-gradient(circle at 20% 20%, rgba(255,255,255,0.45) 1px, transparent 1px), radial-gradient(circle at 80% 80%, rgba(255,255,255,0.36) 1px, transparent 1px)",
        backgroundSize: "6px 6px, 9px 9px",
      }}
    />
  );
};

const Vignette: React.FC = () => {
  return (
    <AbsoluteFill
      style={{
        pointerEvents: "none",
        background:
          "radial-gradient(120% 70% at 50% 12%, rgba(255,255,255,0) 0%, rgba(0,0,0,0.2) 52%, rgba(0,0,0,0.64) 100%)",
      }}
    />
  );
};

const OrbVisual: React.FC<{
  theme: SceneTheme;
  withWave?: boolean;
}> = ({ theme, withWave = false }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const pulse = 1 + Math.sin(frame / (fps * 0.12)) * 0.045;
  const glowPulse = interpolate(Math.sin(frame / (fps * 0.09)), [-1, 1], [0.35, 0.62]);

  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          top: 190,
          left: "50%",
          width: 630,
          height: 630,
          transform: "translateX(-50%)",
        }}
      >
        {[0, 1, 2, 3].map((ring) => {
          const ringScale = 1 + ring * 0.24 + Math.sin(frame / 38 + ring) * 0.02;
          const opacity = interpolate(Math.sin(frame / 29 + ring), [-1, 1], [0.08, 0.24]);
          return (
            <div
              key={`ring-${ring}`}
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                width: 220,
                height: 220,
                borderRadius: 999,
                border: `2px solid ${theme.ringColor}`,
                opacity,
                transform: `translate(-50%, -50%) scale(${ringScale})`,
              }}
            />
          );
        })}

        {withWave ? (
          <>
            {[0, 1].map((wave) => {
              const vertical = wave === 0 ? -10 : 14;
              const skew = Math.sin(frame / 25 + wave * 2) * 7;
              const width = 380 + wave * 40;
              return (
                <div
                  key={`wave-${wave}`}
                  style={{
                    position: "absolute",
                    top: "50%",
                    left: "50%",
                    width,
                    height: 2,
                    borderRadius: 999,
                    background: theme.ringColor,
                    opacity: 0.6 - wave * 0.2,
                    transform: `translate(-50%, ${vertical}px) skewX(${skew}deg)`,
                  }}
                />
              );
            })}
          </>
        ) : null}

        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            width: 270,
            height: 270,
            borderRadius: 999,
            transform: `translate(-50%, -50%) scale(${pulse})`,
            background: `radial-gradient(circle at 40% 32%, rgba(255,255,255,0.62) 0%, ${theme.orbColor} 45%, rgba(0,0,0,0.2) 100%)`,
            boxShadow: `0 0 88px ${theme.orbGlow}, inset 0 -10px 20px rgba(0,0,0,0.24)`,
            border: `3px solid ${theme.ringColor}`,
            opacity: glowPulse,
          }}
        />

        {PARTICLE_POINTS.map((point, index) => {
          const driftX = Math.sin(frame / 35 + point.phase + index * 0.3) * 18;
          const driftY = Math.cos(frame / 44 + point.phase + index * 0.22) * 14;
          const alpha = interpolate(
            Math.sin(frame / 27 + point.phase),
            [-1, 1],
            [0.2, 0.95],
          );

          return (
            <div
              key={`particle-${index}`}
              style={{
                position: "absolute",
                left: `${point.x * 100}%`,
                top: `${point.y * 100}%`,
                width: point.size,
                height: point.size,
                borderRadius: 999,
                background: theme.particleColor,
                boxShadow: `0 0 18px ${theme.particleColor}`,
                opacity: alpha,
                transform: `translate(${driftX}px, ${driftY}px)`,
              }}
            />
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const FragmentedTypeAura: React.FC<{
  theme: SceneTheme;
  isActive: boolean;
}> = ({ theme, isActive }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const reveal = spring({
    frame,
    fps,
    config: { damping: 200 },
    durationInFrames: fps * 2,
  });

  if (!isActive) return null;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 500,
        left: "50%",
        width: 760,
        transform: "translateX(-50%)",
        opacity: reveal * 0.6,
      }}
    >
      {[0, 1, 2].map((index) => {
        const x = interpolate(
          reveal,
          [0, 1],
          [index % 2 === 0 ? -90 : 90, 0],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
        );
        return (
          <div
            key={`type-aura-${index}`}
            style={{
              marginTop: index === 0 ? 0 : 12,
              height: 16,
              borderRadius: 999,
              width: 760 - index * 70,
              background: `linear-gradient(90deg, transparent 0%, ${theme.ringColor} 20%, ${theme.ringColor} 80%, transparent 100%)`,
              transform: `translateX(${x}px)`,
            }}
          />
        );
      })}
    </div>
  );
};

const MessageFlowCards: React.FC<{ theme: SceneTheme }> = ({ theme }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const items = [
    { side: "right", text: "Talk or text?", delay: 0.2 },
    { side: "left", text: "Same memory.", delay: 0.6 },
    { side: "right", text: "Same flow.", delay: 1.0 },
  ] as const;

  return (
    <>
      {items.map((item, index) => {
        const local = spring({
          frame: frame - Math.floor(item.delay * fps),
          fps,
          config: { damping: 200 },
          durationInFrames: Math.floor(fps * 0.9),
        });

        const translateX = interpolate(
          local,
          [0, 1],
          [item.side === "right" ? 70 : -70, 0],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
        );

        const opacity = interpolate(local, [0, 1], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });

        return (
          <div
            key={`flow-card-${index}`}
            style={{
              position: "absolute",
              left: item.side === "right" ? "50%" : "auto",
              right: item.side === "left" ? "50%" : "auto",
              transform: `translate(${item.side === "right" ? "-10%" : "10%"}, 0) translateX(${translateX}px)`,
              top: 800 + index * 118,
              width: 370,
              borderRadius: 34,
              padding: "24px 28px",
              border: `1px solid ${theme.buttonBorder}`,
              background:
                item.side === "right"
                  ? "rgba(255,255,255,0.18)"
                  : "rgba(255,255,255,0.12)",
              color: theme.titleColor,
              fontFamily: FONT_BODY,
              fontWeight: 650,
              fontSize: 40,
              letterSpacing: 0.3,
              boxShadow: "0 14px 24px rgba(0,0,0,0.2)",
              opacity,
            }}
          >
            {item.text}
          </div>
        );
      })}
    </>
  );
};

const BottomBar: React.FC<{
  activeIndex: number;
  theme: SceneTheme;
  ctaLabel: string;
}> = ({ activeIndex, theme, ctaLabel }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const pulse = interpolate(
    Math.sin(frame / (fps * 0.17)),
    [-1, 1],
    [0.72, 1],
  );

  return (
    <div
      style={{
        position: "absolute",
        left: 96,
        right: 96,
        bottom: 114,
        display: "flex",
        flexDirection: "column",
        gap: 44,
      }}
    >
      <div style={{ display: "flex", justifyContent: "center", gap: 16 }}>
        {[0, 1, 2].map((dot) => (
          <div
            key={`dot-${dot}`}
            style={{
              width: dot === activeIndex ? 20 : 18,
              height: dot === activeIndex ? 20 : 18,
              borderRadius: 999,
              background:
                dot === activeIndex ? theme.accentColor : "rgba(255,255,255,0.16)",
              boxShadow:
                dot === activeIndex
                  ? `0 0 16px ${theme.accentColor}`
                  : "none",
              opacity: dot === activeIndex ? pulse : 1,
            }}
          />
        ))}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            color: "rgba(226, 236, 246, 0.8)",
            fontSize: 54,
            fontFamily: FONT_BODY,
            fontWeight: 500,
          }}
        >
          Skip
        </div>

        <div
          style={{
            width: 470,
            borderRadius: 34,
            border: `2px solid ${theme.buttonBorder}`,
            padding: "24px 0",
            textAlign: "center",
            color: "#F1F4F9",
            fontSize: 58,
            fontFamily: FONT_BODY,
            fontWeight: 700,
            letterSpacing: 0.2,
            background:
              "linear-gradient(135deg, rgba(255,255,255,0.14), rgba(255,255,255,0.06))",
            boxShadow: `0 0 48px ${theme.buttonGlow}`,
          }}
        >
          {ctaLabel}
        </div>
      </div>
    </div>
  );
};

const SceneShell: React.FC<{
  theme: SceneTheme;
  title: React.ReactNode;
  subtitle: string;
  activeDot: number;
  ctaLabel: string;
  withWave?: boolean;
  withFragments?: boolean;
  children?: React.ReactNode;
}> = ({
  theme,
  title,
  subtitle,
  activeDot,
  ctaLabel,
  withWave = false,
  withFragments = false,
  children,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleIn = spring({
    frame,
    fps,
    config: { damping: 200 },
    durationInFrames: Math.floor(fps * 1.4),
  });

  const subtitleOpacity = interpolate(
    frame,
    [Math.floor(fps * 0.45), Math.floor(fps * 1.2)],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.quad) },
  );

  return (
    <AbsoluteFill
      style={{
        background: theme.bgGradient,
        overflow: "hidden",
      }}
    >
      <FrameGrain />
      <OrbVisual theme={theme} withWave={withWave} />
      <FragmentedTypeAura theme={theme} isActive={withFragments} />
      {children}

      <div
        style={{
          position: "absolute",
          left: "50%",
          bottom: 430,
          width: 860,
          transform: `translateX(-50%) translateY(${interpolate(titleIn, [0, 1], [28, 0])}px)`,
          opacity: titleIn,
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          gap: 24,
          alignItems: "center",
        }}
      >
        <div
          style={{
            fontFamily: FONT_DISPLAY,
            color: theme.titleColor,
            fontSize: 94,
            lineHeight: 1.08,
            letterSpacing: -0.5,
            fontWeight: 700,
            textWrap: "balance",
          }}
        >
          {title}
        </div>

        <div
          style={{
            fontFamily: FONT_BODY,
            color: theme.subtitleColor,
            fontSize: 58,
            lineHeight: 1.25,
            fontWeight: 500,
            maxWidth: 770,
            opacity: subtitleOpacity,
          }}
        >
          {subtitle}
        </div>
      </div>

      <BottomBar activeIndex={activeDot} theme={theme} ctaLabel={ctaLabel} />
      <Vignette />
    </AbsoluteFill>
  );
};

const SceneOne: React.FC<{ userName: string }> = ({ userName }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const wordIndex = Math.floor(frame / Math.floor(fps * 0.7)) % RELATIONSHIP_WORDS.length;
  const relationshipWord = RELATIONSHIP_WORDS[wordIndex];

  return (
    <SceneShell
      theme={THEMES[0]}
      title={
        <>
          Welcome {userName}, I&apos;m Zee, your{" "}
          <span
            style={{
              color: THEMES[0].accentColor,
              whiteSpace: "nowrap",
            }}
          >
            {relationshipWord}.
          </span>
        </>
      }
      subtitle="I’m here with you."
      activeDot={0}
      ctaLabel="Next"
      withFragments
    />
  );
};

const SceneTwo: React.FC = () => {
  return (
    <SceneShell
      theme={THEMES[1]}
      title="I’m here to listen."
      subtitle="A shoulder to lean on."
      activeDot={1}
      ctaLabel="Next"
      withWave
      withFragments
    />
  );
};

const SceneThree: React.FC = () => {
  return (
    <SceneShell
      theme={THEMES[2]}
      title="See it. Share it."
      subtitle="Understand it in real time."
      activeDot={2}
      ctaLabel="Next"
      withWave
    >
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: 760,
          transform: "translateX(-50%)",
          display: "flex",
          gap: 24,
        }}
      >
        {["Camera", "Gallery", "Live"].map((label, index) => {
          const frame = useCurrentFrame();
          const { fps } = useVideoConfig();
          const reveal = spring({
            frame: frame - index * Math.floor(fps * 0.2),
            fps,
            config: { damping: 200 },
            durationInFrames: Math.floor(fps * 0.9),
          });

          const y = interpolate(reveal, [0, 1], [40, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });

          return (
            <div
              key={label}
              style={{
                width: 220,
                borderRadius: 28,
                border: `1px solid ${THEMES[2].buttonBorder}`,
                background: "rgba(255,255,255,0.12)",
                padding: "20px 16px",
                textAlign: "center",
                color: THEMES[2].titleColor,
                fontFamily: FONT_BODY,
                fontSize: 34,
                fontWeight: 600,
                transform: `translateY(${y}px)`,
                opacity: reveal,
                boxShadow: "0 10px 24px rgba(0,0,0,0.24)",
              }}
            >
              {label}
            </div>
          );
        })}
      </div>
    </SceneShell>
  );
};

const SceneFour: React.FC = () => {
  return (
    <SceneShell
      theme={THEMES[2]}
      title="Talk or text."
      subtitle="Same memory. Same flow."
      activeDot={2}
      ctaLabel="Next"
      withWave
    >
      <MessageFlowCards theme={THEMES[2]} />
    </SceneShell>
  );
};

const SceneFive: React.FC = () => {
  return (
    <SceneShell
      theme={THEMES[2]}
      title="We grow together."
      subtitle="Our journey, our bond."
      activeDot={2}
      ctaLabel="Get Started"
      withWave
      withFragments
    />
  );
};

export const PromoOrbit45: React.FC<PromoOrbitProps> = ({ userName }) => {
  return (
    <AbsoluteFill style={{ WebkitFontSmoothing: "antialiased" }}>
      <TransitionSeries>
        <TransitionSeries.Sequence durationInFrames={SCENE_DURATIONS[0]}>
          <SceneOne userName={userName} />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition presentation={fade()} timing={timing} />

        <TransitionSeries.Sequence durationInFrames={SCENE_DURATIONS[1]}>
          <SceneTwo />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={slide({ direction: "from-right" })}
          timing={timing}
        />

        <TransitionSeries.Sequence durationInFrames={SCENE_DURATIONS[2]}>
          <SceneThree />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={wipe({ direction: "from-left" })}
          timing={timing}
        />

        <TransitionSeries.Sequence durationInFrames={SCENE_DURATIONS[3]}>
          <SceneFour />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition presentation={fade()} timing={timing} />

        <TransitionSeries.Sequence durationInFrames={SCENE_DURATIONS[4]}>
          <SceneFive />
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </AbsoluteFill>
  );
};
