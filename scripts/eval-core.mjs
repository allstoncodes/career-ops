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
 * Call the (injected) generative model and return its text + token usage. The
 * client is injected so a mock can stand in for the real Gemini SDK with no
 * network/key. Any object exposing generateContent(parts) ->
 * { response: { text(), usageMetadata? } } works.
 *
 * Returns { text, usage } where usage = { tokens_in, tokens_out, tokens_total }
 * (each null when the provider/mock does not report it).
 */
export async function callModel({ client, systemPrompt, jdText }) {
  const result = await client.generateContent([
    { text: systemPrompt },
    { text: `\n\nJOB DESCRIPTION TO EVALUATE:\n\n${jdText}` },
  ]);
  return { text: result.response.text(), usage: extractUsage(result.response) };
}

/**
 * Pull token usage from a model response for observability (the speed/cost/
 * energy trifecta). Returns null counts when the field is absent (mock client,
 * older SDKs, or a provider that does not report usage) so callers record
 * "unknown" rather than a fabricated zero.
 *
 * Gemini exposes response.usageMetadata =
 *   { promptTokenCount, candidatesTokenCount, totalTokenCount }.
 */
export function extractUsage(response) {
  const u = response?.usageMetadata || {};
  return {
    tokens_in: u.promptTokenCount ?? null,
    tokens_out: u.candidatesTokenCount ?? null,
    tokens_total: u.totalTokenCount ?? null,
    // The concrete model that actually served the request (e.g. resolves a
    // moving alias like gemini-flash-latest -> gemini-2.5-flash-002). Null when
    // the SDK/provider does not report it — never fabricated.
    model_version: response?.modelVersion ?? null,
  };
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
  const body = evaluationText.replace(/---SCORE_SUMMARY---[\s\S]*?---END_SUMMARY---/g, '').trim();
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
 * Optionally carries usageMetadata so token-capture can be exercised offline.
 */
export function makeMockClient(fixtureText, usageMetadata = null) {
  return {
    generateContent: async () => ({
      response: {
        text: () => fixtureText,
        ...(usageMetadata ? { usageMetadata } : {}),
      },
    }),
  };
}
