#!/usr/bin/env bash
# Antigravity CLI adapter (google). agy has no stdin mode: it is told to read the prompt file.
set -euo pipefail
# shellcheck source=../lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/common.sh"
adapter_parse "$@"

find_agy() {
  if [[ -n "${BRIDGIE_AGY_BIN:-}" ]]; then printf '%s\n' "$BRIDGIE_AGY_BIN"; return; fi
  if command -v agy >/dev/null 2>&1; then command -v agy; return; fi
  local la="${LOCALAPPDATA:-}"
  if [[ -n "$la" ]]; then
    command -v cygpath >/dev/null 2>&1 && la="$(cygpath -u "$la")"
    [[ -x "$la/agy/bin/agy.exe" ]] && { printf '%s\n' "$la/agy/bin/agy.exe"; return; }
  fi
  return 1
}

# find_project <dir>: Antigravity project id whose folderUri covers <dir>. Without it agy runs in
# "default-cli-project" and wipes the permission grants (see gotchas.md).
find_project() {
  if [[ -n "${BRIDGIE_AGY_PROJECT:-}" ]]; then printf '%s\n' "$BRIDGIE_AGY_PROJECT"; return; fi
  local dir; dir="$(winpath "$1")"
  node -e '
    const fs = require("fs"), path = require("path"), os = require("os");
    const want = process.argv[1].replace(/\\/g, "/").toLowerCase();
    const d = path.join(os.homedir(), ".gemini", "config", "projects");
    let best = null;
    for (const f of fs.existsSync(d) ? fs.readdirSync(d) : []) {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(d, f), "utf8"));
        const uris = [j.folderUri, ...(j.folders || []).map(x => x.uri || x)].filter(Boolean);
        for (const u of uris) {
          const p = decodeURIComponent(String(u).replace(/^file:\/\//, "")).replace(/\\/g, "/").replace(/^\/([a-zA-Z]:)/, "$1").toLowerCase().replace(/\/$/, "");
          if (want.startsWith(p) && (!best || p.length > best.len)) best = { id: j.id || path.basename(f, ".json"), len: p.length };
        }
      } catch {}
    }
    if (!best) process.exit(1);
    console.log(best.id);' "$dir"
}

if [[ "$probe" == "1" ]]; then find_agy >/dev/null && { echo OK; exit 0; }; echo "agy not found (PATH or %LOCALAPPDATA%/agy/bin)" >&2; exit 1; fi
if [[ "$caps" == "1" ]]; then echo '{"vendor":"google","reads_repo":true}'; exit 0; fi
adapter_require_run_args
AGY="$(find_agy)" || { echo "agy not found" >&2; exit 1; }
project="$(find_project "$cwd")" || { echo "no Antigravity project covers $cwd; open it in Antigravity once or set BRIDGIE_AGY_PROJECT" >&2; exit 1; }
reply="$(dirname "$out")/reply.txt"
agy_mode="plan"; [[ "$mode" == "write" ]] && agy_mode="${BRIDGIE_AGY_WRITE_MODE:-agent}"
instruction="Read $(winpath "$prompt") in full. It contains your role, inputs and output contract. Do the work now in $(winpath "$cwd"), then end your reply with the fenced json block it asks for."
args=(--project "$project" --mode "$agy_mode" --effort "${effort:-high}" --print-timeout "${BRIDGIE_AGY_TIMEOUT:-15m}" --output-format text)
[[ "$model" != "default" ]] && args+=(--model "$model")
# --print takes the prompt as its VALUE and must come last.
(cd "$cwd" && "$AGY" "${args[@]}" --print "$instruction") > "$reply" 2> "$(dirname "$out")/agy.log"
adapter_finish "$reply"
