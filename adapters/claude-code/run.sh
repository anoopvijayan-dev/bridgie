#!/usr/bin/env bash
# Claude Code adapter (anthropic). Prompt on stdin, reply on stdout, JSON extracted to --out.
set -euo pipefail
# shellcheck source=../lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/common.sh"
adapter_parse "$@"
CLI="${BRIDGIE_CLAUDE_BIN:-claude}"
if [[ "$probe" == "1" ]]; then command -v "$CLI" >/dev/null 2>&1 && { echo OK; exit 0; }; echo "claude CLI not found on PATH" >&2; exit 1; fi
if [[ "$caps" == "1" ]]; then echo '{"vendor":"anthropic","reads_repo":true,"reads_web":true}'; exit 0; fi
adapter_require_run_args
reply="$(dirname "$out")/reply.txt"
args=(-p --output-format text --add-dir "$(dirname "$out")")
[[ "$model" != "default" ]] && args+=(--model "$model")
[[ -n "$effort" ]] && args+=(--effort "$effort")
if [[ "$mode" == "readonly" ]]; then
  # Read and inspect only; everything not allowed is refused without prompting.
  args+=(--permission-mode dontAsk
         --allowedTools "Read" "Grep" "Glob" "LS" "WebSearch" "WebFetch" "Bash(git diff:*)" "Bash(git log:*)" "Bash(git show:*)" "Bash(git status:*)"
         --disallowedTools "Edit" "Write" "MultiEdit" "NotebookEdit")
else
  args+=(--permission-mode acceptEdits
         --allowedTools "Read" "Grep" "Glob" "LS" "Edit" "Write" "MultiEdit" "Bash"
         --disallowedTools "Bash(git push:*)" "Bash(git remote:*)" "Bash(git checkout:*)" "Bash(git switch:*)")
fi
(cd "$cwd" && "$CLI" "${args[@]}" < "$prompt") > "$reply"
adapter_finish "$reply"
