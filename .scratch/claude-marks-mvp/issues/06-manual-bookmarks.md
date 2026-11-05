# 06: Manual bookmarks

**What to build:** the user bookmarks an exchange, or one of Claude's reply blocks in it, with `/mark` or from the reader, and sees ◆ in the tree, band and transcript. Spec: [spec.md](../../claude-marks/spec.md), sections "Commands" (`/mark`), "Reader" (`m`), "Fields the MVP writes but doesn't use" (`corrections`).

**Blocked by:** 05 (Reader)

**Status:** resolved (merged to mvp; manual checks pending)

- [x] `/mark` with no target bookmarks Claude's latest reply text block in the latest exchange (`row` = that block's uuid). `/mark #n` bookmarks exchange n on its prompt row. The rest of the line is the note; without one the text is ~80 chars of the message, else the gist. One manual bookmark per exchange, so a second `/mark` replaces it. It replies with one line like `◆ #14 "chose JSON schema"`; a bad `#n` prints usage.
- [x] In the reader, `m` opens a `Select` of the exchange's reply text blocks (first ~60 chars each) plus "the whole exchange". The entry holding the bookmark shows ◆ and choosing it removes the bookmark. Choosing another entry moves the bookmark there and asks for an optional note (Enter on empty means none).
- [x] Each add writes a `bookmark_add` entry to `corrections[]`, newest 10 kept.
- [x] Enter on a bookmarked exchange in the tree still jumps to the prompt row. A bookmark's `row` falls back to the prompt row if that row can't be found.
- [ ] Build check: a jump to a reply-row anchor after `--resume`, and to a reply row not yet drawn. Record the finding on this ticket. (Needs the real terminal; see below.)

## Comments

Implemented on branch `mvp-06` (2026-11-05).

Where things are:
- `mod/hooks/lib/bookmarks.ts` (pure): `parseMark(args)` (`{ target: 'latest' | n, note? }`, undefined = usage), `planMark(file, args, { rowsOf, isLive })`, `fallbackText(x, rows, row?)`, `runMark(file, args, o, at) -> { file, say }` (the whole `/mark`), `setManual` / `removeManual` / `noteManual`, `manualOf`, `CORRECTIONS_MAX`, `markLine(n, text)`, and for the reader `markMenu(x, rows)`, `heldValue`, `pickMark(file, id, value, rows, at) -> { file, askNote }`, `anchorOf(x, rows)`, `menuKey` / `noteKey` / `menuTarget`. `MARK_USAGE`, `NO_EXCHANGE`, `WHOLE`. Tests: `mod/tests/bookmarks.test.ts`.
- `mod/hooks/lib/pane.ts`: `readerKeys` has `m` enabled; `paneView` keeps `menu`; `onPaneClose` answers `'to-reader'` in a menu. `PaneView` reader gained `menu?: ReaderMenu` (`'pick' | 'note'`) in `types/index.d.ts`.
- `mod/hooks/register.tsx`: registers `/mark` (`immediate: true`) in session.start; the `command.run` hook for `mark`; `ui.select` / `ui.input` hooks on the pane that apply a menu pick or a note to the file (`editFile`, over `commit`).
- `mod/hooks/pane.tsx` (reader branch only): `m` opens the `Select` (`mark:menu:<id>`), a move shows the note `Input` (`mark:note:<id>`), both `autoFocus` plus `$.ui.focus`; their handlers only switch the view. Esc in a menu goes back to the reader. The manual bookmark's line is a plain Button that jumps to `anchorOf` (reply row, else the prompt row). `enter()` takes an optional `row`: tried first, and a denied jump to it retries the prompt row.
- Plugin tests: `mod/tests/mark.test.ts` (`/mark` in all forms, the menu, the note, removal, the bookmark line, the main screen).

Deviations and decisions:
- The confirmation (`◆ #14 "…"`), usage (`usage: /mark [#n] [note]`) and `/mark: no exchange to bookmark yet` go to a toast; `/mark` returns `{}` (decision 9: a command's text is a transcript row the model reads).
- The file edits live in register.tsx, not pane.tsx: `claude plugin validate` refuses `$` passed into a callback, and past an import it follows `$` only into function declarations, while register.tsx's `commit` chain is arrow consts. So the `Select`/`Input` keys carry the exchange id, register.tsx's `ui.select` / `ui.input` hooks change the file, and the pane's own handlers (the bottom of the chain) only switch the view.
- A pick moves the bookmark at once (with the fallback text) and logs the `bookmark_add`; the note then only replaces the text. Esc out of the note leaves the moved bookmark with its fallback text.
- The manual bookmark goes first in `bookmarks[]`, so its ◆ leads the tree's two glyph slots and becomes the inline prompt glyph (ticket 07 draws the first bookmark).
- Removing (choosing the holder) writes no correction: there is no remove kind in `Correction`.
- `/mark` with no target when the latest exchange has no reply text yet (a `/mark` mid-turn, before the first text block): the prompt row.
- "Can't be found" means the row index has no reply row with that uuid (not yet read, rewound, gone). In the menu such a bookmark shows ◆ on "the whole exchange".
- Added beyond the spec: the reader's manual bookmark line is a Button that jumps to the bookmark's row. Nothing else in the MVP jumps to a reply row, and the build check needs a path that does. Inert (plain text) when the exchange can't be jumped to (main screen, before the last compaction).
- `m` works on every exchange the reader shows, including unreachable ones and on the main screen (spec "Scope" of the command-surface ticket: unreachable exchanges take every bookmark).
- `/mark` also stores the session's mode from `presentation.isFullscreen` (`fixMode`), as `/marks` does.

Manual check pending: `/mark` in a real session: toast `◆ #n "…"` and nothing in the transcript the model reads; ◆ in the tree row, the band and on the prompt line (when it is the exchange's first bookmark); the data file holds the bookmark and a `bookmark_add`.
Manual check pending: `/mark` while a turn runs (`immediate`) bookmarks the running exchange's latest reply block so far.
Manual check pending: reader `m`: the `Select` takes the keys at once (arrows, Enter); after a move the note `Input` takes them; Enter on empty keeps the message text. Esc in the `Select` or the `Input` returns to the reader with the keys in the pane (the types say Esc in a Select "always returns to the prompt"; if the keys stay with the prompt, try a longer `RETAKE_MS`).
Manual check pending (build check): in fullscreen, bookmark a reply block with `m`, then press the ◆ line in the reader: the transcript scrolls to that reply block, not the prompt. Then quit, `claude --resume` the conversation, `/marks`, `p` on the exchange, press the ◆ line again (after resume). Also bookmark a reply block far above the drawn window (a long conversation, scrolled to the bottom) and jump to it (a row not yet drawn). Record whether each reached the reply row; a denied reply-row jump falls back to the prompt row and logs `jump to reply row … the prompt row instead` in the debug log.
