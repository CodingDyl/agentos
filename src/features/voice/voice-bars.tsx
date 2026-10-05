import { useEffect, useRef } from "react";
import { energyFor, segmentHeight } from "./orb-geometry";
import type { VoicePhase } from "./voice-model";

/**
 * The launcher's own visualiser: a row of bars that sit flat when Jarvis is
 * ready, follow your voice while you speak, and breathe while Jarvis answers.
 * Decoration only (the state is also written beside it), and a still frame
 * under reduced motion.
 */

const BARS = 18;
const CREAM = "242, 244, 235";
const AMBER = "190, 255, 50";
const FLAME = "255, 122, 138";

export function VoiceBars({ phase, level, width = 112, height = 24 }: { phase: VoicePhase; level: number; width?: number; height?: number }) {
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
    element.width = width * ratio;
    element.height = height * ratio;
    context.scale(ratio, ratio);

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const slot = width / BARS;
    let smoothed = 0;
    let frame = 0;

    const draw = (now: number) => {
      const seconds = reduced ? 0 : now / 1000;
      const { phase: current, level: mic } = live.current;
      smoothed += (energyFor(current, mic, seconds) - smoothed) * 0.2;
      const active = current !== "idle" && current !== "error";
      const colour = current === "listening" ? FLAME : active ? AMBER : CREAM;

      context.clearRect(0, 0, width, height);
      for (let i = 0; i < BARS; i++) {
        // A calm middle and quieter edges, so it reads as a voice, not noise.
        const envelope = 0.45 + 0.55 * Math.sin((Math.PI * (i + 0.5)) / BARS);
        const bar = Math.max(2, segmentHeight(i, smoothed, seconds) * envelope * height);
        context.fillStyle = `rgba(${colour}, ${active ? 0.9 : 0.35})`;
        context.fillRect(i * slot + 1, (height - bar) / 2, Math.max(1.5, slot - 3), bar);
      }
      if (!reduced) frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [width, height, phase]);

  return <canvas ref={canvas} style={{ width, height }} className="shrink-0" aria-hidden="true" />;
}
