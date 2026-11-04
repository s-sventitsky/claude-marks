# 02: Label new turns

**What to build:** after each turn ends, a cheap model call places the new exchange in a **thread** (continue, resume, new main, new sub), writes its **gist** and flags auto **bookmarks** (landmark, branch point). The band now says where you are, in the thread's colour. Spec: [spec.md](../../claude-marks/spec.md), sections "Labeller", "UI" (colours and glyphs), "Band", "Status line", "Fields the MVP writes but doesn't use".

**Blocked by:** 01 (Track exchanges into the conversation file)

**Status:** ready-for-agent

- [ ] `turn.complete` awaits `next(e)`, enqueues the exchange and returns. A `$.clock` timer started in `session.start` drains the queue one call at a time, in conversation order. Nothing awaits the model inside a dispatch.
- [ ] Each call is `$.model.complete` with `haiku`, `effort: 'low'`, the v3 labeller rules verbatim as the first cached block, and the dynamic part built as in the labeller prototype: threads so far (last 2 gists, current marked), the previous exchange (prompt, last 1200 chars of its reply), this exchange (joined prompts, up to 15 tool lines, reply head 2000 + tail 1000).
- [ ] The reply is parsed and validated as the spec says (fence stripping, `{…}` extraction, clipped label, gist and why, unknown kinds dropped). Anything unusable becomes `continue` with no bookmarks.
- [ ] Results apply per the spec: mod-minted ids `t1`, `t2`…; `resume` resolves through `mergedFrom`, unknown ids become `continue`; `new_sub` nests under the current main thread; no threads yet means `new_main`; at most one bookmark per kind, none recreated over a dismissed one; `bookmarkStats.*.flagged` counted; `by: 'labeller'` everywhere and `by: 'user'` values never overwritten.
- [ ] An unanswered call (`api-error`, `empty-reply`, `aborted`) marks the exchange `failed`, retries once on the next drain, then leaves it on `continue`. A call the engine refuses to send stops the drain for the session, and the band hint reads `labeller off: <reason>`.
- [ ] The band reads `● Main › Sub · here #n/N ◇ · click or /marks`, with the thread name and glyphs in the thread's colour (main threads by index from the spec's palette, sub-threads take their main's colour). Before the first label: `○ labelling… · click or /marks`. In fullscreen `here` follows the topmost exchange on screen.
- [ ] The status line reads `/marks · N threads` and is set only when it changes.
- [ ] Build check: a completion started from the timer is not aborted when the next turn starts (if it is, re-queue `aborted` results). Record the finding on this ticket.
