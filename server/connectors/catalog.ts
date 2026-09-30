import {
  defaultPolicyForRisk,
  type CapabilityPolicy,
  type CapabilityRisk,
  type ConnectorCategory,
} from "../../shared/connector-types";

/**
 * Every connector AgentOS knows about, and every capability each one has.
 *
 * Static data and nothing else: no client is imported here, so the policy
 * guard that the clients themselves call can read this file without an import
 * cycle.
 *
 * `implemented` is the honest part. A capability is listed whether or not
 * AgentOS has code for it yet — the orchestrator needs the vocabulary, and a
 * policy set today still holds when the code lands — but only an implemented
 * one can actually be exercised. Nothing marked implemented here is aspirational:
 * each names the file that does it.
 */

export interface CatalogCapability {
  /** The part after `<connector>.`. */
  action: string;
  name: string;
  risk: CapabilityRisk;
  /** Stricter than the risk's default, when set. */
  policy?: CapabilityPolicy;
  /** Where AgentOS does this today. Absent means it doesn't yet. */
  implementedBy?: string;
}

export interface CatalogConnector {
  id: string;
  name: string;
  description: string;
  category: ConnectorCategory;
  tier: 1 | 2 | 3 | 4 | 5;
  icon: string;
  /** False when AgentOS has no adapter: the status is always `unavailable`. */
  integrated: boolean;
  /** The switch is the AI stack's (`/operations` → AI stack) rather than this page's own. */
  aiStackSwitch?: boolean;
  /** The switch is Jarvis's voice switch: Fish is the voice, so there is only one. */
  voiceSwitch?: boolean;
  /** AgentOS runs on it; there is no switch. */
  required?: boolean;
  capabilities: CatalogCapability[];
}

export const CONNECTORS: readonly CatalogConnector[] = [
  // ---------------------------------------------------------------- tier 1
  {
    id: "filesystem",
    name: "Local filesystem",
    description: "The AgentOS vault on this machine: projects, tasks, decisions and notes.",
    category: "productivity",
    tier: 1,
    icon: "hard-drive",
    integrated: true,
    required: true,
    capabilities: [
      { action: "read_vault", name: "Read the vault", risk: "read", implementedBy: "server/agentos/filesystem.ts" },
      { action: "write_project_files", name: "Write tasks, decisions and project files", risk: "write-local", implementedBy: "server/agentos/mutations/writer.ts" },
      { action: "create_directory", name: "Create project folders outside the vault", risk: "write-local", implementedBy: "server/operator/project-folder.ts" },
      { action: "delete_files", name: "Delete files", risk: "destructive" },
    ],
  },
  {
    id: "git",
    name: "Git",
    description: "Local repositories linked to workspaces: status, branches and commits.",
    category: "development",
    tier: 1,
    icon: "git-branch",
    integrated: true,
    capabilities: [
      { action: "read_status", name: "Read branches and working tree", risk: "read", implementedBy: "server/agentos/git.ts" },
      { action: "init", name: "Initialise repositories", risk: "write-local" },
      { action: "create_branch", name: "Create branches", risk: "write-local", implementedBy: "server/agentos/repository.ts" },
      { action: "switch_branch", name: "Switch branches", risk: "write-local", implementedBy: "server/agentos/repository.ts" },
      { action: "commit", name: "Commit", risk: "write-local", implementedBy: "server/agentos/repository.ts" },
      { action: "stash", name: "Stash changes", risk: "write-local", implementedBy: "server/agentos/repository.ts" },
      { action: "push", name: "Push to a remote", risk: "write-external" },
      { action: "reset_hard", name: "Discard work (reset --hard)", risk: "destructive" },
    ],
  },
  {
    id: "github",
    name: "GitHub",
    description: "Repositories, branches, issues and pull requests.",
    category: "development",
    tier: 1,
    icon: "github",
    integrated: true,
    capabilities: [
      { action: "search_repositories", name: "Search public repositories", risk: "read", implementedBy: "server/today/trending.ts" },
      { action: "read_repository", name: "Read repositories", risk: "read" },
      { action: "create_repository", name: "Create repositories", risk: "write-external" },
      { action: "create_branch", name: "Create branches", risk: "write-external" },
      { action: "push", name: "Push branches", risk: "write-external" },
      { action: "create_issue", name: "Create issues", risk: "write-external" },
      { action: "create_pull_request", name: "Open pull requests", risk: "write-external" },
      { action: "merge", name: "Merge to main", risk: "write-external", policy: "approval" },
      { action: "delete_repository", name: "Delete repositories", risk: "destructive" },
    ],
  },
  {
    id: "vercel",
    name: "Vercel",
    description: "Projects, deployments and domains.",
    category: "development",
    tier: 1,
    icon: "triangle",
    integrated: true,
    capabilities: [
      { action: "read_projects", name: "Read projects", risk: "read", implementedBy: "server/vercel/client.ts" },
      { action: "read_deployments", name: "Read deployments and domains", risk: "read", implementedBy: "server/vercel/client.ts" },
      { action: "read_logs", name: "Read build and runtime logs", risk: "read" },
      { action: "create_project", name: "Create projects", risk: "write-external" },
      { action: "create_preview", name: "Create preview deployments", risk: "write-external" },
      { action: "deploy_production", name: "Deploy to production", risk: "write-external", policy: "approval" },
      { action: "delete_project", name: "Delete projects", risk: "destructive" },
    ],
  },
  {
    id: "hermes",
    name: "Hermes",
    description: "The local agent: scopes tasks, plans milestones, routes and reviews work.",
    category: "development",
    tier: 1,
    icon: "bot",
    integrated: true,
    aiStackSwitch: true,
    capabilities: [
      { action: "read_capabilities", name: "Read capabilities and skills", risk: "read", implementedBy: "server/hermes/capabilities.ts" },
      { action: "run_agent", name: "Run agent sessions", risk: "write-local", implementedBy: "server/hermes/runs.ts" },
      { action: "control_automations", name: "Pause, resume and run automations", risk: "write-local", implementedBy: "server/hermes/automations.ts" },
    ],
  },
  {
    id: "claude",
    name: "Claude",
    description: "Anthropic's API, as a coding worker in an isolated checkout.",
    category: "development",
    tier: 1,
    icon: "sparkles",
    integrated: true,
    aiStackSwitch: true,
    capabilities: [
      { action: "run_job", name: "Run coding jobs", risk: "write-local", implementedBy: "server/workers/providers/claude-worker.ts" },
    ],
  },
  {
    id: "grok",
    name: "Grok",
    description: "xAI's CLI, as a coding worker in an isolated checkout.",
    category: "development",
    tier: 1,
    icon: "zap",
    integrated: true,
    aiStackSwitch: true,
    capabilities: [
      { action: "run_job", name: "Run coding jobs", risk: "write-local", implementedBy: "server/workers/providers/grok-worker.ts" },
    ],
  },

  // ---------------------------------------------------------------- tier 2
  {
    id: "gmail",
    name: "Gmail",
    description: "The inbox, and the separate outreach mailbox that drafts and sends.",
    category: "communication",
    tier: 2,
    icon: "mail",
    integrated: true,
    capabilities: [
      { action: "read", name: "Read mail", risk: "read", implementedBy: "server/mail/gmail-client.ts" },
      { action: "search", name: "Search mail", risk: "read", implementedBy: "server/mail/gmail-client.ts" },
      { action: "modify", name: "Mark read and move to Trash", risk: "write-external", implementedBy: "server/mail/gmail-client.ts" },
      { action: "draft", name: "Create drafts", risk: "write-external", implementedBy: "server/outreach/gmail.ts" },
      { action: "send", name: "Send email", risk: "external-communication", implementedBy: "server/outreach/gmail.ts" },
    ],
  },
  {
    id: "calendar",
    name: "Google Calendar",
    description: "Today's events, for the day's agenda and brief.",
    category: "productivity",
    tier: 2,
    icon: "calendar",
    integrated: true,
    capabilities: [
      { action: "read_events", name: "Read events", risk: "read", implementedBy: "server/today/calendar.ts" },
      { action: "create_event", name: "Create events", risk: "write-external" },
      { action: "invite", name: "Send invitations", risk: "external-communication" },
    ],
  },
  {
    id: "drive",
    name: "Google Drive",
    description: "Documents and files, as context for work.",
    category: "productivity",
    tier: 2,
    icon: "folder",
    integrated: false,
    capabilities: [
      { action: "read_files", name: "Read files", risk: "read" },
      { action: "create_file", name: "Create files", risk: "write-external" },
      { action: "share_file", name: "Share files", risk: "external-communication" },
    ],
  },
  {
    id: "fish",
    name: "Fish Audio",
    description: "Jarvis's voice: speaks replies and transcribes what you say.",
    category: "communication",
    tier: 2,
    icon: "audio",
    integrated: true,
    voiceSwitch: true,
    capabilities: [
      { action: "text_to_speech", name: "Speak replies (spends credits)", risk: "write-external", implementedBy: "server/voice/fish.ts" },
      { action: "speech_to_text", name: "Transcribe speech (spends credits)", risk: "write-external", implementedBy: "server/voice/fish.ts" },
      { action: "clone_voice", name: "Clone a voice", risk: "write-external", policy: "approval" },
    ],
  },
  {
    id: "virtec",
    name: "Virtec CRM",
    description: "Leads, clients, follow-ups and quotes.",
    category: "business",
    tier: 2,
    icon: "users",
    integrated: true,
    capabilities: [
      { action: "read_crm", name: "Read leads, clients and follow-ups", risk: "read", implementedBy: "server/virtec/client.ts" },
      { action: "update_records", name: "Update lead and follow-up status", risk: "write-external", implementedBy: "server/virtec/client.ts" },
      { action: "start_scan", name: "Start a Places lead scan (spends Google credit)", risk: "write-external", implementedBy: "server/virtec/client.ts" },
      { action: "publish_email", name: "Publish lead-magnet signup emails", risk: "external-communication", implementedBy: "server/virtec/client.ts" },
    ],
  },

  // ---------------------------------------------------------------- tier 3
  {
    id: "search-console",
    name: "Search Console",
    description: "Impressions, clicks, queries and rankings from Google Search.",
    category: "analytics",
    tier: 3,
    icon: "search",
    integrated: false,
    capabilities: [
      { action: "read_performance", name: "Read impressions and clicks", risk: "read" },
      { action: "read_queries", name: "Read queries and rankings", risk: "read" },
      { action: "submit_sitemap", name: "Submit sitemaps", risk: "write-external" },
    ],
  },
  {
    id: "ga4",
    name: "Google Analytics 4",
    description: "Traffic and landing pages.",
    category: "analytics",
    tier: 3,
    icon: "bar-chart",
    integrated: false,
    capabilities: [
      { action: "read_traffic", name: "Read traffic", risk: "read" },
      { action: "read_landing_pages", name: "Read landing pages", risk: "read" },
    ],
  },
  {
    id: "posthog",
    name: "PostHog",
    description: "Product usage: events, funnels and retention.",
    category: "analytics",
    tier: 3,
    icon: "activity",
    integrated: false,
    capabilities: [
      { action: "read_events", name: "Read events", risk: "read" },
      { action: "read_insights", name: "Read funnels and retention", risk: "read" },
    ],
  },
  {
    id: "sentry",
    name: "Sentry",
    description: "Errors and releases.",
    category: "analytics",
    tier: 3,
    icon: "bug",
    integrated: false,
    capabilities: [
      { action: "read_issues", name: "Read errors", risk: "read" },
      { action: "read_releases", name: "Read releases", risk: "read" },
      { action: "resolve_issue", name: "Resolve issues", risk: "write-external" },
    ],
  },

  // ---------------------------------------------------------------- tier 4
  {
    id: "supabase",
    name: "Supabase",
    description: "Postgres tables and product data, one setup per project and environment.",
    category: "data",
    tier: 4,
    icon: "database",
    integrated: true,
    capabilities: [
      { action: "read_tables", name: "Read tables and columns", risk: "read", implementedBy: "server/supabase/client.ts" },
      { action: "read_rows", name: "Read rows", risk: "read", implementedBy: "server/supabase/client.ts" },
      { action: "insert_rows", name: "Insert rows", risk: "write-external", policy: "approval", implementedBy: "server/supabase/client.ts" },
      { action: "update_rows", name: "Update rows", risk: "write-external", policy: "approval", implementedBy: "server/supabase/client.ts" },
      { action: "delete_rows", name: "Delete rows", risk: "destructive", implementedBy: "server/supabase/client.ts" },
      { action: "run_migration", name: "Run migrations", risk: "destructive" },
    ],
  },
  {
    id: "investec",
    name: "Investec",
    description: "Bank accounts and transactions, read-only.",
    category: "finance",
    tier: 4,
    icon: "landmark",
    integrated: true,
    capabilities: [
      { action: "read_accounts", name: "Read accounts and balances", risk: "read", implementedBy: "server/finance/investec.ts" },
      { action: "read_transactions", name: "Read transactions", risk: "read", implementedBy: "server/finance/investec.ts" },
      { action: "make_payment", name: "Make payments or transfers", risk: "destructive" },
    ],
  },
  {
    id: "stripe",
    name: "Stripe",
    description: "Revenue, customers and payments.",
    category: "finance",
    tier: 4,
    icon: "credit-card",
    integrated: false,
    capabilities: [
      { action: "read_revenue", name: "Read revenue and payouts", risk: "read" },
      { action: "read_customers", name: "Read customers and subscriptions", risk: "read" },
      { action: "refund", name: "Issue refunds", risk: "destructive" },
    ],
  },

  // ---------------------------------------------------------------- tier 5
  {
    id: "higgsfield",
    name: "Higgsfield",
    description: "Image and video generation for Creative.",
    category: "creative",
    tier: 5,
    icon: "image",
    integrated: true,
    capabilities: [
      { action: "read_models", name: "Read models and account", risk: "read", implementedBy: "server/designs/higgsfield.ts" },
      { action: "generate", name: "Generate images (spends credits)", risk: "write-external", implementedBy: "server/designs/generation.ts" },
    ],
  },
  {
    id: "figma",
    name: "Figma",
    description: "Design files, as references for UI work.",
    category: "creative",
    tier: 5,
    icon: "pen-tool",
    integrated: false,
    capabilities: [
      { action: "read_files", name: "Read design files", risk: "read" },
      { action: "comment", name: "Comment on designs", risk: "external-communication" },
    ],
  },
];

export function findConnector(id: string): CatalogConnector | undefined {
  return CONNECTORS.find((connector) => connector.id === id);
}

export function capabilityId(connector: CatalogConnector, capability: CatalogCapability): string {
  return `${connector.id}.${capability.action}`;
}

export function findCapability(id: string): { connector: CatalogConnector; capability: CatalogCapability } | undefined {
  for (const connector of CONNECTORS) {
    for (const capability of connector.capabilities) {
      if (capabilityId(connector, capability) === id) return { connector, capability };
    }
  }
  return undefined;
}

/** The catalog's default: the entry's own policy when stricter, else the risk's. */
export function defaultPolicy(capability: CatalogCapability): CapabilityPolicy {
  return capability.policy ?? defaultPolicyForRisk(capability.risk);
}
