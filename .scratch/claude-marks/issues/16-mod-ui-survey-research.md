# Research: how other mods draw UI

Type: research
Status: resolved

## Question

How do existing Claude Code mods (function-hooks plugins) change the terminal UI, and does any of them get closer to a pick-and-go panel in the prompt's place than [Spike: a pick-and-go panel in the prompt's place](14-bottom-panel-spike.md) did? The user has no particular mod in mind, so this is a survey.

- Find real mods: plugins installed on this machine (`~/.claude/plugins/`), public marketplaces and GitHub repos whose `hooks/hooks.json` names `modules`, or whose code imports from `'claude-code'` and hooks `ui.render`. Note how many exist and how mature they are; the API is early access.
- For each that draws UI, record the technique: which sites (`Pane`, `AbovePrompt`, transcript rows, `AskUserQuestion`, `CommandOutput`, `PromptHint`, `Spinner`, ...), which elements (`Client`, `Raster`, `Markdown`, `Input`, `Select`, `position: absolute` overlays), how they take keys (focus, `hotkey`, `action` chords), and any trick for size or placement.
- Check the leads the spike left open against the build 2.1.299 types: a `Client` element's own surface module on the terminal (what it can draw, whether it takes keys, how big it gets); a `CommandOutput` tree drawn inline in the transcript as a pick list; a tall `AbovePrompt` band; anything that hides or replaces the prompt.

Write the findings to `research/16-mod-ui-survey.md`: a short table of mods and techniques, then a verdict on whether any route gives a pick-and-go panel at the bottom on this build, and what it would cost.

## Answer

**No route puts a panel in the prompt's place on build 2.1.299. The closest is a "band picker"**, a modal list in the band directly above the prompt, with the prompt still under it. Detail and repo links are in [research/16-mod-ui-survey.md](../research/16-mod-ui-survey.md).

- Mods: the slopshopper index (github.com/ryx2/slopshopper, 2026-10-10) lists 5,264 mods in 2,809 repos. Most are new (3,489 repos created in October 2026), and 519 have 10+ stars. On this machine only Anthropic's `code-modernization` is a mod. About 15 were read in detail. None draws in the prompt's place; Anthropic's own `diff` mod uses a pane.
- Techniques that reach the band without ctrl+x tab:
  - a `prompt.edit` hook that answers without `next`, swallowing keys while a menu shows (prompt-stack);
  - band Buttons with a borrowed engine `action` (e.g. `app:diffFileListUp`, ctrl+up/down) inside a `display="none"` Box (prompt-marks, claude-bookmarks);
  - a bare digit from an empty prompt pressing a band Button (code-modernization);
  - `prompt.submit` reading a typed number or name while a band list shows (project-hop);
  - a `ui.focus` hook turning Tab and the arrows into list steps once the band is focused (claude-x, claude-bookmarks).
- A jump from a key works only if `$.ui.scroll` is awaited inside the handler (claude-bookmarks).
- The band slot is capped at half the terminal, prompt included: about 18 rows at 45, about 5 at 18.
- Leads ruled out: a `Client` element (focus only by click, no Esc, no `$.ui.focus`; a jump from it is likely refused); a `CommandOutput` pick list (click only, its rows stay in the JSONL, scrolls away); hiding or replacing the prompt (no render site covers it).
- Untested on this build: whether `prompt.edit` fires for and can swallow every key (arrows, Enter and Esc are not edits, so the picker needs its own close key); whether a jump from `prompt.edit` or `prompt.submit` counts as the person's input; whether VS Code passes the chosen chord. Also unverified: claude-bookmarks claims `keybindings.json` accepts `command:<name>` bindings from 2.1.290, which conflicts with spike 07.
