# copilot adapter gotchas
- Flags verified against GitHub Copilot CLI 1.0.107: `-p` (non-interactive), `-s` (response only), `--no-ask-user`, `--model`, `--reasoning-effort none|minimal|low|medium|high|xhigh|max`, `--allow-tool` / `--deny-tool` (deny always wins), `--add-dir`.
- `-p` takes the prompt text, so the adapter passes a short instruction to read the prompt file (Windows command-line limit).
- Vendor is derived from `--model` (claude/opus/sonnet → anthropic, gpt → openai, gemini → google). With `default` the vendor is `copilot-default`, which never matches another adapter, so set an explicit model when cross-family matters.
- Model names are Copilot's (check `copilot --help` / `/model`), e.g. `claude-opus-5.5`; they are not Anthropic API ids.
