# Simulates implementers working side by side ($1 = seat). The task is the worktree folder's name.
# MODE (env BRIDGIE_TEST_MODE): own (default) each task writes its own file; shared: every task writes
# the same file (a merge conflict for the second one verified), and a retry merges the feature branch
# and keeps both; state: T2 edits .bridgie/ in its worktree; tamper: T1 edits the project's policy.
[[ "$1" == "implementer" ]] || exit 0
task="$(basename "$PWD")"
sleep "${BRIDGIE_TEST_SLEEP:-0}"
case "${BRIDGIE_TEST_MODE:-own}" in
  own) echo "built by $task" > "feature-$task.txt" ;;
  shared)
    if git merge -q --no-edit bridgie/b >/dev/null 2>&1; then :; else
      git checkout -q --ours shared.txt 2>/dev/null && git show bridgie/b:shared.txt >> shared.txt && git add shared.txt && git commit -q --no-edit
    fi
    echo "built by $task" >> shared.txt ;;
  state) echo "built by $task" > "feature-$task.txt"; [[ "$task" == "T2" ]] && mkdir -p .bridgie && echo planted > .bridgie/planted.md ;;
  tamper) echo "built by $task" > "feature-$task.txt"; [[ "$task" == "T1" ]] && echo "x: 1" >> ../../../policy.yaml ;;
esac
exit 0
