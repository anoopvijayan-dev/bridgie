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
  run env HOME="$H" "$BRIDGIE_HOME/bin/install.sh" --path --policy
  [ "$status" -eq 0 ]
  [ -f "$H/.claude/skills/bridgie/SKILL.md" ] && [ -f "$H/.agents/skills/bridgie/SKILL.md" ]
  grep -qF "$BRIDGIE_HOME/bin" "$H/.bashrc"
  grep -q 'adapter: copilot' "$H/.bridgie/policy.yaml"
  BRIDGIE_USER_POLICY="$H/.bridgie/policy.yaml" node "$BRIDGIE_HOME/runner/state.mjs" policy "$(make_project)" >/dev/null 2>&1 || {
    P="$(make_project)"; (cd "$P" && bridgie init) >/dev/null 2>&1
    BRIDGIE_USER_POLICY="$H/.bridgie/policy.yaml" node "$BRIDGIE_HOME/runner/state.mjs" policy "$P" >/dev/null
  }
  run env HOME="$H" "$BRIDGIE_HOME/bin/install.sh" --path --policy
  [ "$(grep -cF "$BRIDGIE_HOME/bin" "$H/.bashrc")" -eq 1 ]
  [[ "$output" == *"already exists"* ]]
}
