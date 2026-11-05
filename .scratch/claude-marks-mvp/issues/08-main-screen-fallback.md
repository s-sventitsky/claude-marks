# 08: Main-screen fallback

**What to build:** on the main screen (`isFullscreen === false`, where the transcript is native scrollback), the mod still works as a list and reader: the same pane and keys, but Enter opens the reader instead of jumping. Spec: [spec.md](../../claude-marks/spec.md), section "Main screen".

**Blocked by:** 05 (Reader), 07 (Inline dividers and prompt glyphs)

**Status:** resolved (merged to mvp; manual checks pending)

- [x] The mode comes from `isFullscreen` (`command.run`'s `presentation`, or `viewport` on any drawing) and stays fixed for the session.
- [x] On the main screen nothing is reachable: every exchange draws dim, Enter opens the reader, `g` is dim and inert, and the pane shows the footer `Enter opens the reader. Jumping works in fullscreen.`
- [x] The band shows the latest exchange's thread as `latest #n/N`.
- [x] No inline dividers or prompt glyphs draw.
- [x] `/mark` and the reader's `m` work as in fullscreen. (Ticket 06: plugin test `mod/tests/mark.test.ts`, "main screen (ticket 08)". The reader's bookmark line is not a jump there, as nothing jumps.)
- [ ] Build check: run it on the main screen and confirm Enter opens the reader in the transient pane. Record the finding on this ticket.

## Comments

Implemented on branch `mvp-08` (2026-11-05). Audit: most of the ticket already worked from 02, 04, 05 and 07 (band `latest`, every row dim, Enter opens the reader with the reason, `g` dim, `Enter read`, no markers). Added: one stored mode and the tree's standing footer.

Where things are:
- `mod/hooks/lib/mode.ts` (pure): `modeOf(stored, seen)`, `modeToStore(stored, seen)`.
- `mod/hooks/mode.ts` (adapter): atom `marks.fullscreen` (`boolean | null`, in `types/index.d.ts`), `noteMode(isFullscreen)` (render hooks), `fixMode($, isFullscreen?)` (stores the first value, never changes it), `readMode($, viewportIsFullscreen)`.
- Writers: `/marks` stores `e.presentation.isFullscreen` at once. Render hooks (band, Pane, UserMessage, AssistantMessage) can't write `$.state`, so they note their viewport and the 500 ms tick stores it.
- Readers: the band, the `Pane` render hook, `enter` (Enter and `g`) and the `UserMessage` marker hook all go through `readMode`. Until a mode is stored, the drawing's own `viewport.isFullscreen` stands in (undefined = unknown: the pane tries the jump, the band says `here`, no markers).
- Footer: in the tree (and the empty tree) on the main screen, a dim `Enter opens the reader. Jumping works in fullscreen.` line above the key line. Like the key line, it is below the window in a long tree until the person scrolls there.
- Plugin tests: `mod/tests/main-screen.test.ts` (the whole path: `/marks` with `presentation.isFullscreen: false` and a pane whose viewport doesn't say; band `latest #3/3`; every exchange row dim; footer; Enter opens the reader with the reason; `g` dim and inert, no close; no overlays on prompt rows; the mode fixed after a later `true`).

Deviations and notes:
- "Fixed for the session" is literal: the first value heard wins, and a later different report is ignored. On the terminal the two never differ (the types say so); a remote surface that switches would keep its first mode. The value is not reset on `/clear` or `/resume` (the terminal layout belongs to the process, not the conversation).
- The marker hook now also returns the engine's row untouched when the drawing has no `viewport`.
- `/mark` and the reader's `m` (ticket 06) were not on `mvp` when this was built; not tested here. 06 should read the mode with `readMode` from `hooks/mode.ts` if it needs it.

Manual check pending: build check. Start with `CLAUDE_CODE_NO_FLICKER=0`, have a few labelled turns, run `/marks`: the pane sits inline above the prompt, every row dim, the footer sentence and `Enter read` in the key line (scroll down in a long tree). Enter on a row opens the reader in the transient pane with the sentence as its reason, `g` dim; Esc goes back to the tree, a second Esc closes it.
Manual check pending: on the main screen the band reads `● <label> · latest #n/N`, a band click opens the pane, and prompt rows in scrollback carry no dividers or glyphs.
Manual check pending: `/mark` and the reader's `m` on the main screen work as in fullscreen (once 06 is merged).
