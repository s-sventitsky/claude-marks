# Mod API: can we mark transcript rows and jump to them?

Type: research
Status: resolved

## Question

Using the plugin-authoring types for this build, establish exactly how the mod would:

- Identify an exchange's prompt row stably (`ui.render` on `UserMessage`: what identity does a row carry, and does it survive a module reload and a resume?).
- Draw a clickable inline marker on that row, with a hover `scope` shared with pane entries.
- Scroll the transcript to that row from a click in the pane or band. `$.ui.scroll` says "a transcript row moves only while this call answers the person's own input": confirm a pane button press qualifies, and note fullscreen vs non-fullscreen differences.
- Run a side pane and an `AbovePrompt` band at the same time, and their width constraints.

Output: a markdown summary linked from this ticket, with a minimal code shape for each, and any blocker that changes the design.

## Answer

Summary: [research/01-mod-api-navigation.md](../research/01-mod-api-navigation.md)

- **Identity:** a `UserMessage` render's `e.requestId` is the message id. `session.append` gives each stored row a `uuid`, the same in the transcript file and on every later read. Both are engine ids, so they survive reload and resume. Filter prompts with `origin.kind === 'composer'`. `$.session.messages()` carries **no** ids.
- **Marker:** wrap `await next(e)` with a gutter `Button`/glyph. A `scope` string shares hover between the transcript mark and the pane/band rows (pure styling). Clicks are reported only in the **fullscreen** terminal.
- **Jump:** `$.ui.scroll({ to: { requestId }, block: 'start' })` from a pane/band `onPress`. A press counts as the person's input. Fullscreen only: the main screen's transcript is native scrollback, so expect `deny`. Reach is limited to rows the transcript keeps drawn.
- **Pane + band:** independent sites, both live at once. The pane docks in fullscreen from 110 columns, otherwise it sits inline above the prompt. Open it from `/marks` (unasked opens wait below 144 columns). The band is `bodyColumns` wide (its column minus 5) and capped at half the rows.

Blockers that change the design: navigation is fullscreen-only; retro-labelling needs uuids from the transcript JSONL or from rendered rows; `requestId === uuid` and jump reach are still unverified (new spike ticket).
