# Spec assembly: MVP spec.md

Type: task
Status: resolved
Blocked by: 12

## Question

Write `.scratch/claude-marks/spec.md` from the resolved tickets, build-ready for the MVP. The user set the MVP scope on 2026-11-04:

- In: the labeller on new turns ([Labeller prompt and output schema](04-labeller-prototype.md), Haiku hardcoded), the per-conversation data file ([Persistence across resume and compaction](03-persistence-resume-compaction.md), [Data model for exchanges, threads, bookmarks and corrections](05-data-model.md)), the band, the transient side pane tree (Enter jumps, `p` opens the reader, Esc) ([UI: transient side pane](15-bottom-panel-prototype.md)), `/mark [#n] [note]` and the reader's `m`, inline thread dividers (always on), and the main-screen fallback ([Main-screen behaviour: require fullscreen or degrade?](08-main-screen-behaviour.md)).
- Later (decided, spec them in a separate "After the MVP" section so the build doesn't paint them out): corrections and the `a` menu ([Command surface and corrections in the pane](11-command-surface.md), [Correction feedback loop](10-correction-feedback-loop.md)), search ([Search in the pane](12-pane-search.md)).
- Not in the MVP and still fog on the map: retro-label, settings, labeller evaluation, the pane as a live map.

The spec should say which data-model fields the MVP writes but doesn't yet use (e.g. `by: user`, `mergedFrom`), and list the build-time checks the tickets left open (main-screen Enter with the transient pane, streaming cost, pane redraw cost).

## Answer

2026-11-04. Written: [spec.md](../spec.md).

- **MVP sections:** data file (with a table of fields written but not yet used), lifecycle (conversation switches, transcript pass, exchanges, liveness and reachability), labeller (when, the call, parsing, applying, failures), band, status line, pane (tree, keys, reader), inline markers, commands, main screen.
- **After the MVP:** corrections and the `a` menu, `v` ranges, correction feedback, `/marks relabel`, search, reply-glyph clicks. The MVP leaves `a`, `v`, `/`, the reader's `n` and `/marks` arguments unbound for them.
- **Settled with the user while writing:**
  - An unlabelled run over 10 exchanges (no relabel command in the MVP) shows as a dim "Unlabelled" group in the tree, jumpable, with a band hint `N unlabelled`.
  - Clicking a reply-block glyph to bookmark is after the MVP. The MVP bookmarks through `/mark` and the reader's `m`.
- **Defaults the spec set** (no ticket; listed in the spec for veto): turns started by a slash command or skill anchor on their first reply text row; a labeller blocked by the engine stops and shows `labeller off: <reason>`; pending exchanges show in the current thread with `…`; the reader's `j`/`k` step through the main thread's family, as in the prototype.
- **Build-time checks** (each with a fallback): main-screen Enter with the transient pane, timer-started completions surviving the next turn, `$.process.spawn` per-piece cost and the `cmd /c type` fallback, pane redraw cost on long trees, `preservedSegment` and live-session reachability, reply-row jumps after resume, `--fork-session`, the slash-command anchor.
