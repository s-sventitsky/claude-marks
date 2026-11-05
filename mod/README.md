# marks

A Claude Code mod that organizes the current conversation for navigation. Each prompt you type becomes an exchange in a per-conversation data file. Later builds label exchanges into a one-level thread tree with bookmarks, and let you jump the transcript to any exchange from a side pane (`/marks`).

Status: early MVP. This build tracks exchanges (rebuilt from the transcript JSONL on every load, so earlier turns, rewinds and compactions show correctly), labels each new turn with a Haiku call (thread, gist, auto bookmarks) after the turn ends, and shows where you are above the prompt (`● Main › Sub · here #n/N`).

`/mark [#n] [note]` bookmarks Claude's latest reply (or exchange #n, as numbered in the tree) with ◆. In the pane's reader, `m` picks which reply block of the exchange holds the bookmark, or removes it.

## Load it

```sh
claude --plugin-dir /path/to/claude-marks/mod
```

Data lives in `<config>/claude-marks/<sessionId>.json`, where `<config>` is `CLAUDE_CONFIG_DIR` or `~/.claude`. Of the transcript's text it stores only each exchange's prompt excerpt (about 80 characters) and the text of manual bookmarks (your note, else about 80 characters of the message); prompts and replies themselves are read from the transcript and kept in memory. A data file not written for more than 14 days is deleted at the next session start, except the current conversation's.

## Develop

From the repository root: `npm run check` checks that `mod/hooks/lib/rules.ts` still matches the labeller prompt (`npm run rules` regenerates it), then runs `claude plugin validate mod`, `tsc -p mod` and `claude plugin test mod`. Without a session that has loaded the mod, run `npm run sync-types` first to copy the engine types into `mod/.claude-plugin/types/`.
