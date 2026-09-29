/**
 * Decides what to say while Hermes is still writing.
 *
 * `feed` is given the whole reply so far, every time it grows, and returns
 * only the newly finished pieces worth speaking: complete sentences and lines
 * of prose, never code, and never a half-written sentence. It holds nothing
 * back forever: `final` flushes whatever is left when the reply ends.
 *
 * Speech is a summary, as it always was: past a budget of characters it stops
 * and says the rest is on screen.
 */

/** The first piece is kept short so speech starts quickly; later ones can breathe. */
const FIRST_MIN = 40;
const NEXT_MIN = 90;
/** No single request to the voice is longer than this. */
const PIECE_MAX = 320;
/** Roughly a fifteen second answer, then a handoff to the screen. */
export const SPEECH_BUDGET = 700;
export const HANDOFF = "The rest is on screen.";

const FENCE = /^\s*(```|~~~)/;
const SENTENCE_END = /[.!?…](?=["')\]]*\s)/g;

export class SpeechStream {
  private consumed = 0;
  private inFence = false;
  private spoken = 0;
  private spokeAny = false;
  private capped = false;

  /** True once the budget is spent and the handoff has been queued. */
  get isCapped(): boolean {
    return this.capped;
  }

  feed(text: string, final = false): string[] {
    if (this.capped) return [];

    const scan = this.scan(text, final);
    const min = this.spokeAny ? NEXT_MIN : FIRST_MIN;
    if (!final && scan.ready.trim().length < min) return [];

    this.consumed = scan.consumed;
    this.inFence = scan.inFence;

    const pieces: string[] = [];
    for (const piece of split(scan.ready)) {
      if (this.spoken + piece.length > SPEECH_BUDGET && this.spokeAny) {
        pieces.push(HANDOFF);
        this.capped = true;
        break;
      }
      pieces.push(piece);
      this.spoken += piece.length;
      this.spokeAny = true;
    }
    return pieces;
  }

  private scan(text: string, final: boolean) {
    let position = this.consumed;
    let inFence = this.inFence;
    let ready = "";

    while (position < text.length) {
      const newline = text.indexOf("\n", position);

      if (newline === -1) {
        // A line still being written. Speak its finished sentences only.
        const line = text.slice(position);
        if (final) {
          if (!inFence && !FENCE.test(line)) ready += line;
          position = text.length;
        } else if (!inFence && !FENCE.test(line)) {
          let cut = -1;
          for (const match of line.matchAll(SENTENCE_END)) cut = (match.index ?? 0) + match[0].length;
          if (cut > 0) {
            ready += line.slice(0, cut);
            position += cut;
          }
        }
        break;
      }

      const line = text.slice(position, newline);
      if (FENCE.test(line)) inFence = !inFence;
      else if (!inFence) ready += `${line}\n`;
      position = newline + 1;
    }

    return { ready, consumed: position, inFence };
  }
}

/** Cuts prose into requests no longer than PIECE_MAX, at sentence ends where it can. */
function split(prose: string): string[] {
  const pieces: string[] = [];
  let rest = prose.trim();

  while (rest.length > PIECE_MAX) {
    const window = rest.slice(0, PIECE_MAX);
    let cut = -1;
    for (const match of window.matchAll(SENTENCE_END)) cut = (match.index ?? 0) + match[0].length;
    if (cut < PIECE_MAX * 0.3) cut = window.lastIndexOf(" ");
    if (cut <= 0) cut = PIECE_MAX;
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }

  if (rest) pieces.push(rest);
  return pieces;
}
