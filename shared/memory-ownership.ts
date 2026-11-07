/**
 * Which memory is right when two disagree.
 *
 * This table is the one place the ownership decision lives. Change a row here
 * (and in docs/memory-ownership.md) to change the rule; nothing else encodes it.
 */

export interface MemoryStore {
  /** Lower rank wins a disagreement. */
  rank: number;
  id: "live" | "vault" | "claude-file" | "honcho" | "notion";
  name: string;
  owns: string;
  neverHolds: string;
  keptFor: string;
}

export const MEMORY_STORES: readonly MemoryStore[] = [
  {
    rank: 0,
    id: "live",
    name: "Live source: code, git, ledger, job store, inbox",
    owns: "What is true right now, and all money figures",
    neverHolds: "",
    keptFor: "As each system defines",
  },
  {
    rank: 1,
    id: "vault",
    name: "Vault (AGENTOS_ROOT)",
    owns: "Goals, decisions, project and business truth, notes",
    neverHolds: "Secrets, client code",
    keptFor: "Forever. Archive, never delete. Daily logs move after 30 days.",
  },
  {
    rank: 2,
    id: "claude-file",
    name: "Claude file memory (~/.claude/projects/…/memory)",
    owns: "How agents should work with the owner, pointers",
    neverHolds: "Project truth it could read instead",
    keptFor: "Until wrong, then corrected or deleted",
  },
  {
    rank: 3,
    id: "honcho",
    name: "Honcho (not connected today)",
    owns: "Inferred preferences for Claude Code sessions only",
    neverHolds: "Client data, money, decisions, secrets",
    keptFor: "Treated as stale after 90 days",
  },
  {
    rank: 4,
    id: "notion",
    name: "Notion (not connected today)",
    owns: "Nothing. Copies shared with other people, via Composio.",
    neverHolds: "Anything that exists only there",
    keptFor: "Disposable",
  },
];

export const MEMORY_CONFLICT_RULE =
  "When two memories disagree, the lower rank number wins. Fix or flag the loser. Never silently overwrite the vault: propose the change with a `Remember:` line.";
