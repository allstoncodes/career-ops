#!/usr/bin/env node
/**
 * smoke.mjs — token-free end-to-end smoke test for the career-ops pipeline.
 *
 * Runs the deterministic, zero-token core (doctor -> eval --mock -> verify) as
 * subprocesses, tallies results, and prints a ✅/❌ checklist. Exits non-zero if
 * any stage fails. `--with-scan` prepends the network-bound `scan --dry-run`.
 *
 * Run:  npm run smoke           (default core)
 *       npm run smoke -- --with-scan
 */

import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const FIXTURE_JD = join(ROOT, 'scripts', 'test', 'fixtures', 'smoke-jd.txt');
const withScan = process.argv.includes('--with-scan');

if (!existsSync(FIXTURE_JD)) {
  console.error(`❌  smoke fixture not found at ${FIXTURE_JD}`);
  process.exit(1);
}

const stages = [];
if (withScan) {
  stages.push({ name: 'scan --dry-run', cmd: 'node', args: ['scan.mjs', '--dry-run'] });
}
stages.push(
  { name: 'doctor (setup)', cmd: 'node', args: ['doctor.mjs'] },
  {
    name: 'eval --mock (token-free)',
    cmd: 'node',
    args: ['gemini-eval.mjs', '--mock', '--no-save', '--file', FIXTURE_JD],
    expectStdout: /Score:\s*\S+\/5/,
    env: { ...process.env, CAREER_OPS_MOCK: '1' },
  },
  { name: 'verify (data integrity)', cmd: 'node', args: ['verify-pipeline.mjs'] },
);

console.log('\ncareer-ops smoke test (token-free)');
console.log('==================================\n');

let failures = 0;
for (const stage of stages) {
  const res = spawnSync(stage.cmd, stage.args, {
    cwd: ROOT,
    encoding: 'utf-8',
    env: stage.env || process.env,
  });
  const exitOk = res.status === 0;
  const stdoutOk = stage.expectStdout ? stage.expectStdout.test(res.stdout || '') : true;

  if (exitOk && stdoutOk) {
    console.log(`✅  ${stage.name}`);
  } else {
    failures++;
    console.log(`❌  ${stage.name}`);
    if (!exitOk) console.log(`     exit ${res.status}`);
    if (!stdoutOk) console.log(`     stdout did not match ${stage.expectStdout}`);
    const tail = (res.stderr || res.stdout || '').trim().split('\n').slice(-6);
    for (const line of tail) if (line) console.log(`     ${line}`);
  }
}

console.log('\n' + '='.repeat(40));
if (failures === 0) {
  console.log('🟢  Smoke passed — pipeline plumbing works, zero tokens spent.');
  process.exit(0);
}
console.log(`🔴  Smoke failed — ${failures} stage(s) broken. Fix before running the real pipeline.`);
process.exit(1);
