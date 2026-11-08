// bridgie scout --from <folder> [--name N] — rank the problems in a folder of raw signals (bet-less).
import { existsSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { collectSignals, writeOpportunities } from '../decide.mjs';
import { runSeat } from '../cli/seat.mjs';
import { die, log, parseArgs, projectRoot, stateCommit } from '../cli/core.mjs';

export default async function scout(argv) {
  const a = parseArgs(argv, { from: 'value', name: 'value' }, 'scout');
  if (!a.from) die('usage: bridgie scout --from <folder> [--name N]');
  const from = resolve(a.from);
  if (!existsSync(from) || !statSync(from).isDirectory()) die(`scout: ${a.from} is not a folder`);
  const root = projectRoot();
  const name = a.name || basename(from).toLowerCase().replace(/[_ ]/g, '-').replace(/[^a-z0-9-]/g, '');
  const packet = mkdtempSync(join(tmpdir(), 'bridgie-scout-'));
  try {
    const { copied } = collectSignals(from, packet);
    if (!copied.length) die(`scout: no text files (.md .txt .csv .json .yaml .eml .log .html) found under ${from}`);
    log(`scouting ${copied.length} file(s) from ${from} as '${name}'`);
    const runDir = await runSeat('_scout', 'decide/scout', { root, packet, runsDir: join(root, '.bridgie', 'runs', '_scout', name) });
    let opps;
    try { opps = writeOpportunities(root, name, join(runDir, 'seat-output.json'), { from, files: copied.length }); }
    catch (e) { die(`${e.message}\nscout: output rejected (see ${runDir})`); }
    stateCommit(root, `scout ${name}`);
    log(`opportunities written to .bridgie/scout/${name}/opportunities.md:`);
    for (const o of opps) log(`  ${o.id} ${o.problem} (${o.sources} sources, ${o.severity})`);
    log(`Next: bridgie bet new <slug> --from ${name}/O1   then   bridgie frame <slug>`);
  } finally { rmSync(packet, { recursive: true, force: true }); }
}
