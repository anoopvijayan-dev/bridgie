# Adapters

An adapter launches one seat invocation on one model runtime. Contract:

    run.sh --seat <seat dir> --prompt <prompt file> --out <output file> --cwd <dir> \
           --mode readonly|write --model <name> [--effort <level>]
    run.sh --capabilities --seat <seat dir>   # prints {"vendor": "...", "reads_repo": true|false}
    run.sh --probe                            # prints OK when the CLI is installed (no model call)

Rules:
- Read the prompt from the file; never pass it inline (Windows argument limits).
- The seat ends its reply with one fenced ```json block. The adapter saves the full reply
  next to `--out` as `reply.txt` and extracts the last JSON block into `--out` with
  `adapters/lib/extract-json.mjs`. If the model wrote `--out` itself, that file wins.
- `readonly` mode must not let the model write in `--cwd`. The runner also checks state files
  and the reviewer worktree afterwards and fails the run on any change.
- `vendor` drives cross-family checks; `reads_repo: false` makes the runner refuse to use the
  adapter as a reviewer.
- Exit 0 only when `--out` exists. Any other exit code with a reason on stderr.
- Keep the traps you learn in `gotchas.md` next to the adapter.

Adapters: `fake` (tests), `claude-code` (anthropic), `codex` (openai), `antigravity` (google).
