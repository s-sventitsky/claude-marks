# Labeller prompt and output schema

Type: prototype
Status: resolved
Blocked by: 02

## Question

Does the chosen labeller produce threads and bookmarks that feel right? Draft the labeller prompt and output schema (continue thread / new main thread / new sub-thread / return to main; branch point; landmark; thread label text), run it over real transcripts, including the charting session of this map, and review the result with the user.

## Comments

- 2026-10-11, from [Labeller: separate model call vs main-model self-tagging](02-labeller-approach.md): the labeller is a `$.model.complete` call (default `haiku`, `effort: "low"`), JSON reply, fixed rules first and cached. Inputs are listed in [research/02-labeller-approach.md](../research/02-labeller-approach.md). If Haiku's labels feel wrong, try a stronger model through the same call before anything else. Also confirm a completion started from a `$.clock` timer isn't aborted when the next turn starts.

## Answer

Reviewed with the user on 2026-10-11. **Verdict: prompt v3 is good enough to spec from**, with the caveat that four conversations is a small sample.

Assets (throwaway; not a git repo, so kept in place and marked PROTOTYPE): [prototype-labeller/](../prototype-labeller/)
- `labeller-prompt.md`: the v3 prompt (`.v1`, `.v2`, `.v3` copies kept for comparison).
- `extract.py`: transcript JSONL → exchanges.
- `run.py`: runs the labeller, one `claude -p --model haiku --effort low` call per exchange, as a stand-in for `$.model.complete`.
- `viewer.html` (built by `build-viewer.py`): the four conversations, per prompt version.

**Schema** (one JSON object per exchange):

```json
{ "thread": { "action": "continue|resume|new_main|new_sub", "id": "<for resume>", "label": "<for new_*>" },
  "bookmarks": [ { "kind": "branch_point|landmark", "why": "<≤8 words>" } ],
  "gist": "<≤10 words>" }
```

- `new_sub` nests under the current main thread. Thread ids are minted by the mod, not the model.
- A reply that can't be parsed falls back to `continue` with no bookmarks.

**Input per call:**
- the thread list (id, main/sub, label, last 2 gists, which one is current);
- the previous exchange (prompt, last ~1200 chars of the reply), so terse answers like "yes" or "2. b" can be placed;
- this exchange: prompt (≤2000 chars), up to 15 tool lines, reply head + tail (≤3000 chars).

**Measured** (Haiku 5.5, 48 exchanges × 3 versions):
- ~3.2K tokens in, ~$0.0007 per exchange (CLI-reported);
- ~4 s per call including CLI start-up; API time ~1.2 s;
- no unparseable replies.

**What the user settled:**
- **Threads:** v3 is "somewhat okay": Linear, OKF and docs split correctly, with resumes and sub-threads.
- **Detours inside a task** (a side problem being chased, an idea raised mid-task) get their own sub-thread.
- **"What's next?" / choosing the next work** starts a new main thread.
- **Landmarks:** mark every settled decision for now (dense is fine), and tune it if it becomes noise.
- **Labels and gists:** brief as they are now.

**What changed v1 → v3:**
- v1 rarely split and flagged most exchanges as bookmarks.
- v2 added "would the user look for this under the current label?", resume rules, stricter bookmark definitions and a gist style.
- v3 added mid-task detours as sub-threads and the "what's next" rule.

**Known weaknesses:**
- v3's detour examples come from the spike session itself (overfit risk).
- Two adjacent detours can merge into one sub-thread (spike, exchanges 7–10).
- Main vs sub for a ticket's follow-up work is unstable between versions.
- The UI look is not covered here: the HTML viewer is a review tool only. That is [UI: band, pane and inline markers](06-ui-prototype.md); `data/*.v3.json` can serve as its fixture data.
