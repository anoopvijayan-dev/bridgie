// The git model (ported from tests/11-git.bats): same seven cases, now cross-platform.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, appendFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import * as g from './git.mjs';
import { BridgieExit } from './core.mjs';

const sh = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
let P;
beforeEach(() => {
  P = mkdtempSync(join(tmpdir(), 'bridgie-git-'));
  sh(P, 'init', '-q', '-b', 'main'); sh(P, 'config', 'user.email', 't@example.com'); sh(P, 'config', 'user.name', 'tester');
  writeFileSync(join(P, 'README.md'), 'hello\n'); sh(P, 'add', '-A'); sh(P, 'commit', '-q', '-m', 'init');
  mkdirSync(join(P, '.bridgie', 'bets'), { recursive: true }); writeFileSync(join(P, '.bridgie', '.gitignore'), 'ui/\n');
});

test('requireClean ignores .bridgie but refuses other changes', () => {
  g.requireClean(P);
  appendFileSync(join(P, 'README.md'), 'change\n');
  assert.throws(() => g.requireClean(P), e => e instanceof BridgieExit && /uncommitted/.test(e.message));
});

test('featureStart creates bridgie/<slug> from the current branch and returns the base', () => {
  assert.equal(g.featureStart(P, 'net'), 'main');
  assert.equal(g.currentBranch(P), 'bridgie/net');
  assert.equal(g.featureStart(P, 'net'), 'main');   // idempotent
});

test('task worktree is created inside .bridgie/worktrees, reused, and ignored by git', () => {
  g.featureStart(P, 'net');
  const wt = g.taskWorktree(P, 'net', 'T1');
  assert.equal(wt, join(P, '.bridgie', 'worktrees', 'net', 'T1'));
  assert.equal(g.currentBranch(wt), 'bridgie-task/net/T1');
  assert.equal(g.taskWorktree(P, 'net', 'T1'), wt);
  assert.ok(!sh(P, 'status', '--porcelain').includes('worktrees'));
});

test('diff packet excludes .bridgie (R8) and lists changed files', () => {
  g.featureStart(P, 'net');
  const wt = g.taskWorktree(P, 'net', 'T1');
  writeFileSync(join(wt, 'app.txt'), 'code\n');
  mkdirSync(join(wt, '.bridgie', 'runs', 'x'), { recursive: true }); writeFileSync(join(wt, '.bridgie', 'runs', 'x', 'out.md'), 'transcript\n');
  g.commitAll(wt, 'work');
  const d = mkdtempSync(join(tmpdir(), 'pk-'));
  g.diffPacket(P, 'net', 'T1', d);
  const patch = readFileSync(join(d, 'diff.patch'), 'utf8');
  assert.match(patch, /app\.txt/); assert.doesNotMatch(patch, /transcript/);
  assert.equal(readFileSync(join(d, 'files.txt'), 'utf8').trim(), 'app.txt');
});

test('bridgieChanges flags .bridgie edits in a worktree', () => {
  g.featureStart(P, 'net');
  const wt = g.taskWorktree(P, 'net', 'T1');
  assert.deepEqual(g.bridgieChanges(P, 'net', 'T1'), []);
  mkdirSync(join(wt, '.bridgie', 'specs', 'net'), { recursive: true }); writeFileSync(join(wt, '.bridgie', 'specs', 'net', 'tasks.json'), '{}');
  assert.ok(g.bridgieChanges(P, 'net', 'T1').length > 0);
});

test('resetTask discards an attempt; mergeTask merges into the feature branch only', () => {
  g.featureStart(P, 'net');
  const wt = g.taskWorktree(P, 'net', 'T1');
  const head = g.head(wt);
  writeFileSync(join(wt, 'bad.txt'), 'bad\n'); g.commitAll(wt, 'bad');
  g.resetTask(wt, head);
  assert.ok(!existsSync(join(wt, 'bad.txt')));
  writeFileSync(join(wt, 'good.txt'), 'good\n'); g.commitAll(wt, 'good');
  g.mergeTask(P, 'net', 'T1');
  assert.ok(existsSync(join(P, 'good.txt')));
  assert.ok(!existsSync(wt));
  assert.throws(() => sh(P, 'rev-parse', '--verify', '-q', 'bridgie-task/net/T1'));
  assert.throws(() => execFileSync('git', ['-C', P, 'show', 'main:good.txt'], { stdio: 'ignore' }));
});

test('review worktree is detached at the task head and removable', () => {
  g.featureStart(P, 'net');
  const wt = g.taskWorktree(P, 'net', 'T1');
  writeFileSync(join(wt, 'x.txt'), 'x\n'); g.commitAll(wt, 'x');
  const rv = g.reviewWorktree(P, 'net', 'T1');
  assert.equal(g.head(rv), g.head(wt));
  assert.equal(sh(rv, 'status', '--porcelain'), '');
  g.removeWorktree(P, rv);
  assert.ok(!existsSync(rv));
});

test('ignoreRunLogs adds the bulky run files to .bridgie/.gitignore once, unless commit_transcripts is on', async () => {
  const { ignoreRunLogs, RUN_LOG_IGNORES } = await import('./core.mjs');
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = mkdtempSync(join(tmpdir(), 'bridgie-ignore-'));
  mkdirSync(join(root, '.bridgie', 'bets'), { recursive: true });
  writeFileSync(join(root, '.bridgie', 'policy.yaml'), 'version: 1\n');
  writeFileSync(join(root, '.bridgie', '.gitignore'), 'ui/\nworktrees/');
  assert.equal(ignoreRunLogs(root), true);
  const lines = readFileSync(join(root, '.bridgie', '.gitignore'), 'utf8').split('\n');
  for (const l of ['ui/', 'worktrees/', ...RUN_LOG_IGNORES]) assert.ok(lines.includes(l), l);
  assert.equal(ignoreRunLogs(root), false);   // once
  assert.equal(readFileSync(join(root, '.bridgie', '.gitignore'), 'utf8').split('\n').filter(l => l === 'runs/**/*.log').length, 1);
  const kept = mkdtempSync(join(tmpdir(), 'bridgie-ignore-'));
  mkdirSync(join(kept, '.bridgie', 'bets'), { recursive: true });
  writeFileSync(join(kept, '.bridgie', 'policy.yaml'), 'version: 1\ncommit_transcripts: true\n');
  assert.equal(ignoreRunLogs(kept), false);
});
