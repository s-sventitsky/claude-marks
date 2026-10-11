# PROTOTYPE, throwaway. Runs the draft labeller over one conversation's exchanges, in order,
# one `claude -p` call per exchange (stand-in for `$.model.complete`), and writes the result.
# Usage: python -I run.py data/<id>.exchanges.json data/<id>.labelled.json [model]
import json, subprocess, sys, time

MODEL = sys.argv[3] if len(sys.argv) > 3 else "haiku"
RULES = open("labeller-prompt.md", encoding="utf-8").read()


def clip(s, head, tail=0):
    if len(s) <= head + tail:
        return s
    return s[:head] + "\n[…]\n" + (s[-tail:] if tail else "")


def build(ex, prev, threads, current):
    lines = ["## Threads so far"]
    if not threads:
        lines.append("(none yet: this is the first exchange; use new_main)")
    for t in threads.values():
        kind = f"sub of {t['parent']}" if t["parent"] else "main"
        gists = "; ".join(t["gists"][-2:])
        mark = "  <- current" if t["id"] == current else ""
        lines.append(f"- {t['id']} [{kind}] \"{t['label']}\": {gists}{mark}")
    if prev:
        lines += ["", "## Previous exchange (context only)", f"User: {clip(prev['prompt'], 300)}",
                  f"Claude (end of reply): {prev['reply'][-1200:]}"]
    lines += ["", "## Exchange to place", f"User: {clip(ex['prompt'], 2000)}",
              f"Claude's tool calls: {', '.join(ex['tools'][:15]) or 'none'}",
              f"Claude's final reply: {clip(ex['reply'], 2000, 1000)}"]
    return "\n".join(lines)


def call(prompt):
    out = subprocess.run(
        ["claude", "-p", "--model", MODEL, "--system-prompt", RULES, "--tools", "",
         "--output-format", "json", "--no-session-persistence", "--disable-slash-commands",
         "--strict-mcp-config", "--effort", "low"],
        input=prompt, capture_output=True, text=True, encoding="utf-8")
    env = json.loads(out.stdout)
    text = env.get("result", "").strip()
    if text.startswith("```"):
        text = text.strip("`").removeprefix("json").strip()
    return json.loads(text[text.index("{"): text.rindex("}") + 1]), env


def main():
    exs = json.load(open(sys.argv[1], encoding="utf-8"))
    threads, current, prev, results, cost = {}, None, None, [], 0.0
    for ex in exs:
        prompt = build(ex, prev, threads, current)
        t0 = time.time()
        try:
            ans, env = call(prompt)
        except Exception as err:  # bad JSON: fall back to "continue"
            ans, env = {"thread": {"action": "continue"}, "bookmarks": [], "gist": f"(labeller failed: {err})"}, {}
        th = ans.get("thread", {})
        act = th.get("action") if current or th.get("action", "").startswith("new") else "new_main"
        if act == "resume" and th.get("id") in threads:
            current = th["id"]
        elif act in ("new_main", "new_sub"):
            tid = f"t{len(threads) + 1}"
            parent = None
            if act == "new_sub" and current:
                parent = threads[current]["parent"] or current
            threads[tid] = {"id": tid, "label": th.get("label") or "(unlabelled)", "parent": parent, "gists": []}
            current = tid
        threads[current]["gists"].append(ans.get("gist", ""))
        usage = env.get("usage", {})
        cost += env.get("total_cost_usd", 0) or 0
        results.append({**ex, "thread": current, "action": act, "bookmarks": ans.get("bookmarks", []),
                        "gist": ans.get("gist", ""), "secs": round(time.time() - t0, 1),
                        "tokensIn": usage.get("input_tokens", 0) + usage.get("cache_read_input_tokens", 0)
                        + usage.get("cache_creation_input_tokens", 0),
                        "tokensOut": usage.get("output_tokens", 0)})
        print(f"{ex['n']:>3} {act:<9} {current} {threads[current]['label']!r:<32} "
              f"{[b.get('kind') for b in ans.get('bookmarks', [])]} {ans.get('gist','')[:60]}", flush=True)
        prev = ex
    json.dump({"model": MODEL, "costUsd": round(cost, 4), "threads": list(threads.values()), "exchanges": results},
              open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"cost reported by CLI: ${cost:.4f}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
