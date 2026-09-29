/**
 * The orb's maths, apart from the canvas so it can be tested and so the
 * drawing code stays about drawing.
 */

import type { VoicePhase } from "./voice-model";

/** Cheap deterministic noise in 0..1: the same input always gives the same value. */
export function hash01(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * How far a phase drives the rings, 0..1, before the microphone adds to it.
 * Listening follows the mic; speaking has no analyser so it breathes on a
 * slow sum of waves; thinking turns quietly; idle is nearly still.
 */
export function energyFor(phase: VoicePhase, level: number, seconds: number): number {
  switch (phase) {
    case "listening":
      return Math.min(1, 0.25 + level * 0.9);
    case "speaking":
      return 0.35 + 0.25 * Math.sin(seconds * 6.1) * Math.sin(seconds * 2.3 + 1) + 0.15 * Math.sin(seconds * 11.7);
    case "transcribing":
    case "thinking":
      return 0.22;
    case "confirming":
      return 0.12;
    case "error":
      return 0.05;
    default:
      return 0.08;
  }
}

/** Height (0..1) of one of the ring's segments at a moment. */
export function segmentHeight(index: number, energy: number, seconds: number): number {
  const base = 0.25 + hash01(index) * 0.5;
  const wobble = 0.5 + 0.5 * Math.sin(seconds * (1.5 + hash01(index + 9) * 2.5) + index);
  return Math.max(0.08, Math.min(1, base * (0.35 + energy) * (0.55 + 0.45 * wobble)));
}

/** Where a halo particle sits: its angle, and its radius pushed out by energy. */
export function haloPoint(index: number, count: number, energy: number, seconds: number, radius: number) {
  const angle = (index / count) * Math.PI * 2;
  const jitter = (hash01(index * 3 + 1) - 0.5) * 2;
  const push = 1 + jitter * 0.03 + energy * 0.09 * Math.sin(seconds * 2 + index * 0.7);
  return { x: Math.cos(angle) * radius * push, y: Math.sin(angle) * radius * push };
}
