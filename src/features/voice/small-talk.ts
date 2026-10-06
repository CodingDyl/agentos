/**
 * Jarvis's small talk: answered at once, without Hermes.
 *
 * "Good morning" should not take a model call and three seconds to come back
 * as a paragraph. A greeting, a thank-you, "you there?" and goodbye are
 * answered here, in Jarvis's voice, knowing the time of day and what is
 * waiting on you. Only a sentence that is *nothing but* small talk is caught:
 * "Good morning, plan my day" still goes to Hermes, whole.
 *
 * Pure: the clock and the dice are passed in, so it is tested exactly.
 */

/** How Jarvis addresses you. One place, so it can become a setting. */
export const ADDRESS = "sir";

export interface SmallTalkContext {
  now: Date;
  /** Decisions waiting on you (Today's count), when known. */
  waiting?: number;
  address?: string;
  /** 0 ≤ n < 1. Defaults to Math.random; tests pass a fixed value. */
  random?: () => number;
}

type Period = "morning" | "afternoon" | "evening" | "night";

export function periodOf(date: Date): Period {
  const hour = date.getHours();
  if (hour < 5) return "night";
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 22) return "evening";
  return "night";
}

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

function count(n: number, thing: string): string {
  const word = n <= 10 ? WORDS[n] : String(n);
  return `${word.charAt(0).toUpperCase()}${word.slice(1)} ${thing}${n === 1 ? "" : "s"}`;
}

/** Lower case, "Jarvis" and punctuation gone, so "Hey Jarvis!" and "hey" read the same. */
export function normaliseSmallTalk(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\bjarvis\b/g, " ")
    .replace(/[^a-z' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type Intent = { kind: "greet"; said?: Period } | { kind: "how" } | { kind: "thanks" } | { kind: "bye" } | { kind: "there" };

const INTENTS: readonly (readonly [RegExp, Intent])[] = [
  [/^(good )?morning( to you)?$|^top of the morning$/, { kind: "greet", said: "morning" }],
  [/^(good )?afternoon$/, { kind: "greet", said: "afternoon" }],
  [/^(good )?evening$/, { kind: "greet", said: "evening" }],
  [/^(hi|hello|hey|hiya|howdy|yo|sup|what's up|wassup|greetings|hey there|hello there|oi)?$/, { kind: "greet" }],
  [/^(how are you|how are you doing|how's it going|how are things|you good|how do you do|how have you been)( today)?$/, { kind: "how" }],
  [/^(thanks|thank you|cheers|nice one|good job|well done|great work|appreciate it|perfect thanks|thanks mate)( very much| so much| a lot)?$/, { kind: "thanks" }],
  [/^(bye|goodbye|good night|goodnight|night|see you|see you later|later|that's all|that will be all|that'll be all)( for now| for today| then)?$/, { kind: "bye" }],
  [/^(you there|are you there|are you awake|you awake|ping|can you hear me)$/, { kind: "there" }],
];

function pick<T>(options: readonly T[], random: () => number): T {
  return options[Math.min(options.length - 1, Math.floor(random() * options.length))];
}

function greeting(said: Period | undefined, context: Required<Pick<SmallTalkContext, "now" | "address" | "random">> & { waiting?: number }): string {
  const { now, address, random } = context;
  const period = periodOf(now);
  const time = now.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" });

  let opener: string;
  if (said && said !== period && period === "night") opener = `It's ${time}, ${address}. Still, good ${said} to you.`;
  else if (said && said !== period) opener = `Good ${period}, technically, ${address}.`;
  else if (period === "night") opener = pick([`Still up, ${address}?`, `Burning the midnight oil, ${address}?`], random);
  else opener = pick([`Good ${period}, ${address}.`, `${period.charAt(0).toUpperCase()}${period.slice(1)}, ${address}.`], random);

  const waiting =
    context.waiting && context.waiting > 0
      ? ` ${count(context.waiting, "thing")} ${context.waiting === 1 ? "is" : "are"} waiting on you.`
      : "";

  const closer =
    period === "night"
      ? pick(["What needs doing before bed?", "What can I take off your plate?"], random)
      : period === "morning"
        ? pick(["What are we conquering today?", "Where shall we start?", "What's first?"], random)
        : pick(["What are we conquering next?", "Where were we?", "What can I do for you?"], random);

  return `${opener}${waiting} ${closer}`;
}

/** Jarvis's answer, or undefined when this isn't small talk and should go to Hermes. */
export function smallTalkReply(text: string, context: SmallTalkContext): string | undefined {
  const plain = normaliseSmallTalk(text);
  // Empty after removing "Jarvis" means you just said his name.
  if (plain.split(" ").length > 6) return undefined;

  const intent = INTENTS.find(([pattern]) => pattern.test(plain))?.[1];
  if (!intent) return undefined;

  const address = context.address ?? ADDRESS;
  const random = context.random ?? Math.random;
  const period = periodOf(context.now);

  switch (intent.kind) {
    case "greet":
      return greeting(intent.said, { now: context.now, address, random, waiting: context.waiting });
    case "how":
      return pick([`All systems running, ${address}. And you?`, `Never better, ${address}. What can I do for you?`, `Fully charged and at your service, ${address}.`], random);
    case "thanks":
      return pick([`Always a pleasure, ${address}.`, `Anytime, ${address}.`, `Happy to help, ${address}.`], random);
    case "bye":
      return period === "night" || period === "evening" ? `Good night, ${address}. I'll keep an eye on things.` : `Very good, ${address}. I'll be here.`;
    case "there":
      return pick([`Always, ${address}.`, `Right here, ${address}.`], random);
  }
}
