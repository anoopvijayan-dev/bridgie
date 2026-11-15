import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commandLine } from './setup.mjs';

test('Windows command lines quote paths with spaces and leave plain words alone', () => {
  assert.equal(commandLine('npm', ['install', '-g', 'C:\\Program Files\\x\\bridgie']), 'npm install -g "C:\\Program Files\\x\\bridgie"');
  assert.equal(commandLine('npx', ['-y', 'skills@1.8.1', 'add', 'C:\\Users\\a b\\skills\\bridgie', '-g']), 'npx -y skills@1.8.1 add "C:\\Users\\a b\\skills\\bridgie" -g');
  assert.equal(commandLine('npm', ['install', '-g', 'bridgie@0.6.1']), 'npm install -g bridgie@0.6.1');
  assert.equal(commandLine('npm', ['x', 'a&b', 'say "hi"']), 'npm x "a&b" "say ""hi"""');
});
