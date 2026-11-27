// Token usage from the Copilot and Antigravity adapters: the parsers, and each adapter run end to end
// against a fake CLI (a Node script with a shebang, so POSIX only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseCopilotUsage, parseAgyJson } from '../adapters/lib/common.mjs';

const ADAPTERS = join(dirname(fileURLToPath(import.meta.url)), '..', 'adapters');
const posix = process.platform !== 'win32';
const REPLY = 'done\n```json\n{"ok":true}\n```\n';

test('parseCopilotUsage sums modelMetrics and ignores agentMetrics', () => {
  const u = parseCopilotUsage({
    totalPremiumRequestCost: 1, totalNanoAiu: 5,
    modelMetrics: {
      'claude-sonnet-4.6': { usage: { inputTokens: 15000, outputTokens: 1000, cacheReadTokens: 9000, cacheWriteTokens: 1000 } },
      'gpt-5-mini': { usage: { inputTokens: 500, outputTokens: 50 } },
    },
    agentMetrics: { main: { usage: { inputTokens: 15500, outputTokens: 1050 } } },
  });
  assert.deepEqual(u, { tokens_in: 5500, tokens_out: 1050, tokens_cache_read: 9000, tokens_cache_write: 1000, tokens_total: 16550 });
});

test('parseCopilotUsage: the file a session with no model calls writes reports nothing', () => {
  // as written by Copilot CLI 1.0.117 for a run that never reached a model
  const empty = { totalPremiumRequestCost: 0, totalUserRequests: 0, totalNanoAiu: 0, totalApiDurationMs: 0, sessionStartTime: '2026-11-27T21:02:44.143Z',
    codeChanges: { linesAdded: 0, linesRemoved: 0, filesModifiedCount: 0, filesModified: [] }, modelMetrics: {}, agentMetrics: {}, providerModelMetrics: [], lastCallInputTokens: 0, lastCallOutputTokens: 0 };
  assert.equal(parseCopilotUsage(empty), null);
  assert.equal(parseCopilotUsage(null), null);
  assert.equal(parseCopilotUsage({ modelMetrics: { m: { usage: { inputTokens: 'lots' } } } }), null);
});

test('parseAgyJson: response and usage, warnings before the JSON, and not-JSON', () => {
  const env = '{"status":"SUCCESS","response":"ok","usage":{"input_tokens":500,"output_tokens":20,"cache_read_tokens":100,"total_tokens":520}}';
  const want = { response: 'ok', usage: { tokens_in: 400, tokens_out: 20, tokens_cache_read: 100, tokens_cache_write: null, tokens_total: 520 } };
  assert.deepEqual(parseAgyJson(env), want);
  assert.deepEqual(parseAgyJson(`warning: update available\n${env}\n`), want);
  assert.deepEqual(parseAgyJson('{"response":"hi"}'), { response: 'hi', usage: null });
  assert.equal(parseAgyJson(REPLY), null);
  assert.equal(parseAgyJson('{"usage":{}}'), null);
  assert.equal(parseAgyJson(''), null);
});

// fakeCli: an executable that logs its arguments to calls.jsonl, then runs body (JS, with `args` and `fs`).
function fakeCli(dir, name, body) {
  const p = join(dir, name);
  writeFileSync(p, `#!${process.execPath}\nconst fs = require('node:fs');\nconst args = process.argv.slice(2);\nfs.appendFileSync(${JSON.stringify(join(dir, 'calls.jsonl'))}, JSON.stringify(args) + '\\n');\n${body}\n`);
  chmodSync(p, 0o755);
  return p;
}
function runAdapter(name, dir, env) {
  const prompt = join(dir, 'prompt.md'), out = join(dir, 'run', 'out.json');
  writeFileSync(prompt, 'do it');
  mkdirSync(dirname(out), { recursive: true });
  const r = spawnSync(process.execPath, [join(ADAPTERS, name, 'run.mjs'), '--seat', 'reviewer', '--prompt', prompt, '--out', out, '--cwd', dir, '--mode', 'readonly', '--model', 'm1'],
    { env: { ...process.env, ...env }, encoding: 'utf8' });
  const usage = join(dirname(out), 'usage.json');
  return { status: r.status, stderr: r.stderr, out: existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : null,
    usage: existsSync(usage) ? JSON.parse(readFileSync(usage, 'utf8')) : null,
    calls: readFileSync(join(dir, 'calls.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)), runDir: dirname(out) };
}

test('copilot adapter: passes --usage-output-file and records usage.json', { skip: !posix }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'bridgie-copilot-'));
  const bin = fakeCli(dir, 'copilot', `
const f = args[args.indexOf('--usage-output-file') + 1];
fs.writeFileSync(f, JSON.stringify({ modelMetrics: { m1: { usage: { inputTokens: 1200, outputTokens: 300, cacheReadTokens: 1000 } } } }));
process.stdout.write(${JSON.stringify(REPLY)});`);
  const r = runAdapter('copilot', dir, { BRIDGIE_COPILOT_BIN: bin });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.out, { ok: true });
  assert.deepEqual(r.usage, { tokens_in: 200, tokens_out: 300, tokens_cache_read: 1000, tokens_cache_write: 0, tokens_total: 1500, usd: null });
  assert.equal(r.calls.length, 1);
  assert.ok(!existsSync(join(r.runDir, 'copilot-usage.json')), 'the raw usage file is cleaned up');
});

test('antigravity adapter: JSON output gives the reply and usage', { skip: !posix }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'bridgie-agy-'));
  const bin = fakeCli(dir, 'agy', `
process.stdout.write(JSON.stringify({ status: 'SUCCESS', response: ${JSON.stringify(REPLY)}, usage: { input_tokens: 900, output_tokens: 100, cache_read_tokens: 400, total_tokens: 1000 } }));`);
  const r = runAdapter('antigravity', dir, { BRIDGIE_AGY_BIN: bin, BRIDGIE_AGY_PROJECT: 'p1' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.out, { ok: true });
  assert.deepEqual(r.usage, { tokens_in: 500, tokens_out: 100, tokens_cache_read: 400, tokens_cache_write: null, tokens_total: 1000, usd: null });
  assert.deepEqual(r.calls.map(a => a[a.indexOf('--output-format') + 1]), ['json']);
  assert.equal(r.calls[0].at(-2), '--print', '--print stays last');
});

test('antigravity adapter: an agy without JSON output is run again as text', { skip: !posix }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'bridgie-agy-old-'));
  const bin = fakeCli(dir, 'agy', `
if (args.includes('json')) { process.stderr.write("error: invalid value 'json' for '--output-format <FORMAT>'\\n"); process.exit(2); }
process.stdout.write(${JSON.stringify(REPLY)});`);
  const r = runAdapter('antigravity', dir, { BRIDGIE_AGY_BIN: bin, BRIDGIE_AGY_PROJECT: 'p1' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.out, { ok: true });
  assert.equal(r.usage, null);
  assert.deepEqual(r.calls.map(a => a[a.indexOf('--output-format') + 1]), ['json', 'text']);
});

test('antigravity adapter: a model failure is not retried, and BRIDGIE_AGY_OUTPUT=text skips JSON', { skip: !posix }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'bridgie-agy-fail-'));
  const bin = fakeCli(dir, 'agy', `process.stderr.write('quota exceeded\\n'); process.exit(1);`);
  const r = runAdapter('antigravity', dir, { BRIDGIE_AGY_BIN: bin, BRIDGIE_AGY_PROJECT: 'p1' });
  assert.notEqual(r.status, 0);
  assert.equal(r.calls.length, 1, 'one run, no retry');

  const dir2 = mkdtempSync(join(tmpdir(), 'bridgie-agy-text-'));
  const bin2 = fakeCli(dir2, 'agy', `process.stdout.write(${JSON.stringify(REPLY)});`);
  const r2 = runAdapter('antigravity', dir2, { BRIDGIE_AGY_BIN: bin2, BRIDGIE_AGY_PROJECT: 'p1', BRIDGIE_AGY_OUTPUT: 'text' });
  assert.equal(r2.status, 0, r2.stderr);
  assert.deepEqual(r2.out, { ok: true });
  assert.deepEqual(r2.calls.map(a => a[a.indexOf('--output-format') + 1]), ['text']);
});
