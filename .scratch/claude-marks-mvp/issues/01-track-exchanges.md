# 01: Track exchanges into the conversation file

**What to build:** the mod's first tracer bullet. With the mod loaded, every composer prompt in the current conversation becomes an **exchange** in a per-conversation data file, and the band above the prompt shows how many there are. Nothing is labelled yet. Spec: [spec.md](../../claude-marks/spec.md), sections "Data file", "Lifecycle" ("Load and conversation switches", "Exchanges") and "Status line".

**Blocked by:** None (can start immediately)

**Status:** implemented (pending merge)

- [x] The mod loads as a function-hooks plugin and passes validate and tsc.
- [x] Each composer prompt (`session.append` door `prompt`, main session only) creates an exchange keyed by the prompt row's uuid, with `excerpt`, `thread: null`, `label.status: 'pending'`. Rows drawn under `requestId: "placeholder"` are ignored.
- [x] A prompt appended while a turn runs is folded into that turn's exchange (`prompts[]`).
- [x] A turn started by a slash command or skill, with no composer prompt, is anchored on its first reply text row with the command line as its prompt text; with no reply text it is skipped. Confirm in the real terminal that a jump to that anchor works (build check from the spec).
- [x] Reply text rows (their uuids and text) and tool lines (`<name> <first line of the main input>`) are kept in an in-memory row index per exchange, from `session.append` door `response`.
- [x] The data file `<config>/claude-marks/<sessionId>.json` has the spec's `schema: 1` shape, is mirrored in `$.state`, and is written back debounced (~1 s). `$.store` holds only the `{ sessionId: { file, updatedAt } }` index.
- [x] A conversation switch (`/clear` with no `session.start`, in-session `/resume` that keeps module variables) is detected by comparing `$.session.id()` on `session.start` and on each prompt append: the old file flushes, the new one loads or starts empty.
- [x] The band draws one line, `#n/N`, for the latest exchange (nothing when there are no exchanges). The status line reads `/marks · 0 threads`.
- [x] Hot reload keeps the data (from `$.state` and the file).

## Comments

Implemented on branch `mvp-01` (2026-11-04). Foundation for later tickets: `mod/` plugin, pure logic in `mod/hooks/lib/` (model, rows, tracker, band, paths), thin adapters in `mod/hooks/register.tsx`, data model in `mod/types/index.d.ts`, tests in `mod/tests/` (`npm run check` from the repo root).

Deviations and notes:
- Plugin name is `marks`, not `claude-marks`: `claude plugin validate` refuses names starting with `claude-` as reserved. The PluginState key and atom `plugin` are `marks`. The data folder stays `<config>/claude-marks/`.
- `requestId: "placeholder"`: this ticket draws no transcript rows (only the band), so there is nothing to skip yet. Ticket 07 must skip it in its `UserMessage` render hook.
- Mid-turn prompts: a `prompt.submit` with `origin.kind === 'composer'` and `turnId` set records the typed text; the next `queued_command` attachment row of that turn folds in with that text. A `queued_command` nobody typed (a notification) is ignored. A door-`prompt` composer row during a running turn also folds.
- Slash/skill turns: the command line comes from `prompt.submit`'s `command` (only when no turn runs). It is used only if the turn gets no composer prompt; a composer prompt clears it, and so does `turn.complete`.
- Switch detection: on `session.start`, on each prompt append, and 250 ms after `session.end` with reason `clear` or `resume` (so `/clear` is picked up without a prompt). `session.end` flushes before `next`. The labeller timer tick check (decision 2) is left to ticket 02.
- Events other than prompt appends apply to the loaded conversation at once, without awaiting `$.session.id()`, so they keep their order.
- Kit facts: the engine hands fs hooks backslash paths on Windows; the test `$` has no `state`/`store` nouns, so `tests/harness.ts` observes `state.set` (passing through to the kit) and keeps the store in memory; `ui.render` needs a test bottom that returns an element.

Manual check pending: a jump to a slash-command or skill turn's anchor (its first reply text row) works in the real terminal (`$.ui.scroll({ to: { requestId: <reply uuid> }, block: 'start' })`). No jump UI exists until ticket 04.
Manual check pending: the live shape of a prompt typed during a running turn. The debug log (`claude --debug`) prints `marks: queued_command door=... type=... origin=...`; confirm it arrives as an attachment row named `queued_command` after a composer `prompt.submit` with `turnId`, and that it folds into the turn's exchange.
Manual check pending: in a real session, `/clear` and in-session `/resume` switch the data file (old file flushed, band shows the new conversation's count), and a hot reload (save a file under `mod/`) keeps `#n/N`.
Manual check pending: slash-command and skill turns do not also arrive as door-`prompt` composer rows that would make a second exchange (wrapper rows starting `<command-` or `<local-command` are filtered).
