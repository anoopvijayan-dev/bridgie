#!/usr/bin/env bats
load helpers

setup() {
  # shellcheck source=../runner/lib/common.sh
  source "$BRIDGIE_HOME/runner/lib/common.sh"
  # shellcheck source=../runner/lib/git.sh
  source "$BRIDGIE_HOME/runner/lib/git.sh"
  P="$(make_project --git)"
  (cd "$P" && bridgie init >/dev/null 2>&1)
}

@test "require_clean ignores .bridgie but refuses other changes" {
  run git_require_clean "$P"
  [ "$status" -eq 0 ]
  echo change >> "$P/README.md"
  run git_require_clean "$P"
  [ "$status" -ne 0 ]
  [[ "$output" == *"uncommitted"* ]]
}

@test "feature_start creates bridgie/<slug> from the current branch and prints the base" {
  run git_feature_start "$P" net
  [ "$status" -eq 0 ]
  [ "$output" = "main" ]
  [ "$(git -C "$P" branch --show-current)" = "bridgie/net" ]
  run git_feature_start "$P" net        # idempotent
  [ "$output" = "main" ]
}

@test "task worktree is created inside .bridgie/worktrees, reused, and ignored by git" {
  git_feature_start "$P" net >/dev/null
  wt="$(git_task_worktree "$P" net T1)"
  [ "$wt" = "$P/.bridgie/worktrees/net/T1" ]
  [ "$(git -C "$wt" branch --show-current)" = "bridgie-task/net/T1" ]
  [ "$(git_task_worktree "$P" net T1)" = "$wt" ]
  ! git -C "$P" status --porcelain | grep -q worktrees
}

@test "diff packet excludes .bridgie (R8) and lists changed files" {
  git_feature_start "$P" net >/dev/null
  wt="$(git_task_worktree "$P" net T1)"
  echo code > "$wt/app.txt"; mkdir -p "$wt/.bridgie/runs/x"; echo transcript > "$wt/.bridgie/runs/x/out.md"
  git_commit_all "$wt" "work"
  d="$(mktemp -d)"
  git_diff_packet "$P" net T1 "$d"
  grep -q 'app.txt' "$d/diff.patch"
  ! grep -q 'transcript' "$d/diff.patch"
  grep -qx 'app.txt' "$d/files.txt"
}

@test "bridgie_changes flags committed and uncommitted .bridgie edits in a worktree" {
  git_feature_start "$P" net >/dev/null
  wt="$(git_task_worktree "$P" net T1)"
  [ -z "$(git_bridgie_changes "$P" net T1)" ]
  mkdir -p "$wt/.bridgie/specs/net"; echo '{}' > "$wt/.bridgie/specs/net/tasks.json"
  [ -n "$(git_bridgie_changes "$P" net T1)" ]
}

@test "reset_task discards an attempt; merge_task merges into the feature branch only" {
  git_feature_start "$P" net >/dev/null
  wt="$(git_task_worktree "$P" net T1)"
  head="$(git -C "$wt" rev-parse HEAD)"
  echo bad > "$wt/bad.txt"; git_commit_all "$wt" "bad"
  git_reset_task "$wt" "$head"
  [ ! -f "$wt/bad.txt" ]
  echo good > "$wt/good.txt"; git_commit_all "$wt" "good"
  git_merge_task "$P" net T1
  [ -f "$P/good.txt" ]
  [ ! -d "$wt" ]
  ! git -C "$P" rev-parse --verify -q bridgie-task/net/T1
  git -C "$P" show main:README.md >/dev/null
  ! git -C "$P" show main:good.txt 2>/dev/null
}

@test "review worktree is detached at the task head and removable" {
  git_feature_start "$P" net >/dev/null
  wt="$(git_task_worktree "$P" net T1)"; echo x > "$wt/x.txt"; git_commit_all "$wt" x
  rv="$(git_review_worktree "$P" net T1)"
  [ "$(git -C "$rv" rev-parse HEAD)" = "$(git -C "$wt" rev-parse HEAD)" ]
  [ -z "$(git -C "$rv" status --porcelain)" ]
  git_remove_worktree "$P" "$rv"
  [ ! -d "$rv" ]
}
