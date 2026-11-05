# marks

A Claude Code mod that organizes the current conversation for navigation. Each prompt you type becomes an exchange in a per-conversation data file. Later builds label exchanges into a one-level thread tree with bookmarks, and let you jump the transcript to any exchange from a side pane (`/marks`).

Status: early MVP. This build tracks exchanges, labels each new turn with a Haiku call (thread, gist, auto bookmarks) after the turn ends, and shows where you are above the prompt (`● Main › Sub · here #n/N`).

## Load it

```sh
claude --plugin-dir /path/to/claude-marks/mod
```

Data lives in `<config>/claude-marks/<sessionId>.json`, where `<config>` is `CLAUDE_CONFIG_DIR` or `~/.claude`. No transcript text is stored there.

## Develop

From the repository root: `npm run check` checks that `mod/hooks/lib/rules.ts` still matches the labeller prompt (`npm run rules` regenerates it), then runs `claude plugin validate mod`, `tsc -p mod` and `claude plugin test mod`. Without a session that has loaded the mod, run `npm run sync-types` first to copy the engine types into `mod/.claude-plugin/types/`.
