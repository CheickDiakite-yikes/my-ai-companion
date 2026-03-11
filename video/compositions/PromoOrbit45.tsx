import React from "react";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export type PromoOrbitProps = {
  userName: string;
};

type ScenePalette = {
  background: string;
  haloA: string;
  haloB: string;
  orbCore: string;
  orbEdge: string;
  orbGlow: string;
  accent: string;
  accentAlt: string;
  text: string;
  textSecondary: string;
  panel: string;
  panelStrong: string;
  border: string;
  shadow: string;
  track: string;
};

const BRAND_ICON = staticFile("icon-512.png");
const DISPLAY_FONT = '"Fraunces", "Iowan Old Style", "Times New Roman", serif';
const BODY_FONT = '"Sora", "Avenir Next", "Segoe UI", sans-serif';

const SCENE_DURATIONS = [120, 225, 240, 240, 240, 360] as const;
const TRANSITION_FRAMES = 15;

export const PROMO_DURATION_IN_FRAMES =
  SCENE_DURATIONS.reduce((sum, frames) => sum + frames, 0) -
  TRANSITION_FRAMES * (SCENE_DURATIONS.length - 1);

const TRANSITION_TIMING = linearTiming({ durationInFrames: TRANSITION_FRAMES });

const PALETTES: readonly ScenePalette[] = [
  {
    background:
      "linear-gradient(180deg, #060A15 0%, #040813 55%, #01040B 100%)",
    haloA: "rgba(82, 219, 209, 0.28)",
    haloB: "rgba(242, 164, 96, 0.18)",
    orbCore: "#77F0E6",
    orbEdge: "#F7C684",
    orbGlow: "rgba(116, 240, 231, 0.52)",
    accent: "#F4C47D",
    accentAlt: "#88F3EA",
    text: "#FAEEDC",
    textSecondary: "rgba(250, 238, 220, 0.74)",
    panel: "rgba(12, 22, 38, 0.54)",
    panelStrong: "rgba(14, 27, 47, 0.8)",
    border: "rgba(255, 232, 201, 0.18)",
    shadow: "rgba(0, 0, 0, 0.46)",
    track: "rgba(255, 255, 255, 0.08)",
  },
  {
    background:
      "linear-gradient(180deg, #120A0D 0%, #180D12 46%, #09050A 100%)",
    haloA: "rgba(244, 182, 120, 0.26)",
    haloB: "rgba(108, 214, 203, 0.14)",
    orbCore: "#F3B36A",
    orbEdge: "#FFF0D7",
    orbGlow: "rgba(243, 179, 106, 0.46)",
    accent: "#FFD6A0",
    accentAlt: "#69E0D1",
    text: "#FFF0DE",
    textSecondary: "rgba(255, 240, 222, 0.74)",
    panel: "rgba(42, 21, 18, 0.54)",
    panelStrong: "rgba(55, 27, 23, 0.8)",
    border: "rgba(255, 220, 188, 0.18)",
    shadow: "rgba(0, 0, 0, 0.5)",
    track: "rgba(255, 255, 255, 0.08)",
  },
  {
    background:
      "linear-gradient(180deg, #07110F 0%, #0B1815 44%, #030807 100%)",
    haloA: "rgba(102, 242, 207, 0.22)",
    haloB: "rgba(242, 190, 109, 0.16)",
    orbCore: "#63EBC7",
    orbEdge: "#F0D18C",
    orbGlow: "rgba(99, 235, 199, 0.46)",
    accent: "#F1D18A",
    accentAlt: "#7BF1D6",
    text: "#EFF9F3",
    textSecondary: "rgba(239, 249, 243, 0.74)",
    panel: "rgba(11, 31, 27, 0.54)",
    panelStrong: "rgba(12, 39, 34, 0.8)",
    border: "rgba(207, 246, 234, 0.16)",
    shadow: "rgba(0, 0, 0, 0.48)",
    track: "rgba(255, 255, 255, 0.08)",
  },
  {
    background:
      "linear-gradient(180deg, #08101C 0%, #0B1730 46%, #02060F 100%)",
    haloA: "rgba(116, 171, 255, 0.2)",
    haloB: "rgba(255, 155, 104, 0.16)",
    orbCore: "#84B8FF",
    orbEdge: "#FFB06E",
    orbGlow: "rgba(132, 184, 255, 0.42)",
    accent: "#FFBB7A",
    accentAlt: "#8DE8FF",
    text: "#F6F2E8",
    textSecondary: "rgba(246, 242, 232, 0.74)",
    panel: "rgba(9, 22, 49, 0.54)",
    panelStrong: "rgba(10, 29, 61, 0.82)",
    border: "rgba(213, 228, 255, 0.16)",
    shadow: "rgba(0, 0, 0, 0.5)",
    track: "rgba(255, 255, 255, 0.08)",
  },
  {
    background:
      "linear-gradient(180deg, #081116 0%, #0A1A20 50%, #020507 100%)",
    haloA: "rgba(105, 235, 224, 0.2)",
    haloB: "rgba(255, 204, 122, 0.18)",
    orbCore: "#7BE9E0",
    orbEdge: "#FFD08A",
    orbGlow: "rgba(123, 233, 224, 0.42)",
    accent: "#FFD08A",
    accentAlt: "#8DF5EE",
    text: "#F8F4E8",
    textSecondary: "rgba(248, 244, 232, 0.74)",
    panel: "rgba(10, 27, 31, 0.54)",
    panelStrong: "rgba(11, 35, 41, 0.82)",
    border: "rgba(222, 247, 242, 0.16)",
    shadow: "rgba(0, 0, 0, 0.5)",
    track: "rgba(255, 255, 255, 0.08)",
  },
  {
    background:
      "linear-gradient(180deg, #120A09 0%, #1B100D 45%, #090403 100%)",
    haloA: "rgba(255, 204, 131, 0.22)",
    haloB: "rgba(99, 230, 219, 0.14)",
    orbCore: "#FFD08A",
    orbEdge: "#FFF2D8",
    orbGlow: "rgba(255, 208, 138, 0.42)",
    accent: "#FFE3B5",
    accentAlt: "#82F3E6",
    text: "#FFF3E1",
    textSecondary: "rgba(255, 243, 225, 0.74)",
    panel: "rgba(37, 18, 13, 0.54)",
    panelStrong: "rgba(50, 24, 17, 0.82)",
    border: "rgba(255, 230, 194, 0.16)",
    shadow: "rgba(0, 0, 0, 0.52)",
    track: "rgba(255, 255, 255, 0.08)",
  },
] as const;

const DUST_PARTICLES = [
  { x: 0.08, y: 0.11, size: 4, phase: 0.2 },
  { x: 0.16, y: 0.19, size: 2, phase: 0.7 },
  { x: 0.24, y: 0.12, size: 3, phase: 1.1 },
  { x: 0.34, y: 0.17, size: 4, phase: 1.8 },
  { x: 0.44, y: 0.1, size: 2, phase: 2.2 },
  { x: 0.56, y: 0.14, size: 3, phase: 2.8 },
  { x: 0.66, y: 0.09, size: 4, phase: 3.1 },
  { x: 0.77, y: 0.17, size: 3, phase: 3.9 },
  { x: 0.88, y: 0.12, size: 2, phase: 4.3 },
  { x: 0.12, y: 0.34, size: 3, phase: 1.9 },
  { x: 0.22, y: 0.41, size: 2, phase: 2.4 },
  { x: 0.32, y: 0.36, size: 4, phase: 3.2 },
  { x: 0.51, y: 0.38, size: 2, phase: 3.7 },
  { x: 0.68, y: 0.33, size: 3, phase: 4.1 },
  { x: 0.83, y: 0.4, size: 2, phase: 4.8 },
  { x: 0.1, y: 0.62, size: 2, phase: 0.4 },
  { x: 0.18, y: 0.71, size: 3, phase: 1.2 },
  { x: 0.28, y: 0.76, size: 4, phase: 1.7 },
  { x: 0.46, y: 0.7, size: 2, phase: 2.5 },
  { x: 0.58, y: 0.82, size: 4, phase: 3.3 },
  { x: 0.74, y: 0.74, size: 3, phase: 4.2 },
  { x: 0.86, y: 0.67, size: 2, phase: 5.1 },
  { x: 0.92, y: 0.83, size: 3, phase: 5.8 },
] as const;

const HOOK_CHIPS = [
  { label: "Live voice", x: 116, y: 324, width: 246, delay: 0.2, rotate: -8 },
  { label: "Shared memory", x: 770, y: 292, width: 258, delay: 0.34, rotate: 8 },
  { label: "Camera context", x: 92, y: 620, width: 282, delay: 0.48, rotate: -5 },
  { label: "Morning Brief", x: 782, y: 602, width: 238, delay: 0.62, rotate: 6 },
  { label: "Personal context", x: 354, y: 760, width: 374, delay: 0.76, rotate: -2 },
] as const;

const VOICE_METRICS = [
  { label: "Interrupt naturally", delay: 0.8 },
  { label: "Shared transcript", delay: 1.0 },
  { label: "Same stitched thread", delay: 1.2 },
] as const;

const MEMORY_ITEMS = [
  {
    title: "Tone",
    body: "Keep it gentle when the day feels heavy.",
    x: 106,
    y: 288,
    delay: 0.25,
  },
  {
    title: "Project",
    body: "Launching Zee in March. Keep the narrative sharp.",
    x: 96,
    y: 860,
    delay: 0.45,
  },
  {
    title: "Promise",
    body: "Ask about the pitch before Tuesday afternoon.",
    x: 690,
    y: 280,
    delay: 0.65,
  },
  {
    title: "Preference",
    body: "Voice first for momentum. Text when I need clarity.",
    x: 674,
    y: 842,
    delay: 0.85,
  },
] as const;

const VISION_TAGS = [
  { label: "Photo uploads", x: 628, y: 188, width: 226, delay: 0.44, rotate: -4 },
  { label: "Live camera", x: 854, y: 838, width: 194, delay: 0.62, rotate: 5 },
  { label: "Grounded help", x: 574, y: 1108, width: 228, delay: 0.82, rotate: -3 },
] as const;

const PERSONALIZATION_TAGS = [
  { label: "Voice presets", x: 132, y: 242, width: 214, delay: 0.32, rotate: -8 },
  { label: "Avatar style", x: 806, y: 282, width: 198, delay: 0.48, rotate: 7 },
  { label: "Memory controls", x: 770, y: 1060, width: 244, delay: 0.68, rotate: -5 },
  { label: "Profile-led tone", x: 126, y: 1104, width: 236, delay: 0.84, rotate: 5 },
] as const;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const springProgress = (
  frame: number,
  fps: number,
  delaySeconds: number,
  durationSeconds = 1.05,
) => {
  return spring({
    frame: frame - Math.floor(delaySeconds * fps),
    fps,
    durationInFrames: Math.floor(durationSeconds * fps),
    config: { damping: 200, stiffness: 120 },
  });
};

const easeProgress = (
  frame: number,
  fps: number,
  startSeconds: number,
  endSeconds: number,
) => {
  return interpolate(
    frame,
    [Math.floor(startSeconds * fps), Math.floor(endSeconds * fps)],
    [0, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.inOut(Easing.cubic),
    },
  );
};

const getLineGeometry = (
  startX: number,
  startY: number,
  endX: number,
  endY: number,
) => {
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  return {
    length: Math.sqrt(deltaX * deltaX + deltaY * deltaY),
    angle: (Math.atan2(deltaY, deltaX) * 180) / Math.PI,
    deltaX,
    deltaY,
  };
};

const FrameNoise: React.FC = () => {
  return (
    <AbsoluteFill
      style={{
        mixBlendMode: "screen",
        opacity: 0.05,
        backgroundImage:
          "radial-gradient(circle at 20% 20%, rgba(255,255,255,0.55) 1px, transparent 1px), radial-gradient(circle at 80% 80%, rgba(255,255,255,0.35) 1px, transparent 1px)",
        backgroundSize: "8px 8px, 11px 11px",
      }}
    />
  );
};

const Backdrop: React.FC<{
  palette: ScenePalette;
  sceneIndex: number;
}> = ({ palette, sceneIndex }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const driftA = Math.sin(frame / (fps * 0.9) + sceneIndex) * 88;
  const driftB = Math.cos(frame / (fps * 1.2) + sceneIndex * 0.6) * 92;
  const gridShift = Math.sin(frame / (fps * 1.6) + sceneIndex) * 80;

  return (
    <AbsoluteFill
      style={{
        background: palette.background,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: -260,
          background: `radial-gradient(circle at 20% 18%, ${palette.haloA} 0%, rgba(0,0,0,0) 34%), radial-gradient(circle at 82% 28%, ${palette.haloB} 0%, rgba(0,0,0,0) 28%), radial-gradient(circle at 50% 72%, rgba(255,255,255,0.06) 0%, rgba(0,0,0,0) 24%)`,
          transform: `translate(${driftA}px, ${driftB * 0.35}px)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: -180,
          left: -80,
          width: 520,
          height: 520,
          borderRadius: 999,
          background: palette.haloA,
          filter: "blur(90px)",
          opacity: 0.55,
          transform: `translate(${driftA * 0.45}px, ${driftB * 0.3}px)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          right: -120,
          top: 120,
          width: 420,
          height: 420,
          borderRadius: 999,
          background: palette.haloB,
          filter: "blur(110px)",
          opacity: 0.48,
          transform: `translate(${driftB * 0.4}px, ${driftA * 0.2}px)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 140,
          bottom: -180,
          width: 700,
          height: 420,
          borderRadius: "50%",
          background: "rgba(255,255,255,0.06)",
          filter: "blur(120px)",
          opacity: 0.35,
          transform: `translateY(${driftB * -0.25}px)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: -240,
          opacity: 0.08,
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.16) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.16) 1px, transparent 1px)",
          backgroundSize: "160px 160px",
          transform: `rotate(${sceneIndex % 2 === 0 ? 8 : -8}deg) translateY(${gridShift}px)`,
        }}
      />
      {DUST_PARTICLES.map((particle, index) => {
        const twinkle = 0.28 + 0.62 * (0.5 + 0.5 * Math.sin(frame / 16 + particle.phase));
        const xDrift = Math.sin(frame / 46 + particle.phase + index * 0.1) * 12;
        const yDrift = Math.cos(frame / 54 + particle.phase + index * 0.12) * 18;
        return (
          <div
            key={`dust-${sceneIndex}-${index}`}
            style={{
              position: "absolute",
              left: `${particle.x * 100}%`,
              top: `${particle.y * 100}%`,
              width: particle.size,
              height: particle.size,
              borderRadius: 999,
              background: "rgba(255,255,255,0.86)",
              opacity: twinkle,
              boxShadow: "0 0 12px rgba(255,255,255,0.85)",
              transform: `translate(${xDrift}px, ${yDrift}px)`,
            }}
          />
        );
      })}
      <FrameNoise />
      <AbsoluteFill
        style={{
          pointerEvents: "none",
          background:
            "radial-gradient(120% 90% at 50% 10%, rgba(255,255,255,0) 0%, rgba(0,0,0,0.28) 58%, rgba(0,0,0,0.72) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};

const BrandChip: React.FC<{
  palette: ScenePalette;
  left?: number;
  top?: number;
}> = ({ palette, left = 90, top = 88 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const inProgress = springProgress(frame, fps, 0, 0.9);

  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        display: "flex",
        alignItems: "center",
        gap: 18,
        padding: "16px 22px 16px 16px",
        borderRadius: 999,
        border: `1px solid ${palette.border}`,
        background: palette.panel,
        boxShadow: `0 20px 50px ${palette.shadow}`,
        transform: `translateY(${interpolate(inProgress, [0, 1], [20, 0])}px)`,
        opacity: inProgress,
      }}
    >
      <div
        style={{
          width: 42,
          height: 42,
          borderRadius: 14,
          overflow: "hidden",
          boxShadow: `0 0 28px ${palette.orbGlow}`,
        }}
      >
        <Img
          src={BRAND_ICON}
          style={{
            width: "100%",
            height: "100%",
          }}
        />
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <div
          style={{
            fontFamily: BODY_FONT,
            fontSize: 14,
            letterSpacing: 4,
            textTransform: "uppercase",
            color: palette.textSecondary,
          }}
        >
          ZeeMe
        </div>
        <div
          style={{
            fontFamily: DISPLAY_FONT,
            fontSize: 28,
            color: palette.text,
            lineHeight: 1,
          }}
        >
          Meet Zee
        </div>
      </div>
    </div>
  );
};

const CopyBlock: React.FC<{
  palette: ScenePalette;
  eyebrow: string;
  title: React.ReactNode;
  body: string;
  style: React.CSSProperties;
  align?: "left" | "center";
  titleSize?: number;
  bodySize?: number;
  delay?: number;
  children?: React.ReactNode;
}> = ({
  palette,
  eyebrow,
  title,
  body,
  style,
  align = "left",
  titleSize = 108,
  bodySize = 34,
  delay = 0.2,
  children,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const titleIn = springProgress(frame, fps, delay, 1.15);
  const bodyIn = easeProgress(frame, fps, delay + 0.28, delay + 0.9);

  return (
    <div
      style={{
        position: "absolute",
        display: "flex",
        flexDirection: "column",
        alignItems: align === "center" ? "center" : "flex-start",
        textAlign: align,
        ...style,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          marginBottom: 22,
          opacity: bodyIn,
          justifyContent: align === "center" ? "center" : "flex-start",
        }}
      >
        <div
          style={{
            width: 54,
            height: 1,
            background: `linear-gradient(90deg, ${palette.accentAlt}, ${palette.accent})`,
          }}
        />
        <div
          style={{
            fontFamily: BODY_FONT,
            fontSize: 16,
            letterSpacing: 6,
            textTransform: "uppercase",
            color: palette.textSecondary,
          }}
        >
          {eyebrow}
        </div>
      </div>
      <div
        style={{
          fontFamily: DISPLAY_FONT,
          fontSize: titleSize,
          lineHeight: 0.96,
          letterSpacing: -2,
          color: palette.text,
          maxWidth: "100%",
          transform: `translateY(${interpolate(titleIn, [0, 1], [50, 0])}px)`,
          opacity: titleIn,
          textShadow: "0 14px 40px rgba(0,0,0,0.24)",
        }}
      >
        {title}
      </div>
      <div
        style={{
          marginTop: 24,
          fontFamily: BODY_FONT,
          fontSize: bodySize,
          lineHeight: 1.35,
          fontWeight: 500,
          color: palette.textSecondary,
          maxWidth: "100%",
          opacity: bodyIn,
          transform: `translateY(${interpolate(bodyIn, [0, 1], [28, 0])}px)`,
        }}
      >
        {body}
      </div>
      {children ? (
        <div
          style={{
            marginTop: 26,
            opacity: bodyIn,
            transform: `translateY(${interpolate(bodyIn, [0, 1], [24, 0])}px)`,
          }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
};

const FloatingChip: React.FC<{
  palette: ScenePalette;
  label: string;
  x: number;
  y: number;
  width: number;
  delay: number;
  rotate?: number;
}> = ({ palette, label, x, y, width, delay, rotate = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const reveal = springProgress(frame, fps, delay, 0.95);
  const floatX = Math.sin(frame / 42 + delay * 9) * 8;
  const floatY = Math.cos(frame / 50 + delay * 8) * 9;

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width,
        padding: "18px 24px",
        borderRadius: 999,
        border: `1px solid ${palette.border}`,
        background: palette.panel,
        color: palette.text,
        fontFamily: BODY_FONT,
        fontSize: 26,
        fontWeight: 600,
        letterSpacing: 0.2,
        boxShadow: `0 20px 60px ${palette.shadow}`,
        opacity: reveal,
        transform: `translate(${floatX}px, ${interpolate(reveal, [0, 1], [36, 0]) + floatY}px) rotate(${rotate}deg)`,
      }}
    >
      {label}
    </div>
  );
};

const OrbCluster: React.FC<{
  palette: ScenePalette;
  size: number;
  centerX: number;
  centerY: number;
  ribbonMode?: boolean;
  iconMode?: boolean;
}> = ({ palette, size, centerX, centerY, ribbonMode = false, iconMode = false }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const breathe = 1 + Math.sin(frame / (fps * 0.18)) * 0.038;
  const coreSize = size * 0.4;

  return (
    <div
      style={{
        position: "absolute",
        left: centerX,
        top: centerY,
        width: size,
        height: size,
        transform: "translate(-50%, -50%)",
      }}
    >
      {Array.from({ length: 4 }).map((_, index) => {
        const ringScale = 0.6 + index * 0.22 + Math.sin(frame / 38 + index) * 0.02;
        const opacity = 0.08 + (index === 0 ? 0.1 : 0) + 0.08 * (0.5 + 0.5 * Math.sin(frame / 24 + index));
        return (
          <div
            key={`orb-ring-${index}`}
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: 999,
              border: `1.5px solid ${palette.border}`,
              opacity,
              transform: `scale(${ringScale}) rotate(${frame * (0.16 + index * 0.03)}deg)`,
            }}
          />
        );
      })}
      {ribbonMode
        ? Array.from({ length: 3 }).map((_, index) => {
            const sway = Math.sin(frame / 24 + index * 1.8) * 18;
            return (
              <div
                key={`ribbon-${index}`}
                style={{
                  position: "absolute",
                  left: -size * 0.34,
                  top: size * (0.45 + index * 0.05),
                  width: size * 1.68,
                  height: 14 + index * 6,
                  borderRadius: 999,
                  background:
                    index % 2 === 0
                      ? `linear-gradient(90deg, rgba(0,0,0,0), ${palette.accentAlt}, rgba(0,0,0,0))`
                      : `linear-gradient(90deg, rgba(0,0,0,0), ${palette.accent}, rgba(0,0,0,0))`,
                  opacity: 0.44 - index * 0.08,
                  filter: "blur(1px)",
                  transform: `translateY(${sway}px) rotate(${index === 1 ? -3 : 3}deg)`,
                }}
              />
            );
          })
        : null}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: coreSize * 1.32,
          height: coreSize * 1.32,
          borderRadius: 999,
          background: palette.orbGlow,
          filter: "blur(60px)",
          transform: "translate(-50%, -50%)",
          opacity: 0.85,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: coreSize,
          height: coreSize,
          borderRadius: 999,
          border: `2px solid ${palette.border}`,
          background: `radial-gradient(circle at 30% 28%, rgba(255,255,255,0.94) 0%, ${palette.orbCore} 38%, ${palette.orbEdge} 76%, rgba(0,0,0,0.24) 100%)`,
          transform: `translate(-50%, -50%) scale(${breathe})`,
          boxShadow: `0 0 90px ${palette.orbGlow}, inset 0 -14px 30px rgba(0,0,0,0.26)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: coreSize * 0.3,
          height: coreSize * 0.3,
          borderRadius: 999,
          background: "rgba(255,255,255,0.42)",
          filter: "blur(8px)",
          transform: `translate(-95px, -102px) scale(${1 + Math.sin(frame / 30) * 0.08})`,
        }}
      />
      {iconMode ? (
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: coreSize * 0.64,
            height: coreSize * 0.64,
            transform: "translate(-50%, -50%)",
            borderRadius: 30,
            overflow: "hidden",
            boxShadow: `0 0 42px ${palette.orbGlow}`,
          }}
        >
          <Img
            src={BRAND_ICON}
            style={{
              width: "100%",
              height: "100%",
            }}
          />
        </div>
      ) : null}
    </div>
  );
};

const GlassPanel: React.FC<{
  palette: ScenePalette;
  style?: React.CSSProperties;
  strong?: boolean;
  children: React.ReactNode;
}> = ({ palette, style, strong = false, children }) => {
  return (
    <div
      style={{
        borderRadius: 36,
        border: `1px solid ${palette.border}`,
        background: strong ? palette.panelStrong : palette.panel,
        boxShadow: `0 18px 60px ${palette.shadow}`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

const PhoneShell: React.FC<{
  palette: ScenePalette;
  style: React.CSSProperties;
  children: React.ReactNode;
}> = ({ palette, style, children }) => {
  const frame = useCurrentFrame();
  const bob = Math.sin(frame / 36) * 10;
  const sway = Math.sin(frame / 52) * 2.4;
  const baseTransform = typeof style.transform === "string" ? style.transform : "";

  return (
    <div
      style={{
        position: "absolute",
        width: 436,
        height: 900,
        padding: 18,
        borderRadius: 58,
        background:
          "linear-gradient(160deg, rgba(255,255,255,0.22), rgba(255,255,255,0.08))",
        border: `1px solid ${palette.border}`,
        boxShadow: `0 36px 120px ${palette.shadow}`,
        ...style,
        transform: `${baseTransform} translateY(${bob}px) rotate(${sway}deg)`,
        transformOrigin: "50% 50%",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: 10,
          width: 140,
          height: 10,
          borderRadius: 999,
          background: "rgba(255,255,255,0.22)",
          transform: "translateX(-50%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 18,
          borderRadius: 42,
          overflow: "hidden",
          background: palette.panelStrong,
        }}
      >
        {children}
      </div>
      <div
        style={{
          position: "absolute",
          inset: 22,
          borderRadius: 38,
          border: "1px solid rgba(255,255,255,0.08)",
          pointerEvents: "none",
        }}
      />
    </div>
  );
};

const VoiceBar: React.FC<{
  palette: ScenePalette;
  index: number;
}> = ({ palette, index }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const level = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(frame / (fps * 0.12) + index * 0.66));
  const height = interpolate(level, [0, 1], [18, 122]);

  return (
    <div
      style={{
        width: 14,
        height,
        borderRadius: 999,
        background:
          index % 3 === 0
            ? `linear-gradient(180deg, ${palette.accentAlt}, rgba(255,255,255,0.16))`
            : `linear-gradient(180deg, ${palette.accent}, rgba(255,255,255,0.12))`,
        boxShadow: `0 0 18px ${index % 3 === 0 ? palette.accentAlt : palette.accent}`,
      }}
    />
  );
};

const VoiceScreen: React.FC<{
  palette: ScenePalette;
}> = ({ palette }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const orbitPulse = 1 + Math.sin(frame / (fps * 0.18)) * 0.03;
  const transcriptOpacity = easeProgress(frame, fps, 0.7, 1.4);

  return (
    <AbsoluteFill
      style={{
        padding: "34px 28px 30px",
        background:
          "linear-gradient(180deg, rgba(11,15,24,1) 0%, rgba(14,26,40,1) 38%, rgba(8,11,16,1) 100%)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div
          style={{
            fontFamily: BODY_FONT,
            fontSize: 18,
            letterSpacing: 4,
            textTransform: "uppercase",
            color: palette.textSecondary,
          }}
        >
          Live voice
        </div>
        <GlassPanel
          palette={palette}
          style={{
            padding: "10px 16px",
            borderRadius: 999,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              color: palette.text,
              fontFamily: BODY_FONT,
              fontSize: 18,
              fontWeight: 600,
            }}
          >
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: 999,
                background: palette.accentAlt,
                boxShadow: `0 0 12px ${palette.accentAlt}`,
              }}
            />
            Connected
          </div>
        </GlassPanel>
      </div>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: 148,
          width: 248,
          height: 248,
          borderRadius: 999,
          border: `1px solid ${palette.border}`,
          background: `radial-gradient(circle at 30% 24%, rgba(255,255,255,0.96) 0%, ${palette.orbCore} 36%, ${palette.orbEdge} 82%, rgba(0,0,0,0.28) 100%)`,
          boxShadow: `0 0 90px ${palette.orbGlow}`,
          transform: `translateX(-50%) scale(${orbitPulse})`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: 438,
          transform: "translateX(-50%)",
          color: palette.text,
          fontFamily: DISPLAY_FONT,
          fontSize: 56,
          lineHeight: 1.02,
          textAlign: "center",
        }}
      >
        Speak naturally.
      </div>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: 516,
          transform: "translateX(-50%)",
          color: palette.textSecondary,
          fontFamily: BODY_FONT,
          fontSize: 26,
          textAlign: "center",
          width: 320,
          opacity: transcriptOpacity,
        }}
      >
        Zee keeps the same thread alive.
      </div>
      <div
        style={{
          position: "absolute",
          left: 42,
          right: 42,
          bottom: 188,
          display: "flex",
          gap: 12,
          alignItems: "flex-end",
          justifyContent: "center",
          height: 130,
        }}
      >
        {Array.from({ length: 17 }).map((_, index) => (
          <VoiceBar
            key={`voice-bar-${index}`}
            palette={palette}
            index={index}
          />
        ))}
      </div>
      <GlassPanel
        palette={palette}
        strong
        style={{
          position: "absolute",
          left: "50%",
          bottom: 110,
          transform: "translateX(-50%)",
          padding: "18px 28px",
          borderRadius: 999,
        }}
      >
        <div
          style={{
            color: palette.text,
            fontFamily: BODY_FONT,
            fontSize: 24,
            fontWeight: 600,
          }}
        >
          Interrupt naturally
        </div>
      </GlassPanel>
      <div
        style={{
          position: "absolute",
          left: 42,
          right: 42,
          bottom: 34,
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        {["Mic", "Camera", "Thread"].map((label) => (
          <GlassPanel
            key={label}
            palette={palette}
            style={{
              width: 106,
              height: 68,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 999,
            }}
          >
            <div
              style={{
                color: palette.textSecondary,
                fontFamily: BODY_FONT,
                fontSize: 20,
                fontWeight: 600,
              }}
            >
              {label}
            </div>
          </GlassPanel>
        ))}
      </div>
    </AbsoluteFill>
  );
};

const ChatBubble: React.FC<{
  palette: ScenePalette;
  text: string;
  side: "left" | "right";
  top: number;
  delay: number;
  width: number;
}> = ({ palette, text, side, top, delay, width }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const reveal = springProgress(frame, fps, delay, 0.82);
  const xOffset = interpolate(reveal, [0, 1], [side === "left" ? -34 : 34, 0]);

  return (
    <div
      style={{
        position: "absolute",
        top,
        left: side === "left" ? 24 : "auto",
        right: side === "right" ? 24 : "auto",
        width,
        padding: "18px 20px",
        borderRadius: 28,
        background:
          side === "left"
            ? "rgba(255,255,255,0.1)"
            : `linear-gradient(135deg, ${palette.accentAlt}, ${palette.accent})`,
        color: side === "left" ? palette.text : "#0C1115",
        border:
          side === "left"
            ? `1px solid ${palette.border}`
            : "1px solid rgba(255,255,255,0.16)",
        fontFamily: BODY_FONT,
        fontSize: 24,
        lineHeight: 1.25,
        fontWeight: 500,
        boxShadow: `0 14px 34px ${palette.shadow}`,
        opacity: reveal,
        transform: `translateX(${xOffset}px)`,
      }}
    >
      {text}
    </div>
  );
};

const ChatScreen: React.FC<{
  palette: ScenePalette;
}> = ({ palette }) => {
  return (
    <AbsoluteFill
      style={{
        padding: "28px 24px 26px",
        background:
          "linear-gradient(180deg, rgba(23,14,11,1) 0%, rgba(28,17,14,1) 46%, rgba(14,9,8,1) 100%)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div
          style={{
            fontFamily: BODY_FONT,
            fontSize: 18,
            letterSpacing: 4,
            textTransform: "uppercase",
            color: palette.textSecondary,
          }}
        >
          Same thread
        </div>
        <GlassPanel
          palette={palette}
          style={{
            padding: "10px 14px",
            borderRadius: 999,
          }}
        >
          <div
            style={{
              color: palette.text,
              fontFamily: BODY_FONT,
              fontSize: 18,
              fontWeight: 600,
            }}
          >
            Voice + text
          </div>
        </GlassPanel>
      </div>
      <div
        style={{
          position: "absolute",
          left: 24,
          right: 24,
          top: 92,
          display: "flex",
          gap: 10,
        }}
      >
        {["Memory", "Tone", "Context"].map((label) => (
          <GlassPanel
            key={label}
            palette={palette}
            style={{
              padding: "10px 14px",
              borderRadius: 999,
            }}
          >
            <div
              style={{
                color: palette.textSecondary,
                fontFamily: BODY_FONT,
                fontSize: 17,
                fontWeight: 600,
              }}
            >
              {label}
            </div>
          </GlassPanel>
        ))}
      </div>
      <ChatBubble
        palette={palette}
        text="I need to calm down before the pitch."
        side="right"
        top={176}
        delay={0.28}
        width={290}
      />
      <ChatBubble
        palette={palette}
        text="Let’s slow the room down. Want a reset plan or a pep talk?"
        side="left"
        top={300}
        delay={0.52}
        width={324}
      />
      <ChatBubble
        palette={palette}
        text="A reset plan. Keep Tuesday 3 PM in mind."
        side="right"
        top={444}
        delay={0.78}
        width={290}
      />
      <ChatBubble
        palette={palette}
        text="Got you. I remembered the time and I’ll keep the tone gentle."
        side="left"
        top={568}
        delay={1.02}
        width={330}
      />
      <GlassPanel
        palette={palette}
        strong
        style={{
          position: "absolute",
          left: 24,
          right: 24,
          bottom: 100,
          padding: "18px 20px",
          borderRadius: 26,
        }}
      >
        <div
          style={{
            color: palette.textSecondary,
            fontFamily: BODY_FONT,
            fontSize: 22,
          }}
        >
          Shared memory stays stitched into the conversation.
        </div>
      </GlassPanel>
      <div
        style={{
          position: "absolute",
          left: 24,
          right: 24,
          bottom: 26,
          height: 58,
          borderRadius: 999,
          border: `1px solid ${palette.border}`,
          background: "rgba(255,255,255,0.08)",
        }}
      />
    </AbsoluteFill>
  );
};

const ConnectorLine: React.FC<{
  palette: ScenePalette;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  delay: number;
}> = ({ palette, startX, startY, endX, endY, delay }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const reveal = easeProgress(frame, fps, delay, delay + 0.6);
  const { length, angle, deltaX, deltaY } = getLineGeometry(startX, startY, endX, endY);
  const travel = ((frame / (fps * 1.2) + delay) % 1) * length;

  return (
    <>
      <div
        style={{
          position: "absolute",
          left: startX,
          top: startY,
          width: length * reveal,
          height: 2,
          borderRadius: 999,
          background: `linear-gradient(90deg, rgba(0,0,0,0), ${palette.accentAlt}, ${palette.accent})`,
          transform: `rotate(${angle}deg)`,
          transformOrigin: "0 50%",
          opacity: 0.86,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: startX + (deltaX / length) * travel - 6,
          top: startY + (deltaY / length) * travel - 6,
          width: 12,
          height: 12,
          borderRadius: 999,
          background: palette.accent,
          boxShadow: `0 0 16px ${palette.accent}`,
          opacity: reveal,
        }}
      />
    </>
  );
};

const MemoryCard: React.FC<{
  palette: ScenePalette;
  title: string;
  body: string;
  x: number;
  y: number;
  delay: number;
}> = ({ palette, title, body, x, y, delay }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const reveal = springProgress(frame, fps, delay, 0.95);
  const hover = Math.sin(frame / 38 + delay * 7) * 8;

  return (
    <GlassPanel
      palette={palette}
      strong
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: 314,
        padding: "26px 28px",
        opacity: reveal,
        transform: `translateY(${interpolate(reveal, [0, 1], [32, 0]) + hover}px)`,
      }}
    >
      <div
        style={{
          fontFamily: BODY_FONT,
          fontSize: 18,
          letterSpacing: 4,
          textTransform: "uppercase",
          color: palette.textSecondary,
        }}
      >
        {title}
      </div>
      <div
        style={{
          marginTop: 12,
          fontFamily: DISPLAY_FONT,
          fontSize: 44,
          lineHeight: 1.05,
          color: palette.text,
        }}
      >
        {body}
      </div>
    </GlassPanel>
  );
};

const CameraScreen: React.FC<{
  palette: ScenePalette;
}> = ({ palette }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scanY = interpolate(
    (frame % Math.floor(fps * 2.6)) / Math.floor(fps * 2.6),
    [0, 1],
    [120, 700],
  );

  return (
    <AbsoluteFill
      style={{
        padding: "28px 22px 24px",
        background:
          "linear-gradient(180deg, rgba(6,12,20,1) 0%, rgba(10,20,38,1) 42%, rgba(4,8,15,1) 100%)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div
          style={{
            fontFamily: BODY_FONT,
            fontSize: 18,
            letterSpacing: 4,
            textTransform: "uppercase",
            color: palette.textSecondary,
          }}
        >
          Camera + image
        </div>
        <GlassPanel
          palette={palette}
          style={{
            padding: "10px 14px",
            borderRadius: 999,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              color: palette.text,
              fontFamily: BODY_FONT,
              fontSize: 18,
              fontWeight: 600,
            }}
          >
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: 999,
                background: palette.accent,
                boxShadow: `0 0 12px ${palette.accent}`,
              }}
            />
            Live
          </div>
        </GlassPanel>
      </div>
      <div
        style={{
          position: "absolute",
          left: 22,
          right: 22,
          top: 84,
          bottom: 118,
          borderRadius: 36,
          overflow: "hidden",
          background:
            "linear-gradient(180deg, rgba(31,71,114,0.86) 0%, rgba(45,70,88,0.76) 26%, rgba(115,79,49,0.88) 100%)",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(circle at 32% 30%, rgba(255,255,255,0.24) 0%, rgba(255,255,255,0) 32%), radial-gradient(circle at 64% 64%, rgba(255,204,145,0.3) 0%, rgba(255,255,255,0) 36%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 84,
            top: 182,
            width: 250,
            height: 420,
            borderRadius: 120,
            background:
              "linear-gradient(180deg, rgba(17,36,46,0.28) 0%, rgba(15,24,33,0.58) 100%)",
            filter: "blur(1px)",
            transform: "rotate(-6deg)",
          }}
        />
        <div
          style={{
            position: "absolute",
            right: 66,
            top: 234,
            width: 116,
            height: 240,
            borderRadius: 58,
            background:
              "linear-gradient(180deg, rgba(255,232,176,0.7) 0%, rgba(165,112,70,0.5) 100%)",
            filter: "blur(0.6px)",
            transform: "rotate(12deg)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 66,
            right: 66,
            top: scanY,
            height: 4,
            borderRadius: 999,
            background: `linear-gradient(90deg, rgba(0,0,0,0), ${palette.accentAlt}, rgba(0,0,0,0))`,
            boxShadow: `0 0 18px ${palette.accentAlt}`,
            opacity: 0.78,
          }}
        />
        {[
          { left: 60, top: 140 },
          { right: 60, top: 140 },
          { left: 60, bottom: 140 },
          { right: 60, bottom: 140 },
        ].map((corner, index) => (
          <div
            key={`focus-${index}`}
            style={{
              position: "absolute",
              width: 72,
              height: 72,
              borderColor: palette.text,
              borderStyle: "solid",
              borderTopWidth: corner.top !== undefined ? 4 : 0,
              borderLeftWidth: corner.left !== undefined ? 4 : 0,
              borderRightWidth: corner.right !== undefined ? 4 : 0,
              borderBottomWidth: corner.bottom !== undefined ? 4 : 0,
              borderRadius: 20,
              opacity: 0.75,
              ...corner,
            }}
          />
        ))}
      </div>
      <GlassPanel
        palette={palette}
        strong
        style={{
          position: "absolute",
          left: 30,
          right: 30,
          bottom: 36,
          padding: "18px 22px",
        }}
      >
        <div
          style={{
            color: palette.text,
            fontFamily: BODY_FONT,
            fontSize: 24,
            lineHeight: 1.25,
          }}
        >
          Live camera gives Zee grounded visual context when words are not enough.
        </div>
      </GlassPanel>
    </AbsoluteFill>
  );
};

const AnalysisCard: React.FC<{
  palette: ScenePalette;
  x: number;
  y: number;
  title: string;
  body: string;
  delay: number;
}> = ({ palette, x, y, title, body, delay }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const reveal = springProgress(frame, fps, delay, 0.9);
  const wobble = Math.sin(frame / 42 + delay * 10) * 6;

  return (
    <GlassPanel
      palette={palette}
      strong
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: 264,
        padding: "20px 22px",
        opacity: reveal,
        transform: `translateY(${interpolate(reveal, [0, 1], [30, 0]) + wobble}px)`,
      }}
    >
      <div
        style={{
          fontFamily: BODY_FONT,
          fontSize: 16,
          letterSpacing: 3.4,
          textTransform: "uppercase",
          color: palette.textSecondary,
        }}
      >
        {title}
      </div>
      <div
        style={{
          marginTop: 10,
          fontFamily: DISPLAY_FONT,
          fontSize: 36,
          lineHeight: 1.04,
          color: palette.text,
        }}
      >
        {body}
      </div>
    </GlassPanel>
  );
};

const ContextBoard: React.FC<{
  palette: ScenePalette;
}> = ({ palette }) => {
  const frame = useCurrentFrame();
  const dots = `${".".repeat(Math.floor((frame / 10) % 3) + 1)}`;

  return (
    <GlassPanel
      palette={palette}
      strong
      style={{
        position: "absolute",
        left: 90,
        top: 244,
        width: 500,
        height: 1020,
        padding: 30,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div
          style={{
            fontFamily: BODY_FONT,
            fontSize: 18,
            letterSpacing: 4,
            textTransform: "uppercase",
            color: palette.textSecondary,
          }}
        >
          Your world + live web
        </div>
        <div
          style={{
            padding: "10px 14px",
            borderRadius: 999,
            border: `1px solid ${palette.border}`,
            color: palette.text,
            fontFamily: BODY_FONT,
            fontSize: 18,
            fontWeight: 600,
          }}
        >
          Ready
        </div>
      </div>
      <GlassPanel
        palette={palette}
        style={{
          marginTop: 28,
          padding: 28,
        }}
      >
        <div
          style={{
            fontFamily: BODY_FONT,
            fontSize: 18,
            letterSpacing: 4,
            textTransform: "uppercase",
            color: palette.textSecondary,
          }}
        >
          Morning Brief
        </div>
        <div
          style={{
            marginTop: 14,
            fontFamily: DISPLAY_FONT,
            fontSize: 58,
            lineHeight: 1.02,
            color: palette.text,
          }}
        >
          7:14 AM
        </div>
        <div
          style={{
            marginTop: 18,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {[
            "Top headlines with grounded market context",
            "Fast summary before the day starts",
            "Calm tone, relevant signal, less noise",
          ].map((item) => (
            <div
              key={item}
              style={{
                display: "flex",
                gap: 12,
                alignItems: "center",
                color: palette.textSecondary,
                fontFamily: BODY_FONT,
                fontSize: 22,
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  background: palette.accent,
                }}
              />
              {item}
            </div>
          ))}
        </div>
      </GlassPanel>
      <div
        style={{
          marginTop: 20,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
        }}
      >
        <GlassPanel
          palette={palette}
          style={{
            padding: 24,
            minHeight: 210,
          }}
        >
          <div
            style={{
              fontFamily: BODY_FONT,
              fontSize: 16,
              letterSpacing: 3.4,
              textTransform: "uppercase",
              color: palette.textSecondary,
            }}
          >
            Gmail
          </div>
          <div
            style={{
              marginTop: 12,
              fontFamily: DISPLAY_FONT,
              fontSize: 52,
              color: palette.text,
            }}
          >
            5 unread
          </div>
          <div
            style={{
              marginTop: 14,
              color: palette.textSecondary,
              fontFamily: BODY_FONT,
              fontSize: 20,
              lineHeight: 1.25,
            }}
          >
            Pull the important signal, skip the clutter.
          </div>
        </GlassPanel>
        <GlassPanel
          palette={palette}
          style={{
            padding: 24,
            minHeight: 210,
          }}
        >
          <div
            style={{
              fontFamily: BODY_FONT,
              fontSize: 16,
              letterSpacing: 3.4,
              textTransform: "uppercase",
              color: palette.textSecondary,
            }}
          >
            Calendar
          </div>
          <div
            style={{
              marginTop: 12,
              fontFamily: DISPLAY_FONT,
              fontSize: 52,
              color: palette.text,
            }}
          >
            3 today
          </div>
          <div
            style={{
              marginTop: 14,
              color: palette.textSecondary,
              fontFamily: BODY_FONT,
              fontSize: 20,
              lineHeight: 1.25,
            }}
          >
            Meetings, timing, and context in one glance.
          </div>
        </GlassPanel>
      </div>
      <GlassPanel
        palette={palette}
        strong
        style={{
          marginTop: 20,
          padding: "22px 24px",
          borderRadius: 30,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div
            style={{
              color: palette.text,
              fontFamily: DISPLAY_FONT,
              fontSize: 42,
              lineHeight: 1.02,
            }}
          >
            Looking up latest info{dots}
          </div>
          <div
            style={{
              width: 14,
              height: 14,
              borderRadius: 999,
              background: palette.accentAlt,
              boxShadow: `0 0 18px ${palette.accentAlt}`,
            }}
          />
        </div>
      </GlassPanel>
      <div
        style={{
          marginTop: 18,
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        {["Web", "Mail", "Calendar", "Markets"].map((label) => (
          <GlassPanel
            key={label}
            palette={palette}
            style={{
              padding: "12px 18px",
              borderRadius: 999,
            }}
          >
            <div
              style={{
                color: palette.textSecondary,
                fontFamily: BODY_FONT,
                fontSize: 18,
                fontWeight: 600,
              }}
            >
              {label}
            </div>
          </GlassPanel>
        ))}
      </div>
    </GlassPanel>
  );
};

const ProfileScreen: React.FC<{
  palette: ScenePalette;
}> = ({ palette }) => {
  return (
    <AbsoluteFill
      style={{
        padding: "28px 24px 24px",
        background:
          "linear-gradient(180deg, rgba(30,18,14,1) 0%, rgba(42,24,18,1) 42%, rgba(20,11,9,1) 100%)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div
          style={{
            fontFamily: BODY_FONT,
            fontSize: 18,
            letterSpacing: 4,
            textTransform: "uppercase",
            color: palette.textSecondary,
          }}
        >
          Personalize Zee
        </div>
        <GlassPanel
          palette={palette}
          style={{
            padding: "10px 14px",
            borderRadius: 999,
          }}
        >
          <div
            style={{
              color: palette.text,
              fontFamily: BODY_FONT,
              fontSize: 18,
              fontWeight: 600,
            }}
          >
            Profile
          </div>
        </GlassPanel>
      </div>
      <div
        style={{
          marginTop: 40,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <div
          style={{
            width: 128,
            height: 128,
            borderRadius: 999,
            overflow: "hidden",
            boxShadow: `0 0 44px ${palette.orbGlow}`,
          }}
        >
          <Img
            src={BRAND_ICON}
            style={{
              width: "100%",
              height: "100%",
            }}
          />
        </div>
        <div
          style={{
            marginTop: 20,
            fontFamily: DISPLAY_FONT,
            fontSize: 52,
            color: palette.text,
          }}
        >
          Zee
        </div>
        <div
          style={{
            marginTop: 8,
            color: palette.textSecondary,
            fontFamily: BODY_FONT,
            fontSize: 22,
          }}
        >
          Voice, tone, and memory shaped around you.
        </div>
      </div>
      <div
        style={{
          marginTop: 34,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        {[
          { label: "Voice preset", value: "Sage" },
          { label: "Tone", value: "Warm + direct" },
          { label: "Memory", value: "Selective recall" },
          { label: "Camera", value: "On when needed" },
        ].map((item) => (
          <GlassPanel
            key={item.label}
            palette={palette}
            style={{
              padding: "18px 20px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div
                style={{
                  color: palette.textSecondary,
                  fontFamily: BODY_FONT,
                  fontSize: 20,
                }}
              >
                {item.label}
              </div>
              <div
                style={{
                  color: palette.text,
                  fontFamily: DISPLAY_FONT,
                  fontSize: 34,
                }}
              >
                {item.value}
              </div>
            </div>
          </GlassPanel>
        ))}
      </div>
    </AbsoluteFill>
  );
};

const HookScene: React.FC = () => {
  const palette = PALETTES[0];

  return (
    <AbsoluteFill>
      <Backdrop palette={palette} sceneIndex={0} />
      <BrandChip palette={palette} />
      <OrbCluster
        palette={palette}
        size={640}
        centerX={540}
        centerY={488}
        ribbonMode
      />
      {HOOK_CHIPS.map((chip) => (
        <FloatingChip
          key={chip.label}
          palette={palette}
          label={chip.label}
          x={chip.x}
          y={chip.y}
          width={chip.width}
          delay={chip.delay}
          rotate={chip.rotate}
        />
      ))}
      <CopyBlock
        palette={palette}
        eyebrow="ZEE / COMPANION OS"
        title={
          <>
            Meet Zee.
            <br />
            Presence with memory.
          </>
        }
        body="A cinematic AI companion for voice, text, vision, and the moments that matter."
        style={{
          left: 110,
          right: 110,
          bottom: 184,
        }}
        align="center"
        titleSize={126}
      >
        <div
          style={{
            display: "flex",
            gap: 14,
            flexWrap: "wrap",
            justifyContent: "center",
          }}
        >
          {["Ideas", "Feelings", "Questions", "Creative sparks"].map((item) => (
            <GlassPanel
              key={item}
              palette={palette}
              style={{
                padding: "12px 18px",
                borderRadius: 999,
              }}
            >
              <div
                style={{
                  color: palette.textSecondary,
                  fontFamily: BODY_FONT,
                  fontSize: 21,
                  fontWeight: 600,
                }}
              >
                {item}
              </div>
            </GlassPanel>
          ))}
        </div>
      </CopyBlock>
    </AbsoluteFill>
  );
};

const VoiceThreadScene: React.FC = () => {
  const palette = PALETTES[1];

  return (
    <AbsoluteFill>
      <Backdrop palette={palette} sceneIndex={1} />
      <BrandChip palette={palette} />
      <CopyBlock
        palette={palette}
        eyebrow="VOICE + TEXT"
        title={
          <>
            Talk naturally.
            <br />
            Text seamlessly.
          </>
        }
        body="Move between live voice and chat without losing the thread. Interrupt, continue, and keep the same conversation alive."
        style={{
          left: 96,
          top: 228,
          width: 430,
        }}
        titleSize={104}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 14,
            alignItems: "flex-start",
          }}
        >
          {VOICE_METRICS.map((metric) => (
            <GlassPanel
              key={metric.label}
              palette={palette}
              style={{
                padding: "14px 18px",
                borderRadius: 999,
              }}
            >
              <div
                style={{
                  color: palette.text,
                  fontFamily: BODY_FONT,
                  fontSize: 22,
                  fontWeight: 600,
                }}
              >
                {metric.label}
              </div>
            </GlassPanel>
          ))}
        </div>
      </CopyBlock>
      <div
        style={{
          position: "absolute",
          left: 498,
          top: 704,
          width: 356,
          height: 5,
          borderRadius: 999,
          background: `linear-gradient(90deg, rgba(0,0,0,0), ${palette.accentAlt}, ${palette.accent}, rgba(0,0,0,0))`,
          boxShadow: `0 0 26px ${palette.accent}`,
          transform: "rotate(-16deg)",
        }}
      />
      <PhoneShell
        palette={palette}
        style={{
          left: 610,
          top: 272,
          transform: "rotate(8deg) scale(0.84)",
          opacity: 0.82,
        }}
      >
        <ChatScreen palette={palette} />
      </PhoneShell>
      <PhoneShell
        palette={palette}
        style={{
          left: 522,
          top: 176,
          transform: "rotate(-8deg) scale(0.92)",
        }}
      >
        <VoiceScreen palette={palette} />
      </PhoneShell>
    </AbsoluteFill>
  );
};

const MemoryScene: React.FC = () => {
  const palette = PALETTES[2];
  const hubX = 532;
  const hubY = 664;

  return (
    <AbsoluteFill>
      <Backdrop palette={palette} sceneIndex={2} />
      <BrandChip palette={palette} />
      <CopyBlock
        palette={palette}
        eyebrow="CONTINUITY"
        title={
          <>
            It remembers
            <br />
            what matters.
          </>
        }
        body="Goals, moods, names, and ongoing stories come back with context instead of cold restarts."
        style={{
          left: 610,
          top: 166,
          width: 366,
        }}
        titleSize={98}
      />
      <OrbCluster
        palette={palette}
        size={404}
        centerX={hubX}
        centerY={hubY}
        ribbonMode
      />
      {MEMORY_ITEMS.map((item) => (
        <MemoryCard
          key={item.title}
          palette={palette}
          title={item.title}
          body={item.body}
          x={item.x}
          y={item.y}
          delay={item.delay}
        />
      ))}
      {MEMORY_ITEMS.map((item, index) => (
        <ConnectorLine
          key={`line-${item.title}`}
          palette={palette}
          startX={item.x + (index < 2 ? 314 : 0)}
          startY={item.y + (index % 2 === 0 ? 170 : 90)}
          endX={hubX + (index < 2 ? -80 : 80)}
          endY={hubY + (index % 2 === 0 ? -48 : 58)}
          delay={item.delay + 0.12}
        />
      ))}
      <GlassPanel
        palette={palette}
        strong
        style={{
          position: "absolute",
          left: 372,
          bottom: 132,
          width: 336,
          padding: "18px 22px",
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontFamily: BODY_FONT,
            fontSize: 22,
            fontWeight: 600,
            color: palette.text,
          }}
        >
          Memory stays in your control.
        </div>
      </GlassPanel>
    </AbsoluteFill>
  );
};

const VisionScene: React.FC = () => {
  const palette = PALETTES[3];

  return (
    <AbsoluteFill>
      <Backdrop palette={palette} sceneIndex={3} />
      <BrandChip palette={palette} />
      <CopyBlock
        palette={palette}
        eyebrow="VISION"
        title={
          <>
            Show Zee
            <br />
            what you see.
          </>
        }
        body="Share photos or live camera when words are not enough and get grounded help in real time."
        style={{
          left: 92,
          top: 238,
          width: 400,
        }}
        titleSize={104}
      />
      <PhoneShell
        palette={palette}
        style={{
          left: 538,
          top: 180,
          transform: "rotate(-4deg) scale(0.95)",
        }}
      >
        <CameraScreen palette={palette} />
      </PhoneShell>
      {VISION_TAGS.map((tag) => (
        <FloatingChip
          key={tag.label}
          palette={palette}
          label={tag.label}
          x={tag.x}
          y={tag.y}
          width={tag.width}
          delay={tag.delay}
          rotate={tag.rotate}
        />
      ))}
      <AnalysisCard
        palette={palette}
        x={786}
        y={410}
        title="Scene summary"
        body="Grounded visual cues for a clearer reply."
        delay={0.54}
      />
      <AnalysisCard
        palette={palette}
        x={772}
        y={676}
        title="Creative feedback"
        body="Fast notes when you want perspective."
        delay={0.76}
      />
    </AbsoluteFill>
  );
};

const ContextScene: React.FC = () => {
  const palette = PALETTES[4];

  return (
    <AbsoluteFill>
      <Backdrop palette={palette} sceneIndex={4} />
      <BrandChip palette={palette} />
      <ContextBoard palette={palette} />
      <CopyBlock
        palette={palette}
        eyebrow="CONTEXT"
        title={
          <>
            Grounded in
            <br />
            your world.
          </>
        }
        body="Morning Brief, Gmail, Calendar, and live web grounding bring the right context exactly when you ask for it."
        style={{
          right: 92,
          top: 256,
          width: 388,
        }}
        titleSize={98}
      >
        <div
          style={{
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          {["Morning Brief", "Gmail", "Calendar", "Latest info"].map((label) => (
            <GlassPanel
              key={label}
              palette={palette}
              style={{
                padding: "12px 16px",
                borderRadius: 999,
              }}
            >
              <div
                style={{
                  color: palette.text,
                  fontFamily: BODY_FONT,
                  fontSize: 20,
                  fontWeight: 600,
                }}
              >
                {label}
              </div>
            </GlassPanel>
          ))}
        </div>
      </CopyBlock>
    </AbsoluteFill>
  );
};

const FinalScene: React.FC<PromoOrbitProps> = ({ userName }) => {
  const palette = PALETTES[5];
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const stageAOut = 1 - easeProgress(frame, fps, 4.6, 5.6);
  const stageBIn = easeProgress(frame, fps, 4.9, 6.1);
  const userLine =
    userName && userName.trim() && userName !== "Friend"
      ? `Built for ${userName}.`
      : "Built for you.";

  return (
    <AbsoluteFill>
      <Backdrop palette={palette} sceneIndex={5} />
      <BrandChip palette={palette} />
      <div
        style={{
          opacity: stageAOut,
        }}
      >
        <CopyBlock
          palette={palette}
          eyebrow="PERSONAL BY DESIGN"
          title={
            <>
              Choose the voice.
              <br />
              Shape the tone.
            </>
          }
          body="Keep one thread alive across voice, text, memory, and camera while Zee adapts around you."
          style={{
            left: 0,
            right: 0,
            top: 154,
            width: 760,
            margin: "0 auto",
          }}
          align="center"
          titleSize={98}
        />
        {PERSONALIZATION_TAGS.map((tag) => (
          <FloatingChip
            key={tag.label}
            palette={palette}
            label={tag.label}
            x={tag.x}
            y={tag.y}
            width={tag.width}
            delay={tag.delay}
            rotate={tag.rotate}
          />
        ))}
        <PhoneShell
          palette={palette}
          style={{
            left: 82,
            top: 388,
            transform: "rotate(-12deg) scale(0.76)",
          }}
        >
          <ProfileScreen palette={palette} />
        </PhoneShell>
        <PhoneShell
          palette={palette}
          style={{
            left: 322,
            top: 334,
            transform: "rotate(-2deg) scale(0.86)",
          }}
        >
          <ChatScreen palette={palette} />
        </PhoneShell>
        <PhoneShell
          palette={palette}
          style={{
            left: 636,
            top: 404,
            transform: "rotate(12deg) scale(0.76)",
          }}
        >
          <VoiceScreen palette={palette} />
        </PhoneShell>
      </div>

      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: stageBIn,
          transform: `scale(${interpolate(stageBIn, [0, 1], [0.95, 1])})`,
        }}
      >
        <OrbCluster
          palette={palette}
          size={520}
          centerX={540}
          centerY={510}
          ribbonMode
          iconMode
        />
        <CopyBlock
          palette={palette}
          eyebrow="ZEE / ZEE ME"
          title={
            <>
              Talk. Show.
              <br />
              Remember.
            </>
          }
          body="Your AI companion for voice, vision, context, continuity, and creative momentum."
          style={{
            left: 110,
            right: 110,
            bottom: 280,
          }}
          align="center"
          titleSize={120}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 22,
            }}
          >
            <div
              style={{
                padding: "20px 34px",
                borderRadius: 999,
                border: `1px solid ${palette.border}`,
                background: `linear-gradient(135deg, ${palette.accent}, ${palette.accentAlt})`,
                color: "#160F0B",
                fontFamily: BODY_FONT,
                fontSize: 28,
                fontWeight: 700,
                boxShadow: `0 24px 70px ${palette.shadow}`,
              }}
            >
              Start your conversation
            </div>
            <div
              style={{
                fontFamily: DISPLAY_FONT,
                fontSize: 52,
                color: palette.text,
              }}
            >
              ZeeMe
            </div>
            <div
              style={{
                fontFamily: BODY_FONT,
                fontSize: 22,
                letterSpacing: 3,
                textTransform: "uppercase",
                color: palette.textSecondary,
              }}
            >
              {userLine}
            </div>
          </div>
        </CopyBlock>
      </div>
    </AbsoluteFill>
  );
};

export const PromoOrbit45: React.FC<PromoOrbitProps> = ({ userName }) => {
  return (
    <AbsoluteFill style={{ WebkitFontSmoothing: "antialiased" }}>
      <TransitionSeries>
        <TransitionSeries.Sequence durationInFrames={SCENE_DURATIONS[0]}>
          <HookScene />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition presentation={fade()} timing={TRANSITION_TIMING} />

        <TransitionSeries.Sequence durationInFrames={SCENE_DURATIONS[1]}>
          <VoiceThreadScene />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={slide({ direction: "from-right" })}
          timing={TRANSITION_TIMING}
        />

        <TransitionSeries.Sequence durationInFrames={SCENE_DURATIONS[2]}>
          <MemoryScene />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={wipe({ direction: "from-bottom" })}
          timing={TRANSITION_TIMING}
        />

        <TransitionSeries.Sequence durationInFrames={SCENE_DURATIONS[3]}>
          <VisionScene />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition presentation={fade()} timing={TRANSITION_TIMING} />

        <TransitionSeries.Sequence durationInFrames={SCENE_DURATIONS[4]}>
          <ContextScene />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={slide({ direction: "from-top" })}
          timing={TRANSITION_TIMING}
        />

        <TransitionSeries.Sequence durationInFrames={SCENE_DURATIONS[5]}>
          <FinalScene userName={userName} />
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </AbsoluteFill>
  );
};
