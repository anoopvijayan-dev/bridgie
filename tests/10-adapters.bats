#!/usr/bin/env bats
load helpers

FAKE() { node "$BRIDGIE_HOME/adapters/fake/run.mjs" "$@"; }

@test "fake capabilities: producer vs verifier vendors, overrides" {
  run FAKE --capabilities --seat "$BRIDGIE_HOME/seats/build/implementer"
  [ "$output" = '{"vendor":"fake-producer","reads_repo":true,"reads_web":true,"sandbox":"builtin"}' ]
  run FAKE --capabilities --seat "$BRIDGIE_HOME/seats/verify/reviewer"
  [ "$output" = '{"vendor":"fake-verifier","reads_repo":true,"reads_web":true,"sandbox":"builtin"}' ]
  BRIDGIE_FAKE_SAME_VENDOR=1 BRIDGIE_FAKE_READS_REPO=0 BRIDGIE_FAKE_READS_WEB=0 run FAKE --capabilities --seat "$BRIDGIE_HOME/seats/verify/reviewer"
  [ "$output" = '{"vendor":"fake","reads_repo":false,"reads_web":false,"sandbox":"builtin"}' ]
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
stub_env() {   # stub claude/codex/agy/copilot CLIs on PATH (.cmd launchers on Windows); each logs args and replies with JSON
  S="$(mktemp -d)"; export STUB_LOG="$S/args.log"
  cat > "$S/stub.mjs" <<'STUB'
import { writeFileSync, readFileSync } from 'node:fs';
const [name, ...args] = process.argv.slice(2);
const log = process.env.STUB_LOG, lines = [...args];
if (name === 'claude' || name === 'copilot') lines.push(`cwd=${process.cwd()}`);
if (name === 'claude') lines.push(`max_output=${process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS ?? ''}`);
writeFileSync(log, lines.join('\n') + '\n');
if (name === 'claude' || name === 'codex') writeFileSync(log + '.stdin', readFileSync(0));
const json = s => '```json\n{"seat":"grill","summary_md":"from ' + s + '"}\n```\n';
if (process.env.STUB_FAIL) { process.stdout.write(process.env.STUB_FAIL + '\n'); process.exit(1); }
if (name === 'codex' && process.env.STUB_TOKENS) process.stderr.write(`some log\ntokens used\n${process.env.STUB_TOKENS}\n`);
if (name === 'claude' && process.env.STUB_RESULT === '1') {   // the real CLI's --output-format json: one result object
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'Done.\n' + json('claude'), total_cost_usd: 0.4215,
    usage: { input_tokens: 12, output_tokens: 340, cache_creation_input_tokens: 2000, cache_read_input_tokens: 50000 } }) + '\n');
  process.exit(0);
}
if (process.env.STUB_NOJSON === '1') process.stdout.write('no json here\n');
else if (name === 'codex') writeFileSync(args[args.indexOf('-o') + 1], json('codex'));
else process.stdout.write((name === 'claude' ? 'Done.\n' : name === 'copilot' ? 'ok\n' : '') + json(name));
STUB
  for c in claude codex agy copilot; do make_cli_stub "$S" "$c" "$S/stub.mjs"; done
  export PATH="$S:$PATH"
  W="$(mktemp -d)"; mkdir -p "$W/run"; echo "PROMPT-BODY" > "$W/run/prompt.md"
}
run_adapter() { node "$BRIDGIE_HOME/adapters/$1/run.mjs" --seat "$BRIDGIE_HOME/seats/decide/grill" --prompt "$W/run/prompt.md" --out "$W/run/seat-output.json" --cwd "$W" "${@:2}"; }

@test "claude-code: readonly uses dontAsk with no edit tools; prompt on stdin; JSON extracted" {
  stub_env
  run run_adapter claude-code --mode readonly --model default
  [ "$status" -eq 0 ]
  grep -q '"summary_md": "from claude"' "$W/run/seat-output.json"
  grep -qx -- '-p' "$STUB_LOG"; grep -qx 'dontAsk' "$STUB_LOG"; grep -qx 'Edit' "$STUB_LOG"
  ! grep -qx -- '--model' "$STUB_LOG"
  grep -q 'PROMPT-BODY' "${STUB_LOG}.stdin"
  has_path_line "$STUB_LOG" "cwd=" "$W"
}

@test "claude-code: asks for the model's output ceiling unless one is already set" {
  stub_env
  run env -u CLAUDE_CODE_MAX_OUTPUT_TOKENS bash -c "$(declare -f run_adapter); W='$W' BRIDGIE_HOME='$BRIDGIE_HOME' run_adapter claude-code --mode readonly --model default"
  [ "$status" -eq 0 ]
  grep -qx 'max_output=128000' "$STUB_LOG"
  CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000 run run_adapter claude-code --mode readonly --model default
  [ "$status" -eq 0 ]
  grep -qx 'max_output=64000' "$STUB_LOG"
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
  grep -qx 'read-only' "$STUB_LOG"; grep -qx -- "-C" "$STUB_LOG"; has_path_line "$STUB_LOG" "" "$W"
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
  printf '{"id":"mine","folderUri":"file://%s"}' "$(native "$W" | tr '\\' /)" > "$H/.gemini/config/projects/b.json"
  HOME="$H" USERPROFILE="$(native "$H")" run run_adapter antigravity --mode readonly --model default
  [ "$status" -eq 0 ]
  grep -qx 'mine' "$STUB_LOG"
}

@test "adapters fail clearly when the model gives no JSON, and probe/capabilities work" {
  stub_env
  STUB_NOJSON=1 run run_adapter claude-code --mode readonly --model default
  [ "$status" -ne 0 ]
  [[ "$output" == *"no JSON block"* ]]
  run node "$BRIDGIE_HOME/adapters/codex/run.mjs" --probe
  [ "$output" = "OK" ]
  run node "$BRIDGIE_HOME/adapters/antigravity/run.mjs" --capabilities
  [ "$output" = '{"vendor":"google","reads_repo":true,"reads_web":false,"sandbox":"none"}' ]
  run node "$BRIDGIE_HOME/adapters/claude-code/run.mjs" --capabilities
  [[ "$output" == '{"vendor":"anthropic","reads_repo":true,"reads_web":true,"sandbox":"'* ]]   # os or none: depends on the machine
}

@test "a CLI that fails (e.g. signed out) is reported as a CLI failure with its message, not as a bad reply" {
  stub_env
  STUB_FAIL="Failed to authenticate: OAuth session expired" run run_adapter claude-code --mode readonly --model default
  [ "$status" -eq 6 ]
  [[ "$output" == *"the CLI failed (exit 1)"* ]]
  [[ "$output" == *"OAuth session expired"* ]]
}

@test "copilot: -p instruction last, read-only denies write, vendor follows the model" {
  stub_env
  run run_adapter copilot --mode readonly --model claude-opus-5.5 --effort high
  [ "$status" -eq 0 ]
  grep -q '"summary_md": "from copilot"' "$W/run/seat-output.json"
  grep -qx 'claude-opus-5.5' "$STUB_LOG"; grep -qx 'high' "$STUB_LOG"; grep -qx 'write' "$STUB_LOG"
  [ "$(grep -n -- '--deny-tool' "$STUB_LOG" | wc -l)" -ge 1 ]
  [ "$(tail -3 "$STUB_LOG" | head -1)" = "-p" ]
  run node "$BRIDGIE_HOME/adapters/copilot/run.mjs" --capabilities --model claude-opus-5.5
  [ "$output" = '{"vendor":"anthropic","reads_repo":true,"reads_web":false,"sandbox":"none"}' ]
  BRIDGIE_COPILOT_WEB=1 run node "$BRIDGIE_HOME/adapters/copilot/run.mjs" --capabilities --model gpt-5.6
  [ "$output" = '{"vendor":"openai","reads_repo":true,"reads_web":true,"sandbox":"none"}' ]
}

@test "web tools: claude-code allows WebSearch read-only; codex passes --search" {
  stub_env
  run run_adapter claude-code --mode readonly --model default
  [ "$status" -eq 0 ]
  grep -qx 'WebSearch' "$STUB_LOG"; grep -qx 'WebFetch' "$STUB_LOG"
  stub_env
  run run_adapter codex --mode readonly --model default
  [ "$status" -eq 0 ]
  grep -qx -- '--search' "$STUB_LOG"
  # codex-cli 0.169 accepts --search only before the exec subcommand
  [ "$(grep -nx -- '--search' "$STUB_LOG" | cut -d: -f1)" -lt "$(grep -nx 'exec' "$STUB_LOG" | cut -d: -f1)" ]
}

@test "claude-code: asks for the JSON result, keeps the reply as before and records tokens and cost" {
  stub_env
  STUB_RESULT=1 run run_adapter claude-code --mode readonly --model default
  [ "$status" -eq 0 ]
  grep -qx -- '--output-format' "$STUB_LOG"; grep -qx 'json' "$STUB_LOG"
  grep -q '"summary_md": "from claude"' "$W/run/seat-output.json"
  grep -q '^Done\.$' "$W/run/reply.txt"
  [ ! -e "$W/run/claude.json" ]
  [ "$(node -e 'const u=require(process.argv[1]); console.log([u.tokens_in,u.tokens_out,u.tokens_cache_read,u.tokens_cache_write,u.tokens_total,u.usd].join(" "))' "$W/run/usage.json")" = "12 340 50000 2000 52352 0.4215" ]
}

@test "claude-code: a CLI that prints plain text (older, or failing before the run) still works and records no usage" {
  stub_env
  run run_adapter claude-code --mode readonly --model default
  [ "$status" -eq 0 ]
  grep -q '"summary_md": "from claude"' "$W/run/seat-output.json"
  [ ! -e "$W/run/usage.json" ]
}

@test "codex: the token total at the end of its log is recorded; no cost is invented" {
  stub_env
  STUB_TOKENS="68,485" run run_adapter codex --mode readonly --model default
  [ "$status" -eq 0 ]
  [ "$(node -e 'const u=require(process.argv[1]); console.log(u.tokens_total, u.usd, u.tokens_in)' "$W/run/usage.json")" = "68485 null null" ]
  rm -f "$W/run/usage.json" "$W/run/seat-output.json"
  run run_adapter codex --mode readonly --model default
  [ "$status" -eq 0 ]
  [ ! -e "$W/run/usage.json" ]
}

@test "claude-code: a seat that writes is sandboxed when the runner asks; shell and file writes are held to the worktree" {
  stub_env
  BRIDGIE_SANDBOX=required BRIDGIE_SANDBOX_NETWORK="registry.npmjs.org, pypi.org" run run_adapter claude-code --mode write --model default
  [ "$status" -eq 0 ]
  grep -qx -- '--settings' "$STUB_LOG"
  f="$W/run/sandbox-settings.json"; [ -f "$f" ]
  has_path_line "$STUB_LOG" "" "$f"
  node -e '
    const s = require(process.argv[1]), sb = s.sandbox;
    const ok = sb.enabled === true && sb.failIfUnavailable === true && sb.allowUnsandboxedCommands === false && sb.autoAllowBashIfSandboxed === true
      && JSON.stringify(sb.network.allowedDomains) === JSON.stringify(["registry.npmjs.org", "pypi.org"]) && sb.filesystem.allowWrite.length === 1
      && s.permissions.blockWritesOutsideWorkingDirectories === true;
    process.exit(ok ? 0 : 1)' "$f"
  BRIDGIE_SANDBOX=auto run run_adapter claude-code --mode write --model default
  [ "$(node -e 'console.log(require(process.argv[1]).sandbox.failIfUnavailable)' "$f")" = "false" ]   # auto: run anyway where there is none
}

@test "claude-code: no sandbox settings unless asked, and never for a read-only seat" {
  stub_env
  run run_adapter claude-code --mode write --model default
  [ "$status" -eq 0 ]
  ! grep -qx -- '--settings' "$STUB_LOG"
  BRIDGIE_SANDBOX=required run run_adapter claude-code --mode readonly --model default
  [ "$status" -eq 0 ]
  ! grep -qx -- '--settings' "$STUB_LOG"
}

@test "capabilities say what sandbox each adapter has" {
  run node "$BRIDGIE_HOME/adapters/codex/run.mjs" --capabilities
  [[ "$output" == *'"sandbox":"builtin"'* ]]
  run node "$BRIDGIE_HOME/adapters/claude-code/run.mjs" --capabilities
  [[ "$output" == *'"sandbox":"os"'* || "$output" == *'"sandbox":"none"'* ]]
  run node "$BRIDGIE_HOME/adapters/antigravity/run.mjs" --capabilities
  [[ "$output" == *'"sandbox":"none"'* ]]
}
