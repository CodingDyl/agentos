import type { ApiProvider, CallApiContextParams, ProviderOptions, ProviderResponse } from "promptfoo";
import type { MailThread } from "../../shared/mail-types";
import { bucketFor } from "../../server/mail/bucketing";
import { classifyThread, type ClassifyCorrectionExample } from "../../server/mail/jev-client";

/**
 * Runs one thread through AgentOS's real mail classifier and bucketing.
 *
 * `context.vars` carries the thread (from, subject, snippet, date) and, for the
 * owner's own data, the other corrections to send as examples. The output is
 * JSON: the bucket and category the app would show.
 */
export default class MailClassifierProvider implements ApiProvider {
  private readonly providerId: string;

  constructor(options: ProviderOptions = {}) {
    this.providerId = options.id ?? "mail-classifier";
  }

  id(): string {
    return this.providerId;
  }

  async callApi(_prompt: string, context?: CallApiContextParams): Promise<ProviderResponse> {
    const vars = (context?.vars ?? {}) as Record<string, unknown>;
    const corrections = Array.isArray(vars.corrections) ? (vars.corrections as ClassifyCorrectionExample[]) : [];
    try {
      const result = await classifyThread({
        from: String(vars.from ?? ""),
        subject: String(vars.subject ?? ""),
        snippet: String(vars.snippet ?? ""),
        date: String(vars.date ?? new Date().toISOString()),
        corrections,
      });
      const bucket = bucketFor({
        classified: true,
        category: result.category,
        needsReply: result.needsReply,
        urgency: result.urgency,
        financial: result.financial,
        actionRequired: result.actionRequired,
        automated: result.automated,
      } as MailThread);
      return { output: JSON.stringify({ bucket, category: result.category }) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "The classifier failed." };
    }
  }
}
