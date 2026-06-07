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
