// bridgie new <folder> [--lane L] — a new project in one step: folder, git repository, Bridgie state.
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { die, log, needCmd, git } from '../cli/core.mjs';
import init from './init.mjs';

export default async function newProject(argv) {
  const folder = argv[0];
  if (!folder || folder.startsWith('--')) die('usage: bridgie new <folder> [--lane engineering|product|marketing|sales|platform|security]');
  needCmd('git');
  const abs = resolve(folder);
  if (existsSync(join(abs, '.bridgie'))) die(`new: ${folder} already has a .bridgie folder (cd there and run: bridgie)`);
  mkdirSync(abs, { recursive: true });
  if (!git(['-C', abs, 'rev-parse', '--is-inside-work-tree']).ok) {
    if (!git(['-C', abs, 'init', '-q', '-b', 'main']).ok) git(['-C', abs, 'init', '-q']);
  }
  await init(argv.slice(1), { cwd: abs });
  log('');
  log('Ready. Next:');
  log(`  cd ${abs}`);
  log('  bridgie                      shows what to do next');
  log('  bridgie bet new <slug> --title "..."   or   bridgie scout --from <folder of notes>');
}
