# PROTOTYPE, throwaway. Turns a Claude Code transcript JSONL into exchanges.
# Usage: python -I extract.py <transcript.jsonl> <out.json>
import json, re, sys

CMD = re.compile(r"<command-name>(/[^<]+)</command-name>.*?<command-args>(.*?)</command-args>", re.S)
SKIP_CMDS = {"/clear", "/login", "/exit", "/resume", "/model", "/config", "/compact", "/reload-plugins"}


def prompt_text(r):
    if r.get("type") != "user" or r.get("isMeta") or r.get("isCompactSummary"):
        return None
    c = r["message"]["content"]
    if not isinstance(c, str):
        return None
    if c.startswith("<local-command") or c.startswith("<command-message>"):
        return None
    m = CMD.search(c)
    if m:
        name, args = m.group(1).strip(), m.group(2).strip()
        return None if name in SKIP_CMDS else f"{name} {args}".strip()
    if c.startswith("<"):
        return None
    return c


def tool_line(b):
    i = b.get("input", {})
    for k in ("file_path", "command", "pattern", "description", "skill", "url", "query"):
        if k in i:
            return f"{b['name']} {str(i[k]).splitlines()[0][:100]}"
    return b["name"]


def extract(path):
    exs, cur = [], None
    for line in open(path, encoding="utf-8"):
        r = json.loads(line)
        if r.get("type") == "system" and r.get("subtype") == "compact_boundary" and cur:
            cur["compactedAfter"] = True
        p = prompt_text(r)
        if p is not None:
            cur = {"uuid": r["uuid"], "n": len(exs) + 1, "prompt": p, "texts": [], "tools": []}
            exs.append(cur)
            continue
        if cur and r.get("type") == "assistant" and not r.get("isSidechain"):
            for b in r["message"].get("content", []):
                if b.get("type") == "text" and b["text"].strip():
                    cur["texts"].append(b["text"])
                elif b.get("type") == "tool_use":
                    cur["tools"].append(tool_line(b))
    for e in exs:
        texts = e.pop("texts")
        e["reply"] = texts[-1] if texts else ""
    return exs


if __name__ == "__main__":
    with open(sys.argv[2], "w", encoding="utf-8") as f:
        json.dump(extract(sys.argv[1]), f, ensure_ascii=False, indent=1)
