# 04: Pane tree with jump

**What to build:** `/marks` or a click on the band opens a transient side pane showing the conversation as a tree of threads and exchanges. Enter jumps the transcript to the chosen exchange and closes the pane. Spec: [spec.md](../../claude-marks/spec.md), sections "Pane" ("Opening", "Tree", "Tree keys"), "Commands" (`/marks`).

**Blocked by:** 02 (Label new turns)

**Status:** implemented (pending merge)

- [x] `/marks` opens the pane focused, `closeOnEscape`, 14 rows, cursor on the exchange last jumped to (the latest if none). A band click opens it on the band's exchange. Any `/marks` argument prints `usage: /marks`.
- [x] The tree lists main threads by first live exchange, headers bold in their colour with counts (`k ex  ◆1 ◇3 ↳1`, just `k` when narrow). Under each, its own and its sub-threads' exchanges in conversation order as `› n glyphs gist`; a sub-thread header ` └ label` before its first exchange, its exchanges indented. The last-jumped exchange has `›`, the band's exchange is bold, unreachable ones are dim, pending ones show `…`, and exchanges with no gist show their excerpt.
- [x] Exchanges with no thread form a dim `Unlabelled  k` group placed by its first exchange.
- [x] Enter on an exchange awaits `$.ui.scroll({ to: { requestId }, block: 'start' })` inside the press handler, then closes the pane and remembers the jump. Enter on a thread header jumps to its first exchange. A denied jump keeps the pane open and shows the reason in a footer line (ticket 05 turns this into the reader).
- [x] Up/down and Tab move, Esc closes. Every key the view uses is always drawn, dim where inert. `a`, `v` and `/` stay unbound. Left arrow is a known engine limit (opens the agents list) and is not bound.
- [ ] Below 110 columns the pane sits inline above the prompt and the layout still fits.
- [ ] Build check: redraw cost with 500+ exchanges in the tree. If it lags, window the tree around the cursor. Record the finding on this ticket.

## Comments

Implemented on branch `mvp-04` (2026-11-05).

Where things are:
- `mod/hooks/lib/tree.ts` (pure): `layoutTree(file, { columns, narrow, lastJump, bandId, isReachable, isLive }) -> TreeRow[]` (`{ key, kind: main|sub|unlabelled|exchange, target, segments }`), `pendingIds(live)`, `fit(text, w)`, `GAP_MAX`. Tests: `mod/tests/tree.test.ts`.
- `mod/hooks/lib/pane.ts` (pure): `enterAction(file, id, { fullscreen, isReachable }) -> jump | reader(reason)`, `afterJump(scrollResult) -> close | note`, `openTarget(file, lastJump, isLive?)`, `bandTarget(file, { fullscreen, hereId })`, `marksUsage(args)`, `isNarrow(placement, bodyColumns)`, `treeKeys({ fullscreen })`, `REASON`, `PANE_ID`, `PANE_ROWS`. Tests: `mod/tests/pane.test.ts`.
- `mod/hooks/pane.tsx` (adapters): `registerPane(on)` (the `/marks` `command.run` hook and the `Pane` render hook), `registerMarksCommand($)`, `openPane($, target)`, `openFromBand($, file, o)`. Wired from `register.tsx`: `registerMarksCommand` in `session.start`, `registerPane(on)` at the end of `register`, and the band is now one `Button` (`key="band"`). Plugin tests: `mod/tests/marks.test.ts`.
- New `$.state` key `marks.pane`: `PaneState { target, lastJump, note }` in `types/index.d.ts`. `lastJump` lives only there (it survives a hot reload; a stale id falls back to the latest).

Deviations and notes:
- `/marks <args>` shows `usage: /marks` as a toast and returns `{}` (decision 9), not a transcript line. `/marks` is registered with `immediate: true` (decision 11).
- The engine refuses a second unmatched `on('session.start')` in one plugin, so `/marks` is registered from register.tsx's existing `session.start`. Functions that take `$` across files must be `function` declarations, and each atom a file reads must be a `const` of that file: `pane.tsx` repeats the `conv` (shape `conv-1`) and `here` atoms. Bump the shape tag in both files.
- A main thread's header counts its whole family (its own and its sub-threads' exchanges, i.e. the rows under it). A sub-thread header counts its own. The prototype counted only the thread's own exchanges.
- Pending vs Unlabelled: an exchange with `thread: null` is pending (`…`, shown in the current thread) when it is in the trailing unlabelled run and that run is 10 or shorter (`pendingIds`). Any other `thread: null` exchange goes to the Unlabelled group. With no labelled exchange yet, pending ones also sit in the Unlabelled group, still with `…`. This copies the gap-on-load rule from the file alone. A long skipped run followed by new queued turns shows the new ones as Unlabelled until they are labelled.
- Row layout: `<indent><›| ><n padded to the widest n> <glyph slot, 2 cols> <gist or excerpt>`; `›` and the number are bold on the last jump, dim otherwise. Header and row text are cut with `…` to `bodyColumns`.
- The footer (the deny or reason line in the warning colour, then the dim key line `↑↓ move · Enter jump · Esc close`) is drawn after the tree. In a long tree it is below the window until the person scrolls there. Ticket 05 replaces the deny footer with the reader.
- Keys: no hotkeys are bound. Up/down/Tab are the engine's ring, Enter presses the focused Button, Esc is `closeOnEscape`. `a`, `v`, `/` and left stay unbound.
- On open, after `isPlaced`: `$.ui.focus({ requestId: 'marks', key: 'ex:<target>' })` and `$.ui.scroll({ in: 'marks', to: { key }, block: 'center' })`, both with `.catch`. The target row also gets `autoFocus`.
- Build check, tree model: `layoutTree` takes about 2.3 ms for 600 exchanges over 40 threads (mean of 20 runs in the kit). The test fails above 10 ms. No windowing is done. The redraw cost of 600+ Buttons in the real terminal is not measured yet (below).

Facts for later tickets:
- 03: pass liveness and reachability into `layoutTree({ isLive, isReachable })`, `enterAction({ isReachable })` and `openTarget(file, lastJump, isLive)` at the `TODO(03)` lines in `pane.tsx`. Main-screen dimming is `isReachable: () => false` when `viewport.isFullscreen === false`; keep that when you add compaction reachability. `bandTarget` repeats `band()`'s pick of the band's exchange (`here` in fullscreen, else the latest); narrow both to live together. If 03 records which exchanges were skipped by the gap rule, replace `pendingIds` with it.
- 05: `enterAction` already returns `{ kind: 'reader', id, reason }` for unreachable and main-screen rows (`REASON.compacted`, `REASON.mainScreen`), and `afterJump` gives the deny note. Both currently go into `PaneState.note`. Make them open the reader instead (`TODO(05)` in `enter`). Add the reader view to `PaneState` (no shape tag on `pane`, so read old values defensively) and the `p` key to `treeKeys` as a `hotkey` Button. `ui.close` has no hook yet.
- 06: `#n` in `/mark #n` should match the number in the tree: the 1-based position among live exchanges, as `layoutTree` counts it.
- 08: `treeKeys({ fullscreen: false })` already says `Enter read`, and every row is dim on the main screen. The main-screen footer sentence is `REASON.mainScreen`; draw it as a standing footer there.
- Test kit: `tests/harness.ts` `world()` now answers `command.register` and records calls in `w.commands`. Don't register a second `command.register` hook in a test.

Manual check pending: a real jump. In fullscreen, `/marks`, move to an older exchange, Enter: the transcript scrolls that prompt to the top, then the pane closes. `/marks` again opens with the cursor on it and `›` on its row.
Manual check pending: cursor placement on open. `/marks` with a long tree puts the ring and the window on the last-jumped (else latest) exchange, and a band click puts them on the band's exchange (`here` in fullscreen). Also check that a band click while the pane is open moves the ring.
Manual check pending: a denied jump (for example, a turn running when Enter is pressed) keeps the pane open and shows `Jump denied: <reason>` in the footer.
Manual check pending: below 110 columns (for example 100x30) the pane sits inline above the prompt, 14 rows, counts shrink to `<k>`, and rows fit without wrapping.
Manual check pending (build check): redraw cost with 500+ exchanges. Open `/marks` on a long conversation and hold the down arrow. If the ring lags, window the tree around the cursor (draw a slice and hook `ui.scroll` for the pane). Record the finding here.

