#!/usr/bin/env bash
# GitHub Copilot CLI adapter. Vendor follows the model (Claude → anthropic, GPT → openai, Gemini → google).
# The prompt is too large for a command line on Windows, so -p carries an instruction to read the file.
set -euo pipefail
# shellcheck source=../lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/common.sh"
adapter_parse "$@"
CLI="${BRIDGIE_COPILOT_BIN:-copilot}"

vendor_of() {
  local m; m="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  case "$m" in
    *claude*|*opus*|*sonnet*|*haiku*|*fable*) echo anthropic ;;
    *gpt*|o[0-9]*|*codex*) echo openai ;;
    *gemini*) echo google ;;
    *) echo "copilot-${m:-default}" ;;
  esac
}

if [[ "$probe" == "1" ]]; then command -v "$CLI" >/dev/null 2>&1 && { echo OK; exit 0; }; echo "copilot CLI not found on PATH" >&2; exit 1; fi
if [[ "$caps" == "1" ]]; then printf '{"vendor":"%s","reads_repo":true}\n' "$(vendor_of "$model")"; exit 0; fi
adapter_require_run_args
reply="$(dirname "$out")/reply.txt"
instruction="Read $(winpath "$prompt") in full. It contains your role, inputs and output contract. Do the work now in $(winpath "$cwd"), then end your reply with the fenced json block it asks for."
args=(-s --no-ask-user --add-dir "$(dirname "$prompt")")
[[ "$model" != "default" ]] && args+=(--model "$model")
[[ -n "$effort" ]] && args+=(--reasoning-effort "$effort")
if [[ "$mode" == "readonly" ]]; then
  # Non-interactive mode denies anything not allowed; deny rules win over allow rules.
  args+=(--allow-tool 'shell(git diff:*)' --allow-tool 'shell(git log:*)' --allow-tool 'shell(git show:*)' --allow-tool 'shell(git status:*)'
         --deny-tool write)
else
  args+=(--allow-tool write --allow-tool shell
         --deny-tool 'shell(git push)' --deny-tool 'shell(git remote)' --deny-tool 'shell(git checkout)' --deny-tool 'shell(git switch)')
fi
(cd "$cwd" && "$CLI" "${args[@]}" -p "$instruction") > "$reply" 2> "$(dirname "$out")/copilot.log"
adapter_finish "$reply"
