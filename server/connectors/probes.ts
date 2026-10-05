import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { ConnectorSetupItem } from "../../shared/connector-types";
import { findOnPath, envKeySet } from "../ai-stack/detect";
import { agentOSRoot } from "../agentos/filesystem";
import { configuredProjectsRoot, PROJECTS_ROOT_ENV, resolveProjectsRoot } from "../operator/project-folder";
import { accountStatus, binary as higgsfieldBinary } from "../designs/higgsfield";
import { investecGet, isInvestecConfigured, missingInvestecVariables } from "../finance/investec";
import { getHermesStatus, hermesFetch } from "../hermes/client";
import {
  canModifyGmail,
  canReadCalendar,
  disconnectGmail,
  getAccessToken,
  isGmailConfigured,
  isGmailConnected,
} from "../mail/gmail-auth";
import {
  disconnectOutreach,
  getOutreachAccessToken,
  isOutreachConnected,
  outreachAddress,
} from "../outreach/auth";
import { isApolloConfigured, searchPeopleAtDomain } from "../outreach/apollo";
import { isFishConfigured, synthesise } from "../voice/fish";
import { disconnectSpotify, isSpotifyConfigured, isSpotifyConnected, spotifyRedirectUri, testSpotify } from "../learning/spotify";
import { fetchYouTubeMetadata } from "../learning/youtube";
import { testSetup } from "../supabase/client";
import { listSetups, recordTest } from "../supabase/setups";
import { getVirtec, isVirtecConfigured, isVirtecWritable, VIRTEC_PATHS, virtecConfigurationProblem } from "../virtec/client";
import { isVercelConfigured, readVercelUser } from "../vercel/client";
import { claudeWorker } from "../workers/providers/claude-worker";
import { grokWorker } from "../workers/providers/grok-worker";
import { testLinkedIn } from "../career/linkedin";
import { timesheetScript } from "../career/timesheet";
import { togglMe } from "../career/toggl";

/**
 * How AgentOS finds out whether each connector is set up, and tests it.
 *
 * Two different costs, kept apart on purpose:
 *
 * - `local()` is what the Connectors page reads on open. File-system checks,
 *   environment variable *names*, stored OAuth grants. No network, no model,
 *   no binary run — opening a screen never starts work.
 * - `test()` is the "Test connection" button: one real, read-only request to
 *   the service. It goes through the same client (and so the same guard) as
 *   every other call, so a connector switched off in AgentOS is not contacted.
 *
 * Neither ever returns a secret. An account is reported by its public handle.
 */

const run = promisify(execFile);

export interface LocalProbe {
  configured: boolean;
  /** Why not, when not — in words that point at the fix. */
  detail?: string;
  setup: ConnectorSetupItem[];
  /** Capabilities (by action) that need more than the connector being connected, and why they can't run. */
  missingGrants?: Record<string, string>;
  connectHint: string;
  connectUrl?: string;
  extraActions?: { label: string; hint?: string; href?: string; post?: string }[];
  canDisconnect?: boolean;
}

export interface TestResult {
  ok: boolean;
  detail: string;
  account?: string;
}

export interface Probe {
  local(): Promise<LocalProbe>;
  test(): Promise<TestResult>;
  disconnect?(): Promise<void>;
}

/**
 * Settings that aren't secrets: an address, an id, a path. Their current value
 * is shown so it can be corrected; every other variable is a key and its
 * value never leaves the server.
 */
export const NON_SECRET = new Set([
  "VERCEL_TEAM_ID",
  "HERMES_BASE_URL",
  "VIRTEC_BASE_URL",
  "INVESTEC_CLIENT_ID",
  "GOOGLE_CLIENT_ID",
  "FISH_VOICE_ID",
  "FISH_MODEL",
  "AGENTOS_GROK_BIN",
  "AGENTOS_HIGGSFIELD_BIN",
  "POSTHOG_HOST",
  "SENTRY_ORG",
  "SUPABASE_URL",
  "SPOTIFY_CLIENT_ID",
  "TOGGL_WORKSPACE_ID",
  "LINKEDIN_PERSON_URN",
  "LINKEDIN_API_VERSION",
  "AGENTOS_TIMESHEET_SCRIPT",
  "AGENTOS_PYTHON_BIN",
]);

/** A variable the Setup form may write. The only names `.env` can be written with. */
export function env(name: string, options: { label?: string; optional?: boolean; placeholder?: string } = {}): ConnectorSetupItem {
  const secret = !NON_SECRET.has(name);
  return {
    label: options.label ?? name,
    kind: "env",
    envName: name,
    done: envKeySet(name),
    secret,
    optional: options.optional || undefined,
    placeholder: options.placeholder,
    value: secret ? undefined : process.env[name]?.trim() || undefined,
  };
}

/** A bare name is looked up on PATH; a path (from an `AGENTOS_*_BIN` setting) is checked where it is. */
async function findBinary(nameOrPath: string): Promise<string | undefined> {
  if (!path.isAbsolute(nameOrPath)) return findOnPath(nameOrPath);
  try {
    await fs.access(nameOrPath, fs.constants.X_OK);
    return nameOrPath;
  } catch {
    return undefined;
  }
}

function failure(error: unknown): TestResult {
  return { ok: false, detail: error instanceof Error ? error.message : "The connection test failed." };
}

async function githubUser(): Promise<TestResult> {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) return { ok: false, detail: "GITHUB_TOKEN is not set." };

  let response: Response;
  try {
    response = await fetch("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "AgentOS/0.1 (personal dashboard)",
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { ok: false, detail: "Couldn't reach GitHub." };
  }

  if (response.status === 401) return { ok: false, detail: "GitHub rejected GITHUB_TOKEN." };
  if (!response.ok) return { ok: false, detail: `GitHub responded with ${response.status}.` };

  const body = (await response.json().catch(() => ({}))) as { login?: unknown };
  const login = typeof body.login === "string" ? body.login : undefined;
  return { ok: true, detail: login ? `Signed in as ${login}.` : "Token accepted.", account: login };
}

export const PROBES: Record<string, Probe> = {
  filesystem: {
    async local() {
      const root = agentOSRoot();
      const projectsRoot = configuredProjectsRoot();
      // Where Operator creates new project folders. Optional: the vault works
      // without it. Not a secret, so its value is shown.
      const projects: ConnectorSetupItem = {
        label: `${PROJECTS_ROOT_ENV}: where new project folders go`,
        kind: "env",
        envName: PROJECTS_ROOT_ENV,
        optional: true,
        done: await resolveProjectsRoot(projectsRoot).then(
          () => true,
          () => false,
        ),
        value: projectsRoot,
        placeholder: "/Volumes/SSD/Developer",
      };
      const setup: ConnectorSetupItem[] = [{ label: "AGENTOS_ROOT (defaults to ~/AgentOS)", kind: "path", done: false }, projects];
      try {
        const stat = await fs.stat(root);
        setup[0].done = stat.isDirectory();
        return stat.isDirectory()
          ? { configured: true, setup, connectHint: "The vault is read from AGENTOS_ROOT." }
          : { configured: false, detail: "AGENTOS_ROOT is not a folder.", setup, connectHint: "Point AGENTOS_ROOT at the vault folder." };
      } catch {
        return { configured: false, detail: "The vault folder was not found.", setup, connectHint: "Point AGENTOS_ROOT at the vault folder." };
      }
    },
    async test() {
      try {
        await fs.access(agentOSRoot(), fs.constants.R_OK | fs.constants.W_OK);
        const entries = await fs.readdir(agentOSRoot());
        // The projects folder is reported beside the vault, not as its health:
        // an unplugged SSD doesn't make the vault unusable.
        const projects = configuredProjectsRoot()
          ? await resolveProjectsRoot().then(
              (real) => ` New project folders go in ${real}.`,
              (error: unknown) => ` ${error instanceof Error ? error.message : "The projects folder can't be used."}`,
            )
          : "";
        return { ok: true, detail: `Readable and writable, ${entries.length} entries at the top level.${projects}` };
      } catch {
        return { ok: false, detail: "The vault folder can't be read and written." };
      }
    },
  },

  git: {
    async local() {
      const found = await findOnPath("git");
      return {
        configured: Boolean(found),
        detail: found ? undefined : "git is not on the server's PATH.",
        setup: [{ label: "git on PATH", kind: "cli", done: Boolean(found) }],
        connectHint: "Git is used on repositories linked from a workspace's PROJECT.md.",
      };
    },
    async test() {
      try {
        const { stdout } = await run("git", ["--version"], { timeout: 5_000 });
        return { ok: true, detail: stdout.trim() };
      } catch {
        return { ok: false, detail: "git could not be run." };
      }
    },
  },

  github: {
    async local() {
      const set = envKeySet("GITHUB_TOKEN");
      return {
        configured: set,
        detail: set ? undefined : "GITHUB_TOKEN is not set.",
        setup: [env("GITHUB_TOKEN")],
        connectHint: "Add a fine-grained personal access token as GITHUB_TOKEN in .env, then restart the data adapter.",
      };
    },
    test: githubUser,
  },

  vercel: {
    async local() {
      const set = isVercelConfigured();
      return {
        configured: set,
        detail: set ? undefined : "VERCEL_API_TOKEN is not set.",
        setup: [env("VERCEL_API_TOKEN"), env("VERCEL_TEAM_ID", { optional: true, placeholder: "team_…" })],
        connectHint: "Add VERCEL_API_TOKEN (and VERCEL_TEAM_ID for a team) to .env, then restart the data adapter.",
      };
    },
    async test() {
      try {
        const user = await readVercelUser();
        return { ok: true, detail: `Signed in as ${user}.`, account: user };
      } catch (error) {
        return failure(error);
      }
    },
  },

  hermes: {
    async local() {
      const { configured } = getHermesStatus();
      return {
        configured,
        detail: configured ? undefined : "HERMES_API_KEY is not set.",
        setup: [env("HERMES_API_KEY"), env("HERMES_BASE_URL", { optional: true, placeholder: "http://127.0.0.1:8642/v1" })],
        connectHint: "Set HERMES_API_KEY in .env and start the Hermes gateway. The switch is shared with Operations → AI stack.",
      };
    },
    async test() {
      try {
        const response = await hermesFetch("/capabilities", { method: "GET" });
        return response.ok
          ? { ok: true, detail: "Hermes answered." }
          : { ok: false, detail: `Hermes responded with ${response.status}.` };
      } catch (error) {
        return failure(error);
      }
    },
  },

  claude: {
    async local() {
      const set = envKeySet("ANTHROPIC_API_KEY") || envKeySet("ANTHROPIC_AUTH_TOKEN");
      return {
        configured: set,
        detail: set ? undefined : "ANTHROPIC_API_KEY is not set.",
        setup: [env("ANTHROPIC_API_KEY")],
        connectHint: "Set ANTHROPIC_API_KEY in .env. The switch is shared with Operations → AI stack.",
      };
    },
    async test() {
      // The worker's own check: the key is present. It does not spend a
      // request — a paid call to prove a key works is not a test worth running.
      const health = await claudeWorker.healthCheck();
      return { ok: health.available, detail: health.reason ?? (health.available ? "Ready." : "Not available.") };
    },
  },

  grok: {
    async local() {
      const found = await findBinary(process.env.AGENTOS_GROK_BIN?.trim() || "grok");
      return {
        configured: Boolean(found),
        detail: found ? undefined : "The grok CLI is not on the server's PATH.",
        setup: [
          { label: "grok CLI on PATH", kind: "cli", done: Boolean(found) },
          env("AGENTOS_GROK_BIN", { optional: true, placeholder: "/usr/local/bin/grok" }),
          env("XAI_API_KEY", { optional: true }),
        ],
        connectHint: "Install the grok CLI and sign in. The switch is shared with Operations → AI stack.",
      };
    },
    async test() {
      const health = await grokWorker.healthCheck();
      return { ok: health.available, detail: health.reason ?? (health.available ? "Ready." : "Not available.") };
    },
  },

  gmail: {
    async local() {
      const clientSet = isGmailConfigured();
      const [inbox, outreach, modify] = await Promise.all([isGmailConnected(), isOutreachConnected(), canModifyGmail()]);
      const missingGrants: Record<string, string> = {};
      if (!inbox) {
        missingGrants.read = "The inbox is not connected.";
        missingGrants.search = "The inbox is not connected.";
      }
      if (!modify) missingGrants.modify = inbox ? "Reconnect the inbox to grant changes." : "The inbox is not connected.";
      if (!outreach) {
        missingGrants.draft = "The outreach mailbox is not connected (Traction → Outreach).";
        missingGrants.send = "The outreach mailbox is not connected (Traction → Outreach).";
      }

      return {
        configured: inbox || outreach,
        detail: !clientSet ? "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set." : inbox || outreach ? undefined : "Not signed in.",
        setup: [
          env("GOOGLE_CLIENT_ID"),
          env("GOOGLE_CLIENT_SECRET"),
          { label: "Inbox signed in", kind: "oauth", done: inbox },
          { label: "Outreach mailbox signed in", kind: "oauth", done: outreach },
        ],
        missingGrants,
        connectHint: clientSet
          ? "Sign in with Google. The inbox and the outreach mailbox are separate grants; disconnecting removes both, and Calendar with the inbox."
          : "Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env, restart the data adapter, then sign in.",
        connectUrl: clientSet && !inbox ? "/api/mail/connect" : undefined,
        extraActions:
          clientSet && !outreach
            ? [
                ...(inbox
                  ? [
                      {
                        label: "Use my inbox account for outreach",
                        hint: "Sends outreach from the Gmail account already connected, with no second sign-in.",
                        post: "/api/outreach/use-inbox",
                      },
                    ]
                  : []),
                {
                  label: "Sign in a separate outreach mailbox",
                  hint: "Choose a different Google account. It must be allowed on the AgentOS Google app (a test user while the app is in Testing).",
                  href: "/api/outreach/connect",
                },
              ]
            : [],
        canDisconnect: inbox || outreach,
      };
    },
    async test() {
      const [inbox, outreach] = await Promise.all([isGmailConnected(), isOutreachConnected()]);
      if (!inbox && !outreach) return { ok: false, detail: "Not signed in." };

      const results: string[] = [];
      try {
        if (inbox) {
          await getAccessToken();
          results.push("inbox token refreshed");
        }
        if (outreach) {
          await getOutreachAccessToken();
          results.push("outreach token refreshed");
        }
      } catch (error) {
        return failure(error);
      }
      const address = await outreachAddress();
      return { ok: true, detail: `${results.join(", ")}.`.replace(/^./, (c) => c.toUpperCase()), account: address };
    },
    async disconnect() {
      await Promise.all([disconnectGmail(), disconnectOutreach()]);
    },
  },

  calendar: {
    async local() {
      const [inbox, calendar] = await Promise.all([isGmailConnected(), canReadCalendar()]);
      return {
        configured: calendar,
        detail: calendar ? undefined : inbox ? "The inbox sign-in predates calendar access. Reconnect it." : "Not signed in.",
        setup: [{ label: "Inbox signed in with calendar access", kind: "oauth", done: calendar }],
        connectHint: "Calendar rides on the inbox's Google sign-in. Connect or reconnect Gmail to grant it.",
        connectUrl: isGmailConfigured() && !calendar ? "/api/mail/connect" : undefined,
      };
    },
    async test() {
      if (!(await canReadCalendar())) return { ok: false, detail: "Calendar access was not granted." };
      try {
        await getAccessToken();
        return { ok: true, detail: "Google token refreshed with calendar access." };
      } catch (error) {
        return failure(error);
      }
    },
  },

  virtec: {
    async local() {
      const configured = isVirtecConfigured();
      const writable = isVirtecWritable();
      const writeReason = "VIRTEC_WRITE_API_KEY is not set, so Virtec is read-only.";
      return {
        configured,
        detail: configured ? undefined : virtecConfigurationProblem(),
        setup: [
          env("VIRTEC_BASE_URL", { placeholder: "https://crm.example.com" }),
          env("VIRTEC_API_KEY"),
          env("VIRTEC_WRITE_API_KEY", { optional: true, label: "VIRTEC_WRITE_API_KEY (for write-back)" }),
        ],
        missingGrants: writable ? undefined : { update_records: writeReason, start_scan: writeReason, publish_email: writeReason },
        connectHint: "Set VIRTEC_BASE_URL and VIRTEC_API_KEY in .env. Write-back needs its own VIRTEC_WRITE_API_KEY.",
      };
    },
    async test() {
      try {
        await getVirtec(VIRTEC_PATHS.revenue);
        return { ok: true, detail: `Virtec answered${isVirtecWritable() ? "; write-back is configured" : "; read-only"}.` };
      } catch (error) {
        return failure(error);
      }
    },
  },

  investec: {
    async local() {
      const configured = isInvestecConfigured();
      const missing = missingInvestecVariables();
      return {
        configured,
        detail: configured ? undefined : `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not set.`,
        setup: [env("INVESTEC_CLIENT_ID"), env("INVESTEC_SECRET"), env("INVESTEC_API_KEY")],
        connectHint: "Add the three Investec programmable-banking values to .env. AgentOS only ever reads.",
      };
    },
    async test() {
      try {
        const listed = await investecGet<{ accounts?: unknown[] }>("/za/pb/v1/accounts");
        const count = Array.isArray(listed.accounts) ? listed.accounts.length : 0;
        return { ok: true, detail: `Investec answered with ${count} account${count === 1 ? "" : "s"}.` };
      } catch (error) {
        return failure(error);
      }
    },
  },

  apollo: {
    async local() {
      const configured = isApolloConfigured();
      return {
        configured,
        detail: configured ? undefined : "APOLLO_API_KEY is not set.",
        setup: [env("APOLLO_API_KEY")],
        connectHint:
          "Paste an Apollo API key (Apollo → Settings → Integrations → API, a master key). Searching is free; revealing an email spends one credit and only happens when you press Reveal.",
      };
    },
    async test() {
      try {
        // A one-person search: it costs no credits, and proves the key works.
        await searchPeopleAtDomain("apollo.io", 1);
        return { ok: true, detail: "Apollo accepted the key. Searching is free; only revealing an email spends a credit." };
      } catch (error) {
        return failure(error);
      }
    },
  },

  fish: {
    async local() {
      const configured = isFishConfigured();
      return {
        configured,
        detail: configured ? undefined : "FISH_API_KEY is not set.",
        setup: [
          env("FISH_API_KEY"),
          env("FISH_VOICE_ID", { optional: true, placeholder: "Defaults to the Jarvis voice" }),
          env("FISH_MODEL", { optional: true, placeholder: "s1" }),
        ],
        connectHint: "Paste a Fish Audio API key. The switch is shared with Jarvis's voice switch: turning either off silences both.",
      };
    },
    async test() {
      // Fish has no free "who am I" call this client uses, so the test speaks
      // two letters. It spends a fraction of a cent of Fish credit.
      try {
        const audio = await synthesise("OK.");
        return { ok: true, detail: `Fish Audio spoke a test line (${Math.round(audio.length / 1024)} KB of audio).` };
      } catch (error) {
        return failure(error);
      }
    },
  },

  youtube: {
    async local() {
      return {
        configured: true,
        setup: [{ label: "No key needed: videos play in YouTube's own embedded player", kind: "path", done: true }],
        connectHint: "Nothing to set up. AgentOS saves a video's address and title, plays it through YouTube's embed, and never downloads it.",
      };
    },
    async test() {
      // YouTube's very first video: as stable a public id as exists.
      const metadata = await fetchYouTubeMetadata("jNQXAC9IVRw");
      return metadata.author
        ? { ok: true, detail: `oEmbed answered (“${metadata.title}”).` }
        : { ok: false, detail: "YouTube's oEmbed endpoint did not answer." };
    },
  },

  spotify: {
    async local() {
      const configured = isSpotifyConfigured();
      const connected = await isSpotifyConnected();
      return {
        configured: connected,
        detail: !configured ? "SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET are not set." : connected ? undefined : "Not signed in.",
        setup: [
          env("SPOTIFY_CLIENT_ID"),
          env("SPOTIFY_CLIENT_SECRET"),
          { label: `Redirect URI registered: ${spotifyRedirectUri()}`, kind: "path", done: configured },
          { label: "Signed in to Spotify", kind: "oauth", done: connected },
        ],
        connectHint: configured
          ? "Sign in with Spotify. Playback control and the in-app player need Premium; reading what's playing does not."
          : `Create an app at developer.spotify.com, add ${spotifyRedirectUri()} as its redirect URI, then paste its client id and secret here.`,
        connectUrl: configured && !connected ? "/api/spotify/connect" : undefined,
        canDisconnect: connected,
      };
    },
    test: testSpotify,
    async disconnect() {
      await disconnectSpotify();
    },
  },

  notebooks: {
    async local() {
      return {
        configured: true,
        setup: [{ label: "Linked notebooks work without an account", kind: "path", done: true }],
        connectHint:
          "Notebooks are linked by address and opened in their own tool. AgentOS does not read or automate NotebookLM; learnings come back through capture.",
      };
    },
    async test() {
      return { ok: true, detail: "Linked notebooks are stored locally." };
    },
  },

  supabase: {
    async local() {
      const setups = listSetups();
      const ready = setups.filter((setup) => setup.keySet);
      return {
        configured: ready.length > 0,
        detail: setups.length === 0 ? "No database set up yet." : ready.length === 0 ? "No setup has its key yet." : undefined,
        setup: [
          {
            label: setups.length === 0 ? "Add a database below" : `${ready.length} of ${setups.length} database${setups.length === 1 ? "" : "s"} ready`,
            kind: "path",
            done: ready.length > 0,
          },
        ],
        connectHint:
          "Add one setup per Supabase project and environment, with its project URL and secret (service_role) key, then link it to workspaces. The key goes into .env and is never shown again.",
      };
    },
    async test() {
      const setups = listSetups().filter((setup) => setup.keySet);
      if (setups.length === 0) return { ok: false, detail: "No setup has its key yet." };
      const results = await Promise.all(setups.map(async (setup) => ({ setup, result: await testSetup(setup) })));
      for (const { setup, result } of results) recordTest(setup.id, { ...result, checkedAt: new Date().toISOString() });
      const failed = results.filter((entry) => !entry.result.ok);
      return failed.length === 0
        ? { ok: true, detail: `All ${results.length} database${results.length === 1 ? "" : "s"} answered.` }
        : { ok: false, detail: failed.map((entry) => `${entry.setup.name}: ${entry.result.detail}`).join(" ") };
    },
  },

  career: {
    async local() {
      const script = timesheetScript();
      const found = await fs
        .access(script)
        .then(() => true)
        .catch(() => false);
      return {
        configured: found,
        detail: found ? undefined : `The timesheet script is not at ${script}.`,
        setup: [
          { label: `Timesheet script: ${script}`, kind: "path", done: found },
          env("AGENTOS_TIMESHEET_SCRIPT", { optional: true, placeholder: "/Users/you/AgentOS/scripts/career/timesheet/extract.py" }),
          env("AGENTOS_PYTHON_BIN", { optional: true, placeholder: "python3" }),
        ],
        connectHint: "Career runs scripts/career/timesheet/extract.py with python3. Copy it into your vault's scripts/career/timesheet to customise mappings.json.",
      };
    },
    async test() {
      const found = await findBinary(process.env.AGENTOS_PYTHON_BIN?.trim() || "python3");
      return found ? { ok: true, detail: `Python at ${found}.` } : { ok: false, detail: "python3 is not on the server's PATH." };
    },
  },

  toggl: {
    async local() {
      const configured = envKeySet("TOGGL_API_TOKEN");
      return {
        configured,
        detail: configured ? undefined : "TOGGL_API_TOKEN is not set.",
        setup: [env("TOGGL_API_TOKEN"), env("TOGGL_WORKSPACE_ID", { optional: true, placeholder: "6550194" })],
        connectHint: "Toggl Track → Profile → API token. Read-only: AgentOS only reads time entries and project names.",
      };
    },
    async test() {
      try {
        const me = await togglMe();
        return { ok: true, detail: `Signed in${me.fullname ? ` as ${me.fullname}` : ""}.`, account: me.email };
      } catch (error) {
        return failure(error);
      }
    },
  },

  entelect: {
    async local() {
      return {
        configured: true,
        setup: [{ label: "Portals are opened in the browser, signed in as you", kind: "path", done: true }],
        connectHint:
          "Entelect's timesheet and Events sites have no API AgentOS uses. Career prepares the timesheet and the event details, opens the site, and records what you submitted.",
      };
    },
    async test() {
      return { ok: true, detail: "Nothing to test: AgentOS only opens these sites." };
    },
  },

  linkedin: {
    async local() {
      const configured = envKeySet("LINKEDIN_ACCESS_TOKEN");
      return {
        configured,
        detail: configured ? undefined : "LINKEDIN_ACCESS_TOKEN is not set. Drafting still works.",
        setup: [
          env("LINKEDIN_ACCESS_TOKEN"),
          env("LINKEDIN_PERSON_URN", { optional: true, placeholder: "urn:li:person:abc123" }),
          env("LINKEDIN_API_VERSION", { optional: true, placeholder: "202509" }),
        ],
        missingGrants: { read_messages: "LinkedIn's messaging API is limited to approved partners. Messages open on linkedin.com." },
        connectHint:
          "Create an app at developer.linkedin.com with the “Share on LinkedIn” and “Sign In with LinkedIn using OpenID Connect” products, then generate a member token with w_member_social, openid and profile.",
      };
    },
    test: testLinkedIn,
  },

  higgsfield: {
    async local() {
      const found = await findBinary(higgsfieldBinary());
      return {
        configured: Boolean(found),
        detail: found ? undefined : "The Higgsfield CLI is not on the server's PATH.",
        setup: [
          { label: "higgsfield CLI on PATH", kind: "cli", done: Boolean(found) },
          env("AGENTOS_HIGGSFIELD_BIN", { optional: true, placeholder: "/usr/local/bin/higgsfield" }),
        ],
        connectHint: "Install the Higgsfield CLI and run `higgsfield auth login`.",
      };
    },
    async test() {
      const account = await accountStatus();
      if (!account.connected) return { ok: false, detail: account.reason ?? "Higgsfield is not connected." };
      const credits = account.credits !== undefined ? `, ${account.credits} credits` : "";
      return { ok: true, detail: `Signed in${account.plan ? ` on ${account.plan}` : ""}${credits}.`, account: account.email };
    },
  },
};

/** For connectors without an adapter: what connecting would take, in plain words. */
export const UNAVAILABLE_HINTS: Record<string, { hint: string; setup: string[] }> = {
  drive: { hint: "AgentOS has no Google Drive adapter yet. It would reuse the Google sign-in with a Drive scope.", setup: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] },
  "search-console": { hint: "AgentOS has no Search Console adapter yet. It would reuse the Google sign-in with the webmasters.readonly scope.", setup: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] },
  ga4: { hint: "AgentOS has no Google Analytics adapter yet. It would reuse the Google sign-in with the analytics.readonly scope.", setup: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] },
  posthog: { hint: "AgentOS has no PostHog adapter yet. It would read with a personal API key.", setup: ["POSTHOG_API_KEY", "POSTHOG_HOST"] },
  sentry: { hint: "AgentOS has no Sentry adapter yet. It would read with an auth token scoped to your organisation.", setup: ["SENTRY_AUTH_TOKEN", "SENTRY_ORG"] },
  stripe: { hint: "AgentOS has no Stripe adapter yet. It would read with a restricted, read-only key.", setup: ["STRIPE_RESTRICTED_KEY"] },
  figma: { hint: "AgentOS has no Figma adapter yet. It would read with a personal access token.", setup: ["FIGMA_TOKEN"] },
};
