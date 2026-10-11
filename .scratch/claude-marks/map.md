# Map: claude-marks

Label: wayfinder:map

## Destination

A build-ready spec at `.scratch/claude-marks/spec.md` for a terminal-first Claude Code mod that auto-organizes the current conversation into a labelled **thread** tree (main → sub, one level) with **bookmarks** (manual, branch points, landmarks) inside threads, navigable from one list that jumps the transcript to any point. Data survives resume and compaction. Done when nothing is left to decide before building.

## Notes

- Domain: a Claude Code **mod** (function-hooks plugin). Consult the `plugin-authoring` skill and its API types (`claude-code.d.ts`) for any capability question; the API is early access, so verify against the types rather than memory.
- Vocabulary lives in `CONTEXT.md` (Exchange, Thread, Main thread, Sub-thread, Labeller, Bookmark, Branch point, Landmark, Correction). Use `/domain-modeling` to keep it current.
- Settled while charting (2026-10-11):
  - Bookmarks and threads are one model: threads are the structure, bookmarks are highlights inside them.
  - The unit of labelling is the **exchange**.
  - The labeller is a separate cheap model call per exchange (confirmed by [Labeller: separate model call vs main-model self-tagging](issues/02-labeller-approach.md)).
  - The user can rename threads, move exchanges and merge threads; corrections feed later labelling.
  - UI: a band above the prompt (where am I) plus a side pane (full tree); inline thread markers on transcript rows. Final layout on [UI: band, pane and inline markers](issues/06-ui-prototype.md).
  - UI direction (2026-10-11): keyboard-first (mouse optional), Enter jumps the conversation, the portal (reader view) is the second action and the fallback. Focus mode was dropped after prototyping.
  - Bookmarks: manual (`/mark`, click a glyph) plus auto (branch points, landmarks) flagged by the labeller.
  - Existing history is labelled on demand by a command, not automatically.
  - Data persists across `--resume` / `--continue` for the same conversation.
  - Search (added 2026-10-11): the pane searches the current conversation's structure (labels, gists, excerpts, bookmark text). Whether to also search the full transcript text depends on research.
- The terminal is the user's main surface; design for it only. Specifically: the Claude Code CLI inside **VS Code's integrated terminal**, fullscreen layout, no tmux (2026-10-11). The normal (main-screen) layout is a secondary fallback.

## Decisions so far

- [Mod API: can we mark transcript rows and jump to them?](issues/01-mod-api-navigation.md): yes, with limits. Rows are keyed by the engine's message uuid, which survives reload and resume. Markers share a hover `scope` with the pane. A pane button can jump via `$.ui.scroll({ to: { requestId } })`. Clicks and jumps work only in **fullscreen**, and `$.session.messages()` carries no ids.
- [Spike: row identity and jump reach](issues/07-row-identity-jump-spike.md): confirmed in VS Code's fullscreen terminal. A prompt row's uuid is the same at append, render, in the JSONL, and after reload or resume. A pane jump reaches every row after the last compaction, even undrawn ones; rows before it aren't drawn and can't be reached. Prompt and reply rows fold, tool groups and footers don't. ctrl+x doesn't work; a command that opens a focused pane does. The status line is plain text, and `$.store` must be keyed by conversation.
- [Labeller: separate model call vs main-model self-tagging](issues/02-labeller-approach.md): a separate `$.model.complete` call per exchange (Haiku, low effort, cached rules, JSON validated), queued after `turn.complete` and drained by a timer so the turn never waits. Self-tagging loses on context, reliability, retro-labelling and scope. A stronger model is the first fallback; `$.model.fork` only for on-demand relabelling.
- [Persistence across resume and compaction](issues/03-persistence-resume-compaction.md): one JSON file per conversation under `<config>/claude-marks/`, keyed by `sessionId` (stable across resume; confirmed in a week-long resumed transcript) and mirrored into `$.state`; `$.store` is only an index (4 MiB shared by all conversations). `/clear` changes the id without `session.start`, so the mod checks the id itself. Pre-compaction rows stay in the JSONL but can't be jumped to; the portal shows them. No compaction instructions.
- [Labeller prompt and output schema](issues/04-labeller-prototype.md): prompt v3 accepted on four real conversations: JSON `{thread: continue|resume|new_main|new_sub, bookmarks, gist}`, given the thread list with recent gists plus the previous reply's tail. Mid-task detours become sub-threads, "what's next" starts a new main thread, landmarks on every settled decision for now, brief gists. ~$0.0007 and ~3.2K tokens per exchange on Haiku.
- [Data model for exchanges, threads, bookmarks and corrections](issues/05-data-model.md): one exchange per turn, anchored by its first prompt uuid; threads `{id, label, parent, mergedFrom}`; bookmarks anchored to `{exchange, row?}` so a manual bookmark can point at one of Claude's messages. Corrections (rename, move range, merge, reparent) overwrite with a `by: user` flag the labeller never overrides, and the newest 10 are kept for the labeller. Abandoned and pre-compaction exchanges are kept; live and reachable are recomputed on load. Gaps of up to 10 unlabelled exchanges are labelled automatically.
- [UI: band, pane and inline markers](issues/06-ui-prototype.md): the band shows where you are (`● Main › Sub · here #n/N ◇`, in the thread's colour, following the viewport) and a click on it opens the pane. The status line is only the hint `/marks · N threads`. The pane is a tree: threads, their exchanges as gists, sub-threads indented. Enter jumps, and `p` opens the reader (`j`/`k` within the thread). Esc goes back from the reader to the tree, then closes the pane. Glyphs (◆ manual, ◇ landmark, ↳ branch point) take the thread's colour. Coloured dividers mark thread changes on transcript rows (not sticky). Clicks on transcript-row buttons work.
- [Main-screen behaviour: require fullscreen or degrade?](issues/08-main-screen-behaviour.md): degrade. The mode comes from `isFullscreen`, fixed per session. On the main screen the same keyboard menu works, but Enter opens the portal instead of jumping, and a footer line notes that fullscreen jumps. The band shows the latest exchange's thread. There are no inline markers (scrollback is frozen before labels arrive) and no focus mode.
- [Spike: reply-message rows as bookmark anchors](issues/09-reply-row-anchor-spike.md): yes. Each reply text block is its own row, drawn under its JSONL `uuid` (also the `session.append` door `response` uuid), and only that uuid is a jump target (`msg_…` and `req_…` are denied). A glyph draws on every block (the `row1` gutter). A manual bookmark's `row` is a reply text row's uuid. Resume and undrawn-row jumps are inferred from spike 07, not re-run.
- [Correction feedback loop](issues/10-correction-feedback-loop.md): the labeller gets the corrected thread list plus a block of the newest 10 corrections in plain language (after the cached rules), with no hard constraints. No automatic relabel after a move or merge; the pane offers "relabel from here" instead. Per-kind dismissal counters add a "flag fewer" line once a kind has ≥3 dismissals and ≥1/3 of its flags dismissed. Checking it is deferred to labeller evaluation.

## Not yet specified

- **Labeller evaluation** — the prompt was tuned on four conversations, partly on the one it was tested against; it needs a check on a larger, fresh set before or during the build, and a way to tune landmark density if it turns noisy. It should also check that the recent-corrections block and dismissal line actually steer placement, ideally with real corrections from early use ([Correction feedback loop](issues/10-correction-feedback-loop.md)).
- **Retro-label command** — batching, progress display, cost cap, and behaviour on a partly labelled conversation. Row uuids for old history come from the transcript JSONL (`$.fs`; confirmed equal to render ids; rows render lazily, so rendered rows aren't enough), found at `<config>/projects/<slug>/<sessionId>.jsonl`. Exchanges before the last compaction can be labelled but not jumped to (the portal is the only way to show them).
- **Settings** — what is user-configurable (labeller model with a fallback when the org allowlist blocks it, on/off, auto-bookmark kinds, maybe a cost display from token `usage`); likely `userConfig`.
- **Long conversations** — `$.session.messages()` returns only the newest 4096 entries, and `$.fs.read` caps at 4 MiB (a 1232-row transcript was 3.4 MB); behaviour and performance beyond that. Now more pressing: the active-chain and compaction-boundary checks read the JSONL too, so the mod probably needs to read it in pieces (e.g. `$.process.run` with `tail`) or keep its own incremental record from `session.append`. [Research: full-transcript search](issues/13-full-text-search-research.md) covers part of this.
- **Spec assembly** — writing `spec.md` from the resolved tickets.

## Out of scope

- Feeding thread structure back to Claude to steer context (e.g. "summarize thread X"): navigation only (2026-10-11). Structure survives compaction in the mod's own file, not the summary ([Persistence across resume and compaction](issues/03-persistence-resume-compaction.md)).
- Browsing across conversations.
- Thread nesting deeper than one level.
- Designing for desktop, VS Code or mobile surfaces.
- Reshaping the transcript itself around threads (2026-10-11): focus mode (folding other threads) left mostly noise, an outline that turns the transcript into the tree blanked the screen on scroll (lazily drawn rows keep their reserved height), and a wide pane that takes over the main area never visibly resized. Navigation stays in the band, the pane and the reader ([UI: band, pane and inline markers](issues/06-ui-prototype.md)).
