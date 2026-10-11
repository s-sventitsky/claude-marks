# Correction feedback loop

Type: grilling
Status: resolved

## Question

How do user corrections steer later labelling in the same conversation? The data model ([Data model for exchanges, threads, bookmarks and corrections](05-data-model.md)) keeps the newest 10 corrections and marks corrected values `by: user`. The labeller's input is the thread list with recent gists plus the previous reply ([Labeller prompt and output schema](04-labeller-prototype.md)). Decide:

- whether corrections go into the labeller's prompt as examples, as hard constraints on the thread list, or both, and in what form;
- what happens to exchanges after a moved range, i.e. whether a move or merge triggers relabelling of later exchanges that are still `by: labeller`;
- how dismissed auto bookmarks feed landmark and branch-point density.

May need a small prototype run on the existing labeller fixtures to check the prompt change.

## Answer

Grilled with the user on 2026-10-11.

1. **Prompt: state plus a recent-corrections block. No hard constraints.**
   - The thread list already carries corrections: renamed labels, merged ids redirected through `mergedFrom`, moved exchanges' gists under their new thread. The mod enforces `by: user` itself.
   - On top of that, each call gets a **recent corrections** block: the newest 10 `corrections[]` entries (move, merge, rename, reparent, bookmark add/dismiss), one plain-language line each, e.g. `moved "Fix resume bug" (#14–16) from sub of "Persistence" → new main "Resume bug"` or `dismissed landmark on #9 ("chose JSON schema")`. One instruction comes with it: "these are the user's corrections; place similar exchanges the way the user would."
   - The block goes **after** the cached rules so the cache holds. About 150 tokens, roughly +5% per call.
2. **No automatic relabel after a move or merge.**
   - Corrections only affect later exchanges. Exchanges after a moved range that are still `by: labeller` stay as they are.
   - In the tree, the pane offers **"relabel from here"** on the exchange right after a moved range (e.g. `/marks relabel from #n`). The final name belongs to the command surface.
   - Rejected: relabelling all later exchanges (the tree reshuffles under the user, and churn cascades) and a bounded carry-along (still moves things unasked).
3. **Dismissal counters per auto kind.**
   - The conversation file gains `bookmarkStats: {landmark: {flagged, dismissed}, branch_point: {flagged, dismissed}}`, counted per conversation, nothing carried across conversations.
   - When a kind has **≥3 dismissals and ≥1/3 of its flags dismissed**, the prompt gets one line, e.g. *"The user dismissed 5 of 12 landmarks: flag landmarks only for clear, lasting decisions."* The thresholds are v1 defaults, tunable.
   - A manual bookmark on an exchange without an auto bookmark is only logged in the corrections block, not counted as a density signal (too ambiguous).
   - Rejected: a filter in the mod that drops auto bookmarks (blunt).
4. **Validation deferred.** No prototype run now: made-up corrections on the four fixtures the prompt was tuned on would prove little. Whether corrections steer placement folds into the **Labeller evaluation** fog item, ideally using real corrections from early use.
