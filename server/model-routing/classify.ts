import {
  ModelRouteTaskTypeSchema,
  type ModelRouteSource,
  type ModelRouteTaskType,
} from "../../shared/model-routing-types";
import { answerAs, isJevConfigured, sendToJev, type JevRequestBody, type JevAnswer } from "../mail/jev-client";

/**
 * Classifying a job into the usage-saving table.
 *
 * Explicit tags from the flow that created the job always win. Free-form
 * text goes through Jev when it is configured (the cheap typed-decision
 * classifier already used by Mail, Finance and Traction). If Jev is off or
 * cannot answer, a keyword heuristic is used — never a paid coding model.
 */

const MOTION =
  /\b(motion[- ]?(?:web)?site|3d motion|motion design|cinematic|higgsfield|gsap|scrolltrigger|scroll[- ]?(driven|film|controlled)|three\.js|react-three|brand film|showreel|keyframe)\b|\/motion-site-studio/i;
const PLAN =
  /\b(plan|roadmap|milestone|architect(?:ure|ing)?|approach|scope|how should we|design the system|steps? to)\b/i;
const EXECUTE =
  /\b(implement|fix|refactor|apply|wire(?:\s+up)?|code|build|add|write|create|patch|debug|test)\b/i;

export function heuristicTaskType(objective: string): ModelRouteTaskType {
  if (MOTION.test(objective)) return "motion";
  if (PLAN.test(objective)) return "plan";
  if (EXECUTE.test(objective)) return "execute";
  return "normal";
}

export interface ClassifyInput {
  objective: string;
  taggedType?: ModelRouteTaskType;
  send?: typeof sendToJev;
}

export interface ClassifyResult {
  taskType: ModelRouteTaskType;
  source: Exclude<ModelRouteSource, "override">;
  reason: string;
}

const CRITERIA: Record<ModelRouteTaskType, string> = {
  plan: "Planning, scoping, architecture, a roadmap, or writing steps before any code is applied",
  execute: "Writing, changing, reviewing or applying code — implementation, a fix, a refactor, tests",
  motion: "A motion, film, video, cinematic, or scroll-driven visual piece, including Motion Design",
  normal: "A short question, summary, rewrite, or everyday request that is not a plan, a code change, or a film",
};

export async function classifyTaskType(input: ClassifyInput): Promise<ClassifyResult> {
  if (input.taggedType) {
    return {
      taskType: input.taggedType,
      source: "tagged",
      reason: `Tagged as ${input.taggedType} by the flow that created the job.`,
    };
  }

  const send = input.send;
  if (send || isJevConfigured()) {
    try {
      const fromJev = await classifyWithJev(input.objective, send ?? sendToJev);
      if (fromJev) return fromJev;
    } catch {
      // Jev is a convenience. A failed call must not block a job.
    }
  }

  const taskType = heuristicTaskType(input.objective);
  return {
    taskType,
    source: "heuristic",
    reason: `Read as a ${taskType} job from the brief.`,
  };
}

async function classifyWithJev(
  objective: string,
  send: typeof sendToJev,
): Promise<ClassifyResult | undefined> {
  const body: JevRequestBody = {
    model: "jev-latest",
    state: { brief: objective.slice(0, 2_000) },
    questions: {
      taskType: {
        type: "choice",
        instructions:
          "Which kind of AgentOS job is this brief? Pick the single best fit. Prefer execute when the person is asking for code to be written or applied, plan when they want an approach before work starts, motion when they want a film or cinematic site, and normal for a short question or rewrite.",
        criteria: CRITERIA,
      },
    },
  };

  const response = await send(body);
  const answer = answerAs(response.answers as Record<string, JevAnswer>, "taskType", "choice");
  const parsed = ModelRouteTaskTypeSchema.safeParse(answer.choice);
  if (!parsed.success) return undefined;

  return {
    taskType: parsed.data,
    source: "jev",
    reason: `Jev classified this as a ${parsed.data} job.`,
  };
}
