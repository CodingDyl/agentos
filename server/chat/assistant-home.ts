import fs from "node:fs/promises";
import path from "node:path";
import { agentOSRoot } from "../agentos/filesystem";
import { uiStateDir } from "../agentos/session-store";

/**
 * Where an assistant chat works, and what it is told about the operator.
 *
 * An assistant chat is everyday help, not work on AgentOS's code, so it runs
 * in its own folder: `assistant/` in the vault when the vault is there (notes
 * it writes show up in Obsidian), else `~/.agentos-ui/assistant`. Outside the
 * repository it can't trip the dev server's file watcher, and the coding
 * setup that lives with the repository (CLAUDE.md, hooks, plugins) never
 * loads.
 *
 * `ABOUT-ME.md` in that folder is the operator's own note on who they are and
 * how they like answers. It is read on every turn and put in the system
 * prompt, so editing it changes the assistant without touching code.
 */

const ABOUT_FILE = "ABOUT-ME.md";

/** Enough for a page about yourself; a runaway note can't swamp the prompt. */
const ABOUT_LIMIT = 6_000;

const ABOUT_TEMPLATE = `# About me

This note is read by the AgentOS assistant at the start of every chat. Write
what it should know about you and how you like answers, and it will use it.

- Name:
- Where I'm based (and time zone):
- What I'm working on:
- How I like answers:
`;

async function isDirectory(folder: string): Promise<boolean> {
  try {
    return (await fs.stat(folder)).isDirectory();
  } catch {
    return false;
  }
}

/** The assistant's folder, created (with an ABOUT-ME.md to fill in) on first use. */
export async function assistantHome(): Promise<string> {
  const vault = agentOSRoot();
  const home = (await isDirectory(vault)) ? path.join(vault, "assistant") : path.join(uiStateDir(), "assistant");
  await fs.mkdir(home, { recursive: true });
  await fs.writeFile(path.join(home, ABOUT_FILE), ABOUT_TEMPLATE, { encoding: "utf8", flag: "wx" }).catch(() => undefined);
  return home;
}

/** The operator's ABOUT-ME.md, clipped; empty when there is none. */
export async function readAboutMe(home: string): Promise<string> {
  try {
    const text = (await fs.readFile(path.join(home, ABOUT_FILE), "utf8")).trim();
    return text.length > ABOUT_LIMIT ? `${text.slice(0, ABOUT_LIMIT)}…` : text;
  } catch {
    return "";
  }
}

/** The whole system prompt for an assistant chat. */
export function assistantSystemPrompt(input: { home: string; aboutMe: string; today?: Date }): string {
  const today = (input.today ?? new Date()).toLocaleDateString("en-GB", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  return [
    "You are the operator's personal assistant inside AgentOS, their personal AI operating system. Talk with them the way a sharp, friendly assistant would: answer the question asked, plainly and briefly, and only go long when the question needs it.",
    `Today is ${today}. Your working folder is ${input.home}, which is yours for notes and drafts. You can read files anywhere on this machine, search and read the web, and run read-only commands. Anything that deletes, installs, writes outside your folder or touches credentials pauses for the operator's OK: if they say no, say what you would have done and carry on.`,
    "You have AgentOS's own tools (named agentos): today's agenda, the vault, projects and their tasks, mail, quick capture, email drafts and Operator runs. Use them for anything about the operator's day, work, notes or email, rather than reading vault files or calling the API yourself. Adding a task or a note and saving a draft need no OK; nothing you do sends an email.",
    "A message may end with an <agentos-context> block saying which AgentOS screen it was sent from and what was open or selected there. When they say 'this' or 'here', that is what they mean. Don't mention the block itself.",
    "You are not here to work on AgentOS's own code; if they want that, tell them to start a Coder chat. Don't plan, brainstorm or write a report unless they ask for one: this is a conversation.",
    input.aboutMe ? `What the operator has told you about themselves (from ABOUT-ME.md in your folder, which they can edit):\n\n${input.aboutMe}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
