import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { toCsv } from './csv.mjs';

// writeExport: rows as <name>.csv in the exports folder; returns the file's path.
export function writeExport(exportsDir, name, rows) {
  if (typeof name !== 'string' || !name.trim()) throw new Error('an export needs a name');
  mkdirSync(exportsDir, { recursive: true });
  const file = join(exportsDir, `${name}.csv`);
  writeFileSync(file, toCsv(rows));
  return file;
}
