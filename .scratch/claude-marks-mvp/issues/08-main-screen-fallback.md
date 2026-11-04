# 08: Main-screen fallback

**What to build:** on the main screen (`isFullscreen === false`, where the transcript is native scrollback), the mod still works as a list and reader: the same pane and keys, but Enter opens the reader instead of jumping. Spec: [spec.md](../../claude-marks/spec.md), section "Main screen".

**Blocked by:** 05 (Reader), 07 (Inline dividers and prompt glyphs)

**Status:** ready-for-agent

- [ ] The mode comes from `isFullscreen` (`command.run`'s `presentation`, or `viewport` on any drawing) and stays fixed for the session.
- [ ] On the main screen nothing is reachable: every exchange draws dim, Enter opens the reader, `g` is dim and inert, and the pane shows the footer `Enter opens the reader. Jumping works in fullscreen.`
- [ ] The band shows the latest exchange's thread as `latest #n/N`.
- [ ] No inline dividers or prompt glyphs draw.
- [ ] `/mark` and the reader's `m` work as in fullscreen.
- [ ] Build check: run it on the main screen and confirm Enter opens the reader in the transient pane. Record the finding on this ticket.
