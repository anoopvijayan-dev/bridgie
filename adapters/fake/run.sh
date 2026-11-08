#!/usr/bin/env bash
# Fake adapter for tests. Returns fixtures instead of calling a model.
#   --capabilities            prints {"vendor","reads_repo"}; vendor is fake-verifier for verify/* seats,
#                             fake-producer otherwise (BRIDGIE_FAKE_SAME_VENDOR=1 → "fake" for all;
#                             BRIDGIE_FAKE_READS_REPO=0 → reads_repo false; BRIDGIE_FAKE_READS_WEB=0 → reads_web false)
#   BRIDGIE_FAKE_DIR          fixture dir (default tests/fixtures/fake); the n-th call of a seat uses
#                             <seat>.<n>.json if present, else <seat>.json (counter in BRIDGIE_FAKE_STATE, default <project>/.bridgie/.fake-state)
#   BRIDGIE_FAKE_OUTPUT       one fixture path for every seat (overrides the dir)
#   BRIDGIE_FAKE_SCRIPT       bash script run inside --cwd before returning (simulates edits)
#   BRIDGIE_FAKE_STDOUT=1     print the fixture in a ```json fence and let extraction write --out
#   BRIDGIE_FAKE_MISBEHAVE=1  tamper with a state file (tests the single-writer guard)
#   BRIDGIE_FAKE_EXIT         exit code after writing (default 0)
#   BRIDGIE_FAKE_FAIL_CARDS   space-separated card ids whose buyer run fails (swarm tests)
#   swarm members             with vars.json beside --out, the card number picks <seat>.<n>.json and "CARD" in the fixture becomes the card id
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[[ "${1:-}" == "--probe" ]] && { echo OK; exit 0; }
seat="" prompt="" out="" cwd="" mode="" model="" caps=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --capabilities) caps=1; shift ;;
    --seat) seat="$2"; shift 2 ;; --prompt) prompt="$2"; shift 2 ;; --out) out="$2"; shift 2 ;;
    --cwd) cwd="$2"; shift 2 ;; --mode) mode="$2"; shift 2 ;; --model) model="$2"; shift 2 ;; --effort) shift 2 ;;
    *) echo "fake: unknown arg $1" >&2; exit 2 ;;
  esac
done
name="$(basename "$seat")"; loop="$(basename "$(dirname "$seat")")"
if [[ "$caps" == "1" ]]; then
  vendor="fake-producer"; [[ "$loop" == "verify" ]] && vendor="fake-verifier"
  [[ "${BRIDGIE_FAKE_SAME_VENDOR:-0}" == "1" ]] && vendor="fake"
  reads=true; [[ "${BRIDGIE_FAKE_READS_REPO:-1}" == "0" ]] && reads=false
  web=true; [[ "${BRIDGIE_FAKE_READS_WEB:-1}" == "0" ]] && web=false
  printf '{"vendor":"%s","reads_repo":%s,"reads_web":%s}\n' "$vendor" "$reads" "$web"; exit 0
fi
[[ -f "$prompt" ]] || { echo "fake: prompt file missing: $prompt" >&2; exit 2; }
dir="${BRIDGIE_FAKE_DIR:-$here/../../tests/fixtures/fake}"
state="${BRIDGIE_FAKE_STATE:-${out%%/.bridgie/*}/.bridgie/.fake-state}"; mkdir -p "$state"
n=$(( $(cat "$state/$name" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$state/$name"
# Swarm member (vars.json beside --out): the card's number picks the fixture, so parallel runs stay deterministic.
card=""
if [[ -f "$(dirname "$out")/vars.json" ]]; then
  card="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).id||"")' "$(dirname "$out")/vars.json")"
  [[ "$card" =~ ([0-9]+)$ ]] && n=$((10#${BASH_REMATCH[1]}))
fi
src="${BRIDGIE_FAKE_OUTPUT:-}"
if [[ -z "$src" ]]; then src="$dir/$name.$n.json"; [[ -f "$src" ]] || src="$dir/$name.json"; fi
[[ -f "$src" ]] || { echo "fake: no fixture for seat $name at $src" >&2; exit 3; }
if [[ -n "${BRIDGIE_FAKE_SCRIPT:-}" ]]; then (cd "$cwd" && bash "$BRIDGIE_FAKE_SCRIPT" "$name" "$n"); fi
if [[ "${BRIDGIE_FAKE_STDOUT:-0}" == "1" ]]; then
  reply="$(dirname "$out")/reply.txt"
  { echo "Here is my result."; echo '```json'; cat "$src"; echo '```'; } > "$reply"
  node "$here/../lib/extract-json.mjs" "$reply" "$out"
else
  cp "$src" "$out"
fi
[[ -n "$card" ]] && sed -i "s/\"CARD\"/\"$card\"/g" "$out"
if [[ -n "$card" && " ${BRIDGIE_FAKE_FAIL_CARDS:-} " == *" $card "* ]]; then rm -f "$out"; echo "fake: card $card fails on purpose" >&2; exit 9; fi
if [[ "${BRIDGIE_FAKE_MISBEHAVE:-0}" == "1" ]]; then
  for f in "$cwd"/.bridgie/decisions/*.json; do [[ -f "$f" ]] && printf '{"tampered":true}\n' > "$f" && break; done
fi
echo "fake adapter: seat=$name call=$n mode=$mode model=$model prompt=$(wc -c < "$prompt") bytes"
exit "${BRIDGIE_FAKE_EXIT:-0}"
