# 01: Track exchanges into the conversation file

**What to build:** the mod's first tracer bullet. With the mod loaded, every composer prompt in the current conversation becomes an **exchange** in a per-conversation data file, and the band above the prompt shows how many there are. Nothing is labelled yet. Spec: [spec.md](../../claude-marks/spec.md), sections "Data file", "Lifecycle" ("Load and conversation switches", "Exchanges") and "Status line".

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] The mod loads as a function-hooks plugin and passes validate and tsc.
- [ ] Each composer prompt (`session.append` door `prompt`, main session only) creates an exchange keyed by the prompt row's uuid, with `excerpt`, `thread: null`, `label.status: 'pending'`. Rows drawn under `requestId: "placeholder"` are ignored.
- [ ] A prompt appended while a turn runs is folded into that turn's exchange (`prompts[]`).
- [ ] A turn started by a slash command or skill, with no composer prompt, is anchored on its first reply text row with the command line as its prompt text; with no reply text it is skipped. Confirm in the real terminal that a jump to that anchor works (build check from the spec).
- [ ] Reply text rows (their uuids and text) and tool lines (`<name> <first line of the main input>`) are kept in an in-memory row index per exchange, from `session.append` door `response`.
- [ ] The data file `<config>/claude-marks/<sessionId>.json` has the spec's `schema: 1` shape, is mirrored in `$.state`, and is written back debounced (~1 s). `$.store` holds only the `{ sessionId: { file, updatedAt } }` index.
- [ ] A conversation switch (`/clear` with no `session.start`, in-session `/resume` that keeps module variables) is detected by comparing `$.session.id()` on `session.start` and on each prompt append: the old file flushes, the new one loads or starts empty.
- [ ] The band draws one line, `#n/N`, for the latest exchange (nothing when there are no exchanges). The status line reads `/marks · 0 threads`.
- [ ] Hot reload keeps the data (from `$.state` and the file).
