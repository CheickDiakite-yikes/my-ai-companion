import { useEffect, useRef, useCallback } from "react";

interface OrbConfig {
  orbColor: string;
  orbGlow: string;
  accentRing: string;
  particleColor: string;
  id: number;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  alphaDir: number;
  life: number;
  maxLife: number;
}

function createParticle(w: number, h: number, cx: number, cy: number): Particle {
  const angle = Math.random() * Math.PI * 2;
  const dist = 60 + Math.random() * 120;
  return {
    x: cx + Math.cos(angle) * dist,
    y: cy + Math.sin(angle) * dist,
    vx: (Math.random() - 0.5) * 0.3,
    vy: -0.2 - Math.random() * 0.5,
    size: 1 + Math.random() * 2.5,
    alpha: 0,
    alphaDir: 1,
    life: 0,
    maxLife: 150 + Math.random() * 200,
  };
}

export default function CanvasOrb({ config }: { config: OrbConfig }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const particlesRef = useRef<Particle[]>([]);
  const timeRef = useRef(0);

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number, dpr: number) => {
      const cx = w / 2;
      const cy = h * 0.42;
      const t = timeRef.current;
      const [r, g, b] = hexToRgb(config.orbColor);

      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const bgGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, w * 0.55);
      bgGlow.addColorStop(0, `rgba(${r},${g},${b},0.12)`);
      bgGlow.addColorStop(0.4, `rgba(${r},${g},${b},0.05)`);
      bgGlow.addColorStop(1, "transparent");
      ctx.fillStyle = bgGlow;
      ctx.fillRect(0, 0, w, h);

      const ringAlphas = [0.08, 0.12, 0.18];
      const ringSizes = [120, 95, 75];
      for (let i = 0; i < 3; i++) {
        const pulse = Math.sin(t * 0.015 + i * 1.2) * 0.15 + 1;
        const radius = ringSizes[i] * pulse;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${r},${g},${b},${ringAlphas[i] + Math.sin(t * 0.02 + i) * 0.05})`;
        ctx.lineWidth = 1 + (2 - i) * 0.3;
        ctx.stroke();
      }

      const outerGlow = ctx.createRadialGradient(cx, cy, 30, cx, cy, 110);
      outerGlow.addColorStop(0, `rgba(${r},${g},${b},0.5)`);
      outerGlow.addColorStop(0.3, `rgba(${r},${g},${b},0.25)`);
      outerGlow.addColorStop(0.6, `rgba(${r},${g},${b},0.08)`);
      outerGlow.addColorStop(1, "transparent");
      ctx.fillStyle = outerGlow;
      ctx.beginPath();
      ctx.arc(cx, cy, 110, 0, Math.PI * 2);
      ctx.fill();

      const orbRadius = 52;
      const orbPulse = 1 + Math.sin(t * 0.025) * 0.03;
      const actualR = orbRadius * orbPulse;

      const orbGrad = ctx.createRadialGradient(
        cx - actualR * 0.25,
        cy - actualR * 0.3,
        0,
        cx,
        cy,
        actualR
      );
      orbGrad.addColorStop(0, `rgba(${Math.min(r + 80, 255)},${Math.min(g + 80, 255)},${Math.min(b + 80, 255)},1)`);
      orbGrad.addColorStop(0.35, `rgba(${r},${g},${b},0.95)`);
      orbGrad.addColorStop(0.7, `rgba(${Math.max(r - 40, 0)},${Math.max(g - 40, 0)},${Math.max(b - 40, 0)},0.9)`);
      orbGrad.addColorStop(1, `rgba(${Math.max(r - 80, 0)},${Math.max(g - 80, 0)},${Math.max(b - 80, 0)},0.8)`);

      ctx.beginPath();
      ctx.arc(cx, cy, actualR, 0, Math.PI * 2);
      ctx.fillStyle = orbGrad;
      ctx.fill();

      ctx.save();
      ctx.globalCompositeOperation = "screen";
      const shineGrad = ctx.createRadialGradient(
        cx - actualR * 0.3,
        cy - actualR * 0.35,
        0,
        cx - actualR * 0.1,
        cy - actualR * 0.15,
        actualR * 0.7
      );
      shineGrad.addColorStop(0, "rgba(255,255,255,0.55)");
      shineGrad.addColorStop(0.3, "rgba(255,255,255,0.18)");
      shineGrad.addColorStop(1, "transparent");
      ctx.fillStyle = shineGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, actualR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.save();
      const rimGrad = ctx.createRadialGradient(cx, cy + actualR * 0.15, actualR * 0.5, cx, cy, actualR);
      rimGrad.addColorStop(0, "transparent");
      rimGrad.addColorStop(0.85, "transparent");
      rimGrad.addColorStop(1, `rgba(${r},${g},${b},0.6)`);
      ctx.fillStyle = rimGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, actualR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      if (config.id >= 2) {
        ctx.save();
        ctx.globalAlpha = 0.5 + Math.sin(t * 0.02) * 0.15;
        const waveY = cy + 2;
        const waveCount = config.id === 3 ? 3 : 2;
        for (let w_i = 0; w_i < waveCount; w_i++) {
          ctx.beginPath();
          const yOff = (w_i - (waveCount - 1) / 2) * 12;
          const phaseOff = w_i * 0.8;
          const amp = 8 + w_i * 4 + Math.sin(t * 0.015 + w_i) * 3;
          for (let x = -20; x <= w + 20; x += 2) {
            const normX = (x - cx) / (w * 0.4);
            const envelope = Math.exp(-normX * normX * 1.2);
            const yVal =
              waveY +
              yOff +
              Math.sin(x * 0.025 + t * 0.03 + phaseOff) * amp * envelope +
              Math.sin(x * 0.015 + t * 0.02 + phaseOff * 2) * (amp * 0.4) * envelope;
            if (x === -20) ctx.moveTo(x, yVal);
            else ctx.lineTo(x, yVal);
          }
          const waveAlpha = 0.3 - w_i * 0.08;
          ctx.strokeStyle = `rgba(${r},${g},${b},${waveAlpha})`;
          ctx.lineWidth = 2 - w_i * 0.4;
          ctx.stroke();
        }
        ctx.restore();
      }

      const particles = particlesRef.current;
      while (particles.length < 20) {
        particles.push(createParticle(w, h, cx, cy));
      }
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life++;
        p.x += p.vx + Math.sin(t * 0.01 + i) * 0.15;
        p.y += p.vy;

        if (p.life < p.maxLife * 0.2) {
          p.alpha = (p.life / (p.maxLife * 0.2)) * 0.8;
        } else if (p.life > p.maxLife * 0.7) {
          p.alpha = ((p.maxLife - p.life) / (p.maxLife * 0.3)) * 0.8;
        }

        if (p.life >= p.maxLife) {
          particles[i] = createParticle(w, h, cx, cy);
          continue;
        }

        const pGrad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 2);
        pGrad.addColorStop(0, `rgba(${r},${g},${b},${p.alpha})`);
        pGrad.addColorStop(0.5, `rgba(${r},${g},${b},${p.alpha * 0.4})`);
        pGrad.addColorStop(1, "transparent");
        ctx.fillStyle = pGrad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 2, 0, Math.PI * 2);
        ctx.fill();
      }

      const starCount = 8;
      for (let i = 0; i < starCount; i++) {
        const sx = ((i * 137.508) % w);
        const sy = ((i * 89.233 + 20) % (h * 0.7));
        const sAlpha = 0.15 + Math.sin(t * 0.03 + i * 2.1) * 0.15;
        const sSize = 1 + Math.sin(t * 0.02 + i) * 0.5;
        ctx.fillStyle = `rgba(255,255,255,${sAlpha})`;
        ctx.beginPath();
        ctx.arc(sx, sy, sSize, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    },
    [config],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = 320;
    const h = 320;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    particlesRef.current = [];

    const loop = () => {
      timeRef.current++;
      draw(ctx, w, h, dpr);
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);

    return () => cancelAnimationFrame(animRef.current);
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      className="max-w-full"
      style={{ width: 320, height: 320, imageRendering: "auto" }}
    />
  );
}
