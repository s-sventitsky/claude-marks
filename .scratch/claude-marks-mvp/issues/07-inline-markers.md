# 07: Inline dividers and prompt glyphs

**What to build:** in fullscreen, the transcript itself shows where threads change: a coloured divider above the prompt of the first exchange in a new thread, and the exchange's bookmark glyph in place of the prompt's `>`. Spec: [spec.md](../../claude-marks/spec.md), section "Inline markers".

**Blocked by:** 02 (Label new turns)

**Status:** implemented (pending merge)

- [x] Where the thread changes between consecutive live exchanges, a `── label ───` divider (`── └ label ───` for a sub-thread) in the thread's colour is drawn over the blank spacer row above the prompt. It is not sticky.
- [x] The exchange's first bookmark glyph replaces `>` on the prompt line, in the thread's colour.
- [x] Both are drawn from the `UserMessage` render hook around `await next(e)`, laid out against row 1 (not spacer row 0), so nothing lands on a misaligned extra row.
- [x] Markers appear on rows already drawn when a label lands seconds later (the hook reads `$.state`).
- [x] Always on in the MVP. No reply-block glyphs yet.

## Comments

Implemented on branch `mvp-07` (2026-11-05).

Where things are:
- `mod/hooks/lib/markers.ts` (pure): `markers(file) -> { [exchangeId]: Marker }` (which exchanges get a divider, which glyph, which colour) and `dividerLine(text, cols)`. Tests: `mod/tests/markers.test.ts`.
- `Marker` (`{ color, divider?, glyph? }`) in `mod/types/index.d.ts`; new `$.state` family `marks.marker` (`StateFamily<Marker | null>`, member id = exchange id = prompt row uuid).
- `mod/hooks/register.tsx`: `publishMarkers` runs inside `publish` and writes only the members whose marker changed (module cache `markerCache`, JSON per id; ids that lose their marker get `null`). The existing `UserMessage` hook keeps `noteOnScreen`, then reads `memberOf(markerA, e)` before `await next(e)` and wraps the engine's row in a column Box with two `position="absolute"` Boxes: the divider at `top={0}` (spacer row), the glyph at `top={1}` (over `>`), both `left={0}`, as in the prototype. Plugin tests: `mod/tests/inline.test.ts` (mounted UserMessage rows; a row mounted before its label redraws when the label lands, with no `ui.redraw()`).

Deviations and notes:
- Divider rule: an exchange gets a divider when it has a thread and that thread differs from the nearest earlier labelled exchange's. The first labelled exchange gets one (it opens its thread). Unlabelled exchanges in between do not split a run, so a pending exchange draws no divider until its label lands, and then the divider may move to it.
- Glyph: the first bookmark that is not dismissed. An unlabelled exchange with a bookmark takes the current thread's colour (that of the nearest earlier labelled exchange).
- Divider text: `── <label> ` padded with `─` to `columns - 1`; a head too long is cut with `…`. Width is `e.viewport.columns`; `Text wrap="truncate"` as a backstop. Wide characters in labels are counted as one column.
- Markers are drawn only when `e.viewport.isFullscreen === true`, `isExpanded` is false, `origin.kind === 'composer'` and the row is not `placeholder`. Otherwise the hook returns `next(e)` untouched.
- A slash or skill turn has no composer prompt row (its anchor is a reply text row), so it gets no inline marker in the MVP.
- Folded prompts (`prompts[1..]`) get no marker; only the exchange's first prompt row.
- TODO(03): `markers` walks every exchange as live (03's liveness helper was not on `mvp` yet). 03 should filter to live exchanges there.
- After a hot reload `markerCache` is empty, so the first `publish` writes every member again. A member set before the reload for an exchange that has since lost its marker would stay until that id is written again (unlikely: the file in `$.state` is the same).

Facts for later tickets:
- 08: the `UserMessage` hook skips markers when `isFullscreen !== true`; nothing else to undo on the main screen.
- 06: a manual bookmark shows on the prompt row when it is the exchange's first bookmark; `publish` after the change is enough (markers follow the file).
- Later "markers on/off" setting: one check at the top of the marker branch in the `UserMessage` hook.

Manual check pending: in a real fullscreen session, the divider lands exactly on the blank spacer row above the prompt and the glyph exactly over `>` (no extra row, no shift of the prompt text), in the thread colour, for a main thread (`── label ───`) and a sub-thread (`── └ label ───`).
Manual check pending: a prompt row already on screen gets its divider and glyph within ~1 s of the label landing, without scrolling, and scrolling does not blink the markers.
Manual check pending: ctrl+o (expanded row) shows the engine's row without markers; the main screen (non-fullscreen) shows none.
