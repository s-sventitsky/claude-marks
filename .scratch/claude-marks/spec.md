# claude-marks: MVP spec

Status: ready to build (2026-11-04). Assembled from the resolved tickets on the [map](map.md); each section links the ticket that holds the reasoning. Vocabulary is in [CONTEXT.md](../../CONTEXT.md).

## What it is

A Claude Code mod (function-hooks plugin) that sorts the current conversation into a thread tree, one level deep (main threads, sub-threads), with bookmarks inside threads, and lets the user jump the transcript to any exchange from one list. A cheap model call labels each exchange after the turn ends. The data lives in a per-conversation file and survives resume and compaction.

The MVP is navigation for new turns: label, show where you are, list everything, jump or read. Fixing the labeller's mistakes, search, retro-labelling and settings come later.

## Target platform

- The Claude Code CLI in VS Code's integrated terminal, fullscreen layout, no tmux. Build 2.1.299 (the spikes ran on 2.1.296 and 2.1.299). Panel sizes seen: 208x43, 220x45, 135x34, 135x18, 208x9.
- The main screen (`isFullscreen === false`) is a degraded fallback, described in [Main screen](#main-screen).
- Desktop, VS Code native UI and mobile surfaces are out of scope.
- The mod API is early access. Check every call against `claude-code.d.ts` from the `plugin-authoring` skill, not against this spec's paraphrase.

## Scope

| | What | Where specced |
|---|---|---|
| **MVP** | Labeller on new turns (Haiku, hardcoded) | [Labeller](#labeller) |
| | Per-conversation data file, `$.state` mirror, transcript pass | [Data file](#data-file), [Lifecycle](#lifecycle) |
| | Band above the prompt, status-line hint | [Band](#band), [Status line](#status-line) |
| | Transient side pane: tree, Enter jumps, `p` reader, Esc | [Pane](#pane) |
| | `/mark [#n] [note]`, the reader's `m` | [Commands](#commands), [Reader](#reader) |
| | Inline thread dividers and prompt glyphs (always on) | [Inline markers](#inline-markers) |
| | Main-screen fallback | [Main screen](#main-screen) |
| **After the MVP** (decided) | Corrections and the `a` menu, range move with `v`, correction feedback to the labeller, `/marks relabel`, search, reply-glyph click to bookmark | [After the MVP](#after-the-mvp) |
| **Not decided** (map fog) | Retro-label batching, progress and cost cap; settings; labeller evaluation; the pane as a live map | [map.md](map.md), "Not yet specified" |

The MVP must not paint the later work out. In particular: keep the data fields listed in [Fields the MVP writes but doesn't use](#fields-the-mvp-writes-but-doesnt-use), leave the pane keys `a`, `v`, `/` and the reader's `n` unbound (not reused for anything else), and keep `/marks` arguments free for `relabel` and `find`.

## Components

One mod, one hooks module. Suggested split inside it:

1. **Conversation tracker.** Knows which conversation is loaded, detects switches, loads and flushes the data file.
2. **Transcript pass.** Reads the JSONL once per load and builds the in-memory row index (prompt rows, reply text rows, tool lines, parent chain, compaction boundary). Kept current from `session.append`.
3. **Labeller.** A queue of exchanges, drained by a timer, one `$.model.complete` call each, results validated and applied to the data.
4. **Store.** The data file plus its `$.state` mirror; a debounced writer.
5. **UI.** Band, status line, pane (tree and reader), transcript-row markers, commands.

Module variables hold only caches and queues (the row index, the labeller queue, the last-jump pointer). They are lost on a hot reload and rebuilt on load. `$.state` holds the live view model; render hooks may only read it ([Persistence across resume and compaction](issues/03-persistence-resume-compaction.md)).

## Data file

One JSON file per conversation at `<config>/claude-marks/<sessionId>.json`. `<config>` is `CLAUDE_CONFIG_DIR`, else `~/.claude` (home from `HOME` or `USERPROFILE`). Loaded into `$.state` on load and on a conversation switch, written back debounced (about 1 s) after each change. `$.store` holds only an index `{ [sessionId]: { file, updatedAt } }`; it is shared by all conversations and capped at 4 MiB, so it never holds the data. Sources: [Persistence across resume and compaction](issues/03-persistence-resume-compaction.md), [Data model for exchanges, threads, bookmarks and corrections](issues/05-data-model.md).

```ts
type ConversationFile = {
  schema: 1
  sessionId: string
  threads: Thread[]
  exchanges: Exchange[]          // conversation order
  corrections: Correction[]      // newest 10 only
  bookmarkStats: {
    landmark:     { flagged: number; dismissed: number }
    branch_point: { flagged: number; dismissed: number }
  }
}

type By = 'labeller' | 'user'

type Thread = {
  id: string                     // minted by the mod: "t1", "t2", ...; never reused
  label: { text: string; by: By }
  parent: string | null          // null = main thread
  mergedFrom: string[]           // ids redirected here
}

type Exchange = {
  id: string                     // uuid of the turn's first prompt row: anchor and jump target
  prompts: string[]              // uuids of prompts folded into the turn, id included
  excerpt: string                // first ~80 chars of the prompt, whitespace collapsed
  thread: { id: string; by: By } | null   // null = unlabelled
  gist: string
  bookmarks: Bookmark[]
  label: { status: 'pending' | 'done' | 'failed'; model?: string; tries?: number }
  // never stored: live, reachable (recomputed on load and after each append)
}

type Bookmark = {
  kind: 'manual' | 'branch_point' | 'landmark'   // at most one per kind per exchange
  row?: string                   // manual only: a reply text row uuid; absent = the prompt row
  text: string                   // manual: note, else ~80 chars of the message, else the gist; auto: the labeller's `why`
  dismissed?: true
}

type Correction =
  | { kind: 'bookmark_add'; exchange: string; row?: string; at: string }
  | { kind: 'bookmark_dismiss'; exchange: string; bookmark: 'branch_point' | 'landmark'; at: string }
  | { kind: 'rename' | 'move' | 'merge' | 'reparent'; at: string /* fields per After the MVP */ }
```

Rules:

- No transcript text is stored. The JSONL is the source for the reader and the labeller's backfill. About 150 KB for 500 exchanges.
- "Current thread" is derived, never stored: the thread of the latest live labelled exchange.
- `live` and `reachable` are recomputed (see [Liveness and reachability](#liveness-and-reachability)).
- Non-live exchanges are kept and hidden. A thread with no live exchanges is hidden. Both reappear if the conversation returns to that fork.
- A `by: user` value is never changed by the labeller (MVP writes none; see below).

### Fields the MVP writes but doesn't use

| Field | MVP writes | Used by (after the MVP) |
|---|---|---|
| `thread.by`, `label.by` | always `labeller` | Corrections fix values as `user`; the labeller then skips them |
| `Thread.mergedFrom` | always `[]`, but the labeller's `resume` already resolves ids through it | Merge, and moves that empty a thread |
| `corrections[]` | `bookmark_add` entries from `/mark` and the reader's `m` (newest 10) | The labeller's recent-corrections block |
| `bookmarkStats.*.flagged` | incremented per auto bookmark the labeller adds | The "flag fewer" density line |
| `bookmarkStats.*.dismissed`, `Bookmark.dismissed` | never set (no dismiss in the MVP) | Dismiss in the `a` menu |
| `label.model` | the model id the call used | Relabel decisions and cost display |
| `excerpt` | always | Search, and unlabelled rows (MVP uses it there) |

## Lifecycle

### Load and conversation switches

- On `session.start`, and on every `session.append` with door `prompt`, compare `$.session.id()` with the loaded `sessionId`. On a mismatch: flush the old file, cancel the labeller queue, clear module caches, load (or create empty) the new file, run the transcript pass.
- Why both checks: an in-session `/resume` fires `session.start` again but keeps module variables; `/clear` changes the id with no `session.start` ([Persistence across resume and compaction](issues/03-persistence-resume-compaction.md)).
- On a hot reload, `$.state` survives but module variables don't. Re-run the transcript pass and rebuild the queue.

### Transcript pass

Path: `<config>/projects/<slug>/<sessionId>.jsonl`, where the slug is the project root with every non-alphanumeric character replaced by `-`. Fall back to scanning `<config>/projects/*/` for the file name ([Persistence across resume and compaction](issues/03-persistence-resume-compaction.md)).

Reading ([Research: full-transcript search](issues/13-full-text-search-research.md)):
- `$.fs.stat` first. 4 MiB or less: one `$.fs.read`.
- Larger: stream with `$.process.spawn`. `cat` on macOS and Linux. On Windows, Git for Windows' `usr\bin\cat.exe` (three levels up from `git --exec-path`, or the fixed install path), then `cmd /c type <file>` as the fallback.
- Split lines and prefilter by substring before `JSON.parse`: keep `"type":"user"` rows without `"tool_result"`, `"type":"assistant"` rows, and `"compact_boundary"` rows.
- Run it off the hook path (from a timer after `session.start`), not inside a dispatch.

What the pass collects, per row: `uuid`, `parentUuid`, kind (human prompt, reply text block, tool_use, compact boundary), and for prompts and reply text the text itself (kept in a module-level map for the reader and the labeller; not persisted). Prompt rows are `type: "user"` rows that are human prompts: not `isMeta`, not a compact summary, not a tool result, not a slash-command or local-command wrapper (see `prototype-labeller/extract.py` for the filters that worked). Main-session rows only (`isSidechain` false).

Live updates come from `session.append` with no `agentId`:
- door `prompt`: a new prompt row (see [Exchanges](#exchanges)).
- door `response`: reply rows. Text blocks become reply text rows (their `uuid` is the row a bookmark can anchor to, [Spike: reply-message rows as bookmark anchors](issues/09-reply-row-anchor-spike.md)). `tool_use` blocks become tool lines. Skip `isMeta`.
- a `compact_boundary` system row: recompute reachability, redraw.
- door `compaction` (the summary): ignore.

`session.append` carries no `parentUuid`. When a prompt arrives whose parent chain the mod can't place (after a rewind), re-read the transcript's tail and recompute liveness.

### Exchanges

- **One exchange per turn,** anchored by the turn's first composer prompt row (`origin.kind === 'composer'` at render, `"origin":{"kind":"human"}` in the JSONL).
- A prompt appended while a turn is running (between `turn.start` and `turn.complete`) is folded into that turn's exchange: its uuid goes into `prompts[]`, and the labeller sees the prompts joined.
- Ignore rows drawn under `requestId: "placeholder"` and slash-command rows: they are not jump targets ([Spike: row identity and jump reach](issues/07-row-identity-jump-spike.md)).
- A turn with no composer prompt (started by a slash command or skill) has no prompt anchor. MVP default: anchor it on its first reply text row (jumpable per spike 09), use the command line as its prompt text, and treat it as an ordinary exchange. If it has no reply text either, skip it. This rule is not from a ticket; see [Defaults this spec set](#defaults-this-spec-set).
- On load, an exchange is built from the transcript pass for every prompt row not yet in the file, with `thread: null`, `label.status: 'pending'`.

### Liveness and reachability

Recomputed on load and after each relevant append, never stored ([Data model for exchanges, threads, bookmarks and corrections](issues/05-data-model.md)):

- **Live:** the exchange's anchor uuid is on the active `parentUuid` chain, walked back from the newest row. A `compact_boundary` row has `parentUuid: null`; continue the walk through its `logicalParentUuid`.
- **Reachable:** fullscreen, and the anchor is after the last `compact_boundary`. Treat rows in its `preservedSegment` as unreachable until the build checks them (a failed jump falls back to the reader either way). On the main screen nothing is reachable.

## Labeller

Decided in [Labeller: separate model call vs main-model self-tagging](issues/02-labeller-approach.md) and [Labeller prompt and output schema](issues/04-labeller-prototype.md).

### When it runs

- In `turn.complete`: `await next(e)`, then push the exchange onto the module-level queue and return. Never await the model inside the dispatch; it would hold the dispatch open and abort with it.
- A `$.clock` timer, started in `session.start`, drains the queue one call at a time, in conversation order. The labeller's input depends on the previous label, so calls never run in parallel.
- **Gaps on load:** find the run of live exchanges after the last labelled one. 10 or fewer: queue them all. More than 10, or a conversation that was never labelled: leave them unlabelled. They show in the tree's [Unlabelled group](#tree) and the band says `N unlabelled`. No relabel command exists in the MVP (decided 2026-11-04).

### The call

```ts
$.model.complete({
  model: 'haiku',                    // hardcoded in the MVP
  effort: 'low',
  system: undefined,
  prompt: [
    { text: RULES, cache: true },    // prompt v3, verbatim
    { text: dynamicPart },
  ],
  maxTokens: 400,
  timeoutMs: 15_000,
})
```

- `RULES` is [prototype-labeller/labeller-prompt.md](prototype-labeller/labeller-prompt.md) (v3), copied into the mod unchanged. The prototype sent it as the system prompt; sending it as the first cached prompt block is equivalent. Pick whichever the types cache; keep the rules first.
- `dynamicPart` follows `build()` in [prototype-labeller/run.py](prototype-labeller/run.py):
  - `## Threads so far`: one line per visible thread, `- <id> [main | sub of <parent>] "<label>": <last 2 gists, "; "-joined>`, with `  <- current` on the current thread. With no threads: `(none yet: this is the first exchange; use new_main)`.
  - `## Previous exchange (context only)`: `User:` the previous prompt (first 300 chars), `Claude (end of reply):` the last 1200 chars of its last reply text block.
  - `## Exchange to place`: `User:` the prompts joined (2000 chars, then `[…]`), `Claude's tool calls:` up to 15 tool lines (`<name> <first line of file_path | command | pattern | description | skill | url | query, ≤100 chars>`) or `none`, `Claude's final reply:` the last reply text block clipped to head 2000 + tail 1000.
- Measured on Haiku: ~3.2K tokens in, ~$0.0007 and ~1.2 s API time per exchange.

### Reading the reply

Expected shape:

```json
{ "thread": { "action": "continue|resume|new_main|new_sub", "id": "<for resume>", "label": "<for new_*>" },
  "bookmarks": [ { "kind": "branch_point|landmark", "why": "<≤8 words>" } ],
  "gist": "<≤10 words>" }
```

- Strip a code fence if present, take the text from the first `{` to the last `}`, `JSON.parse`, then validate. Clip `label` to 40 chars, `gist` to 80, `why` to 60. Drop unknown bookmark kinds and duplicates of a kind.
- A reply that can't be parsed or fails validation becomes `{ action: 'continue', bookmarks: [] }`, gist empty (the row shows the excerpt).

### Applying it

- `continue`: the current thread. With no threads yet, treat as `new_main`, labelled with the gist or the excerpt.
- `resume`: resolve the id through every thread's `mergedFrom`. An unknown id becomes `continue`.
- `new_main`: mint the next id, `parent: null`.
- `new_sub`: mint the next id, `parent` = the current main thread (the current thread, or its parent if it is a sub-thread). With no current thread, treat as `new_main`.
- Bookmarks: add each kind not already present on the exchange. Skip a kind that exists with `dismissed: true`. Increment `bookmarkStats[kind].flagged` per added one.
- Set `gist`, `thread: { id, by: 'labeller' }`, `label: { status: 'done', model }`.
- Never overwrite a field marked `by: 'user'` (none exist in the MVP; the check costs nothing and keeps corrections safe later).

### Failures

- `$.model.complete` resolves (doesn't reject) with `isAnswered: false` and a `reason` (`api-error`, `empty-reply`, `aborted`). Mark the exchange `failed`, keep it queued for one retry on the next drain, then leave it on `continue` (placed in the current thread, `label.status: 'failed'`).
- The call rejects when the engine refuses to send it, for example when an org allowlist blocks `haiku`. Then stop the drain for this session and show `labeller off: <reason>` in the band's hint slot. New exchanges stay pending. The fallback model is a setting, after the MVP.
- Check in the build that a completion started from a timer survives the next turn starting (open since [Labeller: separate model call vs main-model self-tagging](issues/02-labeller-approach.md)).

## UI

Colours and glyphs follow [UI: band, pane and inline markers](issues/06-ui-prototype.md):

- **Thread colour:** each main thread takes a colour from `['suggestion', 'success', 'warning', 'merged', 'planMode', 'autoAccept', 'ide', 'permission']` by its index among main threads, wrapping. A sub-thread uses its main thread's colour.
- **Glyphs:** ◆ manual, ◇ landmark, ↳ branch point, drawn in the thread's colour. The shape tells the kind.
- The prototype in [prototype-ui/hooks/register.tsx](prototype-ui/hooks/register.tsx) is a working reference for every view below (throwaway code; reuse ideas, not the file).

### Band

One line above the prompt (`AbovePrompt`):

```
● Main › Sub · here #n/N ◇ · click or /marks
```

- `● Main › Sub` in the thread's colour. A main thread shows only its label.
- `here #n/N`: in fullscreen, the exchange at the top of the viewport (the topmost exchange with a prompt or reply row on screen, from the rows' `onScreen` reports). `N` is the number of live exchanges.
- The exchange's glyphs, in the thread's colour.
- The hint: `click or /marks`. It is replaced by `N unlabelled` when there is an unlabelled run, and by `labeller off: <reason>` when the labeller stopped.
- Before the first label lands, the band shows `○ labelling… · click or /marks`. With no exchanges, it draws nothing.
- The whole band is one plain `Button`. A click opens the pane on the band's exchange.

### Status line

Only the opening hint, agents style: `/marks · N threads` (plain text, `$.ui.status`, set only when it changes).

### Pane

Decided in [UI: transient side pane](issues/15-bottom-panel-prototype.md) and [UI: band, pane and inline markers](issues/06-ui-prototype.md).

**Opening.**
- `/marks` opens it with the cursor on the exchange last jumped to (the latest exchange if there was no jump this session).
- A band click opens it on the band's exchange.
- `$.ui.open({ id, title: 'marks', focus: true, closeOnEscape: true, rows: 14 })`. The engine docks it at 110 columns or more (fullscreen); below that it sits inline above the prompt at 14 rows.

**Placement is transient.** Enter jumps and closes it. It is a pick-and-go tool, not a persistent view.

#### Tree

- Main threads in order of their first live exchange. Each is a header in its colour (bold) with counts: `<label>  <k> ex  ◆1 ◇3 ↳1`. When narrow (inline, or under 60 body columns) the counts shrink to `<k>`.
- Under a main thread, its own and its sub-threads' exchanges in conversation order, one row each: `› n glyphs gist`.
  - `›` marks the exchange last jumped to; others get a space.
  - Up to two glyphs, then the gist truncated to fit. An exchange with no gist shows its excerpt.
  - A sub-thread's header, ` └ <label>  <counts>`, goes before its first exchange. Its exchanges are indented three spaces wherever they fall.
  - Unreachable exchanges (and every exchange on the main screen) draw dim.
  - The band's exchange draws bold.
  - A pending exchange shows in the current thread with a dim `…` in the glyph slot until its label lands.
- **Unlabelled group:** exchanges with `thread: null` (a skipped run of more than 10) form a dim pseudo-thread `Unlabelled  <k>`, placed by its first exchange like any thread. Its rows show excerpts. Enter and `p` work on them as on any row.
- Pressing a thread header jumps to its first exchange.
- Each row is a plain `Button`. The cursor starts on the open's target.

#### Tree keys

| Key | Action |
|---|---|
| up/down, Tab | Move between rows |
| Enter | Reachable: `await $.ui.scroll({ to: { requestId: anchor }, block: 'start' })`, then close the pane, and remember the exchange as the last jump. Unreachable, a denied jump, or the main screen: open the reader with the reason |
| `p` | Open the reader on the focused exchange |
| Esc | Close the pane |

- Every view draws all its keys, dimmed and inert where they can't act. A pane has no catch-all key on this build, so a letter no key claims goes to the prompt, as in any engine dialog.
- Left arrow: the engine closes a focused pane and opens the agents list (`ui.close`, origin `person`, no key). Nothing can block it on 2.1.299. The pane binds nothing to left. Known limit, worth reporting upstream.
- Reserved, unbound in the MVP: `a`, `v`, `/` (tree), `n` (reader).
- Scroll then close (in that order) is the tested sequence. A jump only moves the transcript while answering the person's own input, so await it inside the press handler.

#### Reader

The pane view of one exchange's text, opened in place.

- Header: the thread path in its colour, then `· #n · i of k in thread` (counted over the main thread's family).
- The reason, when a jump isn't possible: `Before the last compaction: not on screen, so the reader shows it.` or the deny text.
- The exchange's bookmarks with their text, glyph first.
- A rule, `> ` and the prompt, a rule, then the reply text blocks as `Markdown`. Text comes from the transcript pass's map.

| Key | Action |
|---|---|
| `j` / `k` | Next / previous exchange in the main thread's family (the main thread plus its sub-threads, in tree order), as in the prototype. Dim and inert at either end |
| `g` | Jump to the exchange and close the pane (dim and inert when unreachable or on the main screen) |
| `m` | Bookmark menu (below) |
| Esc | Back to the tree, cursor on the reader's exchange. The pane keeps its keys. A second Esc closes the pane |

- Esc in the reader: a `ui.close` hook refuses the person's close (answers `{ value: undefined }`) while the reader shows, and switches to the tree. The close mark (×) behaves the same.
- `m` opens a `Select` of the exchange's reply text blocks (first ~60 chars each) plus "the whole exchange". An entry that already holds the manual bookmark shows ◆, and choosing it removes the bookmark. Choosing any other entry moves the exchange's manual bookmark there (one per exchange), then asks for an optional note in an `Input` (Enter on empty means no note). Each add writes a `bookmark_add` correction ([Command surface and corrections in the pane](issues/11-command-surface.md)).

### Inline markers

Fullscreen only ([UI: band, pane and inline markers](issues/06-ui-prototype.md)). Always on in the MVP; on/off becomes a setting later.

- **Divider:** where the thread changes between consecutive live exchanges, a coloured `── <label> ───` (sub-thread: `── └ <label> ───`) is drawn over the blank spacer row above the prompt. Not sticky: a sticky version blinked on every scroll.
- **Prompt glyph:** the exchange's first bookmark glyph replaces the `>` on the prompt line, in the thread's colour.
- Drawn from the `UserMessage` render hook, wrapping `await next(e)`. Lay the marker out against row 1, not the spacer row 0, or it lands on its own misaligned row ([Spike: row identity and jump reach](issues/07-row-identity-jump-spike.md)).
- Labels land after the row was drawn, so the hook reads `$.state` and redraws when the label arrives.
- Reply-block glyph buttons are after the MVP.

### Commands

Decided in [Command surface and corrections in the pane](issues/11-command-surface.md), trimmed by [Search in the pane](issues/12-pane-search.md).

- **`/mark [#n] [note]`**
  - No target: bookmark Claude's latest reply text block in the latest exchange (`row` = that block's uuid).
  - `#n`: bookmark exchange `n` (the number shown in the tree), anchored to its prompt row.
  - The rest of the line is the note. Without a note, the text is ~80 chars of the message, else the gist.
  - An exchange holds one manual bookmark; `/mark` on one that has it replaces it.
  - Reply: one line, e.g. `◆ #14 "chose JSON schema"`. A bad `#n` prints usage.
- **`/marks`**: opens the pane. Any argument prints `usage: /marks` in the MVP (later: `relabel [from n]`, `find [query]`).

## Main screen

Decided in [Main-screen behaviour: require fullscreen or degrade?](issues/08-main-screen-behaviour.md). The mode comes from `isFullscreen` (`command.run`'s `presentation`, or `viewport` on any drawing) and stays fixed for the session.

- Same pane and keys. It sits inline above the prompt.
- Enter opens the reader instead of jumping. `g` is dim. Every exchange draws dim.
- Footer line in the pane: `Enter opens the reader. Jumping works in fullscreen.`
- The band shows the latest exchange's thread (`latest #n/N` instead of `here`).
- No inline markers: scrollback is frozen before labels arrive.
- `/mark` works.

## Defaults this spec set

Not decided in a ticket. The builder may use them; the user can veto.

- Turns started by a slash command or skill: anchored on the first reply text row, prompt text = the command line ([Exchanges](#exchanges)).
- Labeller blocked by the engine: stop the drain, show `labeller off: <reason>` in the band.
- Thread ids `t1`, `t2`, ... in mint order. Debounced write ~1 s. Clip lengths for label, gist and why.
- Pending exchanges show in the current thread with `…`.
- Cleanup: at the first session start after a module load, data files and `$.store` index entries not written for more than 14 days are deleted, never the current conversation's (user, 2026-11-05). A conversation resumed after that starts over: its old exchanges become Unlabelled.
- Unlabelled runs over 10 go to a dim "Unlabelled" group with a band hint `N unlabelled` (user, 2026-11-04).
- Reply-block glyph clicks are after the MVP (user, 2026-11-04).

## Build-time checks

Open questions the tickets left for the build. Each has a safe fallback, so none blocks starting.

| Check | Fallback if it fails | From |
|---|---|---|
| Main screen: Enter opens the reader in the transient pane (not re-run since the pane became transient) | Adjust the pane flow; the decision stands | [UI: transient side pane](issues/15-bottom-panel-prototype.md) |
| A `$.model.complete` started from a timer survives the next turn starting | Re-queue `aborted` results | [Labeller: separate model call vs main-model self-tagging](issues/02-labeller-approach.md) |
| Cost per streamed piece of `$.process.spawn` inside the mod, and the real cost of the `cmd /c type` fallback on big files | Cache text in `<sessionId>.text.json` | [Research: full-transcript search](issues/13-full-text-search-research.md) |
| Pane redraw cost on long trees (500+ exchanges); matters more for search's type-as-you-go | Window the tree around the cursor | [Search in the pane](issues/12-pane-search.md) |
| Are `preservedSegment` rows drawn and jumpable after a compaction? Does a live (not resumed) session still draw pre-compaction rows? | Treat them as unreachable; the reader shows them | [Persistence across resume and compaction](issues/03-persistence-resume-compaction.md) |
| Reply-row jumps after a resume, and to undrawn reply rows (inferred, not run) | Bookmark falls back to the prompt row | [Spike: reply-message rows as bookmark anchors](issues/09-reply-row-anchor-spike.md) |
| `--fork-session`: what the new file holds | Fork starts with no data | [Persistence across resume and compaction](issues/03-persistence-resume-compaction.md) |
| Turns started by a slash command or skill: anchor on the first reply text row works | Skip such turns | This spec |

## After the MVP

Decided, not built in the MVP. The MVP's data and keys leave room for each.

### Corrections and the `a` menu

From [Command surface and corrections in the pane](issues/11-command-surface.md), [Data model for exchanges, threads, bookmarks and corrections](issues/05-data-model.md) and [Search in the pane](issues/12-pane-search.md) (which removed `r` and `m` from the tree).

- **Kinds**, all overwrite with `by: 'user'`, no undo:
  1. **Rename** a thread.
  2. **Move** a contiguous range of exchanges to an existing or new thread (main or sub). Also covers "split".
  3. **Merge** B into A: B's exchanges move to A, B's id goes into A's `mergedFrom`, A keeps its label and level. B's sub-threads re-parent to A if A is main, or flatten into A if A is a sub-thread.
  4. **Reparent:** promote a sub-thread, demote a main thread (its subs flatten into it), or move a sub-thread under another main thread.
  - Bookmark add and dismiss also go into `corrections[]`. Dismiss sets `dismissed: true` and increments `bookmarkStats[kind].dismissed`.
- **`a`** opens an action menu (`Select`) for the focused row:
  - Thread header: rename, merge into…, then promote to main or move under… (sub-thread), or demote under… (main thread).
  - Exchange row: move to…, bookmark, dismiss <kind> (per auto bookmark), edit note (when a manual bookmark exists), relabel from here; then a divider and the thread's actions.
- **`v`** starts a range on the focused exchange; up/down extend it within that thread as the tree draws it. While a range is active, Enter and `a` open a menu with only "move to…". Esc clears the range. Footer: `3 selected · Esc clears`. `v` is inert while a search filter is on.
- **Target picker:** a `Select` of every thread (subs indented), then "new main thread…" and "new sub-thread under <current main>…". A new entry opens an `Input` pre-filled with the first moved exchange's gist, fully selected.
- **Confirm** only merge, demote and relabel from here (`Relabel 42 exchanges (~$0.03)?`).
- **After a correction:** the cursor follows the moved item; a footer note says what changed (`moved #14–16 → Resume bug`) until the next key; after a move, the exchange after the range shows a dim `↻ relabel from here (a)` row until the pane closes.
- **Emptied threads:** a move that empties a thread drops it. If all its exchanges went to one thread, the dropped id joins that thread's `mergedFrom`.
- Unreachable exchanges take every correction. Non-live ones are hidden, so they can't be corrected. Corrections work the same on the main screen.

### Correction feedback to the labeller

From [Correction feedback loop](issues/10-correction-feedback-loop.md).

- The thread list already reflects corrections. On top, each call gets a **recent corrections** block after the cached rules: the newest 10 `corrections[]` entries, one plain-language line each (`moved "Fix resume bug" (#14–16) from sub of "Persistence" → new main "Resume bug"`), plus "these are the user's corrections; place similar exchanges the way the user would." About 150 tokens.
- No automatic relabel after a move or merge. The pane offers "relabel from here".
- When a kind has ≥3 dismissals and ≥1/3 of its flags dismissed, the prompt gets one line, e.g. "The user dismissed 5 of 12 landmarks: flag landmarks only for clear, lasting decisions."

### `/marks relabel`

`/marks relabel` and `/marks relabel from <n>` from [Command surface and corrections in the pane](issues/11-command-surface.md). Batching, progress, cost cap and partly labelled conversations are still map fog (retro-label). Relabel never overrides `by: user` and never recreates a dismissed bookmark. Once it exists, the band hint for a long unlabelled run becomes `N unlabelled · run /marks relabel`.

### Search

From [Search in the pane](issues/12-pane-search.md) and [Research: full-transcript search](issues/13-full-text-search-research.md).

- **Fields** per live exchange: thread label (and the main's, for a sub), gist, bookmark text, prompt text, reply text. No tool output.
- **Text index:** in memory, `{ uuid, exchange, kind: prompt | reply, text }`, built from the transcript pass on the first `/` of a session and kept current from `session.append`. Not persisted. Footer reads `indexing text…` until ready; structure hits show at once.
- **Matching:** case-insensitive substring; spaces split words, every word must match in the same exchange; a quoted phrase is one word. No fuzzy.
- **Opening:** `/` in the tree; `/marks find <query>` opens the pane filtered, cursor on the latest match; `/marks find` alone opens the typing state. No search from the band.
- **Typing state:** an `Input` above the tree, the tree filters live. Enter or down commits and moves the cursor onto the match nearest its previous row. Esc clears and returns to the full tree. No matches: one dim `no matches` line.
- **Filtered tree:** matching exchanges stay under their thread headers. A matching label keeps all its thread's exchanges. Each match gets one dim snippet line (`reply · …the regex in parseRow drops the trailing… +2`), except when the only hit is the gist or label (bolded in place). `/` returns to the input; Esc clears the filter; a second Esc closes. Footer: `/resume bug · 7 matches · Esc clears`.
- **On a hit:** Enter jumps to the matched row (the reply text block for a reply hit, else the prompt) and closes; unreachable hits open the reader. `p` opens the reader scrolled to the first hit with words highlighted; `n` steps hits within the exchange (wraps); `j`/`k` step matching exchanges in tree order, across threads.

### Reply-block glyph clicks

A glyph `Button` on every reply text block, using the `row1` gutter layout from [Spike: reply-message rows as bookmark anchors](issues/09-reply-row-anchor-spike.md). A click toggles the manual bookmark on that row. Clicks on transcript-row Buttons are confirmed to work ([UI: band, pane and inline markers](issues/06-ui-prototype.md)).

## Out of scope

As on the [map](map.md): feeding thread structure back to Claude; browsing across conversations; nesting deeper than one level; non-terminal surfaces; reshaping the transcript around threads (focus mode, outline, wide pane); any bottom pick-and-go panel. The mod adds no compaction instructions.
