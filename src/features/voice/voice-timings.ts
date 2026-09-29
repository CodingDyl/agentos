/**
 * Where the time goes between finishing a sentence and hearing the answer.
 *
 * A voice assistant feels slow or fast by its slowest step, and the steps live
 * in three different places (Fish listening, Hermes thinking, Fish speaking).
 * Marking each moment as it happens is the only way to say which one is at
 * fault, so this is measured on every exchange and shown in the panel.
 */

export type TimingMark = "stopped" | "transcribed" | "sent" | "firstText" | "firstAudio";

export interface TimingSummary {
  /** You stopped talking until your words came back as text. */
  transcribeMs?: number;
  /** Your words sent until Hermes' first words arrived. */
  hermesFirstTextMs?: number;
  /** Hermes' first words until Jarvis began to speak them. */
  voiceStartMs?: number;
  /** You stopped talking until you heard Jarvis. */
  totalMs?: number;
}

export class VoiceTimings {
  private marks = new Map<TimingMark, number>();

  constructor(private readonly clock: () => number = () => performance.now()) {}

  /** Records a moment once; a repeat of the same mark is ignored. */
  mark(name: TimingMark): void {
    if (!this.marks.has(name)) this.marks.set(name, this.clock());
  }

  reset(): void {
    this.marks.clear();
  }

  private between(from: TimingMark, to: TimingMark): number | undefined {
    const start = this.marks.get(from);
    const end = this.marks.get(to);
    return start !== undefined && end !== undefined ? Math.max(0, Math.round(end - start)) : undefined;
  }

  summary(): TimingSummary {
    const all: TimingSummary = {
      transcribeMs: this.between("stopped", "transcribed"),
      hermesFirstTextMs: this.between("sent", "firstText"),
      voiceStartMs: this.between("firstText", "firstAudio"),
      totalMs: this.between("stopped", "firstAudio") ?? this.between("sent", "firstAudio"),
    };
    // Only what has happened: a step that has not run is absent, not undefined.
    return Object.fromEntries(Object.entries(all).filter(([, value]) => value !== undefined)) as TimingSummary;
  }
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/** One line for the panel, listing only the steps that have happened. */
export function describeTimings(summary: TimingSummary): string {
  const parts: string[] = [];
  if (summary.transcribeMs !== undefined) parts.push(`heard you in ${seconds(summary.transcribeMs)}`);
  if (summary.hermesFirstTextMs !== undefined) parts.push(`Hermes' first words after ${seconds(summary.hermesFirstTextMs)}`);
  if (summary.voiceStartMs !== undefined) parts.push(`voice started ${seconds(summary.voiceStartMs)} later`);
  if (summary.totalMs !== undefined) parts.push(`${seconds(summary.totalMs)} in all`);
  return parts.join(", ");
}
