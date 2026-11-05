# claude-marks

A Claude Code mod that organizes the current conversation for navigation.

## Glossary

- **Exchange** — one turn: the user prompt (plus any prompts typed mid-turn and folded into it) and everything Claude does in reply (text, tool calls). The unit that gets labelled; its jump target is the first prompt row.
- **Gist** — the labeller's one-line summary of an exchange (about 10 words). Shown on the exchange in the tree; a thread's recent gists are the labeller's memory of that thread.
- **Live** — an exchange on the conversation's active chain. A rewind leaves the abandoned exchanges non-live: kept, but hidden.
- **Reachable** — an exchange after the last compaction, so the transcript can jump to it. Unreachable exchanges open in the reader instead.
- **Reader** — the pane view that shows one exchange's prompt and reply text. Opened on demand, and the only way to show an unreachable exchange.
- **Thread** — a labelled group of exchanges about one topic. Threads form a tree exactly one level deep:
  - **Main thread** — a top-level topic of the conversation.
  - **Sub-thread** — a digression inside a main thread (e.g. exploring one of several points a reply raised). Returning to the main theme returns to the main thread.
- **Family** — a main thread together with its sub-threads, and their exchanges in conversation order. The tree shows one family per main thread; the reader steps through a family exchange by exchange.
- **Labeller** — the component that assigns each new exchange to a thread and flags auto-bookmarks.
- **Bookmark** — a highlighted exchange inside a thread, or (manual only) one of Claude's messages in it. Kinds:
  - **Manual bookmark** — created by the user (`/mark` or clicking a glyph).
  - **Branch point** — auto: a reply that offered several options or directions worth returning to.
  - **Landmark** — auto: an exchange where something was settled (a decision, a final design, a commit).
- **Correction** — a user edit to the labeller's output: rename a thread, move a run of exchanges to another thread, merge one thread into another, or reparent a thread (promote, demote, move under another main thread). Corrections guide later labelling in the same conversation.

Avoid: "label" as a noun for a thread (a thread *has* a label); "subconversation" or "group" (use sub-thread or thread); "portal" (use reader).
