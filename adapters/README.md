# Adapters

An adapter launches one seat invocation on one model runtime. Contract:

    run.sh --seat <seat dir> --prompt <prompt file> --out <output file> --cwd <dir> \
           --mode readonly|write --model <name> [--effort <level>]
    run.sh --probe        # prints OK and exits 0 when the runtime is usable

Rules:
- Read the prompt from the file; never pass it inline (Windows argument limits).
- In `readonly` mode the runtime must be unable to write anywhere but `--out`'s directory; the runner also diffs state files afterwards and fails the run on any change.
- Exit 0 only when `--out` was written. Any other exit code with a reason on stderr.
- Keep traps you learn in `gotchas.md` next to the adapter.

Adapters: `fake` (tests), `claude-code`, `codex`, `antigravity` (M1).
