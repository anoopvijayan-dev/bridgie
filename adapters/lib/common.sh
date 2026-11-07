# shellcheck shell=bash
# Shared argument parsing and output handling for real adapters. Source, then call adapter_main.
# shellcheck disable=SC2034  # variables are read by the adapter that sources this file

ADAPTER_LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
seat="" prompt="" out="" cwd="" mode="readonly" model="default" effort="" caps=0 probe=0

adapter_parse() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --probe) probe=1; shift ;;
      --capabilities) caps=1; shift ;;
      --seat) seat="$2"; shift 2 ;; --prompt) prompt="$2"; shift 2 ;; --out) out="$2"; shift 2 ;;
      --cwd) cwd="$2"; shift 2 ;; --mode) mode="$2"; shift 2 ;; --model) model="$2"; shift 2 ;;
      --effort) effort="$2"; shift 2 ;;
      *) echo "adapter: unknown argument $1" >&2; exit 2 ;;
    esac
  done
}

# winpath <path>: Windows form when running under Git Bash/MSYS, unchanged elsewhere.
winpath() { if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s\n' "$1"; fi; }

# adapter_finish <reply file>: keep a model-written --out, else extract the last JSON block.
adapter_finish() {
  local reply="$1"
  if [[ -s "$out" ]]; then return 0; fi
  [[ -s "$reply" ]] || { echo "adapter: model produced no reply (see $reply)" >&2; exit 4; }
  node "$ADAPTER_LIB/extract-json.mjs" "$reply" "$out" || exit 5
}

adapter_require_run_args() {
  [[ -f "$prompt" && -n "$out" && -d "$cwd" ]] || { echo "adapter: --prompt, --out and --cwd are required" >&2; exit 2; }
  [[ "$mode" == "readonly" || "$mode" == "write" ]] || { echo "adapter: --mode must be readonly or write" >&2; exit 2; }
}
