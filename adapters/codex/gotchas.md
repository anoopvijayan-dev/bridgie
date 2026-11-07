# codex adapter gotchas
- Flags verified against codex-cli 0.167.0: `exec -s read-only|workspace-write -C <dir> --skip-git-repo-check -o <last message file>`, `-m`, `-c key=value`.
- Pipe the prompt on stdin (v1: inlining a large diff broke on Windows).
- ChatGPT-auth Codex rejects `-m` for models it does not offer: leave the model as `default` unless you know.
- "requires a newer version of Codex" → `npm install -g @openai/codex@latest`.
- v1 incident: a packet that swept in the run directory hit Codex's 1,048,576-character input limit; packets exclude `.bridgie/runs/**`.
