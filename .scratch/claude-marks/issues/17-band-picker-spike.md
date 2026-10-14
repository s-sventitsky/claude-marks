# Spike: a band picker above the prompt

Type: task
Status: closed (out of scope)
Blocked by: 16

## Question

Can the band above the prompt work as a pick-and-go picker, the closest route to a bottom panel that [Research: how other mods draw UI](16-mod-ui-survey-research.md) found? Build a throwaway mod (AFK, the method of [Spike: a pick-and-go panel in the prompt's place](14-bottom-panel-spike.md)) and confirm it in the user's fullscreen VS Code terminal. Find out:

1. How tall the band gets at the viewport heights seen so far (9 to 45 rows); the cap is half the terminal, prompt included.
2. Opening: a borrowed engine `action` chord on a hidden band Button, a typed trigger, and a `command:<name>` binding in `keybindings.json` (claimed from 2.1.290, refuted by spike 07). Which of these does VS Code's terminal pass?
3. Moving and picking with no band focus: does a `prompt.edit` hook that answers without `next` fire for and swallow every letter and digit? Do bare digits from an empty prompt press band Buttons? Is a `prompt.submit` of a number or a search usable?
4. Does a `$.ui.scroll` jump awaited inside a `prompt.edit`, `prompt.submit` or band-Button handler count as the person's input and move the transcript?
5. Can the reader draw in the same band and come back? What closes the picker, since Esc never reaches it?
6. Does any of it leave rows in the JSONL or the model's context?

If the picker works, [UI: transient side pane](15-bottom-panel-prototype.md) compares it with the side pane. If it doesn't, that ticket prototypes the side pane alone.

## Comments

- 2026-10-14: ruled out of scope by the user ("let's go with side panel approach"). The transient side pane is the placement; no bottom route is pursued.
