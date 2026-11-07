export interface RuleFailure { rule: string; file?: string; message: string }
export interface RuleDiff {
  added: Array<{ file: string; line: string }>;
  addedFiles: string[];
  allFiles: string[];
  branch?: string;
  prBody?: string;
}
export function checkTrackedFiles(paths: string[]): RuleFailure[];
export function checkDiff(diff: RuleDiff): RuleFailure[];
export function parseUnifiedDiff(text: string): Array<{ file: string; line: string }>;
