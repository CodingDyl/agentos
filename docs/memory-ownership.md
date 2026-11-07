# Memory ownership

AgentOS has several places that remember things. They can disagree. This page says which one is right.

The table lives in code as `MEMORY_STORES` in `shared/memory-ownership.ts`. To change the rule, edit the table here and there. Nothing else encodes it.

| Rank | Store | Owns | Never holds | Kept for |
|---|---|---|---|---|
| 0 | Live source: code, `git`, ledger, job store, inbox | What is true right now, and all money figures | | As each system defines |
| 1 | Vault (`AGENTOS_ROOT`) | Goals, decisions, project and business truth, notes | Secrets, client code | Forever. Archive, never delete. Daily logs move after 30 days. |
| 2 | Claude file memory (`~/.claude/projects/…/memory`) | How agents should work with the owner, pointers | Project truth it could read instead | Until wrong, then corrected or deleted |
| 3 | Honcho (not connected today) | Inferred preferences for Claude Code sessions only | Client data, money, decisions, secrets | Treated as stale after 90 days |
| 4 | Notion (not connected today) | Nothing. Copies shared with other people, via Composio. | Anything that exists only there | Disposable |

## Conflict rule

> When two memories disagree, the lower rank number wins. Fix or flag the loser. Never silently overwrite the vault: propose the change with a `Remember:` line.

The same sentence is added to every worker brief and to the Assistant's system prompt, and a test pins it in both.

## What the code does about it

- **Archive is never loaded by default.** Notes under `archive/` are left out of agent context unless the caller passes `includeArchive`. Human search in Memory still finds them.
- **Daily logs move after 30 days.** `logs/daily/YYYY-MM-DD*.md` older than 30 days can be moved to `archive/logs/daily/YYYY-MM/` from Operations → System → Memory upkeep. It only renames files, never overwrites one, and never runs on a schedule: the owner presses the button.
- **Honcho and Notion are not connected.** Nothing in AgentOS calls either. If one is connected later it takes the rank above and nothing more.
