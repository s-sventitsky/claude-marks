# PROTOTYPE, throwaway. Bakes labelled runs into one self-contained viewer.html.
import json, glob, os
NAMES = {"56b622e8": "Charting: bookmarks idea", "3bf55b9d": "Charting: UI direction",
         "c73d54bb": "Row identity spike", "1ebd82e3": "awakened-foundry (Linear, OKF, docs)"}
runs = {}
for f in sorted(glob.glob("data/*.v*.json")):
    conv, ver = os.path.basename(f).split(".")[:2]
    runs.setdefault(conv, {})[ver] = json.load(open(f, encoding="utf-8"))
data = json.dumps({"names": NAMES, "runs": runs}, ensure_ascii=False).replace("</", r"<\/")
html = open("viewer.template.html", encoding="utf-8").read().replace("/*DATA*/null", data)
open("viewer.html", "w", encoding="utf-8").write(html)
print("viewer.html", len(html))
