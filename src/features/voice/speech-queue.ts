/**
 * Plays spoken pieces in order while later ones are still being made.
 *
 * Each piece is sent for synthesis the moment it is queued, so the next one is
 * usually ready before the current one ends. Playback is one at a time. A
 * failure stops the rest and is reported once: the words are on screen, and a
 * patchy half-spoken answer is worse than a text one.
 */

export interface SpeechQueueOptions {
  synthesise: (text: string, signal: AbortSignal) => Promise<Blob>;
  /** Resolves when the audio has ended or been stopped; rejects if it cannot play. */
  play: (audio: Blob) => Promise<void>;
  stopPlayback: () => void;
  /** True while there is audio playing or about to play. */
  onSpeaking: (speaking: boolean) => void;
  /** Closed, and everything queued has been said. */
  onDrained: () => void;
  onError: (error: unknown) => void;
  /** A piece that is not worth failing over, e.g. one with nothing to say. */
  isSkippable?: (error: unknown) => boolean;
}

export class SpeechQueue {
  private generation = 0;
  private controller = new AbortController();
  private items: Promise<Blob | null>[] = [];
  private next = 0;
  private closed = false;
  private running = false;
  private speaking = false;
  private wake?: () => void;

  constructor(private readonly options: SpeechQueueOptions) {}

  enqueue(text: string): void {
    const item = this.options
      .synthesise(text, this.controller.signal)
      .then((audio): Blob | null => audio)
      .catch((error: unknown) => {
        if (this.options.isSkippable?.(error)) return null;
        throw error;
      });
    // The loop awaits it in order; until then a rejection must not go unhandled.
    item.catch(() => undefined);
    this.items.push(item);
    this.wake?.();
    void this.run();
  }

  /** No more text is coming. */
  close(): void {
    this.closed = true;
    this.wake?.();
    void this.run();
  }

  /** Stops everything and forgets it, ready for the next answer. */
  reset(): void {
    this.generation++;
    this.controller.abort();
    this.controller = new AbortController();
    this.items = [];
    this.next = 0;
    this.closed = false;
    this.running = false;
    this.options.stopPlayback();
    this.wake?.();
    this.setSpeaking(false);
  }

  private setSpeaking(speaking: boolean): void {
    if (this.speaking === speaking) return;
    this.speaking = speaking;
    this.options.onSpeaking(speaking);
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const generation = this.generation;

    try {
      while (generation === this.generation) {
        if (this.next < this.items.length) {
          const audio = await this.items[this.next++];
          if (generation !== this.generation) return;
          if (!audio) continue;
          this.setSpeaking(true);
          await this.options.play(audio);
          continue;
        }

        // Nothing queued: either the answer is done, or more is on its way.
        this.setSpeaking(false);
        if (this.closed) {
          this.options.onDrained();
          this.running = false;
          return;
        }
        await new Promise<void>((resolve) => {
          this.wake = resolve;
        });
      }
    } catch (error) {
      if (generation !== this.generation) return;
      this.reset();
      this.options.onError(error);
    }
  }
}
