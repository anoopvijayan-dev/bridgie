// bridgie seat-run <slug> <loop/seat> [--task T] [--cwd D] [--packet D] [--vars F] [--exclude D] [--no-lock]
import { runSeat } from '../cli/seat.mjs';
import { die, parseArgs } from '../cli/core.mjs';

export default async function seatRun(argv) {
  const a = parseArgs(argv, { task: 'value', cwd: 'value', packet: 'value', vars: 'value', exclude: 'value', 'no-lock': 'bool' }, 'seat-run');
  if (a._.length < 2) die('usage: bridgie seat-run <slug> <loop/seat> [--task T]');
  const dir = await runSeat(a._[0], a._[1], { task: a.task, cwd: a.cwd, packet: a.packet, vars: a.vars, exclude: a.exclude, lock: !a['no-lock'] });
  process.stdout.write(`${dir}\n`);
}
