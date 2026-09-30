# Step 60 — Obsidian vault as AgentOS memory, and the Memory page

Date: 2026-09-29. Source brief: "Obsidian Vault Integration and AgentOS Memory Graph".

## Decision that changed the brief

The brief said to keep the memory vault separate from the AgentOS workspace
root. Dylan had already migrated the whole workspace into the Obsidian vault
(`/Volumes/DylanSSD/AgentOS/AgentOS-Memory` was a byte-for-byte copy of
`~/AgentOS`) and said: **use the vault from now on.** So:

- `AGENTOS_ROOT` points at the vault. There is one copy; no duplicate is indexed.
- `AGENTOS_MEMORY_VAULT_PATH` exists but defaults to `AGENTOS_ROOT`.
- `~/AgentOS` is left untouched on disk and is no longer read.
- Task/job records stay where they are (`~/.agentos-ui`); no migration.

## Shape

```text
server/memory/
  config.ts      vault path, exclusions, availability probe (never mkdirs)
  parser.ts      front matter, headings, tags, aliases, block ids, links (marked lexer + wikilink extension)
  resolve.ts     Obsidian link semantics → resolved / ambiguous / unresolved / attachment / external
  index.ts       in-memory index + JSON cache in ~/.agentos-ui/memory, backlinks, edges (deduped with counts)
  watcher.ts     fs.watch (debounced) + availability poll + periodic reconcile; reindex on remount
  search.ts      deterministic scoring over title/alias/heading/tag/path/content
  retrieval.ts   bounded, sectioned context for a task with provenance (path, heading, hash)
  routes.ts      /api/memory/* (status, reindex, notes, note, graph, search, facets, diagnostics, context preview)
shared/memory-types.ts, shared/memory-markdown.ts (wikilink tokenizer shared by server + preview)
src/features/memory/  Memory page: Graph | Notes, filters, preview with links/backlinks
```

## Agent integration

- `startJob` retrieves vault context for every job before it is saved and
  stores it on the job (`memoryContext`: status, budget, sources with
  path/heading/hash/mtime, and the exact text). The packet a worker gets is
  built from that stored text, so later note edits never change captured
  provenance, and a new job sees the new text.
- Hermes scoping receives related vault notes (beyond the four project files it
  already reads) with source references.
- Unavailable vault → `status: "unavailable"`, no cached text is sent, the
  packet and job page say so. Required notes missing → `insufficient`.
- Notes are labelled as reference material, not instructions.
- There is no Jev step in the worker pipeline today (routing is AgentOS/Hermes);
  nothing was invented for it.

## Safety

- Notes are served by indexed id only; real path must stay inside the vault;
  symlinks escaping the root are skipped and reported.
- Rendering uses the existing token-to-React Markdown renderer (no raw HTML).
- Writes refuse when the vault root is missing, so an unplugged SSD never
  becomes an empty replacement folder.
- Bounded responses: note text ≤ 256 KB, list pages ≤ 200, graph ≤ 5,000 nodes
  (cap disclosed in the response).
