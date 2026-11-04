# 05: Reader

**What to build:** `p` in the tree opens the **reader**: one exchange's prompt and reply text inside the pane. It is also where an exchange goes when it can't be jumped to (before the last compaction, or a denied jump). Spec: [spec.md](../../claude-marks/spec.md), section "Reader", and the Enter row of "Tree keys".

**Blocked by:** 03 (Rebuild from the transcript), 04 (Pane tree with jump)

**Status:** ready-for-agent

- [ ] `p` opens the reader in place: thread path in its colour, `· #n · i of k in thread` (counted over the main thread's family), the reason when a jump isn't possible, the exchange's bookmarks, then the prompt and the reply text blocks as Markdown. Text comes from the row index, so pre-compaction exchanges show in full.
- [ ] `j`/`k` step to the next/previous exchange in the main thread's family, dim and inert at either end. `g` jumps and closes the pane, dim and inert when unreachable.
- [ ] Esc in the reader returns to the tree on the reader's exchange, with the pane keeping its keys: a `ui.close` hook refuses the person's close while the reader shows. The × mark behaves the same. A second Esc in the tree closes the pane.
- [ ] Enter on an unreachable exchange in the tree, or a jump the engine denies, opens the reader with the reason (`Before the last compaction: not on screen, so the reader shows it.` or the deny text) instead of the ticket 04 footer.
- [ ] `m` is drawn and reserved for ticket 06; `n` stays unbound.
