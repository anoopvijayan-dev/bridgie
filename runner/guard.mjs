// Single-writer guard (P1) for seat runs: a full manifest of Bridgie state before the run,
// compared after it. Catches files that changed, appeared or disappeared, and restores exactly.
//   guard.mjs snapshot <root> <snapdir> [--exclude <rel>]...
//   guard.mjs check    <root> <snapdir> [--exclude <rel>]...  → {"added":[],"removed":[],"changed":[]}
//   guard.mjs restore  <root> <snapdir> [--exclude <rel>]...
// Paths are relative to <root> with forward slashes. Always excluded: worktrees (seats work there),
// rendered pages, the fake adapter's scratch state, the seat lock, other runs' .snapshot dirs
// (otherwise every snapshot would copy every earlier snapshot and grow without bound), and Python
// __pycache__ dirs (a seat that imports a helper from a run folder makes one; it is not state).
//
// Size: run history (.bridgie/runs/) is append-only and can be large (prompts, logs, diffs), so it is
// hashed but never copied. Tampering there is still detected and fails the run; it is reported as
// unrestorable rather than rolled back (acceptance digests bind the evidence anyway). Everything else —
// bets, decisions, specs, acceptance, policy — is small and copied for an exact restore. A copy larger
// than BRIDGIE_SNAPSHOT_MAX_MB (default 50) is refused: a guard must never fill a disk.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, copyFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const ALWAYS = ['.bridgie/worktrees/', '.bridgie/ui/', '.bridgie/.fake-state/', '.bridgie/.seat-lock/', '.bridgie/.adapter-state.json'];
const rel = (root, p) => relative(root, p).split(sep).join('/');
const norm = e => e.replace(/\\/g, '/').replace(/\/?$/, '/');

function walk(root, excludes) {
  const out = [];
  const ex = [...ALWAYS, ...excludes.map(norm)];
  const visit = dir => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name), r = rel(root, p);
      const st = statSync(p);
      // never snapshot a snapshot; interpreter caches (Python's __pycache__) are not state
      if (st.isDirectory()) { if (name !== '.snapshot' && name !== '__pycache__' && !ex.some(e => `${r}/`.startsWith(e))) visit(p); }
      else if (st.isFile() && !ex.some(e => r.startsWith(e))) out.push(r);
    }
  };
  const base = join(root, '.bridgie');
  if (existsSync(base)) visit(base);
  return out.sort();
}
const hash = f => createHash('sha256').update(readFileSync(f)).digest('hex');
const HASH_ONLY = '.bridgie/runs/';
const maxBytes = () => Number(process.env.BRIDGIE_SNAPSHOT_MAX_MB || 50) * 1024 * 1024;

export function snapshot(root, snap, excludes = []) {
  const files = walk(root, excludes);
  const copied = files.filter(r => !r.startsWith(HASH_ONLY));
  const bytes = copied.reduce((n, r) => n + statSync(join(root, r)).size, 0);
  if (bytes > maxBytes()) {
    const big = copied.map(r => [r, statSync(join(root, r)).size]).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r, n]) => `${r} (${Math.round(n / 1048576)} MB)`);
    throw new Error(`state snapshot would copy ${Math.round(bytes / 1048576)} MB (limit ${Math.round(maxBytes() / 1048576)} MB, BRIDGIE_SNAPSHOT_MAX_MB). Largest: ${big.join(', ')}. Bridgie state should be small; move large files out of .bridgie/`);
  }
  const manifest = {};
  for (const r of files) {
    manifest[r] = hash(join(root, r));
    if (r.startsWith(HASH_ONLY)) continue;
    mkdirSync(dirname(join(snap, 'files', r)), { recursive: true });
    copyFileSync(join(root, r), join(snap, 'files', r));
  }
  mkdirSync(snap, { recursive: true });
  writeFileSync(join(snap, 'manifest.json'), JSON.stringify(manifest, null, 1));
  return manifest;
}

export function check(root, snap, excludes = []) {
  const before = JSON.parse(readFileSync(join(snap, 'manifest.json'), 'utf8'));
  const now = walk(root, excludes);
  const added = now.filter(r => !(r in before));
  const removed = Object.keys(before).filter(r => !now.includes(r));
  const changed = now.filter(r => r in before && hash(join(root, r)) !== before[r]);
  return { added, removed, changed };
}

export function restore(root, snap, excludes = []) {
  const d = check(root, snap, excludes);
  for (const r of d.added) rmSync(join(root, r), { force: true });
  const unrestorable = [];
  for (const r of [...d.removed, ...d.changed]) {
    if (!existsSync(join(snap, 'files', r))) { unrestorable.push(r); continue; }   // run history is hash-only
    mkdirSync(dirname(join(root, r)), { recursive: true });
    copyFileSync(join(snap, 'files', r), join(root, r));
  }
  return { ...d, unrestorable };
}

// leftoverSnapshots: .snapshot dirs under runs/ that no VIOLATION explains (left by older versions).
export function leftoverSnapshots(root) {
  const out = []; const runs = join(root, '.bridgie', 'runs');
  const size = d => { let n = 0; for (const x of readdirSync(d)) { const p = join(d, x), s = statSync(p); n += s.isDirectory() ? size(p) : s.size; } return n; };
  const visit = dir => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (!statSync(p).isDirectory()) continue;
      if (name === '.snapshot') { if (!existsSync(join(dir, 'VIOLATION'))) out.push({ path: rel(root, p), bytes: size(p) }); continue; }
      visit(p);
    }
  };
  if (existsSync(runs)) visit(runs);
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [op, root, snap, ...rest] = process.argv.slice(2);
  const excludes = [];
  for (let i = 0; i < rest.length; i++) if (rest[i] === '--exclude') excludes.push(rest[++i]);
  const ops = { snapshot, check, restore };
  try {
    if (!ops[op] || !root || !snap) throw new Error('usage: guard.mjs snapshot|check|restore <root> <snapdir> [--exclude rel]...');
    const r = ops[op](resolve(root), resolve(snap), excludes);
    if (op !== 'snapshot') process.stdout.write(JSON.stringify(r) + '\n');
  } catch (e) { console.error(`guard.mjs: ${e.message}`); process.exit(1); }
}
