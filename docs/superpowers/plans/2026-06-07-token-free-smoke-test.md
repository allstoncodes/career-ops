# Token-Free Smoke Test + `eval-core` Seam — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `career-ops` validate its eval pipeline end-to-end with **zero tokens** — via a testable `eval-core` module, a `--mock` path on `gemini-eval.mjs`, and an `npm run smoke` orchestrator.

**Architecture:** Extract the side-effect-free logic of `gemini-eval.mjs` into `scripts/eval-core.mjs` (Approach 2 — seam extraction + TDD). The model client is **injected** into `callModel`, so a mock client drives the full flow (context load → prompt build → parse → render) with no network and no API key. `gemini-eval.mjs` becomes a thin CLI wrapper; `smoke.mjs` chains `doctor → eval(--mock) → verify` as subprocesses.

**Tech Stack:** Node ESM (`.mjs`), `node:test` + `node:assert/strict`, `child_process.spawnSync`, `@google/generative-ai` (real path only, lazy-imported).

**Worktree:** `~/.config/superpowers/worktrees/career-ops/token-free-smoke-test` (branch `token-free-smoke-test`). Baseline: existing `npm run test:derive` = 26 passing.

---

## File Structure

| File | Responsibility |
|---|---|
| `scripts/eval-core.mjs` | **NEW.** Pure functions: `loadContext`, `buildSystemPrompt`, `callModel`, `parseScoreSummary`, `renderReport`, `nextReportNumber`, `makeMockClient`. No top-level I/O, no `process.exit`, no network. |
| `scripts/test/eval-core.test.mjs` | **NEW.** Unit tests for the pure functions + mock client. |
| `scripts/test/eval-cli.test.mjs` | **NEW.** Integration test: spawn `gemini-eval.mjs --mock` with no key → exit 0 + parsed score. |
| `scripts/test/fixtures/mock-eval-response.md` | **NEW.** Canned LLM response with a valid `SCORE_SUMMARY` block. |
| `scripts/test/fixtures/smoke-jd.txt` | **NEW.** Tiny fixture JD (note: `jds/*` is gitignored, so fixtures live under `scripts/test/`). |
| `gemini-eval.mjs` | **REFACTOR.** Thin CLI wrapper over `eval-core`; adds `--mock` / `CAREER_OPS_MOCK=1`; lazy-imports the SDK on the real path only; skips the key check when mocking. |
| `smoke.mjs` | **NEW.** Orchestrator for `npm run smoke` (`--with-scan` opt-in). |
| `package.json` | Add `"smoke"` and `"test"` scripts. |

---

## Task 1: `eval-core.mjs` — the testable seam (TDD)

**Files:**
- Create: `scripts/eval-core.mjs`
- Test: `scripts/test/eval-core.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `scripts/test/eval-core.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  parseScoreSummary,
  renderReport,
  nextReportNumber,
  buildSystemPrompt,
  callModel,
  makeMockClient,
} from '../eval-core.mjs';

const SUMMARY = `Some eval body text...
---SCORE_SUMMARY---
COMPANY: Acme AI
ROLE: Senior SWE
SCORE: 3.8
ARCHETYPE: Frontier Lab
LEGITIMACY: High Confidence
---END_SUMMARY---`;

test('parseScoreSummary extracts all five fields from a valid block', () => {
  const r = parseScoreSummary(SUMMARY);
  assert.equal(r.company, 'Acme AI');
  assert.equal(r.role, 'Senior SWE');
  assert.equal(r.score, '3.8');
  assert.equal(r.archetype, 'Frontier Lab');
  assert.equal(r.legitimacy, 'High Confidence');
});

test('parseScoreSummary defaults every field to unknown when block is absent', () => {
  const r = parseScoreSummary('no summary block here');
  assert.equal(r.company, 'unknown');
  assert.equal(r.score, 'unknown');
  assert.equal(r.legitimacy, 'unknown');
});

test('parseScoreSummary defaults missing keys to unknown', () => {
  const r = parseScoreSummary('---SCORE_SUMMARY---\nCOMPANY: X\n---END_SUMMARY---');
  assert.equal(r.company, 'X');
  assert.equal(r.role, 'unknown');
  assert.equal(r.score, 'unknown');
});

test('renderReport emits header fields and strips the summary block', () => {
  const md = renderReport({
    company: 'Acme AI', role: 'Senior SWE', score: '3.8',
    archetype: 'Frontier Lab', legitimacy: 'High Confidence',
    modelName: 'gemini-2.0-flash', evaluationText: SUMMARY, date: '2026-06-07',
  });
  assert.match(md, /# Evaluation: Acme AI — Senior SWE/);
  assert.match(md, /\*\*Score:\*\* 3\.8\/5/);
  assert.match(md, /\*\*Date:\*\* 2026-06-07/);
  assert.match(md, /\*\*Tool:\*\* Gemini \(gemini-2\.0-flash\)/);
  assert.doesNotMatch(md, /SCORE_SUMMARY/);
});

test('nextReportNumber returns 001 for an absent dir', () => {
  assert.equal(nextReportNumber('/no/such/dir/at/all'), '001');
});

test('nextReportNumber increments past the highest NNN- file and ignores others', () => {
  const dir = mkdtempSync(join(tmpdir(), 'co-reports-'));
  try {
    writeFileSync(join(dir, '001-acme-2026-01-01.md'), 'x');
    writeFileSync(join(dir, '002-beta-2026-01-02.md'), 'x');
    writeFileSync(join(dir, 'notes.md'), 'x');
    assert.equal(nextReportNumber(dir), '003');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildSystemPrompt includes the three context sections and the summary contract', () => {
  const p = buildSystemPrompt({ shared: 'SHARED_X', oferta: 'OFERTA_Y', cv: 'CV_Z' });
  assert.match(p, /SHARED_X/);
  assert.match(p, /OFERTA_Y/);
  assert.match(p, /CV_Z/);
  assert.match(p, /---SCORE_SUMMARY---/);
});

test('callModel returns the mock client text with no network (token-free)', async () => {
  const client = makeMockClient('hello from mock');
  const text = await callModel({ client, systemPrompt: 'sys', jdText: 'jd' });
  assert.equal(text, 'hello from mock');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ~/.config/superpowers/worktrees/career-ops/token-free-smoke-test && node --test scripts/test/eval-core.test.mjs`
Expected: FAIL — `Cannot find module '../eval-core.mjs'` (module not created yet).

- [ ] **Step 3: Write the minimal implementation**

Create `scripts/eval-core.mjs`:

```js
/**
 * eval-core.mjs — pure, testable core for the Gemini job-offer evaluator.
 *
 * gemini-eval.mjs is a thin CLI wrapper around these functions. Keeping them
 * side-effect-free (no top-level I/O, no process.exit, no network) makes the
 * fragile bits — SCORE_SUMMARY parsing, report rendering, report numbering —
 * unit-testable, and lets a mock client drive the whole flow with zero tokens.
 */

import { readFileSync, existsSync, readdirSync } from 'fs';

/**
 * Read the three context files used to build the evaluation prompt. A missing
 * file degrades to a labelled placeholder (preserves prior behavior: the
 * evaluator still runs, the prompt just notes the gap).
 */
export function loadContext({ sharedPath, ofertaPath, cvPath }) {
  const read = (path, label) =>
    existsSync(path) ? readFileSync(path, 'utf-8').trim() : `[${label} not found — skipping]`;
  return {
    shared: read(sharedPath, 'modes/_shared.md'),
    oferta: read(ofertaPath, 'modes/oferta.md'),
    cv: read(cvPath, 'cv.md'),
  };
}

/**
 * Assemble the system prompt. Mirrors the Claude skill-router logic and pins
 * the machine-readable SCORE_SUMMARY contract that parseScoreSummary depends on.
 */
export function buildSystemPrompt({ shared, oferta, cv }) {
  return `You are career-ops, an AI-powered job search assistant.
You evaluate job offers against the user's CV using a structured A-G scoring system.

Your evaluation methodology is defined below. Follow it exactly.

═══════════════════════════════════════════════════════
SYSTEM CONTEXT (_shared.md)
═══════════════════════════════════════════════════════
${shared}

═══════════════════════════════════════════════════════
EVALUATION MODE (oferta.md)
═══════════════════════════════════════════════════════
${oferta}

═══════════════════════════════════════════════════════
CANDIDATE RESUME (cv.md)
═══════════════════════════════════════════════════════
${cv}

═══════════════════════════════════════════════════════
IMPORTANT OPERATING RULES FOR THIS CLI SESSION
═══════════════════════════════════════════════════════
1. You do NOT have access to WebSearch, Playwright, or file writing tools.
   - For Block D (Comp research): provide salary estimates based on your training data, clearly noted as estimates.
   - For Block G (Legitimacy): analyze the JD text only; skip URL/page freshness checks.
   - Post-evaluation file saving is handled by the script, not by you.
2. Generate Blocks A through G in full, in English, unless the JD is in another language.
3. At the very end, output a machine-readable summary block in this exact format:

---SCORE_SUMMARY---
COMPANY: <company name or "Unknown">
ROLE: <role title>
SCORE: <global score as decimal, e.g. 3.8>
ARCHETYPE: <detected archetype>
LEGITIMACY: <High Confidence | Proceed with Caution | Suspicious>
---END_SUMMARY---
`;
}

/**
 * Call the (injected) generative model and return its text. The client is
 * injected so a mock can stand in for the real Gemini SDK with no network/key.
 * Any object exposing generateContent(parts) -> { response: { text() } } works.
 */
export async function callModel({ client, systemPrompt, jdText }) {
  const result = await client.generateContent([
    { text: systemPrompt },
    { text: `\n\nJOB DESCRIPTION TO EVALUATE:\n\n${jdText}` },
  ]);
  return result.response.text();
}

/**
 * Extract the machine-readable summary block. Every field defaults to 'unknown'
 * when the block or a key is absent, so downstream code never crashes.
 */
export function parseScoreSummary(text) {
  const defaults = {
    company: 'unknown', role: 'unknown', score: 'unknown',
    archetype: 'unknown', legitimacy: 'unknown',
  };
  const match = text.match(/---SCORE_SUMMARY---\s*([\s\S]*?)---END_SUMMARY---/);
  if (!match) return { ...defaults };
  const block = match[1];
  const extract = (key) => {
    const m = block.match(new RegExp(`${key}:\\s*(.+)`));
    return m ? m[1].trim() : 'unknown';
  };
  return {
    company: extract('COMPANY'),
    role: extract('ROLE'),
    score: extract('SCORE'),
    archetype: extract('ARCHETYPE'),
    legitimacy: extract('LEGITIMACY'),
  };
}

/**
 * Render the saved report markdown. `date` is injected (not read from the clock)
 * so output is deterministic + testable. The SCORE_SUMMARY block is stripped
 * from the body (its values live in the header fields).
 */
export function renderReport({ company, role, score, archetype, legitimacy, modelName, evaluationText, date }) {
  const body = evaluationText.replace(/---SCORE_SUMMARY---[\s\S]*?---END_SUMMARY---/, '').trim();
  return `# Evaluation: ${company} — ${role}

**Date:** ${date}
**Archetype:** ${archetype}
**Score:** ${score}/5
**Legitimacy:** ${legitimacy}
**PDF:** pending
**Tool:** Gemini (${modelName})

---

${body}
`;
}

/**
 * Next zero-padded report number from NNN- prefixed files in reportsDir.
 * Absent/empty dir -> '001'.
 */
export function nextReportNumber(reportsDir) {
  if (!existsSync(reportsDir)) return '001';
  const nums = readdirSync(reportsDir)
    .filter((f) => /^\d{3}-/.test(f))
    .map((f) => parseInt(f.slice(0, 3), 10))
    .filter((n) => !Number.isNaN(n));
  if (nums.length === 0) return '001';
  return String(Math.max(...nums) + 1).padStart(3, '0');
}

/**
 * A mock generative client matching the SDK shape, for token-free runs/tests.
 */
export function makeMockClient(fixtureText) {
  return {
    generateContent: async () => ({ response: { text: () => fixtureText } }),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test scripts/test/eval-core.test.mjs`
Expected: PASS — 8 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add scripts/eval-core.mjs scripts/test/eval-core.test.mjs
git commit -m "feat(eval-core): extract testable eval functions + injectable mock client

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Fixtures (mock response + smoke JD)

**Files:**
- Create: `scripts/test/fixtures/mock-eval-response.md`
- Create: `scripts/test/fixtures/smoke-jd.txt`

- [ ] **Step 1: Create the canned mock response**

Create `scripts/test/fixtures/mock-eval-response.md`:

```markdown
# career-ops evaluation (MOCK FIXTURE — not a real model output)

Deterministic fixture used by `--mock`, the smoke test, and the CLI integration
test. It contains a representative A–G-style body and a valid summary block.

## Block A — Role fit
Strong alignment with AI infrastructure / systems-performance background.

## Block D — Compensation (estimate)
~$200K base (estimate from training data; not live market data).

## Block G — Legitimacy
JD text is internally consistent; no red flags in the provided text.

---SCORE_SUMMARY---
COMPANY: Acme AI
ROLE: Senior Software Engineer, Inference
SCORE: 3.8
ARCHETYPE: Frontier Lab
LEGITIMACY: High Confidence
---END_SUMMARY---
```

- [ ] **Step 2: Create the smoke fixture JD**

Create `scripts/test/fixtures/smoke-jd.txt`:

```text
Senior Software Engineer, Inference — Acme AI (San Francisco / Remote)

We are hiring an engineer to optimize LLM inference: kernel-level performance,
memory packing, and serving throughput. Python + CUDA. Competitive comp + equity.
```

- [ ] **Step 3: Commit**

```bash
git add scripts/test/fixtures/mock-eval-response.md scripts/test/fixtures/smoke-jd.txt
git commit -m "test(eval): add mock-response + smoke-jd fixtures

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Refactor `gemini-eval.mjs` into a thin wrapper + `--mock` (TDD)

> **PROCESS GATE — do this first:** invoke the `api-key-security` skill before editing the
> `GEMINI_API_KEY` check. This edit only changes *when* the key is required (mock mode skips it);
> no secret value is read or written. `.env` is already gitignored (verified). Do not print key values.

**Files:**
- Modify: `gemini-eval.mjs` (full rewrite to a thin wrapper)
- Test: `scripts/test/eval-cli.test.mjs`

- [ ] **Step 1: Write the failing integration test**

Create `scripts/test/eval-cli.test.mjs`:

```js
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

  const res = spawnSync(
    'node',
    ['gemini-eval.mjs', '--mock', '--no-save', '--file', FIXTURE],
    { cwd: ROOT, encoding: 'utf-8', env },
  );

  assert.equal(res.status, 0, `expected exit 0, got ${res.status}\n${res.stderr}`);
  assert.match(res.stdout, /Score:\s*\S+\/5/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test scripts/test/eval-cli.test.mjs`
Expected: FAIL — current `gemini-eval.mjs` has no `--mock`; it falls through to the real path, finds no key, and exits 1 (`status !== 0`).

- [ ] **Step 3: Rewrite `gemini-eval.mjs` as the thin wrapper**

Replace the entire contents of `gemini-eval.mjs` with:

```js
#!/usr/bin/env node
/**
 * gemini-eval.mjs — Gemini-powered Job Offer Evaluator for career-ops (thin CLI).
 *
 * The evaluation logic lives in scripts/eval-core.mjs (side-effect-free + tested).
 * This file parses args, wires the REAL or a MOCK generative client, and handles
 * display + report saving.
 *
 * Usage:
 *   node gemini-eval.mjs "Paste JD text here"
 *   node gemini-eval.mjs --file ./jds/my-job.txt
 *   node gemini-eval.mjs --mock --no-save --file ./scripts/test/fixtures/smoke-jd.txt
 *
 * GEMINI_API_KEY is required for the REAL path only. Mock mode (--mock or
 * CAREER_OPS_MOCK=1) spends zero tokens, makes no network call, and needs no key.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import {
  loadContext,
  buildSystemPrompt,
  callModel,
  parseScoreSummary,
  renderReport,
  nextReportNumber,
  makeMockClient,
} from './scripts/eval-core.mjs';

// Load .env (optional) before reading process.env.
try {
  const { config } = await import('dotenv');
  config();
} catch {
  // dotenv is optional — fall back to process.env if not installed
}

const ROOT = dirname(fileURLToPath(import.meta.url));
const PATHS = {
  shared: join(ROOT, 'modes', '_shared.md'),
  oferta: join(ROOT, 'modes', 'oferta.md'),
  cv: join(ROOT, 'cv.md'),
  reports: join(ROOT, 'reports'),
  fixture: join(ROOT, 'scripts', 'test', 'fixtures', 'mock-eval-response.md'),
};

// --- CLI args ---
const args = process.argv.slice(2);

if (args[0] === '--help' || args[0] === '-h') {
  console.log(`
career-ops — Gemini Evaluator (free-tier)

  USAGE
    node gemini-eval.mjs "<JD text>"
    node gemini-eval.mjs --file ./jds/my-job.txt
    node gemini-eval.mjs --mock --no-save --file <fixture>

  OPTIONS
    --file <path>    Read JD from a file instead of inline text
    --model <name>   Gemini model (default: gemini-2.0-flash)
    --no-save        Do not write a report to reports/
    --mock           Token-free: stub the model with a fixture (no key, no network)
    --help           Show this help

  SETUP (real path)
    1. Get a free API key at https://aistudio.google.com/apikey
    2. Add GEMINI_API_KEY=<key> to .env
    3. npm install
`);
  process.exit(0);
}

let jdText = '';
let modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
let saveReport = true;
let mock = process.env.CAREER_OPS_MOCK === '1';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--file' && args[i + 1]) {
    const filePath = args[++i];
    if (!existsSync(filePath)) {
      console.error(`❌  File not found: ${filePath}`);
      process.exit(1);
    }
    jdText = readFileSync(filePath, 'utf-8').trim();
  } else if (args[i] === '--model' && args[i + 1]) {
    modelName = args[++i];
  } else if (args[i] === '--no-save') {
    saveReport = false;
  } else if (args[i] === '--mock') {
    mock = true;
  } else if (!args[i].startsWith('--')) {
    jdText += (jdText ? '\n' : '') + args[i];
  }
}

if (!jdText) {
  console.error('❌  No Job Description provided. Run with --help for usage.');
  process.exit(1);
}

// --- Build the model client (real path lazy-imports the SDK + needs a key) ---
let client;
if (mock) {
  if (!existsSync(PATHS.fixture)) {
    console.error(`❌  Mock fixture not found: ${PATHS.fixture}`);
    process.exit(1);
  }
  client = makeMockClient(readFileSync(PATHS.fixture, 'utf-8'));
  console.log('\n🧪  MOCK mode — no API call, no tokens spent.');
} else {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error(`
❌  GEMINI_API_KEY not found.
   1. Get a free key at https://aistudio.google.com/apikey
   2. Add it to .env:   GEMINI_API_KEY=your_key_here
`);
    process.exit(1);
  }
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(apiKey);
  client = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: { temperature: 0.4, maxOutputTokens: 8192 },
  });
  console.log(`🤖  Calling Gemini (${modelName})... this may take 30-60 seconds.\n`);
}

// --- Load context + build prompt ---
console.log('📂  Loading context files...');
const ctx = loadContext({ sharedPath: PATHS.shared, ofertaPath: PATHS.oferta, cvPath: PATHS.cv });
const systemPrompt = buildSystemPrompt(ctx);

// --- Evaluate ---
let evaluationText;
try {
  evaluationText = await callModel({ client, systemPrompt, jdText });
} catch (err) {
  console.error('❌  Model call failed:', err.message);
  process.exit(1);
}

// --- Display ---
console.log('\n' + '═'.repeat(66));
console.log('  CAREER-OPS EVALUATION — powered by Google Gemini');
console.log('═'.repeat(66) + '\n');
console.log(evaluationText);

// --- Parse summary + optionally save ---
const summary = parseScoreSummary(evaluationText);

if (saveReport) {
  try {
    if (!existsSync(PATHS.reports)) mkdirSync(PATHS.reports, { recursive: true });
    const num = nextReportNumber(PATHS.reports);
    const date = new Date().toISOString().split('T')[0];
    const companySlug = summary.company.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const filename = `${num}-${companySlug}-${date}.md`;
    const report = renderReport({ ...summary, modelName, evaluationText, date });
    writeFileSync(join(PATHS.reports, filename), report, 'utf-8');
    console.log(`\n✅  Report saved: reports/${filename}`);
    console.log('\n📊  Tracker entry (add to data/applications.md):');
    console.log(`    | ${num} | ${date} | ${summary.company} | ${summary.role} | ${summary.score} | Evaluada | ❌ | [${num}](reports/${filename}) |`);
  } catch (err) {
    console.warn(`⚠️   Could not save report: ${err.message}`);
  }
}

console.log('\n' + '─'.repeat(66));
console.log(`  Score: ${summary.score}/5  |  Archetype: ${summary.archetype}  |  Legitimacy: ${summary.legitimacy}`);
console.log('─'.repeat(66) + '\n');
```

- [ ] **Step 4: Run the integration test (and the full unit suite) to verify pass**

Run: `node --test scripts/test/eval-cli.test.mjs && node --test scripts/test/eval-core.test.mjs`
Expected: PASS — CLI test exits 0 with a `Score: 3.8/5` line; eval-core 8/8 still green.

- [ ] **Step 5: Sanity-check the real path is structurally intact (no tokens spent)**

Run: `node gemini-eval.mjs --file scripts/test/fixtures/smoke-jd.txt 2>&1 | head -5`
Expected: with no/blank key it stops at `❌  GEMINI_API_KEY not found` (proves the real branch still gates on the key and lazy-imports the SDK only here). **Do not** add a real key for this check.

- [ ] **Step 6: Commit**

```bash
git add gemini-eval.mjs scripts/test/eval-cli.test.mjs
git commit -m "refactor(gemini-eval): thin CLI over eval-core + token-free --mock path

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `smoke.mjs` orchestrator + npm scripts

**Files:**
- Create: `smoke.mjs`
- Modify: `package.json` (add `"smoke"` and `"test"` scripts)

- [ ] **Step 1: Create `smoke.mjs`**

Create `smoke.mjs`:

```js
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
```

- [ ] **Step 2: Add npm scripts**

In `package.json`, add two lines to the `"scripts"` block (after `"verify"` and `"test:derive"` respectively):

```json
    "smoke": "node smoke.mjs",
    "test": "node --test scripts/test/*.test.mjs"
```

(The full `scripts` block should read, in order: `doctor`, `verify`, `smoke`, `normalize`, `dedup`, `merge`, `pdf`, `sync-check`, `update:check`, `update`, `rollback`, `liveness`, `scan`, `gemini:eval`, `derive`, `derive:check`, `test:derive`, `test`.)

- [ ] **Step 3: Prepare the worktree runtime (one-time; gitignored user files not in the diff)**

`doctor` requires the gitignored user-data files, which live only in the main checkout. Symlink them into the worktree so the smoke can run here:

```bash
CO=/Users/allstonfojas/Code/career-ops
WT=~/.config/superpowers/worktrees/career-ops/token-free-smoke-test
ln -sf "$CO/cv.md" "$WT/cv.md"
ln -sf "$CO/config/profile.yml" "$WT/config/profile.yml"
ln -sf "$CO/portals.yml" "$WT/portals.yml"
```

If `doctor` later reports Playwright chromium missing, run `npx playwright install chromium` once (environment setup, not a code change).

- [ ] **Step 4: Run the smoke test to verify it passes**

Run: `npm run smoke`
Expected: a `✅` line for each of `doctor`, `eval --mock`, `verify`, then `🟢  Smoke passed — pipeline plumbing works, zero tokens spent.` (exit 0).

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS — all `scripts/test/*.test.mjs` (existing 26 derive + 8 eval-core + 1 eval-cli = 35), 0 failures.

- [ ] **Step 6: Commit**

```bash
git add smoke.mjs package.json
git commit -m "feat(smoke): npm run smoke — token-free doctor→eval→verify orchestrator

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Final verification + self-check

**Files:** none (verification only)

- [ ] **Step 1: Confirm zero-token + no-key behavior explicitly**

Run: `env -u GEMINI_API_KEY node gemini-eval.mjs --mock --no-save --file scripts/test/fixtures/smoke-jd.txt | tail -3`
Expected: prints `Score: 3.8/5 | Archetype: Frontier Lab | Legitimacy: High Confidence` with no key set.

- [ ] **Step 2: Confirm no new dependencies + contained diff**

Run: `git -C ~/.config/superpowers/worktrees/career-ops/token-free-smoke-test diff --stat main...token-free-smoke-test`
Expected: only `docs/superpowers/{specs,plans}/...`, `scripts/eval-core.mjs`, `scripts/test/eval-core.test.mjs`, `scripts/test/eval-cli.test.mjs`, `scripts/test/fixtures/*`, `gemini-eval.mjs`, `smoke.mjs`, `package.json`. No `package-lock.json` / dependency changes.

- [ ] **Step 3: Confirm the real Gemini path is byte-compatible**

Read `gemini-eval.mjs` and confirm the real branch still uses `model: modelName` + `generationConfig: { temperature: 0.4, maxOutputTokens: 8192 }` and the same `callModel` parts. (No behavioral change when not mocking.)

- [ ] **Step 4: Request code review**

Invoke `superpowers:requesting-code-review` (per the personal-vault default for substantive work) before declaring done.

---

## Acceptance Criteria (from the spec)

- `npm test` green (26 existing + 9 new).
- `gemini-eval.mjs --mock --no-save` produces a parsed `Score` with **no `GEMINI_API_KEY`** and **no network**.
- `npm run smoke` exits 0 with a `✅` checklist when user-data files are present; exits 1 with a clear failure list otherwise.
- Real eval behavior unchanged (same model / temperature / token budget on the non-mock path).
- No new dependencies; diff limited to the files above.
