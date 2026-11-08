// bridgie doctor — validate the tool, and the project when inside one.
import { doctor as check } from '../doctor.mjs';
import { findRoot, BridgieExit } from '../cli/core.mjs';

export default async function doctor() {
  const results = check(findRoot());
  for (const [k, m] of results) process.stdout.write(`[${k}] ${m}\n`);
  if (results.some(([k]) => k === 'fail')) throw new BridgieExit('', 1);
}
