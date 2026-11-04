# 07: Inline dividers and prompt glyphs

**What to build:** in fullscreen, the transcript itself shows where threads change: a coloured divider above the prompt of the first exchange in a new thread, and the exchange's bookmark glyph in place of the prompt's `>`. Spec: [spec.md](../../claude-marks/spec.md), section "Inline markers".

**Blocked by:** 02 (Label new turns)

**Status:** ready-for-agent

- [ ] Where the thread changes between consecutive live exchanges, a `── label ───` divider (`── └ label ───` for a sub-thread) in the thread's colour is drawn over the blank spacer row above the prompt. It is not sticky.
- [ ] The exchange's first bookmark glyph replaces `>` on the prompt line, in the thread's colour.
- [ ] Both are drawn from the `UserMessage` render hook around `await next(e)`, laid out against row 1 (not spacer row 0), so nothing lands on a misaligned extra row.
- [ ] Markers appear on rows already drawn when a label lands seconds later (the hook reads `$.state`).
- [ ] Always on in the MVP. No reply-block glyphs yet.
