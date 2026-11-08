// Single-writer guard (P1) for seat runs: a full manifest of Bridgie state before the run,
// compared after it. Catches files that changed, appeared or disappeared, and restores exactly.
//   guard.mjs snapshot <root> <snapdir> [--exclude <rel>]...
//   guard.mjs check    <root> <snapdir> [--exclude <rel>]...  → {"added":[],"removed":[],"changed":[]}
//   guard.mjs restore  <root> <snapdir> [--exclude <rel>]...
// Paths are relative to <root> with forward slashes. Always excluded: worktrees (seats work there),
// rendered pages, the fake adapter's scratch state, the seat lock, and other runs' .snapshot dirs
// (otherwise every snapshot would copy every earlier snapshot and grow without bound).
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, copyFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const ALWAYS = ['.bridgie/worktrees/', '.bridgie/ui/', '.bridgie/.fake-state/', '.bridgie/.seat-lock/'];
const rel = (root, p) => relative(root, p).split(sep).join('/');
const norm = e => e.replace(/\\/g, '/').replace(/\/?$/, '/');

function walk(root, excludes) {
  const out = [];
  const ex = [...ALWAYS, ...excludes.map(norm)];
  const visit = dir => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name), r = rel(root, p);
      const st = statSync(p);
      if (st.isDirectory()) { if (name !== '.snapshot' && !ex.some(e => `${r}/`.startsWith(e))) visit(p); }   // never snapshot a snapshot
      else if (st.isFile() && !ex.some(e => r.startsWith(e))) out.push(r);
    }
  };
  const base = join(root, '.bridgie');
  if (existsSync(base)) visit(base);
  return out.sort();
}
const hash = f => createHash('sha256').update(readFileSync(f)).digest('hex');

export function snapshot(root, snap, excludes = []) {
  const manifest = {};
  for (const r of walk(root, excludes)) {
    manifest[r] = hash(join(root, r));
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
  for (const r of [...d.removed, ...d.changed]) {
    mkdirSync(dirname(join(root, r)), { recursive: true });
    copyFileSync(join(snap, 'files', r), join(root, r));
  }
  return d;
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
