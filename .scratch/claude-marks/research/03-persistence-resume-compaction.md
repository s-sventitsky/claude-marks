# Persistence across resume and compaction

Sources: `claude-code.d.ts` and `reference.md` from the plugin-authoring skill, build 2.1.296 (read 2026-10-11), the [Spike: row identity and jump reach](../issues/07-row-identity-jump-spike.md) findings, and the user's real transcripts under `~/.claude/projects/` (read 2026-10-11).

## The storage options

| | Lifetime | Limits | Role |
|---|---|---|---|
| Module variables | Lost on hot reload. **Kept across an in-session `/resume`** (spike). | n/a | Queues and caches only. Never the source of truth. |
| `$.state` (~L3391) | Host-held "for the session": survives a hot reload, not a new process. Reads during `ui.render` subscribe, so a `set` redraws the band, pane and markers. | JSON; can't be written while a render draws. | **The live view model** of the current conversation. |
| `$.store` (~L3358) | One JSON file per plugin under the config dir; survives everything. **Shared by every conversation.** | **4 MiB of JSON for the whole store**, every conversation together. | A small index only (conversation → data file, last opened). |
| `$.fs` file | Survives everything. | 4 MiB per read or write; `write` replaces the whole file. | **The durable data**, one file per conversation. |

Rejected: storing marks in the transcript itself via `$.session.append` system notices. They survive resume and travel with the file, but they draw as visible notice rows and can't be edited in place.

**Recommendation:** one JSON file per conversation at `<config>/claude-marks/<sessionId>.json`. `<config>` is `CLAUDE_CONFIG_DIR`, else `~/.claude` (home from `$.env.get("HOME")` / `"USERPROFILE"`). It's loaded into `$.state` on start or conversation switch and written back, debounced, after each change. Size check: ~300 bytes per exchange is ~150 KB for 500 exchanges, well under 4 MiB. `$.store` holds only `{ sessionId → { file, updatedAt } }` for cleanup.

## (1) Module reload

- `$.state` and the file survive. Module variables, pending `$.clock` timers and the labeller queue are lost.
- On load, re-read `$.state` and rebuild the queue: any prompt row in the transcript after the last labelled exchange is unlabelled (ties to the "last labelled exchange" marker noted on the data-model ticket).

## (2) `--resume` / `--continue`

- **The session id is stable across resume.** `$.session.id()` is "the transcript file's name" (~L2803). The user's spike conversation `1ebd82e3…` runs from 2026-10-04 to 2026-10-11, resumed several times (`--continue`, `/resume`), in **one file with one `sessionId`** on all 1288 rows. So `sessionId` is the storage key.
- **Exchanges are re-identified by prompt-row uuid,** which the spike confirmed equal at append, render, in the JSONL and after reload or resume. `$.session.messages()` carries no ids, so it can't be the anchor.
- **Conversation switches must be detected by the mod:**
  - In-session `/resume` fires `session.start` again but keeps module variables and, presumably, `$.state`.
  - **`/clear` fires `session.end` (reason `clear`) and continues under a new id with no `session.start`** (~L11060).
  - So compare `$.session.id()` with the id the view model was loaded for, on `session.start` and on the first `session.append` of each prompt. On mismatch, flush the old file and load (or start empty for) the new one.
- **Unverified edge, `--fork-session`:** it writes a new file under a new id (and presumably copies the rows with their uuids). The fork starts with no data. Offering to import the parent's marks is a later nicety, not a blocker.
- **Rewind (esc esc)** leaves abandoned rows in the file. The view should show only exchanges on the active chain: walk `parentUuid` back from the newest row of the JSONL, and hide labelled exchanges that are off it. That is the data model's concern.

## (3) Compaction

What the transcript shows (`1ebd82e3…`, line 753 of 1288):

- **The JSONL keeps every pre-compaction row** with its uuid. Compaction appends a `system` row of `subtype: "compact_boundary"` with `parentUuid: null`, `logicalParentUuid` (the last row before it), `compactMetadata` (`trigger`, `preTokens`, `postTokens`), and a `preservedSegment` `{ headUuid, anchorUuid, tailUuid }`: some recent messages are carried forward past the summary.
- **Navigation after compaction:**
  - Rows **after the last boundary** can be jumped to (spike).
  - Rows **before it are not drawn** in a resumed fullscreen transcript (spike), so a jump is denied (`nothing drawn under that requestId`). Their labels, bookmarks and text stay fully available from the file and the JSONL: the **portal** (reader view) is the only way to show them.
  - **Unverified:** whether the `preservedSegment` rows are drawn and reachable after the boundary, and whether a *live* (not resumed) fullscreen session still draws pre-compaction rows until restart. Treat both as "not reachable" until the build spike checks; a failed jump falls back to the portal either way.
- **Hooks:**
  - `session.compact` (~L4390) fires before any compaction (`manual`, `auto`, `plugin`, `precompute`) with `instructions` and `messages`. A hook can rewrite `instructions` to change what the summarizer keeps.
  - The boundary row arrives through `session.append` as a system notice (subtype `compact_boundary`, ~L10622). That is the moment to mark the earlier exchanges unreachable and redraw.
  - `$.session.messages()` afterwards is the live conversation (summary onward). A further reason never to anchor on it.
- **Should the mod add compaction instructions? No.** Thread data lives in the mod's file keyed by uuid, so nothing has to survive in the summary for navigation. The labeller has its own prompt and needs nothing from the summary either. Adding the thread list to the summary would put structure into Claude's context, which the map ruled out of scope. The map's one exception ("preserving the structure through compaction") is met by the file, not the summary.

## Anchoring scheme (summary)

- **Conversation key:** `sessionId` (`$.session.id()`), re-checked on `session.start` and each prompt append.
- **Exchange key:** the prompt row's uuid (`session.append` door `prompt`, `!e.agentId`; for history, `type: "user"` rows of the JSONL that are human prompts).
- **Reachability:** an exchange is jumpable if its prompt uuid is after the last `compact_boundary` (or, if confirmed, in its `preservedSegment`). Otherwise portal only.
- **Liveness:** an exchange is shown if its uuid is on the active `parentUuid` chain.
- **Transcript path** (needed for history, reachability and liveness): `<config>/projects/<slug>/<sessionId>.jsonl`. The slug is the project root with every non-alphanumeric character replaced by `-` (e.g. `E--CodeExperiments-claude-marks`). Fall back to a scan of `<config>/projects/*/` for the file name. The 4 MiB read cap is the **Long conversations** fog item on the map.
