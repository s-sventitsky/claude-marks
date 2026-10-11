# Labeller: separate model call vs main-model self-tagging

Type: research
Status: resolved

## Question

Compare the two labeller approaches on cost, latency, reliability and impact on the conversation's context:

- (a) a `$.model` call per exchange (e.g. Haiku), given the thread list and the new exchange, returning the thread assignment and bookmark flags;
- (b) the main model tagging its own replies through `prompt.compose` instructions.

Find what `$.model` offers (models, structured output, cost visibility, running off the turn's critical path) and how much of an exchange (prompt, reply text, tool calls) the labeller needs. Recommend one, and state the conditions under which the other wins.

## Answer

**(a), a separate `$.model.complete` call per exchange.** Detail in [research/02-labeller-approach.md](../research/02-labeller-approach.md).

- `$.model.complete` takes a model alias or id (allowlist-checked like `--model`), `system`, cacheable prompt blocks, `maxTokens`, `effort`, `timeoutMs`. Text only, so the labeller asks for JSON and validates it. Cost comes back as token `usage`, never dollars.
- Off the critical path: `turn.complete` enqueues the exchange and returns; a `$.clock` timer drains the queue. Labels land seconds after the reply. Work awaited inside the dispatch would be aborted with it.
- Input per exchange: prompt text, the reply's final text (head + tail), tool names with one-line targets (no results), the thread list with recent gists, recent corrections. Roughly 2–4K tokens in, ~100 out.
- (b) loses on context (the changing thread list busts the prompt cache or piles up, tags persist into compaction), on reliability (tagging competes with the task), on retro-labelling (impossible), and on scope (it feeds thread structure to Claude, which the map ruled out).
- When the other wins: a stronger model through the same call is the first fallback if Haiku labels poorly; `$.model.fork` (full context, but a cache read of the whole transcript per call) suits on-demand relabelling only; (b) only if both separate-call options fail in the prototype, and then the scope must be redrawn.
- Open for the prototype: confirm a completion started from a timer survives the next turn starting. Open for the data model: a prompt folded into a running turn makes one turn hold two prompts.
