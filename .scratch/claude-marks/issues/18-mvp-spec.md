# Spec assembly: MVP spec.md

Type: task
Status: open
Blocked by: 12

## Question

Write `.scratch/claude-marks/spec.md` from the resolved tickets, build-ready for the MVP. The user set the MVP scope on 2026-11-04:

- In: the labeller on new turns ([Labeller prompt and output schema](04-labeller-prototype.md), Haiku hardcoded), the per-conversation data file ([Persistence across resume and compaction](03-persistence-resume-compaction.md), [Data model for exchanges, threads, bookmarks and corrections](05-data-model.md)), the band, the transient side pane tree (Enter jumps, `p` opens the reader, Esc) ([UI: transient side pane](15-bottom-panel-prototype.md)), `/mark [#n] [note]` and the reader's `m`, inline thread dividers (always on), and the main-screen fallback ([Main-screen behaviour: require fullscreen or degrade?](08-main-screen-behaviour.md)).
- Later (decided, spec them in a separate "After the MVP" section so the build doesn't paint them out): corrections and the `a` menu ([Command surface and corrections in the pane](11-command-surface.md), [Correction feedback loop](10-correction-feedback-loop.md)), search ([Search in the pane](12-pane-search.md)).
- Not in the MVP and still fog on the map: retro-label, settings, labeller evaluation, the pane as a live map.

The spec should say which data-model fields the MVP writes but doesn't yet use (e.g. `by: user`, `mergedFrom`), and list the build-time checks the tickets left open (main-screen Enter with the transient pane, streaming cost, pane redraw cost).
