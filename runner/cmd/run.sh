# shellcheck shell=bash
# bridgie run <slug> — drive the bet as far as it can go without a human:
# shape → plan → (build → verify)* → accept packaging. Stops at every human decision.

run_step() {   # run_step <args...>: one bridgie subcommand in its own process; returns its exit code
  log "→ bridgie $*"
  "$BRIDGIE_HOME/bin/bridgie" "$@"
}

# stop_or_fail <rc>: exit code 3 means a person must decide (clean stop); anything else is an error.
stop_or_fail() { [[ "$1" -eq 3 ]] && return 0; return "$1"; }

cmd_run() {
  local slug="${1:-}"; [[ -n "$slug" ]] || die "usage: bridgie run <slug>"
  local root; root="$(project_root)"
  local specs="$root/.bridgie/specs/$slug" i status
  for ((i = 0; i < 60; i++)); do
    status="$(node_run state.mjs fm-get "$root/.bridgie/bets/$slug/bet.md" status | tr -d '"')"
    case "$status" in
      signed) ;;
      delivered|evaluated) log "bet $slug is $status. Next: bridgie learn $slug"; return 0 ;;
      *) die "run: bet '$slug' is '$status'; Decide comes first (bridgie grill $slug, then answer and sign on bridgie open $slug)" ;;
    esac
    if [[ "$(node_run flow.mjs design-approved "$root" "$slug")" != "true" ]]; then
      if [[ -n "$(node_run flow.mjs pending-of-type "$root" "$slug" approve_design)" ]]; then
        log "waiting for you to approve the design: bridgie open $slug"; return 0
      fi
      run_step shape "$slug" || { stop_or_fail $?; return; }
      continue
    fi
    if [[ ! -f "$specs/tasks.json" ]]; then run_step plan "$slug" || { stop_or_fail $?; return; }; continue; fi
    if [[ "$(node_run flow.mjs all-passed "$root" "$slug")" == "true" ]]; then
      if [[ -n "$(node_run flow.mjs pending-of-type "$root" "$slug" accept)" ]]; then
        log "every task passed; waiting for your acceptance: bridgie open $slug"; return 0
      fi
      local decided=""
      [[ -f "$root/.bridgie/acceptance/$slug.md" ]] && decided="$(node_run state.mjs fm-get "$root/.bridgie/acceptance/$slug.md" decision | tr -d '"')"
      if [[ "$decided" == "rejected" ]]; then log "acceptance was rejected; fix, then re-package with bridgie accept $slug"; return 0; fi
      run_step accept "$slug" || { stop_or_fail $?; return; }
      continue
    fi
    local states; states="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).tasks.map(t=>`${t.id}:${t.status}`).join(" "))' "$specs/tasks.json")"
    if [[ "$states" == *":blocked"* ]]; then log "a task is blocked ($states); decide on bridgie open $slug"; return 0; fi
    if [[ "$states" == *":verify"* ]]; then
      local rc=0
      run_step verify "$slug" || rc=$?
      [[ $rc -eq 0 || $rc -eq 2 ]] || { stop_or_fail $rc; return; }   # 2 = verdict failed: loop on to retry
      continue
    fi
    if [[ -n "$(node_run flow.mjs ready-tasks "$root" "$slug")" ]]; then run_step build "$slug" || { stop_or_fail $?; return; }; continue; fi
    log "nothing is ready ($states); see bridgie status"; return 0
  done
  die "run: stopped after $i steps without finishing; see bridgie status"
}
