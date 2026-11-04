#!/usr/bin/env sh
# Copies the newest bundled engine d.ts into mod/.claude-plugin/types/claude-code/index.d.ts.
# Needed only when no interactive session has loaded the mod (agents, CI): a session that
# loads the mod with --plugin-dir writes these files itself. The bundled file exists only
# after the plugin-authoring skill has loaded in some Claude Code process.
set -e
SRC=$(ls -t "${TEMP:-/tmp}"/claude/bundled-skills/*/*/plugin-authoring/types/claude-code.d.ts 2>/dev/null | head -1 || true)
if [ -z "$SRC" ]; then
  SRC=$(ls -t /c/Users/*/AppData/Local/Temp/claude/bundled-skills/*/*/plugin-authoring/types/claude-code.d.ts | head -1)
fi
DST="$(dirname "$0")/../mod/.claude-plugin/types/claude-code"
mkdir -p "$DST"
cp "$SRC" "$DST/index.d.ts"
head -1 "$DST/index.d.ts"
