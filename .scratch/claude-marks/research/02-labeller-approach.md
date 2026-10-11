# Labeller: separate model call vs main-model self-tagging

Source: `claude-code.d.ts` and `reference.md` from the plugin-authoring skill, build 2.1.296 (read 2026-10-11). Line refs are to that `claude-code.d.ts`. No dollar figures: the API reports tokens only, and prices should be read from current docs when the spec needs them.

## What `$.model` offers (~L2597)

| Call | What it is | Fit for labelling |
|---|---|---|
| `$.model.complete(req, { signal })` | One completion, no history, no tools. `model` is an alias (`haiku`) or full id, resolved and allowlist-checked like `--model`. `system`, `prompt` (string or `{ text, cache? }` blocks), `maxTokens` (default 1024), `effort` (`low`…`max`), `timeoutMs`. | **Yes.** The core of option (a). |
| `$.model.classify(text, labels, { model })` | One label from a fixed list; default model is the engine's small fast model. | Too narrow: we need a thread choice *plus* bookmark flags and a label text. Could serve a cheap yes/no pre-check, not needed. |
| `$.model.fork({ prompt })` | The main thread's last request again (same model, system prompt, messages) plus one question, tools denied. Prefix served from the main prompt cache. | Possible "option (c)": full context, but bills a cache read of the **whole transcript** per exchange on the main model. See below. |

- **Structured output: none.** Every call returns `text`. The labeller must ask for JSON, parse and validate it, and treat a bad reply as "continue current thread, no bookmarks" (or retry once).
- **Cost visibility:** every result arm carries `usage` (`ModelUsage`, ~L6431): `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`. Tokens only; a cost display needs a per-model price table in the mod.
- **Caching:** mark the fixed rules block `cache: true` and put it first. Reads within five minutes are cheap; `usage` shows whether it hit. Under the model's minimum cacheable length nothing is cached (both counts zero).
- **Failures never reject** (except a request the engine refuses to send, e.g. a blocked model): branch on `isAnswered` / `reason` (`api-error` with `status` and `error` kind, `empty-reply`, `aborted`).
- **Model availability:** resolved like `--model`, so an org allowlist or a Bedrock/Vertex setup can refuse `haiku`. The labeller model belongs in settings, with a fallback to the session's model (`$.session.model()`, ~L2794).

## Running off the turn's critical path

- A hook's 10 s budget counts only its own code: a `$.model.complete` in flight costs it nothing (~L5100, `HookBudget`).
- But work started inside a dispatch is tied to it: `next.signal` aborts when the dispatch is abandoned, and a completion then resolves `aborted` (reference.md "Work that outlives a dispatch"). Awaiting the labeller inside `turn.complete` would also hold that dispatch open.
- **Pattern:** in `turn.complete`, `await next(e)`, push the exchange onto a module-level queue and return at once. Drain the queue from a `$.clock.after` timer (timers run until cancelled or the module reloads; start the loop in `session.start`). The queue is lost on reload, so persist "last labelled exchange" and re-scan on load.
- Result: the reply appears with no added latency; the band and markers update a second or two later. **Prototype check:** confirm a `$.model.complete` made from a timer callback is not aborted when the next turn starts.

## How much of an exchange the labeller needs

Enough to judge topic and spot options/decisions, not the work itself:

- **Prompt:** the user's text in full (`turn.start` `e.text`, or the `session.append` prompt row). Cap at ~2K chars.
- **Reply:** the final visible text (`turn.complete` `e.answer`). Branch points (a reply offering options) and landmarks (something settled) live here. Head + tail, ~3K chars.
- **Tool calls:** names and one-line targets only (`Edit src/x.ts`, `Bash git commit …`), never results. A `git commit` or a written spec file is a strong landmark signal. Available from `$.session.messages()` `toolUses` or `session.append` rows.
- **Thread context:** the thread list (id, label, main/sub, parent) with the last 1–2 exchange gists per open thread, the current thread, and recent corrections.
- Estimate: ~2–4K input tokens per call (most of the fixed rules cached), ~100 output tokens.

**Data-model caveat:** a turn is not always one exchange. A prompt typed while a turn runs is folded into it. The data model must decide what that does to the "one prompt row = one exchange" anchor.

## Comparison

| | (a) separate `$.model.complete` (Haiku-class) | (b) main model self-tags via `prompt.compose` |
|---|---|---|
| **Cost** | One small call per exchange, ~2–4K in / ~100 out on a cheap model; fixed prompt cached. | A few dozen output tokens per reply on the main (expensive) model, plus the instructions and **the live thread list** in every request. |
| **Latency** | None on the turn (queued after it); labels land seconds later. | None extra, labels arrive with the reply. |
| **Reliability** | Dedicated task, validated JSON, retry possible. Quality of a small model on topic shifts is unproven (that is ticket 04). | Main model sees everything, so judgement is good, but tagging competes with the real task: skipped or malformed tags, tool-only turns with no final text, subagent turns. No retry without another turn. |
| **Context impact** | **Zero.** Claude never sees it. | Instructions + thread list in every request. The thread list changes each turn, so in the system prompt it busts the prompt cache (`prompt.section` warns of this); as an appended note it accumulates. The tags themselves sit in the transcript and survive into compaction summaries unless stripped at `session.append`, and stripping makes the model's view inconsistent with its own past output. |
| **Visible artefacts** | None. | Tags stream into the reply; hiding them needs `MessageDisplay` / `AssistantMessage` render hooks. |
| **Retro-labelling** | Works the same over old history. | **Impossible:** past replies can't be retagged. Needs (a) anyway. |
| **Scope** | Navigation only. | Feeds thread structure into Claude's context, which the map ruled **out of scope**. |

**(c) `$.model.fork`:** best judgement (full context, main model), zero context impact, but each call is a cache read of the whole transcript on the main model, and the cache lapses after five idle minutes, then it is a full re-read. Too costly per exchange; reasonable for a rare, on-demand "relabel this conversation" pass.

## Recommendation

**(a): a separate `$.model.complete` call per exchange,** small model by default (`haiku`, `effort: "low"`, `timeoutMs` ~15 s), fixed rules first and cached, JSON reply validated, queued after `turn.complete` and drained by a timer.

**When the other wins:**
- **(b)** only if both are true: small-model labels prove poor in ticket 04 *and* a stronger separate model (e.g. Sonnet through the same call) is also poor or too costly. Even then it breaks the "navigation only" scope and can't retro-label, so it would need the scope redrawn.
- **Stronger model in (a)** is the first fallback if Haiku's labels are poor: same plumbing, a setting.
- **(c) fork** wins for on-demand relabelling of a confused stretch, where full context matters and the cost is paid once.
- **Session model as labeller** when the org allowlist blocks the small model.
