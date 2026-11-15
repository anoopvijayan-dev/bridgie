// Fake adapter for tests. Returns fixtures instead of calling a model.
//   --capabilities            {"vendor","reads_repo","reads_web"}; vendor fake-verifier for verify/* seats, fake-producer otherwise
//                             (BRIDGIE_FAKE_SAME_VENDOR=1 → "fake"; BRIDGIE_FAKE_READS_REPO=0 / BRIDGIE_FAKE_READS_WEB=0 → false)
//   BRIDGIE_FAKE_DIR          fixture dir (default adapters/fake/fixtures); the n-th call of a seat uses <seat>.<n>.json if
//                             present, else <seat>.json (counter in BRIDGIE_FAKE_STATE, default <project>/.bridgie/.fake-state)
//   BRIDGIE_FAKE_OUTPUT       one fixture path for every seat (overrides the dir)
//   BRIDGIE_FAKE_SCRIPT       script run with bash inside --cwd before returning (simulates edits; tests only)
//   BRIDGIE_FAKE_STDOUT=1     print the fixture in a ```json fence and let extraction write --out
//   BRIDGIE_FAKE_MISBEHAVE=1  tamper with a state file (tests the single-writer guard)
//   BRIDGIE_FAKE_EXIT         exit code after writing (default 0)
//   BRIDGIE_FAKE_FAIL_CARDS   space-separated card ids whose buyer run fails (swarm tests)
//   swarm members             with vars.json beside --out, the card number picks <seat>.<n>.json and "CARD" becomes the card id
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, copyFileSync, statSync } from 'node:fs';
import { dirname, join, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { extractLastJson } from '../lib/extract-json.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
if (argv[0] === '--probe') { process.stdout.write('OK\n'); process.exit(0); }
const o = { caps: false };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--capabilities') o.caps = true;
  else if (['--seat', '--prompt', '--out', '--cwd', '--mode', '--model', '--effort'].includes(a)) o[a.slice(2)] = argv[++i];
  else { process.stderr.write(`fake: unknown arg ${a}\n`); process.exit(2); }
}
const name = basename(o.seat), loop = basename(dirname(o.seat));
if (o.caps) {
  let vendor = loop === 'verify' ? 'fake-verifier' : 'fake-producer';
  if (process.env.BRIDGIE_FAKE_SAME_VENDOR === '1') vendor = 'fake';
  process.stdout.write(JSON.stringify({ vendor, reads_repo: process.env.BRIDGIE_FAKE_READS_REPO !== '0', reads_web: process.env.BRIDGIE_FAKE_READS_WEB !== '0' }) + '\n');
  process.exit(0);
}
if (!o.prompt || !existsSync(o.prompt)) { process.stderr.write(`fake: prompt file missing: ${o.prompt}\n`); process.exit(2); }
const dir = process.env.BRIDGIE_FAKE_DIR || join(here, 'fixtures');
const outNorm = o.out.replace(/\\/g, '/');
const projectOf = outNorm.includes('/.bridgie/') ? outNorm.slice(0, outNorm.indexOf('/.bridgie/')) : dirname(o.out);
const state = process.env.BRIDGIE_FAKE_STATE || join(projectOf, '.bridgie', '.fake-state');
mkdirSync(state, { recursive: true });
let n = (existsSync(join(state, name)) ? Number(readFileSync(join(state, name), 'utf8').trim()) || 0 : 0) + 1;
writeFileSync(join(state, name), `${n}\n`);
// Swarm member: the card's number picks the fixture, so parallel runs stay deterministic.
let card = '';
const vars = join(dirname(o.out), 'vars.json');
if (existsSync(vars)) { card = JSON.parse(readFileSync(vars, 'utf8')).id || ''; const m = card.match(/(\d+)$/); if (m) n = Number(m[1]); }
let src = process.env.BRIDGIE_FAKE_OUTPUT || '';
if (!src) { src = join(dir, `${name}.${n}.json`); if (!existsSync(src)) src = join(dir, `${name}.json`); }
if (!existsSync(src)) { process.stderr.write(`fake: no fixture for seat ${name} at ${src}\n`); process.exit(3); }
if (process.env.BRIDGIE_FAKE_SCRIPT) spawnSync('bash', [process.env.BRIDGIE_FAKE_SCRIPT, name, String(n)], { cwd: o.cwd, stdio: 'inherit' });
if (process.env.BRIDGIE_FAKE_STDOUT === '1') {
  const reply = join(dirname(o.out), 'reply.txt');
  writeFileSync(reply, `Here is my result.\n\`\`\`json\n${readFileSync(src, 'utf8')}\n\`\`\`\n`);
  writeFileSync(o.out, JSON.stringify(extractLastJson(readFileSync(reply, 'utf8')), null, 2) + '\n');
} else copyFileSync(src, o.out);
if (card) writeFileSync(o.out, readFileSync(o.out, 'utf8').replace(/"CARD"/g, `"${card}"`));
if (card && ` ${process.env.BRIDGIE_FAKE_FAIL_CARDS || ''} `.includes(` ${card} `)) { rmSync(o.out, { force: true }); process.stderr.write(`fake: card ${card} fails on purpose\n`); process.exit(9); }
if (process.env.BRIDGIE_FAKE_MISBEHAVE === '1') {
  const dd = join(o.cwd, '.bridgie', 'decisions');
  const f = existsSync(dd) ? readdirSync(dd).find(x => x.endsWith('.json')) : null;
  if (f) writeFileSync(join(dd, f), '{"tampered":true}\n');
}
process.stdout.write(`fake adapter: seat=${name} call=${n} mode=${o.mode} model=${o.model} prompt=${statSync(o.prompt).size} bytes\n`);
process.exit(Number(process.env.BRIDGIE_FAKE_EXIT || 0));
