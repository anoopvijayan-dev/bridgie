# shellcheck shell=bash
# bridgie status — one line per bet, plus pending decisions.

cmd_status() {
  local root; root="$(project_root)"
  node_run state.mjs status "$root" --table
  local pending; pending="$(node_run state.mjs decision-list "$root" --pending)"
  local n; n="$(printf '%s' "$pending" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s||"[]").length)))')"
  if [[ "$n" != "0" ]]; then
    printf '\n%s decision(s) waiting: bridgie open\n' "$n"
    printf '%s' "$pending" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const d of JSON.parse(s))console.log(`  ${d.bet}  ${d.id}  ${d.type.padEnd(8)} ${d.context.slice(0,70)}`)})'
  fi
}
