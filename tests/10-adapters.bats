#!/usr/bin/env bats
load helpers

FAKE() { "$BRIDGIE_HOME/adapters/fake/run.sh" "$@"; }

@test "fake capabilities: producer vs verifier vendors, overrides" {
  run FAKE --capabilities --seat "$BRIDGIE_HOME/seats/build/implementer"
  [ "$output" = '{"vendor":"fake-producer","reads_repo":true}' ]
  run FAKE --capabilities --seat "$BRIDGIE_HOME/seats/verify/reviewer"
  [ "$output" = '{"vendor":"fake-verifier","reads_repo":true}' ]
  BRIDGIE_FAKE_SAME_VENDOR=1 BRIDGIE_FAKE_READS_REPO=0 run FAKE --capabilities --seat "$BRIDGIE_HOME/seats/verify/reviewer"
  [ "$output" = '{"vendor":"fake","reads_repo":false}' ]
}

@test "fake returns the n-th fixture per seat, then falls back" {
  d="$(mktemp -d)"; mkdir -p "$d/fx" "$d/.bridgie/runs/b/x"
  echo '{"n":1}' > "$d/fx/grill.1.json"; echo '{"n":"default"}' > "$d/fx/grill.json"; echo p > "$d/p.md"
  for i in 1 2; do BRIDGIE_FAKE_DIR="$d/fx" FAKE --seat "$BRIDGIE_HOME/seats/decide/grill" --prompt "$d/p.md" --out "$d/.bridgie/runs/b/x/o$i.json" --cwd "$d" --mode readonly --model m >/dev/null; done
  [ "$(cat "$d/.bridgie/runs/b/x/o1.json")" = '{"n":1}' ]
  [ "$(cat "$d/.bridgie/runs/b/x/o2.json")" = '{"n":"default"}' ]
}

@test "stdout mode goes through JSON extraction and a seat run still validates" {
  export BRIDGIE_ADAPTER=fake BRIDGIE_FAKE_STDOUT=1
  P="$(make_project --git)"
  bash -c "cd '$P' && bridgie init && bridgie bet new b" >/dev/null
  run bash -c "cd '$P' && bridgie seat-run b decide/grill"
  [ "$status" -eq 0 ]
  [ -f "$output/reply.txt" ]
  grep -q '"seat": "grill"' "$output/seat-output.json"
  grep -q '"vendor":"fake-producer"' "$output/adapter.json"
}

@test "fake script runs inside the working directory" {
  d="$(mktemp -d)"; mkdir -p "$d/.bridgie/runs/b/x"; echo p > "$d/p.md"
  printf 'echo "$1 $2" > touched.txt\n' > "$d/s.sh"
  BRIDGIE_FAKE_SCRIPT="$d/s.sh" FAKE --seat "$BRIDGIE_HOME/seats/decide/grill" --prompt "$d/p.md" --out "$d/.bridgie/runs/b/x/o.json" --cwd "$d" --mode write --model m >/dev/null
  [ "$(cat "$d/touched.txt")" = "grill 1" ]
}

# --- real adapters against stub CLIs ---------------------------------------
stub_env() {   # creates stub claude/codex/agy on PATH; each logs args and replies with a json block
  S="$(mktemp -d)"; export STUB_LOG="$S/args.log"
  cat > "$S/claude" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$STUB_LOG"; printf 'cwd=%s\n' "$PWD" >> "$STUB_LOG"; cat > "${STUB_LOG}.stdin"
printf 'Done.\n```json\n{"seat":"grill","summary_md":"from claude"}\n```\n'
STUB
  cat > "$S/codex" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$STUB_LOG"; cat > "${STUB_LOG}.stdin"
while [[ $# -gt 0 ]]; do if [[ "$1" == "-o" ]]; then printf '```json\n{"seat":"grill","summary_md":"from codex"}\n```\n' > "$2"; fi; shift; done
STUB
  cat > "$S/agy" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$STUB_LOG"
printf '```json\n{"seat":"grill","summary_md":"from agy"}\n```\n'
STUB
  cat > "$S/copilot" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$STUB_LOG"; printf 'cwd=%s\n' "$PWD" >> "$STUB_LOG"
printf 'ok\n```json\n{"seat":"grill","summary_md":"from copilot"}\n```\n'
STUB
  chmod +x "$S"/claude "$S"/codex "$S"/agy "$S"/copilot
  export PATH="$S:$PATH"
  W="$(mktemp -d)"; mkdir -p "$W/run"; echo "PROMPT-BODY" > "$W/run/prompt.md"
}
run_adapter() { "$BRIDGIE_HOME/adapters/$1/run.sh" --seat "$BRIDGIE_HOME/seats/decide/grill" --prompt "$W/run/prompt.md" --out "$W/run/seat-output.json" --cwd "$W" "${@:2}"; }

@test "claude-code: readonly uses dontAsk with no edit tools; prompt on stdin; JSON extracted" {
  stub_env
  run run_adapter claude-code --mode readonly --model default
  [ "$status" -eq 0 ]
  grep -q '"summary_md": "from claude"' "$W/run/seat-output.json"
  grep -qx -- '-p' "$STUB_LOG"; grep -qx 'dontAsk' "$STUB_LOG"; grep -qx 'Edit' "$STUB_LOG"
  ! grep -qx -- '--model' "$STUB_LOG"
  grep -q 'PROMPT-BODY' "${STUB_LOG}.stdin"
  grep -qx "cwd=$W" "$STUB_LOG"
}

@test "claude-code: write mode uses acceptEdits, passes model and effort, blocks push" {
  stub_env
  run run_adapter claude-code --mode write --model opus --effort xhigh
  [ "$status" -eq 0 ]
  grep -qx 'acceptEdits' "$STUB_LOG"; grep -qx 'opus' "$STUB_LOG"; grep -qx 'xhigh' "$STUB_LOG"
  grep -qx 'Bash(git push:\*)' "$STUB_LOG"
}

@test "codex: read-only sandbox, -C cwd, -o reply, -m only when a model is set" {
  stub_env
  run run_adapter codex --mode readonly --model default
  [ "$status" -eq 0 ]
  grep -q '"summary_md": "from codex"' "$W/run/seat-output.json"
  grep -qx 'read-only' "$STUB_LOG"; grep -qx -- "-C" "$STUB_LOG"; grep -qx "$W" "$STUB_LOG"
  ! grep -qx -- '-m' "$STUB_LOG"
  run run_adapter codex --mode write --model gpt-5 --effort high
  grep -qx 'workspace-write' "$STUB_LOG"; grep -qx 'gpt-5' "$STUB_LOG"; grep -qx 'model_reasoning_effort="high"' "$STUB_LOG"
}

@test "antigravity: project from env, plan mode when readonly, --print last" {
  stub_env
  BRIDGIE_AGY_PROJECT=proj-123 run run_adapter antigravity --mode readonly --model default
  [ "$status" -eq 0 ]
  grep -q '"summary_md": "from agy"' "$W/run/seat-output.json"
  grep -qx 'proj-123' "$STUB_LOG"; grep -qx 'plan' "$STUB_LOG"
  [ "$(tail -2 "$STUB_LOG" | head -1)" = "--print" ]
  tail -1 "$STUB_LOG" | grep -q 'prompt.md'
}

@test "antigravity: finds the project whose folderUri covers the working dir" {
  stub_env
  H="$(mktemp -d)"; mkdir -p "$H/.gemini/config/projects"
  printf '{"id":"other","folderUri":"file:///somewhere/else"}' > "$H/.gemini/config/projects/a.json"
  printf '{"id":"mine","folderUri":"file://%s"}' "$W" > "$H/.gemini/config/projects/b.json"
  HOME="$H" run run_adapter antigravity --mode readonly --model default
  [ "$status" -eq 0 ]
  grep -qx 'mine' "$STUB_LOG"
}

@test "adapters fail clearly when the model gives no JSON, and probe/capabilities work" {
  stub_env
  printf '#!/usr/bin/env bash\ncat >/dev/null; echo "no json here"\n' > "$(dirname "$STUB_LOG")/claude"
  run run_adapter claude-code --mode readonly --model default
  [ "$status" -ne 0 ]
  [[ "$output" == *"no JSON block"* ]]
  run "$BRIDGIE_HOME/adapters/codex/run.sh" --probe
  [ "$output" = "OK" ]
  run "$BRIDGIE_HOME/adapters/antigravity/run.sh" --capabilities
  [ "$output" = '{"vendor":"google","reads_repo":true}' ]
}

@test "copilot: -p instruction last, read-only denies write, vendor follows the model" {
  stub_env
  run run_adapter copilot --mode readonly --model claude-opus-5.5 --effort high
  [ "$status" -eq 0 ]
  grep -q '"summary_md": "from copilot"' "$W/run/seat-output.json"
  grep -qx 'claude-opus-5.5' "$STUB_LOG"; grep -qx 'high' "$STUB_LOG"; grep -qx 'write' "$STUB_LOG"
  [ "$(grep -n -- '--deny-tool' "$STUB_LOG" | wc -l)" -ge 1 ]
  [ "$(tail -3 "$STUB_LOG" | head -1)" = "-p" ]
  run "$BRIDGIE_HOME/adapters/copilot/run.sh" --capabilities --model claude-opus-5.5
  [ "$output" = '{"vendor":"anthropic","reads_repo":true}' ]
  run "$BRIDGIE_HOME/adapters/copilot/run.sh" --capabilities --model gpt-5.6
  [ "$output" = '{"vendor":"openai","reads_repo":true}' ]
}
