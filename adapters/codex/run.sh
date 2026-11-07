#!/usr/bin/env bash
# Codex CLI adapter (openai). Prompt on stdin; last message written with -o; JSON extracted to --out.
set -euo pipefail
# shellcheck source=../lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/common.sh"
adapter_parse "$@"
CLI="${BRIDGIE_CODEX_BIN:-codex}"
if [[ "$probe" == "1" ]]; then command -v "$CLI" >/dev/null 2>&1 && { echo OK; exit 0; }; echo "codex CLI not found on PATH" >&2; exit 1; fi
if [[ "$caps" == "1" ]]; then echo '{"vendor":"openai","reads_repo":true}'; exit 0; fi
adapter_require_run_args
reply="$(dirname "$out")/reply.txt"
sandbox="read-only"; [[ "$mode" == "write" ]] && sandbox="workspace-write"
args=(exec -s "$sandbox" -C "$cwd" --skip-git-repo-check -o "$reply")
# ChatGPT-auth Codex rejects -m for models it does not offer: only pass it when one is configured.
[[ "$model" != "default" ]] && args+=(-m "$model")
[[ -n "$effort" ]] && args+=(-c "model_reasoning_effort=\"$effort\"")
"$CLI" "${args[@]}" < "$prompt" > "$(dirname "$out")/codex.log" 2>&1
adapter_finish "$reply"
