#!/usr/bin/env bats
load helpers

@test "the bridgie skill has a name and a description without angle brackets" {
  run node "$BRIDGIE_HOME/runner/state.mjs" fm-get "$BRIDGIE_HOME/skills/bridgie/SKILL.md" name
  [ "$output" = '"bridgie"' ]
  d="$(node "$BRIDGIE_HOME/runner/state.mjs" fm-get "$BRIDGIE_HOME/skills/bridgie/SKILL.md" description)"
  [ "${#d}" -gt 50 ] && [ "${#d}" -lt 1024 ]
  [[ "$d" != *"<"* ]]
}

@test "install copies the skill, adds PATH once, and creates a routing policy once" {
  H="$(mktemp -d)"; mkdir -p "$H/.claude" "$H/.agents"
  run env HOME="$H" "$BRIDGIE_HOME/bin/install.sh"
  [ "$status" -eq 0 ]
  [ -f "$H/.claude/skills/bridgie/SKILL.md" ] && [ -f "$H/.agents/skills/bridgie/SKILL.md" ]
  grep -qF "$BRIDGIE_HOME/bin" "$H/.bashrc"
  grep -qF "$BRIDGIE_HOME/bin" "$H/.bash_profile"     # Git Bash and macOS login shells read this one
  grep -q 'adapter: copilot' "$H/.bridgie/policy.yaml"
  BRIDGIE_USER_POLICY="$H/.bridgie/policy.yaml" node "$BRIDGIE_HOME/runner/state.mjs" policy "$(make_project)" >/dev/null 2>&1 || {
    P="$(make_project)"; (cd "$P" && bridgie init) >/dev/null 2>&1
    BRIDGIE_USER_POLICY="$H/.bridgie/policy.yaml" node "$BRIDGIE_HOME/runner/state.mjs" policy "$P" >/dev/null
  }
  run env HOME="$H" "$BRIDGIE_HOME/bin/install.sh" --path --policy     # old flags still accepted
  [ "$(grep -cF "$BRIDGIE_HOME/bin" "$H/.bashrc")" -eq 1 ]
  [ "$(grep -cF "$BRIDGIE_HOME/bin" "$H/.bash_profile")" -eq 1 ]
  [[ "$output" == *"already exists"* ]]
}

@test "on Windows the installer drops a bridgie.cmd shim where PowerShell and cmd already look" {
  H="$(mktemp -d)"; mkdir -p "$H/AppData/Local/Microsoft/WindowsApps" "$H/bin"
  cat > "$H/bin/cygpath" <<'SH'
#!/usr/bin/env bash
case "$1" in -w) echo "C:\\fake$2" ;; -u) echo "$2" ;; esac
SH
  chmod +x "$H/bin/cygpath"
  run env HOME="$H" MSYSTEM=MINGW64 LOCALAPPDATA="$H/AppData/Local" PATH="$H/bin:$PATH" "$BRIDGIE_HOME/bin/install.sh" --no-policy
  [ "$status" -eq 0 ]
  [ -f "$H/AppData/Local/Microsoft/WindowsApps/bridgie.cmd" ]
  grep -q '@echo off' "$H/AppData/Local/Microsoft/WindowsApps/bridgie.cmd"
  grep -qF 'bin/bridgie" %*' "$H/AppData/Local/Microsoft/WindowsApps/bridgie.cmd"
  grep -q '^set "PATH=C:.*;%PATH%"' "$H/AppData/Local/Microsoft/WindowsApps/bridgie.cmd"   # Git tools first
  [[ "$output" == *"works from PowerShell and cmd too"* ]]
}

@test "bridgie new makes the folder, the git repo and the state in one step; plain bridgie says what to do next" {
  W="$(mktemp -d)"
  run bash -c "cd '$W' && bridgie new my-idea --lane product"
  [ "$status" -eq 0 ]
  [ -d "$W/my-idea/.git" ] && [ -f "$W/my-idea/.bridgie/policy.yaml" ]
  grep -q 'default_lane: product' "$W/my-idea/.bridgie/policy.yaml"
  [[ "$output" == *"bridgie bet new"* ]]
  run bash -c "cd '$W' && bridgie"
  [[ "$output" == *"not inside a Bridgie project"* ]]
  run bash -c "cd '$W/my-idea' && bridgie"
  [[ "$output" == *"no bets yet"* ]]
  bash -c "cd '$W/my-idea' && bridgie bet new b --title T" >/dev/null
  run bash -c "cd '$W/my-idea' && bridgie"
  [[ "$output" == *"b: T — draft"* ]] && [[ "$output" == *"bridgie grill b --lenses"* ]]
  run bash -c "cd '$W' && bridgie new my-idea"
  [ "$status" -ne 0 ]
}

@test "bin/bridgie starts without dirname on PATH (as from a Windows shim)" {
  T="$(mktemp -d)"; ln -s "$(command -v node)" "$T/node"; for c in tr cat; do ln -s "$(command -v $c)" "$T/$c"; done
  run env -i HOME="$HOME" PATH="$T" "$BASH" "$BRIDGIE_HOME/bin/bridgie" version
  [ "$status" -eq 0 ]
  [[ "$output" == bridgie\ 0.* ]]
}
