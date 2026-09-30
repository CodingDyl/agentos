import { z } from "zod";

/** The Grok Bot workspace, as the server sees it. Folder access only — never proof Grok is online. */
export const GrokBotWorkspaceStatusSchema = z.object({
  state: z.enum(["unconfigured", "available", "unavailable"]),
  path: z.string().optional(),
  reason: z.string().optional(),
  checks: z.array(z.object({ name: z.string(), ok: z.boolean(), detail: z.string().optional() })),
});

export const GrokBotStatusSchema = z.object({
  enabled: z.boolean(),
  workspacePath: z.string(),
  workspace: GrokBotWorkspaceStatusSchema,
});

export const GrokBotTestResultSchema = GrokBotWorkspaceStatusSchema.extend({
  testedAt: z.string(),
});

export type GrokBotWorkspaceStatus = z.infer<typeof GrokBotWorkspaceStatusSchema>;
export type GrokBotStatus = z.infer<typeof GrokBotStatusSchema>;
export type GrokBotTestResult = z.infer<typeof GrokBotTestResultSchema>;

/**
 * What Grok writes back, at `results/<taskId>.json`.
 *
 * Deliberately small: AgentOS judges the reply through review, so the file
 * only has to say which task it answers and what the answer is.
 */
export const GrokBotResultSchema = z.object({
  schemaVersion: z.literal(1),
  taskId: z.string().min(1),
  jobId: z.string().min(1),
  status: z.enum(["completed", "failed"]),
  /** The answer itself. Plain text or Markdown; JSON when the task asked for JSON. */
  reply: z.string().min(1),
  /** Why Grok could not do it, when `status` is `failed`. */
  error: z.string().optional(),
  completedAt: z.string().optional(),
});

/** The JSON Schema written into every task file, so Grok sees the exact shape expected. */
export const GROK_BOT_RESULT_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "taskId", "jobId", "status", "reply"],
  properties: {
    schemaVersion: { const: 1 },
    taskId: { type: "string", description: "Copy exactly from the task file." },
    jobId: { type: "string", description: "Copy exactly from the task file." },
    status: { enum: ["completed", "failed"] },
    reply: { type: "string", minLength: 1, description: "Your answer to the objective." },
    error: { type: "string", description: "Only when status is failed: why." },
    completedAt: { type: "string", format: "date-time" },
  },
} as const;

/** One note copied out of the vault for a task. */
export const GrokBotExportedNoteSchema = z.object({
  /** Path inside the Obsidian vault. */
  source: z.string(),
  /** Absolute path of the copy on the SSD. */
  exportedPath: z.string(),
  /** sha256 of the note as exported. */
  hash: z.string(),
  /** When the vault note was last modified. */
  modifiedAt: z.string(),
  exportedAt: z.string(),
});

/** The bridge's record on a Grok Bot job: where things are and what has happened. */
export const GrokBotBridgeSchema = z.object({
  taskId: z.string(),
  workspace: z.string(),
  taskPath: z.string(),
  resultPath: z.string(),
  memoryDir: z.string(),
  exportedAt: z.string(),
  notes: z.array(GrokBotExportedNoteSchema),
  /** The exact text for the Copy Grok instruction button. */
  instruction: z.string(),
  /** Set while the SSD is missing; cleared when it comes back. */
  workspaceUnavailableSince: z.string().optional(),
  /** The last result file that was refused, and why. The job keeps waiting. */
  rejection: z.object({ at: z.string(), reason: z.string() }).optional(),
  importedAt: z.string().optional(),
  /** sha256 of the imported result file: what was accepted, byte for byte. */
  resultHash: z.string().optional(),
});

export type GrokBotResult = z.infer<typeof GrokBotResultSchema>;
export type GrokBotExportedNote = z.infer<typeof GrokBotExportedNoteSchema>;
export type GrokBotBridge = z.infer<typeof GrokBotBridgeSchema>;
