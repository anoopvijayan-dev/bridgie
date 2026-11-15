#!/usr/bin/env bats
load helpers

@test "the bridgie skill has a name and a description without angle brackets" {
  run node "$BRIDGIE_HOME/runner/state.mjs" fm-get "$BRIDGIE_HOME/skills/bridgie/SKILL.md" name
  [ "$output" = '"bridgie"' ]
  d="$(node "$BRIDGIE_HOME/runner/state.mjs" fm-get "$BRIDGIE_HOME/skills/bridgie/SKILL.md" description)"
  [ "${#d}" -gt 50 ]
  [ "${#d}" -lt 1024 ]
  [[ "$d" != *"<"* ]]
}

# stubs <home>: fake npm and npx on $H/stub that log their arguments to $H/npm.log and $H/npx.log
stubs() {
  mkdir -p "$1/stub"
  printf 'require("fs").appendFileSync(process.argv[2], process.argv.slice(3).join(" ") + "\\n")\n' > "$1/log.cjs"
  for c in npm npx; do
    if on_windows; then printf '@node "%s" "%s" %%*\r\n' "$(native "$1/log.cjs")" "$(native "$1/$c.log")" > "$1/stub/$c.cmd"
    else printf '#!/bin/sh\nexec node "%s" "%s" "$@"\n' "$1/log.cjs" "$1/$c.log" > "$1/stub/$c"; chmod +x "$1/stub/$c"; fi
  done
}

@test "setup links the clone, installs the skill through the skills installer, writes a policy once, and is safe to re-run" {
  H="$(mktemp -d)"; stubs "$H"
  run env HOME="$H" USERPROFILE="$(native "$H")" PATH="$H/stub:$PATH" node "$BRIDGIE_HOME/bin/bridgie.mjs" setup
  [ "$status" -eq 0 ]
  cat "$H/npm.log" "$H/npx.log"
  has_path_line "$H/npm.log" "install -g " "$BRIDGIE_HOME"            # a git clone is linked, not downloaded
  grep -q -- "-y skills@1.8.1 add .*skills.bridgie -g -y --copy$" "$H/npx.log"
  [[ "$output" == *"works in PowerShell, cmd, Git Bash, macOS and Linux"* ]]
  [[ "$output" == *"upload skills/bridgie/SKILL.md"* ]]
  grep -q 'adapter: ' "$H/.bridgie/policy.yaml"
  run env HOME="$H" USERPROFILE="$(native "$H")" PATH="$H/stub:$PATH" "$BRIDGIE_HOME/bin/install.sh"      # old entry point still works
  [ "$status" -eq 0 ]
  [[ "$output" == *"already exists"* ]]
  run env HOME="$H" USERPROFILE="$(native "$H")" PATH="$H/stub:$PATH" node "$BRIDGIE_HOME/bin/bridgie.mjs" setup --no-link --no-policy --agent claude-code --agent codex
  [ "$status" -eq 0 ]
  [ "$(grep -c 'install -g' "$H/npm.log")" -eq 2 ]
  grep -q -- "--copy --agent claude-code codex$" "$H/npx.log"
}

@test "setup from the npm package installs that version of bridgie, not the npx cache folder" {
  C="$(mktemp -d)/bridgie"; mkdir -p "$C"
  for d in bin runner schemas policy templates ui adapters seats lanes skills; do cp -r "$BRIDGIE_HOME/$d" "$C/"; done
  cp "$BRIDGIE_HOME/VERSION" "$C/"
  H="$(mktemp -d)"; stubs "$H"
  run env HOME="$H" USERPROFILE="$(native "$H")" PATH="$H/stub:$PATH" BRIDGIE_HOME="$C" node "$C/bin/bridgie.mjs" setup --no-skill --no-policy
  [ "$status" -eq 0 ]
  grep -qx "install -g bridgie@$(cat "$BRIDGIE_HOME/VERSION")" "$H/npm.log"
  [ ! -f "$H/npx.log" ]
}

@test "doctor reports installed skill copies as current or out of date" {
  H="$(mktemp -d)"; mkdir -p "$H/.agents/skills" "$H/.claude/skills"
  cp -r "$BRIDGIE_HOME/skills/bridgie" "$H/.agents/skills/"; cp -r "$BRIDGIE_HOME/skills/bridgie" "$H/.claude/skills/"
  run env -u CLAUDE_CODE_REMOTE bash -c "cd '$(mktemp -d)' && HOME='$H' USERPROFILE='$(native "$H")' bridgie doctor"
  [[ "$output" == *"[ok] skill current for Claude Code"* ]]
  [[ "$output" == *"[ok] skill current for agents that read ~/.agents/skills"* ]]
  echo 'old' > "$H/.claude/skills/bridgie/SKILL.md"
  run env -u CLAUDE_CODE_REMOTE bash -c "cd '$(mktemp -d)' && HOME='$H' USERPROFILE='$(native "$H")' bridgie doctor"
  [ "$status" -eq 0 ]                                     # a stale skill warns, it does not fail
  [[ "$output" == *"[warn] skill out of date for Claude Code"* ]]
  run env -u CLAUDE_CODE_REMOTE bash -c "cd '$(mktemp -d)' && HOME='$(mktemp -d)' bridgie doctor"
  [[ "$output" == *"[warn] agent skill not installed"* ]]
}

@test "the skill covers chat, local terminals and cloud sessions, and names no one's machine" {
  S="$BRIDGIE_HOME/skills/bridgie/SKILL.md"
  grep -q 'device_bash' "$S"
  grep -q 'CLAUDE_CODE_REMOTE' "$S"
  grep -q 'npx -y bridgie' "$S"
  ! grep -qiE 'anoop|source/repos|/home/user' "$S"
}

@test "the npm package version matches VERSION, and the package ships the skill but not the tests" {
  [ "$(node -p 'require(process.argv[1]).version' "$BRIDGIE_HOME/package.json")" = "$(cat "$BRIDGIE_HOME/VERSION")" ]
  run bash -c "cd '$BRIDGIE_HOME' && npm pack --dry-run --json"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"skills/bridgie/SKILL.md"'* ]]
  [[ "$output" == *'"LICENSE"'* ]]
  [[ "$output" != *'"tests/'* ]]
  [[ "$output" != *'.test.mjs"'* ]]
  [[ "$output" != *'"docs/'* ]]
}

@test "setup removes the old bash-era Windows shim, and leaves other files alone" {
  H="$(mktemp -d)"; W="$H/AppData/Local/Microsoft/WindowsApps"; mkdir -p "$W"
  printf '@echo off\r\n"C:\\Git\\usr\\bin\\bash.exe" "/c/Users/x/bridgie/bin/bridgie" %%*\r\n' > "$W/bridgie.cmd"
  echo 'something else' > "$W/other.cmd"
  run env HOME="$H" USERPROFILE="$(native "$H")" LOCALAPPDATA="$(native "$H/AppData/Local")" node "$BRIDGIE_HOME/bin/bridgie.mjs" setup --no-link --no-skill --no-policy
  [ "$status" -eq 0 ]
  [ ! -e "$W/bridgie.cmd" ]
  [ -f "$W/other.cmd" ]
  [[ "$output" == *"removed the old bash shim"* ]]
}

@test "bridgie new makes the folder, the git repo and the state in one step; plain bridgie says what to do next" {
  W="$(mktemp -d)"
  run bash -c "cd '$W' && bridgie new my-idea --lane product"
  [ "$status" -eq 0 ]
  [ -d "$W/my-idea/.git" ]
  [ -f "$W/my-idea/.bridgie/policy.yaml" ]
  grep -q 'default_lane: product' "$W/my-idea/.bridgie/policy.yaml"
  [[ "$output" == *"bridgie bet new"* ]]
  run bash -c "cd '$W' && bridgie"
  [[ "$output" == *"not inside a Bridgie project"* ]]
  run bash -c "cd '$W/my-idea' && bridgie"
  [[ "$output" == *"no bets yet"* ]]
  bash -c "cd '$W/my-idea' && bridgie bet new b --title T" >/dev/null
  run bash -c "cd '$W/my-idea' && bridgie"
  [[ "$output" == *"b: T — draft"* ]]
  [[ "$output" == *"bridgie grill b --lenses"* ]]
  run bash -c "cd '$W' && bridgie new my-idea"
  [ "$status" -ne 0 ]
}

@test "bridgie runs with nothing but node on PATH (no bash tools needed)" {
  on_windows && skip "covered by the PowerShell and cmd CI steps"
  T="$(mktemp -d)"; ln -s "$(command -v node)" "$T/node"; ln -s "$(command -v git)" "$T/git"
  run env -i HOME="$HOME" PATH="$T" "$T/node" "$BRIDGIE_HOME/bin/bridgie.mjs" version
  [ "$status" -eq 0 ]
  [[ "$output" == bridgie\ 0.* ]]
  W="$(mktemp -d)"
  run env -i HOME="$HOME" PATH="$T" BRIDGIE_USER=t "$BASH" -c "cd '$W' && '$T/node' '$BRIDGIE_HOME/bin/bridgie.mjs' new p --lane product"
  [ "$status" -eq 0 ]
  [ -f "$W/p/.bridgie/policy.yaml" ]
}

@test "a folder under the home directory is not a project just because ~/.bridgie holds the machine policy" {
  H="$(mktemp -d)"; mkdir -p "$H/.bridgie" "$H/Downloads"; echo 'version: 1' > "$H/.bridgie/policy.yaml"
  run env HOME="$H" USERPROFILE="$(native "$H")" bash -c "cd '$H/Downloads' && bridgie"
  [[ "$output" == *"not inside a Bridgie project"* ]]
  run env HOME="$H" USERPROFILE="$(native "$H")" bash -c "cd '$H/Downloads' && bridgie status"
  [ "$status" -ne 0 ]
  [[ "$output" == *"not inside a bridgie project"* ]]
}

@test "init writes LF files even when Bridgie itself was checked out with CRLF (Windows autocrlf)" {
  C="$(mktemp -d)"; cp -R "$BRIDGIE_HOME/." "$C/"
  for f in "$C/templates/"*; do node -e 'const fs=require("fs"),f=process.argv[1]; fs.writeFileSync(f, fs.readFileSync(f,"utf8").replace(/\r?\n/g,"\r\n"))' "$f"; done
  P="$(mktemp -d)"; git -C "$P" init -q
  run bash -c "cd '$P' && BRIDGIE_HOME='$C' node '$C/bin/bridgie.mjs' init --lane product && BRIDGIE_HOME='$C' node '$C/bin/bridgie.mjs' bet new b --title T"
  [ "$status" -eq 0 ]
  [[ "$output" != *"CRLF"* ]]
  run node -e '
    const fs = require("fs"), bad = process.argv.slice(1).filter(f => fs.readFileSync(f, "utf8").includes("\r"));
    for (const f of bad) console.log("CRLF:", f, JSON.stringify(fs.readFileSync(f, "utf8").split("\n").find(l => l.includes("\r"))));
    process.exit(bad.length ? 1 : 0)' "$P/.bridgie/.gitignore" "$P/.bridgie/policy.yaml" "$P/.bridgie/bets/b/bet.md"
  echo "$output"
  [ "$status" -eq 0 ]
}
