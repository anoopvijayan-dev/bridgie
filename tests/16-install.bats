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

@test "setup copies the skill, links with npm, creates a routing policy once, and is safe to re-run" {
  H="$(mktemp -d)"; mkdir -p "$H/.claude" "$H/.agents" "$H/stub"
  printf 'require("fs").appendFileSync(process.argv[2], process.argv.slice(3).join(" ") + "\\n")\n' > "$H/npm.cjs"
  if on_windows; then printf '@node "%s" "%s" %%*\r\n' "$(native "$H/npm.cjs")" "$(native "$H/npm.log")" > "$H/stub/npm.cmd"
  else printf '#!/bin/sh\nexec node "%s" "%s" "$@"\n' "$H/npm.cjs" "$H/npm.log" > "$H/stub/npm"; chmod +x "$H/stub/npm"; fi
  run env HOME="$H" USERPROFILE="$(native "$H")" PATH="$H/stub:$PATH" node "$BRIDGIE_HOME/bin/bridgie.mjs" setup
  [ "$status" -eq 0 ]
  [ -f "$H/.claude/skills/bridgie/SKILL.md" ]
  [ -f "$H/.agents/skills/bridgie/SKILL.md" ]
  cat "$H/npm.log"; has_path_line "$H/npm.log" "install -g " "$BRIDGIE_HOME"
  [[ "$output" == *"works in PowerShell, cmd, Git Bash, macOS and Linux"* ]]
  grep -q 'adapter: copilot' "$H/.bridgie/policy.yaml"
  run env HOME="$H" USERPROFILE="$(native "$H")" PATH="$H/stub:$PATH" "$BRIDGIE_HOME/bin/install.sh"      # old entry point still works
  [ "$status" -eq 0 ]
  [[ "$output" == *"already exists"* ]]
  run env HOME="$H" USERPROFILE="$(native "$H")" node "$BRIDGIE_HOME/bin/bridgie.mjs" setup --no-link --no-policy
  [ "$status" -eq 0 ]
  [ "$(wc -l < "$H/npm.log")" -eq 2 ]
}

@test "setup removes the old bash-era Windows shim, and leaves other files alone" {
  H="$(mktemp -d)"; W="$H/AppData/Local/Microsoft/WindowsApps"; mkdir -p "$W"
  printf '@echo off\r\n"C:\\Git\\usr\\bin\\bash.exe" "/c/Users/x/bridgie/bin/bridgie" %%*\r\n' > "$W/bridgie.cmd"
  echo 'something else' > "$W/other.cmd"
  run env HOME="$H" USERPROFILE="$(native "$H")" LOCALAPPDATA="$(native "$H/AppData/Local")" node "$BRIDGIE_HOME/bin/bridgie.mjs" setup --no-link --no-policy
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
