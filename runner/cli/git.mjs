// Git model (spec §7.5):
//   feature branch  bridgie/<slug>             checked out in the project root by `shape`
//   task branch     bridgie-task/<slug>/<task> (git cannot nest refs under bridgie/<slug>)
//   task worktree   <root>/.bridgie/worktrees/<slug>/<task>         (git-ignored)
//   review worktree <root>/.bridgie/worktrees/<slug>/<task>-review  (detached, read-only use)
// Nothing here pushes, and nothing merges into the base branch (R7).
import { existsSync, mkdirSync, readFileSync, appendFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { git, gitOrDie, die } from './core.mjs';

const EXCLUDE = ['--', '.', ':(exclude).bridgie', ':(exclude).bridgie/**'];
export const featureBranch = slug => `bridgie/${slug}`;
export const taskBranch = (slug, task) => `bridgie-task/${slug}/${task}`;
export const taskWtPath = (root, slug, task) => join(root, '.bridgie', 'worktrees', slug, task);

export const isRepo = dir => git(['-C', dir, 'rev-parse', '--is-inside-work-tree']).ok;
export const currentBranch = root => git(['-C', root, 'branch', '--show-current']).out.trim();
const hasBranch = (root, b) => git(['-C', root, 'rev-parse', '--verify', '-q', `refs/heads/${b}`]).ok;

export function requireClean(root) {
  const dirty = git(['-C', root, 'status', '--porcelain', ...EXCLUDE]).out;
  if (dirty.trim()) die(`uncommitted changes outside .bridgie/; commit or stash them first:\n${dirty}`);
}

export function ignoreWorktrees(root) {
  const gi = join(root, '.bridgie', '.gitignore');
  const cur = existsSync(gi) ? readFileSync(gi, 'utf8') : '';
  if (!cur.split(/\r?\n/).includes('worktrees/')) appendFileSync(gi, `${cur && !cur.endsWith('\n') ? '\n' : ''}worktrees/\n`);
}

// featureStart: create or switch to bridgie/<slug>; returns the base branch.
export function featureStart(root, slug) {
  const fb = featureBranch(slug), cur = currentBranch(root);
  ignoreWorktrees(root);
  if (hasBranch(root, fb)) {
    if (cur !== fb) gitOrDie(['-C', root, 'checkout', '-q', fb]);
    return git(['-C', root, 'config', `branch.${fb}.bridgieBase`]).out.trim() || 'main';
  }
  if (!cur) die('detached HEAD; check out the branch to build from first');
  gitOrDie(['-C', root, 'checkout', '-q', '-b', fb]);
  gitOrDie(['-C', root, 'config', `branch.${fb}.bridgieBase`, cur]);
  return cur;
}

export function onFeature(root, slug) {
  const fb = featureBranch(slug);
  if (currentBranch(root) !== fb) die(`the project must be on branch ${fb} (git checkout ${fb})`);
}

export function taskWorktree(root, slug, task) {
  const wt = taskWtPath(root, slug, task), tb = taskBranch(slug, task);
  ignoreWorktrees(root);
  if (existsSync(wt) && isRepo(wt)) return wt;
  mkdirSync(dirname(wt), { recursive: true });
  if (hasBranch(root, tb)) gitOrDie(['-C', root, 'worktree', 'add', '-q', wt, tb]);
  else gitOrDie(['-C', root, 'worktree', 'add', '-q', '-b', tb, wt, featureBranch(slug)]);
  return wt;
}

// restoreTaskWorktree: the task's worktree, re-created from its branch when it was built on another
// machine (the branch is local, or on a remote after a fetch). Null when the branch exists nowhere.
export function restoreTaskWorktree(root, slug, task) {
  const wt = taskWtPath(root, slug, task), tb = taskBranch(slug, task);
  if (existsSync(wt) && isRepo(wt)) return wt;
  const remote = git(['-C', root, 'for-each-ref', '--format=%(refname:short)', `refs/remotes/*/${tb}`]).out.trim().split('\n').filter(Boolean)[0];
  if (!hasBranch(root, tb) && !remote) return null;
  if (existsSync(wt)) rmSync(wt, { recursive: true, force: true });
  ignoreWorktrees(root);
  mkdirSync(dirname(wt), { recursive: true });
  git(['-C', root, 'worktree', 'prune']);
  if (hasBranch(root, tb)) gitOrDie(['-C', root, 'worktree', 'add', '-q', wt, tb]);
  else gitOrDie(['-C', root, 'worktree', 'add', '-q', '--track', '-b', tb, wt, remote]);
  return wt;
}

// archiveTaskBranches: before a re-plan, move every task branch of the bet to
// bridgie-task-archive/<slug>/<stamp>/<task> (worktrees removed), so new tasks that reuse an id
// start from the feature branch instead of an old task's code. Returns [[old, new], ...].
export function archiveTaskBranches(root, slug, stamp) {
  const prefix = `bridgie-task/${slug}/`;
  const names = git(['-C', root, 'for-each-ref', '--format=%(refname:short)', `refs/heads/${prefix}`]).out.trim().split('\n').filter(Boolean);
  const moved = [];
  for (const b of names) {
    const task = b.slice(prefix.length), wt = taskWtPath(root, slug, task);
    if (existsSync(wt)) removeWorktree(root, wt);
    const to = `bridgie-task-archive/${slug}/${stamp}/${task}`;
    gitOrDie(['-C', root, 'branch', '-m', b, to]);
    moved.push([b, to]);
  }
  git(['-C', root, 'worktree', 'prune']);
  return moved;
}

export function reviewWorktree(root, slug, task) {
  const rv = `${taskWtPath(root, slug, task)}-review`;
  if (existsSync(rv)) removeWorktree(root, rv);
  gitOrDie(['-C', root, 'worktree', 'add', '-q', '--detach', rv, taskBranch(slug, task)]);
  return rv;
}

export function removeWorktree(root, wt) {
  if (!git(['-C', root, 'worktree', 'remove', '--force', wt]).ok) rmSync(wt, { recursive: true, force: true });
  git(['-C', root, 'worktree', 'prune']);
}

export function commitAll(wt, msg) {
  git(['-C', wt, 'add', '-A']);
  if (!git(['-C', wt, 'diff', '--cached', '--quiet']).ok) gitOrDie(['-C', wt, 'commit', '-q', '-m', msg]);
}

export const head = wt => gitOrDie(['-C', wt, 'rev-parse', 'HEAD']).trim();
export const taskBase = (root, slug, task) => gitOrDie(['-C', root, 'merge-base', featureBranch(slug), taskBranch(slug, task)]).trim();

// bridgieChanges: .bridgie/ paths a task changed in its worktree (committed or not).
export function bridgieChanges(root, slug, task) {
  const wt = taskWtPath(root, slug, task), base = taskBase(root, slug, task);
  const committed = git(['-C', wt, 'diff', '--name-only', base, 'HEAD', '--', '.bridgie']).out.split(/\r?\n/);
  const pending = git(['-C', wt, 'status', '--porcelain', '--untracked-files=all', '--', '.bridgie']).out.split(/\r?\n/).map(l => l.slice(3));
  return [...new Set([...committed, ...pending].map(s => s.trim()).filter(Boolean))].sort();
}

// syncTask: bring into a task's worktree the code other tasks merged into the feature branch after
// this one branched, so the tiers and the reviewer see the code as it will be once it is merged.
// Nothing happens when the feature branch only gained Bridgie state since then (the usual case when
// tasks are built one at a time). A conflict is undone and reported: { conflict: [files] }.
export function syncTask(root, slug, task) {
  const wt = taskWtPath(root, slug, task), fb = featureBranch(slug);
  const base = taskBase(root, slug, task);
  if (git(['-C', root, 'diff', '--quiet', base, fb, ...EXCLUDE]).ok) return { synced: false };
  const m = git(['-C', wt, 'merge', '--no-edit', '-q', '-m', `bridgie: sync ${task} with ${fb}`, fb]);
  if (m.ok) return { synced: true };
  const files = git(['-C', wt, 'diff', '--name-only', '--diff-filter=U']).out.split(/\r?\n/).filter(Boolean);
  git(['-C', wt, 'merge', '--abort']);
  return { synced: false, conflict: files.length ? files : ['(git could not merge; see the task worktree)'] };
}

export function resetTask(wt, to) {
  gitOrDie(['-C', wt, 'reset', '-q', '--hard', to]);
  git(['-C', wt, 'clean', '-q', '-fd']);
}

// diffPacket: diff.patch, diff-stat.txt, files.txt; .bridgie/ excluded entirely (R8).
export function diffPacket(root, slug, task, out) {
  const base = taskBase(root, slug, task), tb = taskBranch(slug, task);
  mkdirSync(out, { recursive: true });
  const d = args => git(['-C', root, 'diff', ...args, base, tb, ...EXCLUDE]).out;
  const nl = s => (s ? `${s}\n` : '');
  writeFileSync(join(out, 'diff.patch'), nl(d([])));
  writeFileSync(join(out, 'diff-stat.txt'), nl(d(['--stat'])));
  writeFileSync(join(out, 'files.txt'), nl(d(['--name-only'])));
}

// betDiff: the whole bet's code change since it branched (three dots: later commits on the base are not in it).
export const betDiff = (root, base, slug) => git(['-C', root, 'diff', `${base}...${featureBranch(slug)}`, ...EXCLUDE]).out;

// detachedWorktree: a read-only look at a branch, for a seat that must not touch the project's checkout.
export function detachedWorktree(root, ref, path) {
  if (existsSync(path)) removeWorktree(root, path);
  mkdirSync(dirname(path), { recursive: true });
  ignoreWorktrees(root);
  gitOrDie(['-C', root, 'worktree', 'add', '-q', '--detach', path, ref]);
  return path;
}

export function diffStat(root, base, branch) {
  return git(['-C', root, 'diff', '--stat', base, branch, ...EXCLUDE]).out;
}

export function mergeTask(root, slug, task) {
  const tb = taskBranch(slug, task);
  onFeature(root, slug);
  gitOrDie(['-C', root, 'merge', '-q', '--no-ff', '-m', `bridgie: merge ${task} into ${featureBranch(slug)}`, tb]);
  removeWorktree(root, taskWtPath(root, slug, task));
  git(['-C', root, 'branch', '-q', '-D', tb]);
}
