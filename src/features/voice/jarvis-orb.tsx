import { useEffect, useRef } from "react";
import { energyFor, haloPoint, segmentHeight } from "./orb-geometry";
import type { VoicePhase } from "./voice-model";

/**
 * The voice visualiser: a wireframe core, a ring of segments that rise and
 * fall with the voice, and a halo of particles.
 *
 * Drawn in the Hermes palette (Deep Ink, Hermes Blue, danger red) rather than HUD cyan, so it
 * belongs to the rest of AgentOS. The canvas is decoration: the state is also
 * said in words beside it, so it is hidden from assistive technology. Under
 * reduced motion it draws one still frame per state change.
 */

const INK = "183, 194, 185";
const AMBER = "190, 255, 50";
const FLAME = "255, 122, 138";
const SEGMENTS = 48;
const PARTICLES = 120;

export interface JarvisOrbProps {
  phase: VoicePhase;
  /** Live microphone loudness, 0..1. Read every frame without re-rendering. */
  level: number;
  size?: number;
}

export function JarvisOrb({ phase, level, size = 168 }: JarvisOrbProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef({ phase, level });

  useEffect(() => {
    live.current = { phase, level };
  }, [phase, level]);

  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;

    const ratio = window.devicePixelRatio || 1;
    element.width = size * ratio;
    element.height = size * ratio;
    context.scale(ratio, ratio);

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const centre = size / 2;
    const core = size * 0.19;
    const inner = size * 0.27;
    const outer = size * 0.38;
    const halo = size * 0.45;
    let smoothed = 0;
    let frame = 0;

    const draw = (now: number) => {
      const seconds = now / 1000;
      const { phase: current, level: mic } = live.current;
      const target = energyFor(current, mic, reduced ? 0 : seconds);
      smoothed += (target - smoothed) * 0.18;
      const accent = current === "listening" || current === "error" ? FLAME : AMBER;

      context.clearRect(0, 0, size, size);
      context.save();
      context.translate(centre, centre);

      // Halo of particles.
      for (let i = 0; i < PARTICLES; i++) {
        const point = haloPoint(i, PARTICLES, smoothed, seconds, halo);
        context.fillStyle = `rgba(${INK}, ${0.18 + 0.3 * smoothed})`;
        context.fillRect(point.x, point.y, 1.4, 1.4);
      }

      // Segment ring.
      const turn = current === "thinking" || current === "transcribing" ? seconds * 0.8 : 0;
      for (let i = 0; i < SEGMENTS; i++) {
        const angle = (i / SEGMENTS) * Math.PI * 2 + turn;
        const height = segmentHeight(i, smoothed, reduced ? 0 : seconds);
        const from = inner;
        const to = inner + (outer - inner) * height;
        context.strokeStyle = `rgba(${accent}, ${0.35 + 0.65 * height})`;
        context.lineWidth = (2 * Math.PI * inner) / SEGMENTS - 1.2;
        context.lineCap = "butt";
        context.beginPath();
        context.moveTo(Math.cos(angle) * from, Math.sin(angle) * from);
        context.lineTo(Math.cos(angle) * to, Math.sin(angle) * to);
        context.stroke();
      }

      // Wireframe core: latitudes and turning meridians on a paper-white disc.
      context.fillStyle = "rgb(242, 242, 242)";
      context.beginPath();
      context.arc(0, 0, core, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = `rgba(${INK}, 0.75)`;
      context.lineWidth = 1.5;
      context.stroke();
      context.lineWidth = 0.7;
      context.strokeStyle = `rgba(${INK}, 0.45)`;
      for (let lat = -2; lat <= 2; lat++) {
        const y = (lat / 3) * core;
        const half = Math.sqrt(Math.max(0, core * core - y * y));
        context.beginPath();
        context.ellipse(0, y, half, half * 0.18, 0, 0, Math.PI * 2);
        context.stroke();
      }
      const spin = reduced ? 0 : seconds * 0.6;
      for (let m = 0; m < 4; m++) {
        const width = Math.abs(Math.cos(spin + (m * Math.PI) / 4)) * core;
        context.beginPath();
        context.ellipse(0, 0, Math.max(0.5, width), core, 0, 0, Math.PI * 2);
        context.stroke();
      }

      context.restore();
      if (!reduced) frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [size, phase]);

  return <canvas ref={canvas} style={{ width: size, height: size }} className="shrink-0" aria-hidden="true" />;
}
