# Spike: reply-message rows as bookmark anchors

Type: task
Status: resolved

## Question

[Data model for exchanges, threads, bookmarks and corrections](05-data-model.md) lets a manual bookmark point at one of Claude's reply messages. Confirm AFK, with the same throwaway-mod method as [Spike: row identity and jump reach](07-row-identity-jump-spike.md), in the user's fullscreen VS Code terminal:

1. Does an `AssistantMessage` render's `requestId` equal that reply row's `uuid` in `session.append` and in the transcript JSONL, and stay equal after reload and resume?
2. Does `$.ui.scroll({ to: { requestId }, block: 'start' })` reach a reply row, including one not yet drawn?
3. Is one reply with several text blocks (around tool calls) several rows with distinct uuids, and can a glyph be drawn on each?

If any answer is no, record the fallback: manual bookmarks stay exchange-level.

## Comments

- 2026-10-11: Offline check of this conversation's transcript JSONL: **an assistant reply is stored as one row per content block** (thinking, text, tool_use), each with its own `uuid`. Rows from one API response share `message.id` (`msg_…`) and the row-level `requestId` (`req_…`). So there are three candidate ids for an `AssistantMessage` render. The types say only "the message id for a message" and describe `AssistantMessage` as "one block of an assistant reply". `session.append` (door `response`) carries the row `uuid` but not `message.id`.
- 2026-10-11: The spike mod `marks-reply-spike` is at `~/.claude/dev-mods/ec0d3ac6-68ec-4e89-ac81-0f131be18218/marks-reply-spike/`. It passes validate and tsc. Each session writes its facts to `research/spike-09/log-<sessionStart>.json`: every render id classified against append uuids and JSONL uuid / msgId / reqId, replies with several text blocks, jumps and presses. `/rspike` opens a focused pane with one jump button per reply text row from the JSONL (`UNDRAWN` marks rows not drawn yet). `k` cycles the id kind for jumps (uuid → msgId → reqId), `g` cycles the glyph layout (row1 → row → off), and `d` dumps the log. A ◇ glyph Button is drawn on every reply block. The user runs the checklist (HITL: real terminal, mouse, resume).
- 2026-10-11, run 1 (this conversation, VS Code terminal, 119x46 with the pane docked, `isFullscreen: true`): `/rspike` loaded 64 assistant rows from the JSONL. The user jumped by each id kind and took `research/spike-09/glyphs.png`, then exited. No `--continue` run was logged (only one log file).

## Answer

Assets: the spike mod `~/.claude/dev-mods/ec0d3ac6-68ec-4e89-ac81-0f131be18218/marks-reply-spike/` (throwaway). The log and screenshot are in [research/spike-09/](../research/spike-09/). Build 2.1.296.

**Yes: a manual bookmark can anchor to one of Claude's reply blocks, by that block's row `uuid`.**

1. **Identity: yes.**
   - All 16 `AssistantMessage` renders were drawn under the `uuid` of their JSONL row. None used the API `message.id` (`msg_…`) or the row's `requestId` (`req_…`).
   - Both reply text rows appended live through `session.append` (door `response`) were drawn under their append `uuid`.
   - The other appends (thinking, tool_use) draw no `AssistantMessage` row.
   - Rows written before the mod loaded were drawn under their JSONL uuids too, so the id comes from the stored row, not from the live session.
   - **Resume was not exercised in this run.** It is inferred: a resumed transcript is rebuilt from the same JSONL, and [Spike: row identity and jump reach](07-row-identity-jump-spike.md) showed prompt uuids surviving `--continue` and `/resume`.
2. **Jump: yes, by `uuid` only.**
   - `$.ui.scroll({ to: { requestId: uuid }, block: 'start' })` reached reply rows 4 out of 4 times, including rows from much earlier in the conversation.
   - Jumps by `msg_…` and by `req_…` were each denied 2 out of 2 times, with `nothing drawn under that requestId` (user confirmed: "only uuid accepted to navigate").
   - A jump to a reply row that was not yet drawn was not isolated: all 12 text rows had been drawn by the time of the dump. It is inferred from spike 07, where a jump reached every row after the last compaction, drawn or not, through the same mechanism.
3. **Several text blocks: yes.**
   - A reply with text around tool calls is several rows: one `AssistantMessage` per text block, each with a distinct `uuid`.
   - The text blocks of the multi-block turns also had distinct `msg_…` ids. Each tool step is a new API response, so `msg_…` can't group a reply either.
   - A ◇ glyph drew on every reply block. With the `row1` gutter (a blank row, then the glyph) it sits on the block's first line, beside the engine's bullet (screenshot).
   - No click on a reply-block glyph was recorded in this run. Clicks on transcript-row Buttons were confirmed in [UI: band, pane and inline markers](06-ui-prototype.md).

Consequences for the build:
- A bookmark's `row` (see [Data model for exchanges, threads, bookmarks and corrections](05-data-model.md)) is the reply text row's `uuid`, taken from `session.append` door `response` or read from the JSONL.
- Thinking and tool_use rows are not anchors.
- A reply-block glyph uses the `row1` gutter layout.
- The fallback (exchange-level manual bookmarks only) is not needed.
