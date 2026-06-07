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
