# 03: Rebuild from the transcript

**What to build:** the mod rebuilds its view of the conversation from the transcript JSONL whenever it loads (session start, hot reload, `--resume`, `--continue`, a switch), so exchanges made before the mod loaded, rewinds and compactions all show correctly. Short unlabelled gaps are labelled automatically; long ones wait. Spec: [spec.md](../../claude-marks/spec.md), sections "Transcript pass", "Liveness and reachability", "Labeller" ("Gaps on load").

**Blocked by:** 01 (Track exchanges into the conversation file), 02 (Label new turns)

**Status:** implemented (pending merge)

- [x] The transcript path is found from the project slug, with a scan of the projects folder as the fallback.
- [x] Files of 4 MiB or less are read with one `$.fs.read`. Larger files stream through `$.process.spawn`: `cat` on macOS and Linux, Git for Windows' `cat.exe` on Windows, `cmd /c type` as the last fallback. Lines are prefiltered by substring before `JSON.parse`. The pass runs off the hook path.
- [x] The pass fills the same row index as live appends (prompt rows, reply text rows with text, tool lines, `parentUuid`, compaction boundaries) and creates exchanges for prompt rows not yet in the file. Human-prompt filters match the labeller prototype's extractor.
- [x] **Live** is recomputed by walking `parentUuid` back from the newest row (through `logicalParentUuid` at a boundary). Non-live exchanges and threads with no live exchanges are hidden, and come back if the conversation returns to that fork. A prompt append the mod can't place triggers a re-read of the transcript's tail.
- [x] **Reachable** is recomputed: after the last `compact_boundary`, in fullscreen. A `compact_boundary` arriving through `session.append` recomputes and redraws.
- [x] On load, a run of 10 or fewer unlabelled live exchanges after the last labelled one is queued. A longer run, or a never-labelled conversation, stays unlabelled, and the band hint reads `N unlabelled`.
- [ ] Build checks, findings recorded on this ticket: per-piece cost of `$.process.spawn` inside the mod and the real cost of the `cmd /c type` fallback on the largest local transcript (fallback: a `<sessionId>.text.json` cache); whether `preservedSegment` rows are drawn and jumpable after a compaction; whether a live (not resumed) session still draws pre-compaction rows; what `--fork-session` copies (fallback: the fork starts empty).

## Comments

Implemented on branch `mvp-03` (2026-11-05). The spawn and `cmd /c type` costs were measured (below). The four checks that need a real terminal are listed as manual checks.

Where things are:
- `mod/hooks/lib/jsonl.ts` (pure): `slug`, `transcriptPath`, `lineSplitter`, `keep` (the prefilter), `ingest(t, line)` into a `Transcript` (`order`, `pos`, `parent`, `rows`, `newest`, `boundaries`), `addBoundary`, `gitRootOf`, `catCommands`. Tests: `mod/tests/jsonl.test.ts`, with synthetic line builders in `mod/tests/fixtures/jsonl.ts`.
- `mod/hooks/lib/chain.ts` (pure): `stepBack`, `liveSet`, `turnsOf`, `mergeTurns`, `viewOf`, `isLive`, `isReachable`, `gapRun`, `liveView`, `mergeBack`, `visibleThreads`, `unlabelledCount`. Tests: `mod/tests/chain.test.ts`.
- `mod/hooks/lib/transcript.ts` (I/O through `$`): `findTranscript`, `readTranscript`, `readTail`.
- `mod/hooks/register.tsx`:
  - `rebuild` runs from `$.clock.after(0)` on each conversation load (first load, hot reload, switch).
  - `placePrompt` reads the tail 250 ms after each prompt append, retrying every 500 ms up to 6 tries.
  - A new branch handles `compact_boundary`. `publishChain` publishes the view.
  - The drain, the band and the status line read the live view.
  - New `$.state` key `marks.chain`: `ChainView | null` = `{ hidden, compacted, unlabelled }` (exchange ids), declared in `mod/types/index.d.ts`.
  - Plugin tests: `mod/tests/rebuild.test.ts`.
- Merge of `mvp` (04, 07) wired their TODO(03)s to the chain view: `publishMarkers` and the band click take `liveView`; `pane.tsx` passes `isLive`, `isReachable` (unknown viewport counts as fullscreen) and `unlabelled` to `layoutTree`, `isLive` to `openTarget`, and `isReachable(view, id, true)` to `enterAction`. `layoutTree` gained `unlabelled` (the gap rule's record): given, every other unlabelled exchange is pending.

Deviations and decisions:
- **The `parentUuid` walk needs a bridge.** A strict walk from the newest row hid 460 of 870 prompts across the 77 local transcripts, for two reasons. The engine links rows to uuids it never writes (`away_summary` rows, prompts after a resume). And new-format boundaries point `logicalParentUuid` forward, to the preserved tail after the summary. The fix is the rule in `stepBack`: a parent missing from the file, one later in the file, or a boundary with none continues at the previous row in file order. With the bridge, 2 of 925 turns are hidden across all 77 transcripts. Both are real rewinds: two prompts with the same parent, 16 s and 42 s apart.
- The newest row is the last `user` or `assistant` row. System and attachment rows don't count.
- **Rewinds (decision 5).** Each prompt append triggers one tail read:
  - 4 MiB or less: the whole file through `$.fs.read`. Rows already known are skipped by uuid before any parse.
  - Larger: `tail -c <growth + 64 KiB>` through `$.process.run`, with Git's `tail.exe` on Windows.
  - A whole re-read when the file shrank, grew past 4 MiB since the last read, or no tail exists.
  - After the read, liveness is always recomputed. The walk takes a few ms; the read is the cost, so checking the new prompt's parent first would save nothing. A prompt not written yet is looked for again.
- Only the prefiltered lines go through `JSON.parse`: user rows without `tool_result`, `assistant`, `compact_boundary` and `queued_command`. Every other line is linked by regex: `^{"parentUuid":…` plus the `"uuid"` beside `"timestamp"`. A line the regex misses is parsed.
- **Prompt filters.**
  - A prompt has `origin.kind` human (or no origin), is not `isMeta` or `isCompactSummary`, has no `tool_result`, and its text doesn't start with `<` (the extractor's rule).
  - Command wrappers are commands, anchored on the first reply text row, as in the live tracker.
  - A row with another origin (task notification, peer) or a `<bash-input>`-style row starts a turn with no exchange, and its replies belong to none. The live tracker drops them the same way.
  - Older builds wrote typed local commands as bare `/compact` rows with no origin. Those are commands too.
  - Prompts with pasted images (content is a list) are prompts. The extractor skipped them.
- A reply row belongs to the exchange of the row it walks back to, not to the latest prompt in file order. Each rewind branch keeps its own replies, and a turn continues through a mid-turn compaction.
- **Gap rule.** "Never labelled" means the data file had no exchanges when loaded (`fresh`): the mod never tracked the conversation (installed mid-conversation, or a fork). A tracked file whose exchanges are all pending (a reload before the first label, or the labeller off) gets the ≤10 rule. Queued exchanges and the running turn's exchange are not part of a gap.
- A hidden exchange stays `pending`. The drain drops it from the queue without a call.
- **Labeller narrowing.** `buildDynamic(liveView(file, hidden), …)`. `settle` runs on the same view, then `mergeBack` writes the result into the full file. "Threads so far" lists `visibleThreads`: threads with an exchange in the view, plus a main thread while one of its sub-threads has one. The view keeps every thread, so colours don't shift.
- **Band.** N counts live exchanges only. The hint is `labeller off: …` first, else `N unlabelled`, else `click or /marks`. The status line counts visible threads.
- **Compacted** means the anchor sits before the last boundary in file order, `preservedSegment` rows included (the spec's default). An exchange the transcript doesn't know yet (appended live since the last read) is live and reachable.
- No `<sessionId>.text.json` cache. The measured fallback cost is acceptable; numbers below.
- In `mod/tests/track.test.ts`, the hot-reload test now asserts no `write failed` logs instead of no logs at all. The reload now refills the queue and logs the transcript lookup.

Build check findings. Measured 2026-11-05 on 2.1.318 (Windows) in a real mod loaded with `claude -p --plugin-dir`, against the largest local transcript: 87.8 MB, 22,901 lines, 13,942 rows, 20 compactions.

| Reader | Time | Pieces | Per piece | Notes |
|---|---|---|---|---|
| Git `cat.exe` | 437–598 ms | 1,341 | ~0.4 ms | With the whole pass (ingest, turns, live walk): 619–694 ms, 258–364 ms of it the mod's own JS |
| `cmd /c type` | 3.2–3.3 s | 62–66k | ~0.05 ms | With the whole pass: 3.9 s, 377 ms own JS. On a 12 MB file: 0.58 s, against 0.16 s with `cat` |

- The first line splitter re-joined the held text on every piece. That is quadratic on `cmd`'s tiny pieces: 595 ms of own JS on 12 MB. It now joins once per line: 62 ms.
- `tail -c 1 MiB` through `$.process.run`: 43 ms. `git --exec-path`: 60–111 ms.
- Conclusion: no text cache. The fallback costs about 4 s once per load, off the hook path, and only without Git for Windows.
- In node, the pass over all 77 local transcripts takes 1.0 s in total (275 ms for the 88 MB one). Re-ingesting a whole file whose rows are all known takes 3–96 ms.

Manual check pending: after a compaction in fullscreen, are `preservedSegment` rows drawn and jumpable? They are treated as unreachable now, so a jump to them opens the reader.
Manual check pending: does a live (not resumed) session still draw pre-compaction rows? The mod marks them unreachable as soon as the `compact_boundary` append arrives (`claude --debug` logs `marks: compact_boundary door=<door>`; also confirm the row arrives with `name: 'compact_boundary'`).
Manual check pending: `--fork-session`: what the new file holds. No fork exists among the local transcripts. If the fork copies rows with their uuids, its exchanges are rebuilt from them and, as a fresh file, left unlabelled with `N unlabelled`. Labels are not carried over in either case, which is the fallback.
Manual check pending: a rewind in a real session. After Esc Esc and a new prompt, the rewound exchanges leave the band's N within about a second. The debug log shows `marks: tail: …` only for a `tail -c` read (files over 4 MiB).

Facts for later tickets:
- 04:
  - Liveness lives in `$.state` `marks.chain` (`atom({ plugin: 'marks', key: 'chain' }, null)`).
  - Read it with `isLive(view, id)` and `isReachable(view, id, fullscreen)`, and filter with `liveView(file, view.hidden)`. Threads to show: `visibleThreads(liveView(...))`. All of these are in `mod/hooks/lib/chain.ts`.
  - A null view (before the first read), or an id the view doesn't name, means live and reachable.
  - The Unlabelled group's run is `view.unlabelled`; `unlabelledCount(file, view)` counts the live ones still unlabelled.
- 05: the transcript pass fills the row index `tracked.index[exchangeId]` (`prompts` texts, `replies` `{ uuid, text }`, `tools`) for every exchange in the transcript, pre-compaction ones included. It is a module variable in `register.tsx`, rebuilt on every load. It is not in `$.state`.
- 07: skip markers for hidden exchanges (`isLive`). `compacted` exchanges are not drawn in a resumed transcript.
- Kit and loader facts:
  - A helper in another file that takes `$` must be a `function` declaration. The loader refuses a `$` passed into an arrow function bound to a name: "past an import $ is followed only into a function declaration".
  - The test `$` has no `process` noun, so tests can't spawn real children.
  - A test stand-in for `process.spawn` is an `async function*` that yields `{ stream, text }` chunks and returns `{ value: { code, signal } }`.
  - `fs.stat`, `fs.list`, `session.root` and `session.cwd` need test hooks. Without them the pass logs `no transcript for <id>` and carries on with an empty transcript.
- Tooling: `npm run sync-types` runs `sh`, which PowerShell doesn't have. Run it from Git Bash.
