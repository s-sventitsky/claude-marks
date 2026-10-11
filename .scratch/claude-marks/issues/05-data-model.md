# Data model for exchanges, threads, bookmarks and corrections

Type: grilling
Status: resolved
Blocked by: 01, 03, 07

## Question

Pin down the stored shape: how an exchange is anchored to its transcript row; thread identity, label and parent; bookmark kinds; and how rename, move and merge corrections are recorded. It must fit the persistence scheme from "Persistence across resume and compaction" and the row identity from "Mod API: can we mark transcript rows and jump to them?".

## Comments

- 2026-10-11, from [Spike: row identity and jump reach](07-row-identity-jump-spike.md):
  - **Anchor an exchange by its prompt row's uuid:** the same at append, render and in the JSONL, and across reload and resume. Ignore `requestId: "placeholder"` and slash-command rows.
  - **Exchanges before the last compaction are not drawn after a resume,** so the model needs a "not reachable" state.
  - **Key all data by conversation:** `$.store` is global.

## Comments

- 2026-10-11, from [Labeller: separate model call vs main-model self-tagging](02-labeller-approach.md): a prompt typed while a turn runs is folded into that turn, so one turn can hold two prompt rows. Decide whether that is one exchange or two. The labeller queue is lost on module reload, so the model needs a "last labelled exchange" marker to resume from.
- 2026-10-11, from [Persistence across resume and compaction](03-persistence-resume-compaction.md): one file per conversation keyed by `sessionId`, mirrored in `$.state`. The model needs per-exchange **reachability** (prompt uuid after the last `compact_boundary`, or in its `preservedSegment`) and **liveness** (on the active `parentUuid` chain, so a rewind hides abandoned exchanges). Detail in [research/03-persistence-resume-compaction.md](../research/03-persistence-resume-compaction.md).

## Answer

Grilled with the user on 2026-10-11.

**Conversation file** (`<config>/claude-marks/<sessionId>.json`, mirrored in `$.state`):

```
{ schema: 1, sessionId,
  threads:     [Thread],
  exchanges:   [Exchange],      // conversation order
  corrections: [Correction] }   // newest 10 only, examples for the labeller
```

**Exchange: one per turn.**
- `id`: the turn's first prompt uuid (anchor and jump target). `prompts[]` holds the uuids of prompts typed mid-turn and folded into it; markers draw on all of them, and the labeller sees the prompts joined.
- `excerpt`: the first ~80 chars of the prompt, whitespace collapsed (shown when unlabelled, searchable in the pane).
- `thread: {id, by: labeller|user}`, `gist`, `bookmarks[]`.
- `label: {status: pending|done|failed, model}`.
- `live` (on the active `parentUuid` chain) and `reachable` (after the last `compact_boundary` or in its preserved segment) are **recomputed** on load and after each append, never trusted from storage.
  - Abandoned (non-live) exchanges are **kept, hidden**; a thread with no live exchanges is hidden. They reappear if the conversation returns to that fork.
  - Unreachable exchanges show dimmed and open in the portal instead of jumping.
- No full text: the JSONL is the source for the portal and relabelling, read by uuid. ~100–150 KB for 500 exchanges.

**Thread**
- `id` (mod-minted), `label: {text, by}`, `parent` (null = main), `mergedFrom[]`.
- "Current thread" is derived from the latest live exchange, not stored.
- Colours and glyphs belong to [UI: band, pane and inline markers](06-ui-prototype.md).

**Bookmark: anchored to `{exchange, row?}`.**
- `{kind: manual|branch_point|landmark, row?, text, dismissed?}`, at most one per kind per exchange.
- `row` is one of Claude's reply messages (a text row), for **manual** bookmarks only; without it the jump goes to the prompt row, and it also falls back there if the row can't be found. Tool rows and tool groups can't be marked (no render hook).
- Clicking the glyph marks the row clicked; `/mark <note>` with no target marks Claude's **latest message** in the latest exchange.
- Text: manual = the note, else ~80 chars of the message, else the gist; auto = the labeller's `why`.
- Deleting an auto bookmark sets `dismissed: true` so a relabel won't recreate it.
- Unverified: that `AssistantMessage.requestId` equals the reply row's JSONL uuid and that a jump reaches it. See [Spike: reply-message rows as bookmark anchors](09-reply-row-anchor-spike.md).

**Corrections: overwrite plus a `by` flag, no undo.**
- A `by: user` value is fixed: the labeller and relabels never change it.
- Four kinds:
  1. **Rename** a thread.
  2. **Move** a contiguous range of exchanges to an existing thread or a new one (main or sub). This also covers "split".
  3. **Merge** B into A. B's exchanges move to A. B's id goes into A's `mergedFrom[]` (a later labeller `resume B` is redirected to A). A keeps its label and level. B's sub-threads re-parent to A if A is main, or flatten into A if A is a sub-thread. Any pair can merge.
  4. **Reparent**: promote a sub-thread, demote a main thread (its own sub-threads flatten into it), or move a sub-thread under another main thread.
- Bookmark add and dismiss edits are not thread corrections, but go into the recent-corrections list (useful for landmark density).
- The list holds the newest 10 entries such as `{kind: move, exchange, from, to}`. How the labeller uses them is [Correction feedback loop](10-correction-feedback-loop.md).

**Labelling progress: no global cursor.**
- On load, the mod finds the unlabelled run of live exchanges after the last labelled one.
  - **≤ 10:** queued automatically.
  - **Larger, or a never-labelled conversation:** left alone; the band shows "N unlabelled · run /marks relabel".
- A failed call (API error) is marked `failed` and retried once on the next drain, then stays `continue` until a relabel. Unparseable replies already fall back to `continue`.
