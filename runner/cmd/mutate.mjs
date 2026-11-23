// bridgie mutate [--base SHA] [--test "<command>"] [--max N] [--min 0.6] [--timeout S]
// The mutation check on the code changed since a base commit, in the current git checkout. Run by
// `bridgie verify` as the `mutation` tier (which sets the base, the test command and the bar), and
// usable by hand in any repository: bridgie mutate --base main --test "npm test".
import * as m from '../mutate.mjs';
import { die, git, parseArgs } from '../cli/core.mjs';

export default async function mutate(argv) {
  const a = parseArgs(argv, { base: 'value', test: 'value', max: 'value', min: 'value', timeout: 'value' }, 'mutate');
  const cwd = process.cwd();
  if (!git(['-C', cwd, 'rev-parse', '--is-inside-work-tree']).ok) die('mutate: not inside a git repository');
  const base = a.base || process.env.BRIDGIE_BASE_SHA;
  if (!base) die('mutate: say what to compare with: --base <commit or branch>');
  if (!git(['-C', cwd, 'rev-parse', '--verify', '-q', `${base}^{commit}`]).ok) die(`mutate: no such commit: ${base}`);
  const num = (v, name, lo, hi) => { const n = Number(v); if (!Number.isFinite(n) || n < lo || n > hi) die(`mutate: --${name} takes a number from ${lo} to ${hi}`); return n; };
  const max = num(a.max ?? process.env.BRIDGIE_MUTATION_MAX ?? 20, 'max', 1, 500);
  const min = num(a.min ?? process.env.BRIDGIE_MUTATION_MIN ?? 0.6, 'min', 0, 1);
  const timeoutS = a.timeout !== undefined ? num(a.timeout, 'timeout', 1, 36000) : null;
  let r;
  try { r = m.run(cwd, { base, test: a.test || process.env.BRIDGIE_MUTATION_TEST || '', max: Math.round(max), min, timeoutS }); } catch (e) { die(`mutate: ${e.message}`); }
  if (!r.ok) die('', 1);
}
