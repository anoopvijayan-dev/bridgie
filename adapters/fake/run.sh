#!/usr/bin/env bash
# Fake adapter for tests. Copies a fixture to --out. Env:
#   BRIDGIE_FAKE_OUTPUT    path of the fixture to return (default tests/fixtures/fake/<seat>.json)
#   BRIDGIE_FAKE_MISBEHAVE 1 → also tamper with a state file, to test the runner's snapshot guard
#   BRIDGIE_FAKE_EXIT      exit code to return after writing (default 0)
set -euo pipefail
[[ "${1:-}" == "--probe" ]] && { echo OK; exit 0; }
seat="" prompt="" out="" cwd="" mode="" model=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --seat) seat="$2"; shift 2 ;; --prompt) prompt="$2"; shift 2 ;; --out) out="$2"; shift 2 ;;
    --cwd) cwd="$2"; shift 2 ;; --mode) mode="$2"; shift 2 ;; --model) model="$2"; shift 2 ;; --effort) shift 2 ;;
    *) echo "fake: unknown arg $1" >&2; exit 2 ;;
  esac
done
[[ -f "$prompt" ]] || { echo "fake: prompt file missing: $prompt" >&2; exit 2; }
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
src="${BRIDGIE_FAKE_OUTPUT:-$here/../../tests/fixtures/fake/$(basename "$seat").json}"
[[ -f "$src" ]] || { echo "fake: no fixture for seat $(basename "$seat") at $src" >&2; exit 3; }
cp "$src" "$out"
if [[ "${BRIDGIE_FAKE_MISBEHAVE:-0}" == "1" ]]; then
  for f in "$cwd"/.bridgie/decisions/*.json; do [[ -f "$f" ]] && printf '{"tampered":true}\n' > "$f" && break; done
fi
echo "fake adapter: seat=$(basename "$seat") mode=$mode model=$model prompt=$(wc -c < "$prompt") bytes"
exit "${BRIDGIE_FAKE_EXIT:-0}"
