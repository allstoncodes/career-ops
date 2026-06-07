import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// scripts/test/ -> repo root is two levels up
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURE = join(ROOT, 'scripts', 'test', 'fixtures', 'smoke-jd.txt');

test('gemini-eval --mock runs token-free (no key) and prints a parsed score', () => {
  const env = { ...process.env };
  delete env.GEMINI_API_KEY; // prove the mock path needs no key
  delete env.CAREER_OPS_MOCK; // prove it's the --mock FLAG enabling mock, not an ambient env var

  const res = spawnSync(
    'node',
    ['gemini-eval.mjs', '--mock', '--no-save', '--file', FIXTURE],
    { cwd: ROOT, encoding: 'utf-8', env },
  );

  assert.equal(res.status, 0, `expected exit 0, got ${res.status}\n${res.stderr}`);
  assert.match(res.stdout, /Score:\s*\S+\/5/);
});

test('bare invocation (no args) prints usage and exits 0', () => {
  const res = spawnSync('node', ['gemini-eval.mjs'], { cwd: ROOT, encoding: 'utf-8' });
  assert.equal(res.status, 0, `expected exit 0, got ${res.status}\n${res.stderr}`);
  assert.match(res.stdout, /USAGE/);
});
