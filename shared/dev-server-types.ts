import { z } from "zod";

/**
 * A workspace's local dev server, as the Dev tab sees it.
 *
 * `status` is the whole lifecycle in one word. `plan` is what Start *would*
 * run, read from the project's `package.json` on every request, so the tab can
 * say "npm run dev (Next.js)" before anything is started and explain why when
 * there is nothing it can start.
 */

export const DevServerStatusSchema = z.enum(["stopped", "installing", "starting", "running", "failed"]);
export type DevServerStatus = z.infer<typeof DevServerStatusSchema>;

export const DevFrameworkSchema = z.enum(["next", "vite", "cra", "astro", "other"]);
export type DevFramework = z.infer<typeof DevFrameworkSchema>;

export const DevServerPlanSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    /** The package.json script that will run: `dev`, else `start`. */
    script: z.string(),
    framework: DevFrameworkSchema,
    /** What the operator would type, e.g. `npm run dev`. */
    command: z.string(),
    /** Dependencies are missing here, so Start installs them first. */
    needsInstall: z.boolean(),
    installCommand: z.string().optional(),
  }),
  z.object({ ok: z.literal(false), reason: z.string() }),
]);
export type DevServerPlan = z.infer<typeof DevServerPlanSchema>;

export const DevServerStateSchema = z.object({
  status: DevServerStatusSchema,
  /** The folder the server runs in, or absent when the project has no local repository. */
  folder: z.string().optional(),
  plan: DevServerPlanSchema.optional(),
  /** What is running (or last ran), with the port filled in. */
  command: z.string().optional(),
  port: z.number().int().optional(),
  url: z.string().optional(),
  startedAt: z.string().optional(),
  /** Why it failed, in plain words. */
  error: z.string().optional(),
  /** The tail of combined stdout and stderr, oldest first and bounded. */
  output: z.array(z.string()),
});
export type DevServerState = z.infer<typeof DevServerStateSchema>;
