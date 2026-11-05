# 05: Reader

**What to build:** `p` in the tree opens the **reader**: one exchange's prompt and reply text inside the pane. It is also where an exchange goes when it can't be jumped to (before the last compaction, or a denied jump). Spec: [spec.md](../../claude-marks/spec.md), section "Reader", and the Enter row of "Tree keys".

**Blocked by:** 03 (Rebuild from the transcript), 04 (Pane tree with jump)

**Status:** implemented (pending merge)

- [x] `p` opens the reader in place: thread path in its colour, `· #n · i of k in thread` (counted over the main thread's family), the reason when a jump isn't possible, the exchange's bookmarks, then the prompt and the reply text blocks as Markdown. Text comes from the row index, so pre-compaction exchanges show in full.
- [x] `j`/`k` step to the next/previous exchange in the main thread's family, dim and inert at either end. `g` jumps and closes the pane, dim and inert when unreachable. (A real `g` jump is a manual check.)
- [x] Esc in the reader returns to the tree on the reader's exchange, with the pane keeping its keys: a `ui.close` hook refuses the person's close while the reader shows. The × mark behaves the same. A second Esc in the tree closes the pane. (Pure decision tested; the hook is a manual check.)
- [x] Enter on an unreachable exchange in the tree, or a jump the engine denies, opens the reader with the reason (`Before the last compaction: not on screen, so the reader shows it.` or the deny text) instead of the ticket 04 footer.
- [x] `m` is drawn and reserved for ticket 06; `n` stays unbound.

## Comments

Implemented on branch `mvp-05` (2026-11-05). The kit cannot jump or raise a person's close, so a real `g` jump and Esc back are manual checks (below).

Where things are:
- `mod/hooks/lib/reader.ts` (pure): `readerModel(file, id, { fullscreen, isLive, isReachable, unlabelled, deny, rows }) -> ReaderModel | undefined` = `{ id, path (segments), n, i, k, reason, canJump, prev, next, bookmarks [{ glyph, color, text }], prompts, replies }`. Undefined when the exchange is gone or hidden. Tests: `mod/tests/reader.test.ts`.
- `mod/hooks/lib/tree.ts`: `groupTree(file, { isLive, unlabelled }) -> Groups` (`shown`, `n`, `pending`, `threadOf`, `order`, `family`, `own`) is pulled out of `layoutTree`, so the reader counts `#n` and the family exactly as the tree does. `UNLABELLED` is exported.
- `mod/hooks/lib/pane.ts`: `paneView(stored)` (defensive read), `onPaneClose(view, origin) -> 'to-tree' | 'pass'`, `readTarget(rows, focusedRow, fallback)`, `readerKeys(model)`. `treeKeys` gained `p`. Tests: `mod/tests/pane.test.ts`.
- `mod/hooks/pane.tsx`: `registerPane(on, rowsOf)` now takes the row index getter (register.tsx passes `id => tracked?.index[id]`). New hooks: `ui.close` (refuse in the reader, back to the tree, retake the keys after 30 ms with `ui.open` and `ui.focus ex:<id>`), and `ui.focus` on the pane (remembers the last `ex:`/`th:` row for `p`). Plugin tests: `mod/tests/marks.test.ts`, "the reader".
- `PaneState` (`types/index.d.ts`): `note` is gone, `view: PaneView` (`{ kind: 'tree' } | { kind: 'reader', id, deny? }`) is new. No shape tag; old values read through `paneView` as the tree.

Deviations and decisions:
- The ticket 04 footer note is gone: every "can't jump" path opens the reader. `readerModel` works out the reason from the same facts as `enterAction` (main screen first, then compaction). A stored `deny` (`Jump denied: <reason>`) shows only when neither applies. `j`/`k` drop the deny. `g` stays live after a deny so the person can retry.
- Main screen: the reader's reason is `REASON.mainScreen` (`Enter opens the reader. Jumping works in fullscreen.`) and `g` is dim.
- Keys are plain hotkey Buttons (`p: read`, `j: next`, `k: previous`, `g: jump`, `m: bookmark`) plus dim text for the engine keys. Inert ones draw `dimColor` and do nothing on press. `KeyHint.label` is now the action word; the Button draws `<hotkey>: ` before it.
- The reader's key line is at the top, not the bottom: a long reply would push it out of the 14-row inline window. The tree's key line stays at the bottom (ticket 04).
- Opening the reader moves the ring to `key:j` (the tree row it was on is gone). Esc back puts the cursor (`target`, autoFocus) and the ring on the reader's exchange.
- `p` with no row heard through `ui.focus` (fresh open, after a reload) reads the cursor's start row.
- Prompt block: each folded prompt on its own `> ` line. With no index entry yet, the excerpt stands in and the body says `No reply text.`
- `/marks` or a band click while the reader shows opens the tree (`openPane` resets the view).
- A reader whose exchange stops being live (a rewind) falls back to the tree.
- Known limit: the reader redraws on `$.state` changes only. The row index is a module variable, so reply text streaming into the running exchange shows on the next file change (its label landing, the next prompt), not live.
- Kit finding: a test can raise `ui.focus` as an event: `$.ui.focus({ component, requestId, element, origin })`, with a bottom `on('ui.focus', () => ({}))` registered before the test's first `$` call. The test `$` has no `ui.close`.

Manual check pending: Esc in the reader goes back to the tree with the cursor and the ring on the reader's exchange, and the pane keeps the keyboard (arrows and `p` work at once; the prompt doesn't get them). A second Esc closes the pane. If the keys stay with the prompt, try a longer `RETAKE_MS` in `pane.tsx`.
Manual check pending: the × mark (and ctrl+x x) in the reader does the same as Esc.
Manual check pending: `g` in the reader on a reachable exchange in fullscreen scrolls the transcript to it and closes the pane; `/marks` then opens with `›` on it.
Manual check pending: `p` after moving the cursor with the arrows reads the row under the cursor (needs the engine's `ui.focus` with `origin.kind: 'person'`), and on a thread header reads its first exchange.
Manual check pending: hotkeys `j`/`k`/`g`/`p` fire in a focused pane in both placements (dock and inline), and an inert key does nothing.
Manual check pending: a long reply (tables, code fences) draws as Markdown inside the pane and scrolls; the key line stays at the top.
Manual check pending: after a compaction, Enter on a pre-compaction exchange opens the reader with `Before the last compaction: …` and its full text from the transcript pass.

Facts for later tickets:
- 06 (reader `m`):
  - `readerKeys` has `m` with `enabled: false`. Enable it there and add `m: () => …` to the reader's `keyLine(readerKeys(m), { j, k, g })` call in `pane.tsx`.
  - The reply blocks for the `Select`: `rowsOf(id)?.replies` (`{ uuid, text }`; the uuid is the bookmark `row`). `ReaderModel.replies` holds the texts only; add the uuids if the menu is built from the model.
  - The reader view is `PaneView` in `$.state` `marks.pane`. A sub-view (the menu, the note `Input`) can extend it, for example `{ kind: 'reader', id, menu?: … }`. Add it to `paneView`'s defensive read. `onPaneClose` should send Esc in a menu back to the reader, not the tree.
  - The reader's bookmark lines come from `readerModel(...).bookmarks`, so a new manual bookmark shows once the file is published.
- 08 (main screen):
  - Enter already opens the reader there with `REASON.mainScreen` as its reason line, and `g` is dim. The tree still has no standing footer sentence; add it in the tree branch of the `Pane` render hook.
  - The tree key line says `Enter read` on the main screen (`treeKeys`).
  - `fullscreen` in the pane comes from `e.viewport?.isFullscreen`; undefined counts as fullscreen.
