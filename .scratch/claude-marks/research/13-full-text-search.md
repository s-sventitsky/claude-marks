# Full-transcript search

Sources: `claude-code.d.ts` from the plugin-authoring skill, build 2.1.299 (read 2026-10-14; line refs are to that file), the spike findings in [07](../issues/07-row-identity-jump-spike.md) and [09](../issues/09-reply-row-anchor-spike.md), [research/03](03-persistence-resume-compaction.md), and measurements on the user's 81 main-session transcripts under `~/.claude/projects/` (2026-10-14, Windows 11, node 24 as a stand-in for the mod's environment; read only, no content copied).

## What the API gives

| Need | API fact | Ref |
|---|---|---|
| Read the JSONL whole | `$.fs.read(path)` returns the whole file; **no offset or length option**. Over 4 MiB rejects. | ~L3279, `FsReadCall` ~L5047 |
| Read it in pieces | No `$.fs` slice read. `$.process.run` returns at most 4 MiB of stdout (`isStdoutTruncated`). **`$.process.spawn` streams stdout with no cap** (back-pressure at 1 MiB unread). Both: argv, no shell, CLI only. | ~L3552-3612, ~L8125, ~L8172 |
| Live text | `session.append` gives each row's `uuid`, `door` (`prompt`, `response`, `compaction`, ...), `agentId` (absent on main) and `message.content` blocks with `isMeta`. **No `parentUuid`** ("parent links" are not on `e`). | ~L10809-10935 |
| History via the session | `$.session.messages()`: newest 4096 entries, **no ids**. Not usable for search hits. | ~L2768 |
| Search box | `Input` with `onInput` (every change) and `onSubmit` (Enter), in a pane or the band. | ~L5550 |
| Jump | `$.ui.scroll({ to: { requestId } })` to a transcript row, only while answering the person's input; `{ key }` scrolls to one of the mod's own elements in a pane. A row taller than the window shows its top. | ~L14735-14765, ~L14912 |
| Time | A hook's own time is capped at 10 s; time inside `$` calls (a `$.process` stream, `$.fs.read`) doesn't count. | `HookBudget` ~L5180 |

## Tools on the user's Windows machine

`$.process` has no shell, so `argv[0]` resolves against the Claude process's own `PATH` (the Windows one, not Git Bash's).

- **Not on PATH:** `rg`, `tail`, `grep`, `cat`. `bash` resolves to `C:\Windows\system32\bash.exe` (WSL), not Git Bash.
- **Present by absolute path:** Git for Windows' `C:\Program Files\Git\usr\bin\{cat,grep,tail}.exe`. Only `Git\cmd` (git.exe) is on PATH, so the mod would find `usr\bin` from `git --exec-path` (`…/mingw64/libexec/git-core`, three levels up) or the fixed install path.
- **Always present on Windows:** `cmd /c type <file>` and `findstr`.
- **Claude Code's own ripgrep** is embedded in `claude.exe` (native build) and not exposed: `claude.exe --ripgrep --version` just prints the Claude version.
- macOS and Linux have `cat`, `grep` and `tail` on PATH.

## Measurements (81 main-session transcripts)

**Sizes.** 18 of 81 transcripts are over 4 MiB. The largest is 83.8 MB (22,901 rows, 20 compactions). The next are 27.4, 16.4 and 11.3 MB.

**Searchable text is about 1% of the file.** Prompts plus reply text blocks are 0.2-3.2% of file bytes (median 0.9%). In the 84 MB file they are 472 KB (82 KB prompts, 390 KB replies). Across all 81 files the most is 472 KB. A looser filter (every user row without a tool result, meta rows included) gives 1.2 M characters. The rest is mostly tool results and the structured `toolUseResult` copies (22.6 MB), attachments, file-history snapshots and base64 media. Tool input and output text is 5-15× the prose (6.6 MB in the 84 MB file).

**Most text in a long conversation is before the last compaction.** Text after the last boundary: 11 KB of 472 KB (84 MB file), 12 of 339, 23 of 215, 50 of 151. Bytes after the last boundary in the 18 big files are 0.6-5.5 MB. 13 of 15 with a boundary are under 4 MiB; 3 have no boundary (6-11 MB, all reachable).

**Reading and searching** (84 MB file / 11.3 MB file):

| Method | 84 MB | 11.3 MB | Notes |
|---|---|---|---|
| Git `cat.exe` streamed | 252 ms, 1,341 pieces | 93 ms, 182 pieces | Fast. Needs Git for Windows. |
| `cmd /c type` streamed | 5.4 s, 228,157 pieces | — | Always there, but tiny writes. Each piece crosses into the mod (overhead not measured), so expect worse. |
| `cmd /c type` + prefilter + parse text rows | 10.8 s | 2.0 s | Same, end to end (node). |
| read + `JSON.parse` every row | 1.7 s | 137 ms | Parse cost if every row is parsed. |
| Prefilter, then parse only text rows | 1,152 rows parsed of 22,901 | 476 of 4,282 | A substring check before `JSON.parse` skips 95% of rows. |
| Git `grep -F -i <query>` over the JSONL | 460-665 ms, 50 lines | 86-95 ms, 22 lines | Raw lines: 50 matching lines vs 6 real text hits (the rest are tool output and metadata). Lines run up to 1.2 MB each. |
| `findstr /i /c:<query>` | 665 ms | 106 ms | Same false hits; not UTF-8 aware for case. |
| Git `tail -c 4000000` | 101 ms | 57 ms | Covers the post-boundary part in 13 of 15 compacted big files. |
| **In-memory substring search, 1.24 M chars** | **2 ms** (pre-lowercased), 8 ms (lowercasing per query) | 0.5 / 2 ms | One pass over an array of `[uuid, text]`. |

## Option A: search the JSONL on each query

Rejected. Each search re-reads megabytes, gives 8× false hits from tool output and metadata (every line must be parsed and checked anyway), needs Git's `grep` or `findstr`'s quirks on Windows, and takes 0.5-0.7 s on the big file. Too slow to type into, and no simpler than an index.

## Option B: an in-memory text index (recommended)

- **Shape:** one entry per searchable row, `{ uuid, exchange, kind: prompt | reply, text }`, held in module variables. Text is lowercased once for matching.
- **Live:** append on `session.append` doors `prompt` and `response` with `!e.agentId`, text blocks only, skipping `isMeta` rows and door `compaction` (the summary).
- **Backfill** on the first pane open (or idle after `session.start`), off the hook path, with "indexing…" in the pane:
  - `$.fs.stat` the transcript. If it is 4 MiB or less (63 of 81 files), use one `$.fs.read`.
  - Otherwise stream it with `$.process.spawn`: `cat` on macOS and Linux, Git's `usr\bin\cat.exe` on Windows, and `cmd /c type` as the last fallback.
  - Split lines, prefilter by substring (`"type":"assistant"` with `"type":"text"`, or `"type":"user"` without `"tool_result"`), and `JSON.parse` only those lines.
  - This costs about 0.3-0.5 s with `cat` (0.25 s of streaming plus line splitting) or 2-11 s with the `cmd /c type` fallback (11 MB / 84 MB files). A module reload or a new process repeats it.
- **Persistence: none.** The JSONL is the source of truth. Copying 0.5-1.2 MB of text into the conversation file would make it about 5× larger, and `$.fs.write` rewrites the whole file on every debounced save. `$.store` (4 MiB shared by all conversations) is out. If the `cmd /c type` fallback proves too slow in the mod, a separate `<sessionId>.text.json` cache is the fix, not the main file.
- **Same pass, shared:** the same pass can collect each row's `uuid`, `parentUuid`, `type` and boundary markers for the active-chain and reachability checks ([research/03](03-persistence-resume-compaction.md)). It is also where the portal gets the text of unreachable exchanges.
- **Scope:** prompts and reply text only. Tool output is 5-15× larger, mostly noise for "where did we talk about X", and its rows don't map to a useful jump target (tool groups render collapsed, as spike 07 found). Tool output stays a later option.
- **Rewinds:** the JSONL and `session.append` both include abandoned branches. A hit maps to its exchange, and non-live exchanges follow the pane's rule for hidden ones ([Search in the pane](../issues/12-pane-search.md)).

## Where a hit opens

- **Reachable hit (after the last compaction):**
  - In a prompt, Enter jumps to the prompt row's uuid.
  - **In a reply, Enter jumps to that reply text block's own row:** each text block is its own row under its JSONL `uuid`, and `uuid` is the only id a jump accepts (spike 09).
  - The jump lands on the row's top (`block: 'start'`). A block taller than the window shows its top, so the matched words may be below the fold. A gutter glyph on the hit row (the `row1` layout from spike 09) can mark it, but highlighting the words inside the engine's own row was not checked.
- **Unreachable hit (before the last compaction):** opens in the portal. The portal draws the text itself, so it can scroll to the hit block with `$.ui.scroll({ to: { key }, in: paneId })` and highlight the matched words.
- In a long conversation **most hits are unreachable** (98% of the 84 MB file's text is before its last boundary). The portal is the main path there, not a fallback.
- Still unverified (from research/03; a failed jump falls back to the portal either way): whether `preservedSegment` rows are drawn after the boundary, and whether a live (not resumed) session still draws pre-compaction rows.
- On the main screen, Enter opens the portal for every hit ([Main-screen behaviour](../issues/08-main-screen-behaviour.md)).

## Latency: type-as-you-search vs search-on-Enter

- With the index in memory, a query over the largest conversation takes 2-8 ms (node). That is well inside a keystroke and far below the 10 s hook budget. **Type-as-you-search works**: `Input` `onInput` updates an atom, and the pane redraws the results. Cap the shown results (e.g. 50) so the redraw stays small. Pane redraw cost was not measured.
- Search-on-Enter is needed only without an index (option A, 0.5-0.7 s per query on 84 MB). With the index it gains nothing.
- The one slow step is the first backfill on a big transcript. Run it once per process, in the background, with a progress line. Structure search ([Search in the pane](../issues/12-pane-search.md)) works at once, and text hits join when the index is ready.

## Recommendation

**Feasible with limits.** Build it as an in-memory index of prompt and reply text: backfilled once from the JSONL, then kept current from `session.append`. Search as you type. Reachable hits jump to the exact prompt or reply-block row; pre-compaction hits, which are most hits in long conversations, open in the portal at the matched block. The limits:

- Tool output is not searched.
- A jump lands on the row's top, not on the matched words.
- On Windows the fast backfill needs Git for Windows' `cat.exe`. Without it, `cmd /c type` takes seconds on very large transcripts.
- The mod's own per-piece stream overhead is not yet measured; check it in the build.

## What this settles for "Long conversations"

- **Reading a transcript over 4 MiB:** `$.fs.read` has no offset, so there is no piecewise read through `$.fs`. `$.process.run` + `tail` is capped at 4 MiB of stdout and isn't on the Windows PATH. **The way is `$.process.spawn` streaming `cat`** (Git's `usr\bin\cat.exe` on Windows, `cmd /c type` as the fallback), parsed line by line with a substring prefilter. Use `$.fs.read` whole when the file is 4 MiB or less (63 of 81 of the user's transcripts).
- **One shared transcript pass** collects the search text, the uuid and parent chain for liveness, and compaction boundaries for reachability. After that, `session.append` keeps it current. `session.append` lacks `parentUuid`, so a rewind still needs a re-read: a tail is enough, since rows are appended in order.
- **Performance is not a blocker:** 84 MB streams in about 0.25 s, and the searchable text is under 1.3 M characters even there.
- **Still open for the build:** the `$.process.spawn` per-piece overhead inside the mod, and the `cmd /c type` fallback's real cost there.
- `$.session.messages()` (4096 entries, no ids) plays no part.
