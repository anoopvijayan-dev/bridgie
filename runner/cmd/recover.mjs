// bridgie recover <slug> — after a run was killed (a closed terminal, a restarted machine): clear a
// seat lock whose process is gone and make tasks it left in_progress buildable again. The
// interrupted attempt is not counted. `bridgie build` and `bridgie run` do this themselves; the
// command is for looking, and for a project where neither is about to run.
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import * as st from '../state.mjs';
import * as fl from '../flow.mjs';
import { die, log, projectRoot, stateCommit } from '../cli/core.mjs';

export default async function recover(argv) {
  const slug = argv[0];
  if (!slug) die('usage: bridgie recover <slug>');
  const root = projectRoot();
  const held = st.seatLock(root);
  if (held) die(`an agent run is in progress (seat ${held.seat}, pid ${held.pid ?? '?'}, since ${held.since}); nothing to recover while it runs`);
  const lock = join(root, '.bridgie', '.seat-lock');
  const stale = existsSync(lock);
  if (stale) rmSync(lock, { recursive: true, force: true });
  if (!existsSync(st.tasksPath(root, slug))) { log(stale ? 'removed a seat lock left by a run that is gone; no tasks yet' : 'nothing to recover'); return; }
  const ids = fl.recoverAttempts(root, slug);
  if (ids.length) stateCommit(root, `recover ${slug}: ${ids.join(', ')}`);
  if (stale) log('removed a seat lock left by a run that is gone');
  log(ids.length ? `recovered ${ids.join(', ')}: the interrupted attempt is not counted; whatever it left in the task worktree is kept. Next: bridgie run ${slug}` : 'no task was left in progress');
}
