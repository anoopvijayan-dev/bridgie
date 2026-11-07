# antigravity adapter gotchas (carried from Bridgie v1, verified 2026-08-12)
- The binary is the CLI `agy` (`%LOCALAPPDATA%\agy\bin\agy.exe`, often not on PATH in a spawned shell), not the IDE. The old `gemini` CLI's OAuth tier is retired.
- `--print` takes the prompt as its VALUE: put `--print "<prompt>"` last, or the next flag becomes the prompt.
- `--project` is load-bearing. Without it agy uses `default-cli-project`, clears the permission grants and every tool is denied. The adapter finds the project whose folderUri covers the working dir in `~/.gemini/config/projects/*.json`; override with `BRIDGIE_AGY_PROJECT`.
- Headless auto-denies tools. Grant read tools in `~/.gemini/antigravity-cli/settings.json`: `permissions.allow: ["read_file(*)","list_directory(*)","glob(*)","grep(*)","search_file_content(*)"]`, and deny `write_file(*)`, `edit_file(*)`, `replace(*)`, `run_shell_command(*)`, `command(*)` for reviewer use. Never use `--dangerously-skip-permissions`.
- `--sandbox` hangs on Windows. Do not use it.
- Probe first: `agy --project <id> --mode plan --print "Reply with exactly: OK"`.
- A QA seat that cannot read the repo invents findings (v1, 2026-08-08). Task worktrees live inside the repo (`.bridgie/worktrees/`) so the project's grants cover them.
- UNVERIFIED: write mode. The adapter uses `--mode ${BRIDGIE_AGY_WRITE_MODE:-agent}` for implementer seats; confirm the mode name on first use and record it here.
