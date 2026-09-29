import { SpeechStream } from "./speech-stream";

/**
 * The bookkeeping for one spoken answer: whether Hermes is still writing,
 * whether you have silenced Jarvis, and how much has been said. Plain
 * mutable state kept out of React on purpose; nothing on screen reads it.
 */
export class VoiceSession {
  private silenced = false;
  private writing = false;
  private stream = new SpeechStream();

  /** A new question: forget the last answer and start listening for the next. */
  begin(): void {
    this.silenced = false;
    this.writing = true;
    this.stream = new SpeechStream();
  }

  /** Hermes has finished writing (or failed). */
  end(): void {
    this.writing = false;
  }

  /** Silence Jarvis for the rest of this answer. */
  mute(): void {
    this.silenced = true;
  }

  isMuted(): boolean {
    return this.silenced;
  }

  isWriting(): boolean {
    return this.writing;
  }

  /** The newly finished pieces worth speaking. */
  feed(text: string, final: boolean): string[] {
    return this.stream.feed(text, final);
  }
}
