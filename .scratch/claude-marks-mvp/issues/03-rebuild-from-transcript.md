# 03: Rebuild from the transcript

**What to build:** the mod rebuilds its view of the conversation from the transcript JSONL whenever it loads (session start, hot reload, `--resume`, `--continue`, a switch), so exchanges made before the mod loaded, rewinds and compactions all show correctly. Short unlabelled gaps are labelled automatically; long ones wait. Spec: [spec.md](../../claude-marks/spec.md), sections "Transcript pass", "Liveness and reachability", "Labeller" ("Gaps on load").

**Blocked by:** 01 (Track exchanges into the conversation file), 02 (Label new turns)

**Status:** ready-for-agent

- [ ] The transcript path is found from the project slug, with a scan of the projects folder as the fallback.
- [ ] Files of 4 MiB or less are read with one `$.fs.read`. Larger files stream through `$.process.spawn`: `cat` on macOS and Linux, Git for Windows' `cat.exe` on Windows, `cmd /c type` as the last fallback. Lines are prefiltered by substring before `JSON.parse`. The pass runs off the hook path.
- [ ] The pass fills the same row index as live appends (prompt rows, reply text rows with text, tool lines, `parentUuid`, compaction boundaries) and creates exchanges for prompt rows not yet in the file. Human-prompt filters match the labeller prototype's extractor.
- [ ] **Live** is recomputed by walking `parentUuid` back from the newest row (through `logicalParentUuid` at a boundary). Non-live exchanges and threads with no live exchanges are hidden, and come back if the conversation returns to that fork. A prompt append the mod can't place triggers a re-read of the transcript's tail.
- [ ] **Reachable** is recomputed: after the last `compact_boundary`, in fullscreen. A `compact_boundary` arriving through `session.append` recomputes and redraws.
- [ ] On load, a run of 10 or fewer unlabelled live exchanges after the last labelled one is queued. A longer run, or a never-labelled conversation, stays unlabelled, and the band hint reads `N unlabelled`.
- [ ] Build checks, findings recorded on this ticket: per-piece cost of `$.process.spawn` inside the mod and the real cost of the `cmd /c type` fallback on the largest local transcript (fallback: a `<sessionId>.text.json` cache); whether `preservedSegment` rows are drawn and jumpable after a compaction; whether a live (not resumed) session still draws pre-compaction rows; what `--fork-session` copies (fallback: the fork starts empty).
