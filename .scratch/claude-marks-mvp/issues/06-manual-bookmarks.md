# 06: Manual bookmarks

**What to build:** the user bookmarks an exchange, or one of Claude's reply blocks in it, with `/mark` or from the reader, and sees ◆ in the tree, band and transcript. Spec: [spec.md](../../claude-marks/spec.md), sections "Commands" (`/mark`), "Reader" (`m`), "Fields the MVP writes but doesn't use" (`corrections`).

**Blocked by:** 05 (Reader)

**Status:** ready-for-agent

- [ ] `/mark` with no target bookmarks Claude's latest reply text block in the latest exchange (`row` = that block's uuid). `/mark #n` bookmarks exchange n on its prompt row. The rest of the line is the note; without one the text is ~80 chars of the message, else the gist. One manual bookmark per exchange, so a second `/mark` replaces it. It replies with one line like `◆ #14 "chose JSON schema"`; a bad `#n` prints usage.
- [ ] In the reader, `m` opens a `Select` of the exchange's reply text blocks (first ~60 chars each) plus "the whole exchange". The entry holding the bookmark shows ◆ and choosing it removes the bookmark. Choosing another entry moves the bookmark there and asks for an optional note (Enter on empty means none).
- [ ] Each add writes a `bookmark_add` entry to `corrections[]`, newest 10 kept.
- [ ] Enter on a bookmarked exchange in the tree still jumps to the prompt row. A bookmark's `row` falls back to the prompt row if that row can't be found.
- [ ] Build check: a jump to a reply-row anchor after `--resume`, and to a reply row not yet drawn. Record the finding on this ticket.
