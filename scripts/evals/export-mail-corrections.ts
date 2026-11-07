import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { MailBucket, MailCategory } from "../../shared/mail-types";
import { uiStateDir } from "../../server/agentos/session-store";
import { buildCorrectionCases, type CorrectedThread } from "../../server/evals/mail-corrections";

/**
 * `tsx scripts/evals/export-mail-corrections.ts` — turns the owner's mail
 * corrections into eval cases for `npm run eval:mail:real`.
 *
 * Reads `mail.db` read-only and writes `evals/mail-corrections.json` inside
 * AgentOS's UI folder (mode 0600), never inside the repository: it holds real
 * mail subjects and snippets.
 */

const EXAMPLES_PER_CASE = 8;

const source = path.join(uiStateDir(), "mail.db");
if (!fs.existsSync(source)) {
  console.error(`No mail database at ${source}, so there are no corrections to export.`);
  process.exit(1);
}

const db = new DatabaseSync(source, { readOnly: true });
const rows = db
  .prepare(
    `SELECT thread_id, from_email, subject, snippet, message_date, user_bucket, user_category, corrected_at
     FROM mail_threads WHERE corrected_at IS NOT NULL ORDER BY corrected_at DESC`,
  )
  .all() as unknown as Array<{
  thread_id: string;
  from_email: string | null;
  subject: string;
  snippet: string;
  message_date: string;
  user_bucket: string | null;
  user_category: string | null;
  corrected_at: string;
}>;
db.close();

const corrected: CorrectedThread[] = rows.map((row) => ({
  threadId: row.thread_id,
  fromEmail: row.from_email ?? undefined,
  subject: row.subject,
  snippet: row.snippet,
  messageDate: row.message_date,
  bucket: (row.user_bucket as MailBucket | null) ?? undefined,
  category: (row.user_category as MailCategory | null) ?? undefined,
  correctedAt: row.corrected_at,
}));

const cases = buildCorrectionCases(corrected, EXAMPLES_PER_CASE);
const directory = path.join(uiStateDir(), "evals");
await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
const target = path.join(directory, "mail-corrections.json");
await fsp.writeFile(target, `${JSON.stringify(cases, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
await fsp.chmod(target, 0o600);
console.log(`Wrote ${cases.length} correction ${cases.length === 1 ? "case" : "cases"} to ${target}.`);
