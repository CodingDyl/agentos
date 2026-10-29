# Jarvis request routing

What happens to something said or typed to Jarvis, and where each kind of
request ends up. This replaces the unmerged October branch
`task/confident-ride-gjwot7`, whose `server/jarvis/` router duplicated what
production now has under other names.

## Path

```text
voice / typed ─► JarvisProvider (src/features/voice/jarvis-context.tsx)
                   │
                   ├─ a page has taken Jarvis over (setIntercept)
                   │    ├─ Operator chat  → use-chat-jarvis.ts → the chat's agent
                   │    │                    (Claude chats get the AgentOS tools below)
                   │    └─ Operator runs  → use-operator-jarvis.ts → planned run + approvals
                   │
                   ├─ small talk          → answered locally (small-talk.ts)
                   └─ everything else     → Hermes run (useAgentRun), its skills and approvals
```

In a chat, "stop", "new chat", "allow", "don't allow" and "confirm" are
commands handled in the browser (`chat-voice.ts`); everything else is a
message to the agent.

## AgentOS tools in a Claude chat (`server/chat/agentos-tools.ts`)

| Request | Tool | Asks first? |
| --- | --- | --- |
| "What's on today?" | `today_agenda` | no |
| Vault lookups | `search_memory`, `read_note` | no |
| Projects and tasks | `list_projects`, `list_tasks`, `add_task`, `capture_note` | no |
| Inbox | `check_mail`, `read_email` | no |
| "Draft a reply to X" | `draft_email` (Gmail draft, never sent) | no |
| "Send that email" | `send_email` | **yes, every time** |
| "Which invoices are overdue?" | `overdue_invoices` (Business ledger, read-only) | no |
| "Who should do this?" | `list_specialists` (Agents v1 roster) | no |
| "Start a job to fix Y" | `start_job` (`startJob`, specialist chosen by Agents v1 routing unless named) | **yes, every time** |
| Bigger, planned work | `start_operator_run` (Operator keeps its own approval) | no |

## Sending and spending

`send_email` and `start_job` are listed in `server/chat/confirmed-actions.ts`.

1. The chat policy always asks about them. The approval card shows the
   recipients, subject and whole body (or the project, specialist and brief).
   By voice: "allow" reads it back, and only "confirm" within 20 seconds
   approves.
2. When the operator allows, the server records a one-use grant for a digest
   of exactly that input, valid for five minutes.
3. The tool spends the grant before acting. No grant, a different
   recipient/subject/body/brief, a second use, or an expired grant is refused,
   and nothing is sent or started.

Mail, notes and invoices that tools return are marked as data written by
other people. An email saying "send this to…" is not a request from the
operator, and even if an agent acted on it, step 1 puts it in front of the
operator.

## Not covered

- Jarvis outside an Operator chat goes to Hermes, which doesn't have these
  tools. Open a chat (Operator → Chat) to use them by voice.
- No send goes out without the operator; there is no "trusted recipient"
  shortcut.
