import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const profileYml = fileURLToPath(new URL('../../config/profile.yml', import.meta.url));
const fixture = 'scripts/test/fixtures/job-profile.fixture.md';

test('--all --dry-run --source <fixture> exits 0 and writes nothing', () => {
  const before = existsSync(profileYml) ? readFileSync(profileYml, 'utf-8') : null;
  const out = execFileSync(
    'node',
    ['scripts/derive-from-job-profile.mjs', '--all', '--dry-run', '--source', fixture],
    { cwd: repoRoot, encoding: 'utf-8' },
  );
  assert.match(out, /profile\.yml/i);
  const after = existsSync(profileYml) ? readFileSync(profileYml, 'utf-8') : null;
  assert.equal(after, before, 'dry-run must not modify config/profile.yml');
});

test('no source set exits non-zero', () => {
  assert.throws(() => {
    execFileSync('node', ['scripts/derive-from-job-profile.mjs', '--target', 'profile'], {
      cwd: repoRoot,
      encoding: 'utf-8',
      env: { ...process.env, JOB_PROFILE_PATH: '' },
      stdio: 'pipe',
    });
  });
});
