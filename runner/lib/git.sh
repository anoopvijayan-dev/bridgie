# shellcheck shell=bash
# Git model (spec §7.5, M1 plan decision 3):
#   feature branch  bridgie/<slug>             checked out in the project root by `shape`
#   task branch     bridgie-task/<slug>/<task> (git cannot nest refs under bridgie/<slug>)
#   task worktree   <root>/.bridgie/worktrees/<slug>/<task>         (git-ignored)
#   review worktree <root>/.bridgie/worktrees/<slug>/<task>-review  (detached, read-only use)
# Nothing here pushes, and nothing merges into the base branch (R7).

feature_branch() { printf 'bridgie/%s\n' "$1"; }
task_branch()    { printf 'bridgie-task/%s/%s\n' "$1" "$2"; }
task_wt_path()   { printf '%s/.bridgie/worktrees/%s/%s\n' "$1" "$2" "$3"; }

git_is_repo() { git -C "$1" rev-parse --is-inside-work-tree >/dev/null 2>&1; }

# git_require_clean <root>: no uncommitted changes outside .bridgie/.
git_require_clean() {
  local dirty
  dirty="$(git -C "$1" status --porcelain -- . ':(exclude).bridgie' ':(exclude).bridgie/**')"
  [[ -z "$dirty" ]] || die "uncommitted changes outside .bridgie/; commit or stash them first:
$dirty"
}

# Keep worktrees out of git status even in projects initialised before M1.
git_ignore_worktrees() {
  local gi="$1/.bridgie/.gitignore"
  grep -qx 'worktrees/' "$gi" 2>/dev/null || printf 'worktrees/\n' >> "$gi"
}

# git_feature_start <root> <slug>: create or switch to bridgie/<slug>; prints the base branch.
git_feature_start() {
  local root="$1" slug="$2" fb cur
  fb="$(feature_branch "$slug")"
  cur="$(git -C "$root" branch --show-current)"
  git_ignore_worktrees "$root"
  if git -C "$root" rev-parse --verify -q "refs/heads/$fb" >/dev/null; then
    [[ "$cur" == "$fb" ]] || git -C "$root" checkout -q "$fb"
    git -C "$root" config "branch.$fb.bridgieBase" 2>/dev/null || printf 'main\n'
    return 0
  fi
  [[ -n "$cur" ]] || die "detached HEAD; check out the branch to build from first"
  git -C "$root" checkout -q -b "$fb"
  git -C "$root" config "branch.$fb.bridgieBase" "$cur"
  printf '%s\n' "$cur"
}

# git_on_feature <root> <slug>: fail unless the project root has bridgie/<slug> checked out.
git_on_feature() {
  local fb; fb="$(feature_branch "$2")"
  [[ "$(git -C "$1" branch --show-current)" == "$fb" ]] || die "the project must be on branch $fb (git checkout $fb)"
}

# git_task_worktree <root> <slug> <task>: create or reuse; prints the path.
git_task_worktree() {
  local root="$1" slug="$2" task="$3" wt tb
  wt="$(task_wt_path "$root" "$slug" "$task")"; tb="$(task_branch "$slug" "$task")"
  git_ignore_worktrees "$root"
  if [[ -d "$wt" ]] && git -C "$wt" rev-parse --is-inside-work-tree >/dev/null 2>&1; then printf '%s\n' "$wt"; return 0; fi
  mkdir -p "$(dirname "$wt")"
  if git -C "$root" rev-parse --verify -q "refs/heads/$tb" >/dev/null; then
    git -C "$root" worktree add -q "$wt" "$tb"
  else
    git -C "$root" worktree add -q -b "$tb" "$wt" "$(feature_branch "$slug")"
  fi
  printf '%s\n' "$wt"
}

# git_review_worktree <root> <slug> <task>: fresh detached checkout of the task head.
git_review_worktree() {
  local root="$1" slug="$2" task="$3" rv
  rv="$(task_wt_path "$root" "$slug" "$task")-review"
  [[ -d "$rv" ]] && git_remove_worktree "$root" "$rv"
  git -C "$root" worktree add -q --detach "$rv" "$(task_branch "$slug" "$task")"
  printf '%s\n' "$rv"
}

git_remove_worktree() {
  git -C "$1" worktree remove --force "$2" >/dev/null 2>&1 || rm -rf "$2"
  git -C "$1" worktree prune
}

# Commit everything in a worktree (the runner commits on the seat's behalf).
git_commit_all() {
  git -C "$1" add -A
  git -C "$1" diff --cached --quiet || git -C "$1" commit -q -m "$2"
}

# The point the task branched from the feature branch.
git_task_base() {
  git -C "$1" merge-base "$(feature_branch "$2")" "$(task_branch "$2" "$3")"
}

# git_bridgie_changes <root> <slug> <task>: .bridgie/ paths a task changed (committed or not).
git_bridgie_changes() {
  local root="$1" slug="$2" task="$3" wt base
  wt="$(task_wt_path "$root" "$slug" "$task")"; base="$(git_task_base "$root" "$slug" "$task")"
  {
    git -C "$wt" diff --name-only "$base" HEAD -- .bridgie
    git -C "$wt" status --porcelain --untracked-files=all -- .bridgie | cut -c4-
  } | sort -u | sed '/^$/d'
}

# Throw away an attempt: back to the recorded head, untracked files removed.
git_reset_task() {
  git -C "$1" reset -q --hard "$2"
  git -C "$1" clean -q -fd
}

# git_diff_packet <root> <slug> <task> <out dir>: diff.patch, diff-stat.txt, files.txt.
# .bridgie/ is excluded entirely, which covers .bridgie/runs/** (R8).
git_diff_packet() {
  local root="$1" slug="$2" task="$3" out="$4" base tb
  base="$(git_task_base "$root" "$slug" "$task")"; tb="$(task_branch "$slug" "$task")"
  mkdir -p "$out"
  git -C "$root" diff "$base" "$tb" -- . ':(exclude).bridgie' ':(exclude).bridgie/**' > "$out/diff.patch"
  git -C "$root" diff --stat "$base" "$tb" -- . ':(exclude).bridgie' ':(exclude).bridgie/**' > "$out/diff-stat.txt"
  git -C "$root" diff --name-only "$base" "$tb" -- . ':(exclude).bridgie' ':(exclude).bridgie/**' > "$out/files.txt"
}

# git_merge_task <root> <slug> <task>: merge a passed task into the feature branch, clean up.
git_merge_task() {
  local root="$1" slug="$2" task="$3" tb wt
  tb="$(task_branch "$slug" "$task")"; wt="$(task_wt_path "$root" "$slug" "$task")"
  git_on_feature "$root" "$slug"
  git -C "$root" merge -q --no-ff -m "bridgie: merge $task into $(feature_branch "$slug")" "$tb"
  git_remove_worktree "$root" "$wt"
  git -C "$root" branch -q -D "$tb"
}
