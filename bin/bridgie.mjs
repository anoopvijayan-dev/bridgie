#!/usr/bin/env node
// bridgie — entry point. Plain Node, so it runs the same in PowerShell, cmd, Git Bash, macOS and Linux.
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const home = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.env.BRIDGIE_HOME ||= home;

const [cmd = 'next', ...args] = process.argv.slice(2);
const name = { '-h': 'help', '--help': 'help', '--version': 'version' }[cmd] || cmd;

const { BridgieExit, version } = await import(pathToFileURL(join(home, 'runner', 'cli', 'core.mjs')).href);
try {
  if (name === 'version') { process.stdout.write(`bridgie ${version()}\n`); process.exit(0); }
  const file = join(home, 'runner', 'cmd', `${name}.mjs`);
  if (!/^[a-z][a-z-]*$/.test(name) || !existsSync(file)) throw new BridgieExit(`unknown command: ${cmd} (try 'bridgie help')`);
  const mod = await import(pathToFileURL(file).href);
  await mod.default(args);
  process.exit(0);
} catch (e) {
  if (e instanceof BridgieExit) {
    if (e.message) process.stderr.write(`bridgie: ${e.message}\n`);
    process.exit(e.code);
  }
  process.stderr.write(`bridgie: ${e?.stack || e}\n`);
  process.exit(1);
}
