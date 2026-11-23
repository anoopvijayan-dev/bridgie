# Adapters
Each adapter is `adapters/<name>/run.mjs`, run with the same `node` as Bridgie (run.mjs is plain Node, so adapters behave the same on Windows, macOS and Linux). A legacy `run.sh` is still launched with bash if no run.mjs exists.

An adapter launches one seat invocation on one model runtime. Contract:

    run.mjs --seat <seat dir> --prompt <prompt file> --out <output file> --cwd <dir> \
           --mode readonly|write --model <name> [--effort <level>]
    run.mjs --capabilities --seat <seat dir>   # prints {"vendor": "...", "reads_repo": true|false, "reads_web": true|false}
    run.mjs --probe                            # prints OK when the CLI is installed (no model call)

Rules:
- Read the prompt from the file; never pass it inline (Windows argument limits).
- The seat ends its reply with one fenced ```json block. The adapter saves the full reply
  next to `--out` as `reply.txt` and extracts the last JSON block into `--out` with
  `adapters/lib/extract-json.mjs`. If the model wrote `--out` itself, that file wins.
- `readonly` mode must not let the model write in `--cwd`. The runner also checks state files
  and the reviewer worktree afterwards and fails the run on any change.
- `reads_web: false` makes the runner refuse seats whose manifest lists the `web` tool (research).
- `vendor` drives cross-family checks; `reads_repo: false` makes the runner refuse to use the
  adapter as a reviewer.
- Exit 0 only when `--out` exists. Any other exit code with a reason on stderr.
- Exit 6 when the CLI itself failed (signed out, over its usage limit, crashed) and left no JSON; put the CLI's last words on stderr. Exit 4 means no reply at all, exit 5 a reply with no valid JSON block.
- When the CLI reports what the run used, write it beside `--out` as `usage.json` with `writeUsage` from `adapters/lib/common.mjs`: `tokens_in`, `tokens_out`, `tokens_cache_read`, `tokens_cache_write`, `tokens_total`, `usd`, each optional. Write only what the CLI itself said; never estimate. The runner copies it onto the run's cost entry.
- `--capabilities` may add `sandbox`: `os` (an OS sandbox the adapter can turn on here), `builtin` (the CLI always sandboxes itself) or `none`, and a `sandbox_note` saying why not. For a seat that writes, the runner sets `BRIDGIE_SANDBOX` (`off`, `auto`, `required`) and `BRIDGIE_SANDBOX_NETWORK` (comma-separated hosts); read them with `sandboxAsk()` from `adapters/lib/common.mjs`. `required` means: do not run unsandboxed.
- Keep the traps you learn in `gotchas.md` next to the adapter.

Adapters: `fake` (tests), `claude-code` (anthropic), `codex` (openai), `antigravity` (google).
