import type { AgentRecord } from "../../shared/agent-types";

/**
 * The operator's current team, as editable starting rows.
 *
 * Written once into the registry. Edits persist; this module is not re-applied
 * over existing rows. A later release that adds an id merges that row in.
 */

const STAMP = "2026-01-01T00:00:00.000Z";

function seed(
  partial: Omit<AgentRecord, "createdAt" | "updatedAt" | "standingInstructions" | "modelRoutes" | "allowedModelOverrides" | "allowedTools" | "allowedConnectors" | "allowedSkills" | "linkedWorkspaces" | "schedules" | "memoryNotes" | "keywords" | "creditCeilingUsd"> &
    Partial<Pick<AgentRecord, "standingInstructions" | "modelRoutes" | "allowedModelOverrides" | "allowedTools" | "allowedConnectors" | "allowedSkills" | "linkedWorkspaces" | "schedules" | "memoryNotes" | "keywords" | "creditCeilingUsd" | "effort">>,
): AgentRecord {
  return {
    standingInstructions: "",
    modelRoutes: {},
    allowedModelOverrides: ["haiku", "sonnet", "opus", "claude-opus-5-5"],
    allowedTools: [],
    allowedConnectors: [],
    allowedSkills: [],
    linkedWorkspaces: [],
    schedules: [],
    memoryNotes: "",
    keywords: [],
    creditCeilingUsd: 40,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...partial,
  };
}

export const SEED_AGENTS: readonly AgentRecord[] = [
  seed({
    id: "chief-of-staff",
    name: "Chief of Staff",
    avatar: "🗂️",
    role: "Routes work and chases follow-ups",
    mission: "Keep the board honest: send each request to the right specialist, and chase anything waiting on a person or a job.",
    standingInstructions:
      "You route and follow up. You do not implement product work yourself. Name the owner, the next action, and when it is due.",
    effort: "medium",
    modelRoutes: { normal: { model: "haiku", effort: "low" }, plan: { model: "claude-opus-5-5", effort: "high" } },
    creditCeilingUsd: 50,
    keywords: ["route", "follow-up", "follow up", "chase", "delegate", "owner", "brief", "triage"],
    schedules: [{ id: "cos-am", label: "Morning chase", cadence: "weekdays, morning" }],
  }),
  seed({
    id: "backend-engineer",
    name: "Backend Engineer",
    avatar: "🛠️",
    role: "Backend, APIs and tests",
    mission: "Design, implement and test server work in Java, Node, Supabase and Postgres.",
    standingInstructions:
      "Prefer small, tested changes. Name the API contract, the migration, and the test that proves it. Do not invent frontend UI.",
    effort: "medium",
    modelRoutes: { execute: { model: "sonnet", effort: "medium" } },
    creditCeilingUsd: 80,
    keywords: ["backend", "api", "server", "java", "node", "supabase", "postgres", "sql", "endpoint", "test"],
  }),
  seed({
    id: "frontend-friend",
    name: "Frontend Friend",
    avatar: "🎨",
    role: "Frontend and UI",
    mission: "Ship interface work in React, Next.js, Expo and Tailwind that matches the rest of AgentOS.",
    standingInstructions:
      "Reuse existing components. Do not introduce a new design system. Verify the flow in the browser when the change is user-visible.",
    effort: "medium",
    modelRoutes: { execute: { model: "sonnet", effort: "medium" } },
    creditCeilingUsd: 80,
    keywords: ["frontend", "ui", "react", "next", "expo", "tailwind", "css", "layout", "component"],
  }),
  seed({
    id: "growth-lab",
    name: "Growth Lab",
    avatar: "📈",
    role: "Pipeline and recurring income",
    mission: "Move VoxMachine, Jurivo and Virtara toward recurring income. Experiments with a next action, not vanity metrics.",
    standingInstructions:
      "Every experiment names a hypothesis, a metric already in Traction, and a kill date. Do not invent figures.",
    effort: "medium",
    linkedWorkspaces: ["voxmachine", "jurivo", "virtara"],
    creditCeilingUsd: 40,
    keywords: ["growth", "voxmachine", "jurivo", "lead", "offer", "icp", "traction"],
    schedules: [{ id: "growth-week", label: "Weekly pipeline", cadence: "weekly" }],
  }),
  seed({
    id: "life-ops",
    name: "Life Ops",
    avatar: "🏃",
    role: "Fitness, nutrition, personal ops",
    mission: "Keep personal operations — training, food, recovery — in motion without turning them into a second career.",
    standingInstructions: "Be specific and kind. No medical claims. Prefer the next session or meal, not a manifesto.",
    effort: "low",
    modelRoutes: { normal: { model: "haiku", effort: "low" } },
    creditCeilingUsd: 15,
    keywords: ["fitness", "nutrition", "workout", "meal", "health", "gym", "sleep", "personal"],
    schedules: [{ id: "life-daily", label: "Daily check-in", cadence: "daily" }],
  }),
  seed({
    id: "entelect",
    name: "Entelect",
    avatar: "💼",
    role: "Day-job deep work",
    mission: "Deep work for the Entelect job: Java 8 and Gradle, in the constraints of that codebase.",
    standingInstructions:
      "Java 8 only. Honour the existing Gradle build. Do not modernise the stack unless the task says so.",
    effort: "high",
    modelRoutes: { execute: { model: "sonnet", effort: "high" } },
    creditCeilingUsd: 30,
    keywords: ["entelect", "java 8", "gradle", "day job", "timesheet", "career"],
    linkedWorkspaces: ["entelect"],
  }),
  seed({
    id: "finance",
    name: "Finance",
    avatar: "💷",
    role: "Money and budgets",
    mission: "Watch money, bills and runway with a line of sight to R100k+ a month. Arithmetic, not vibes.",
    standingInstructions:
      "Use figures AgentOS already has. Never invent a balance, a rate or a projection. Say when a number is missing.",
    effort: "medium",
    modelRoutes: { plan: { model: "sonnet", effort: "high" }, normal: { model: "haiku", effort: "low" } },
    creditCeilingUsd: 20,
    keywords: ["finance", "budget", "money", "invoice", "runway", "r100k", "investec", "bill"],
    schedules: [{ id: "finance-month", label: "Monthly review", cadence: "monthly" }],
  }),
  seed({
    id: "pantry-pilot",
    name: "Pantry Pilot",
    avatar: "🥗",
    role: "Meal app, end to end",
    mission: "Ship the Expo / Supabase meal app: client, API, data, and the next release.",
    standingInstructions: "Stay inside Pantry Pilot. Prefer the existing Expo and Supabase setup over a rewrite.",
    effort: "medium",
    linkedWorkspaces: ["pantry-pilot"],
    creditCeilingUsd: 60,
    keywords: ["pantry", "meal app", "recipes", "groceries", "expo"],
  }),
  seed({
    id: "site-audit",
    name: "Site Audit",
    avatar: "🔍",
    role: "SEO, speed, a11y, CRO",
    mission: "Audit sites for SEO, speed, accessibility and conversion. Report only what was measured.",
    standingInstructions:
      "No invented metrics. Every finding names the URL, the evidence, and a fix. If it was not measured, say so.",
    effort: "medium",
    creditCeilingUsd: 25,
    keywords: ["seo", "audit", "a11y", "accessibility", "cro", "lighthouse", "speed", "core web vitals"],
  }),
  seed({
    id: "ai-teacher",
    name: "AI Teacher",
    avatar: "🎓",
    role: "Practical AI learning",
    mission: "Teach AI that the operator can use this week: leverage, not lecture.",
    standingInstructions: "One concept, one exercise, one way it applies to AgentOS or a current workspace.",
    effort: "medium",
    modelRoutes: { normal: { model: "sonnet", effort: "medium" } },
    creditCeilingUsd: 20,
    keywords: ["learn", "teacher", "lesson", "hub", "course", "explain ai", "prompt"],
  }),
  seed({
    id: "virtara-desk",
    name: "Virtara Desk",
    avatar: "🏛️",
    role: "Client delivery and hosting",
    mission: "Deliver and host the Virtara client portfolio: sites that ship, stay up, and can be handed over.",
    standingInstructions: "Client work is the product. Do not volunteer internal AgentOS refactors on a client repo.",
    effort: "medium",
    linkedWorkspaces: ["virtara"],
    creditCeilingUsd: 50,
    keywords: ["virtara", "client", "hosting", "portfolio", "rebuild", "handover"],
  }),
  seed({
    id: "motion-studio",
    name: "Motion Studio",
    avatar: "🎬",
    role: "Motion sites",
    mission: "Build motion sites in Next.js, GSAP, Three.js and Framer. Cinematic, not a slide deck.",
    standingInstructions:
      "Next.js + GSAP (and Three or Framer when the brief asks). Do not invent Higgsfield spend. Credit ceilings are approved on the Motion Design screen, not here.",
    effort: "high",
    modelRoutes: { motion: { model: "claude-opus-5-5", effort: "high" } },
    allowedTools: [
      "Write",
      "Edit",
      "WebFetch",
      "Bash(ffmpeg:*)",
      "Bash(ffprobe:*)",
      "Bash(python3:*)",
      "Bash(npm:*)",
      "Bash(npx:*)",
      "Bash(node:*)",
    ],
    creditCeilingUsd: 100,
    keywords: ["motion", "gsap", "three", "framer", "cinematic", "scroll", "higgsfield", "film"],
  }),
];

export const DEFAULT_AGENT_ID = "chief-of-staff";

/** Flows that already know which specialist owns the work. */
export const FLOW_AGENTS: Record<string, string> = {
  "motion-design": "motion-studio",
  "claude-motion": "motion-studio",
  "website-rebuild": "virtara-desk",
  reengineer: "site-audit",
  finance: "finance",
  career: "entelect",
  traction: "growth-lab",
};

export function agentIdForFlow(flow: string | undefined): string | undefined {
  if (!flow) return undefined;
  return FLOW_AGENTS[flow];
}
