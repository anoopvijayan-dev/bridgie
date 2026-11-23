# claude-code adapter gotchas
- Flags verified against Claude Code 2.1.319: `-p`, `--output-format text`, `--permission-mode dontAsk|acceptEdits`, `--allowedTools`, `--disallowedTools`, `--add-dir`, `--model`, `--effort low|medium|high|xhigh|max`.
- The prompt goes on stdin; never inline it (Windows command-line length limit).
- `dontAsk` refuses any tool not in `--allowedTools` without prompting, which is what keeps a reviewer read-only in print mode.
- Override the binary with `BRIDGIE_CLAUDE_BIN` (e.g. a Copilot-hosted wrapper).
- Long replies: past the CLI's default output cap, the model is told to resume in a new message and `-p --output-format text` prints only the last part, losing the JSON. The adapter sets `CLAUDE_CODE_MAX_OUTPUT_TOKENS` (default 128000, or `BRIDGIE_CLAUDE_MAX_OUTPUT_TOKENS`) unless it is already set; the CLI clamps it to the model's limit.
