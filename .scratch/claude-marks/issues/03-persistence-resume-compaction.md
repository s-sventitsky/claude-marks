# Persistence across resume and compaction

Type: research
Status: resolved

## Question

How does thread and bookmark data survive (1) a module reload, (2) `--resume` / `--continue`, and (3) compaction?

- Where to store it: `$.state` vs `$.store` keyed by session id. Is the session id the same after a resume?
- How exchanges are re-identified after a resume (message ids in `$.session.messages()`?).
- After compaction: are pre-compaction rows still drawn and scrollable in the terminal (fullscreen and not)? What do `session.compact` and `$.session.messages()` show afterwards? Can the mod add instructions to the compaction summary?

Output: a summary with the recommended storage key and anchoring scheme, and what navigation to compacted-away exchanges can and cannot do.

## Comments

- 2026-10-11, from [Spike: row identity and jump reach](07-row-identity-jump-spike.md):
  - Row uuids survive reload, `--continue` and `/resume`.
  - **`$.store` is shared across conversations;** key by conversation (session id after `--continue`/`/resume` still to confirm).
  - **`/resume` inside a running session** fires `session.start` again but keeps module variables.
  - **In a resumed fullscreen transcript, rows before the last `compact_boundary` are not drawn** (it starts at the compact summary), so they cannot be jumped to.

## Answer

Detail in [research/03-persistence-resume-compaction.md](../research/03-persistence-resume-compaction.md).

- **Storage:** one JSON file per conversation at `<config>/claude-marks/<sessionId>.json`, loaded into `$.state` (the live view model; survives hot reload, redraws on `set`) and written back debounced. `$.store` is too small to hold the data: 4 MiB of JSON shared by *all* conversations. It keeps only an index for cleanup. Module variables hold only the labeller queue, rebuilt on load.
- **Key:** `sessionId`. It is stable across `--resume` / `--continue`: the user's 1288-row conversation, resumed over a week, has one file and one `sessionId`. Exchanges are keyed by prompt-row uuid (spike-confirmed stable).
- **Conversation switches:** in-session `/resume` re-fires `session.start` but keeps module state. `/clear` changes the id with **no** `session.start`. So compare `$.session.id()` with the loaded id on `session.start` and on each prompt append.
- **Compaction:** the JSONL keeps every pre-compaction row. A `compact_boundary` system row (with `logicalParentUuid` and a `preservedSegment`) marks the cut and arrives through `session.append`. Rows before it can't be jumped to after a resume; their data stays whole and the portal shows them.
- **Compaction instructions: none.** The structure lives in the mod's file, so nothing needs to survive in the summary, and putting it there would feed it to Claude (out of scope).
- Unverified, left to the build (a failed jump falls back to the portal either way): whether `preservedSegment` rows are drawn after the boundary, whether a live session still draws pre-compaction rows, and what `--fork-session` copies.
