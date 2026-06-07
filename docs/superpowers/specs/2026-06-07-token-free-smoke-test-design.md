# Spec — Token-Free Smoke Test + `eval-core` Seam

- **Date:** 2026-06-07
- **Branch:** `token-free-smoke-test`
- **Status:** Approved in brainstorming → pending implementation plan
- **Author:** Allston + Claude (Opus 4.8)

## Context & problem

The career-ops pipeline spends LLM tokens in exactly **one** place: `gemini-eval.mjs`'s
call to `model.generateContent(...)` (Google Gemini). Before running the pipeline for the
real job switch, we want to validate end-to-end that the plumbing works **without spending
tokens** — a smoke test.

Existing safety tooling does not cover this:

- `doctor.mjs` (`npm run doctor`) checks **setup** (Node, deps, Playwright, `cv.md` /
  `config/profile.yml` / `portals.yml` exist). Never touches the LLM.
- `verify-pipeline.mjs` (`npm run verify`) checks **tracker data integrity**. Never touches the LLM.
- `scan --dry-run` / `derive --dry-run` mean **"no file writes"**, *not* "no API call."

So nothing exercises the **token-spending eval path** token-free. This spec closes that gap.

## Goal

1. A **token-free mode** for the evaluator that exercises the full eval plumbing
   (context load → prompt build → response parse → report render) with a **stubbed LLM** —
   zero tokens, **no `GEMINI_API_KEY` required**.
2. A thin **`npm run smoke`** orchestrator: `doctor → eval(mock) → verify`, reporting pass/fail.
3. **Unit tests** (`node --test`) on the fragile logic, enabled by refactoring `gemini-eval.mjs`
   into a testable `eval-core` module (Approach 2 — seam extraction + TDD).

## Non-goals (YAGNI)

- No behavior change to `scan.mjs`, `derive`, `verify-pipeline.mjs`, `doctor.mjs` (smoke only
  *invokes* `doctor`/`verify`).
- No change to real Gemini behavior (model / temperature / token budget) when not mocking.
- No new runtime dependencies.
- Default smoke does **not** run `scan` (network/Playwright; not token-bound) — opt-in via `--with-scan`.
- Default smoke does **not** write reports (`--no-save`); write-path correctness is covered by
  `renderReport` unit tests.

## Constraints

- Zero tokens and **no network** in the mock path.
- Mock path runs with **no `GEMINI_API_KEY`** present (fresh clone / CI can smoke it).
- Deterministic + fast default path.
- **Contain upstream divergence** (career-ops tracks `santifer/career-ops`): changes limited to
  `gemini-eval.mjs` + net-new files + `package.json`.
- Match repo idioms: ESM `.mjs`, `node --test`, `✅/❌` console style, conventional commits.

## Architecture / file layout

| File | Change | Purpose |
|---|---|---|
| `scripts/eval-core.mjs` | **NEW** — pure exported functions, no top-level side effects | Testable seam (matches the `scripts/` + `scripts/test/` pattern used by `derive`) |
| `gemini-eval.mjs` | **REFACTOR** → thin CLI wrapper importing `eval-core` | Keeps santifer's entry-point *name* stable; logic moves into a tested module |
| `smoke.mjs` | **NEW** — top-level orchestrator | `npm run smoke` |
| `scripts/test/eval-core.test.mjs` | **NEW** — `node --test` unit tests | TDD |
| `scripts/test/fixtures/mock-eval-response.md` | **NEW** — canned LLM response w/ valid `SCORE_SUMMARY` | drives mock + tests |
| `scripts/test/fixtures/smoke-jd.txt` | **NEW** — tiny fixture JD | smoke input (note: `jds/*` is gitignored, so fixtures live here) |
| `package.json` | add `"smoke"` + `"test"` scripts | wiring |

### `scripts/eval-core.mjs` exports

- `loadContext({ sharedPath, ofertaPath, cvPath })` → `{ shared, oferta, cv }` strings
  (tolerates missing files → `[label not found]` placeholder, preserving current behavior).
- `buildSystemPrompt({ shared, oferta, cv })` → string (includes the three context sections +
  the `---SCORE_SUMMARY---` machine-readable contract).
- `callModel({ client, systemPrompt, jdText })` → text. Calls `client.generateContent([...])`;
  **client is injected** (real or mock).
- `parseScoreSummary(text)` → `{ company, role, score, archetype, legitimacy }` (each defaults
  to `'unknown'` when absent).
- `renderReport({ company, role, score, archetype, legitimacy, modelName, evaluationText, date })`
  → markdown string (strips the `SCORE_SUMMARY` block from the body).
- `nextReportNumber(reportsDir)` → zero-padded `'NNN'`.
- `makeMockClient(fixtureText)` → `{ generateContent: async () => ({ response: { text: () => fixtureText } }) }`.

## The mock seam (core mechanism)

`callModel` takes an **injected client** matching the SDK shape
(`{ generateContent(parts) → { response: { text() } } }`):

- **Real:** the wrapper builds `new GoogleGenerativeAI(apiKey).getGenerativeModel({ model, generationConfig })`
  — unchanged model / temperature / tokens. The `@google/generative-ai` import becomes **lazy**
  (`await import(...)` only on the real path) so the mock path needs neither the dep nor a key.
- **Mock:** `makeMockClient(fixtureText)` returns the fixture — **no network, no key**.
  Selected by the `--mock` flag *or* the `CAREER_OPS_MOCK=1` env var (the env hook lets
  `smoke.mjs` force-mock spawned subprocesses uniformly).

In mock mode the `GEMINI_API_KEY` presence check is **skipped** (the whole point).

## Data flow

- **Real & mock are identical except `callModel`'s client.** `argv → loadContext (reads
  modes/_shared.md, oferta.md, cv.md) → buildSystemPrompt → callModel(client) → parseScoreSummary
  → renderReport → save/print`. The mock therefore exercises **everything except the network call.**
- **Smoke** (`smoke.mjs`) runs each stage as a subprocess, tallies doctor-style, prints a
  `✅/❌` checklist, exits 1 if any fail:
  1. `node doctor.mjs`
  2. `node gemini-eval.mjs --mock --no-save --file scripts/test/fixtures/smoke-jd.txt`
     (assert exit 0 **and** stdout contains a parsed `Score: X/5`)
  3. `node verify-pipeline.mjs`
  - `npm run smoke -- --with-scan` prepends `node scan.mjs --dry-run`.

## Error handling

- Missing fixture → clear `❌ smoke fixture not found at <path>`, exit 1.
- `eval-core` functions throw typed errors; the CLI wrapper catches → `❌` + exit 1 (preserves
  current behavior).
- `smoke.mjs` runs **all** stages (not fail-fast), reports the full checklist + a stderr tail
  for any failed stage, exits 1 on any failure (consistent with `doctor.mjs` / `verify-pipeline.mjs`).
- Mock mode with no API key must **not** error; real mode unchanged.

## Testing (TDD order — red → green → commit each)

1. `parseScoreSummary` — valid block extracts all 5 fields · missing block → `unknown` defaults · malformed → graceful.
2. `renderReport` — correct markdown header (score / archetype / legitimacy) · strips the `SCORE_SUMMARY` block.
3. `nextReportNumber` — empty → `001` · `001,002` → `003` · ignores non-matching files.
4. `buildSystemPrompt` — includes the 3 context sections + the `SCORE_SUMMARY` contract.
5. `makeMockClient` / `callModel` mock path — returns fixture text with no network.
6. CLI integration — spawn `gemini-eval.mjs --mock --no-save --file <fixture>` → exit 0 + score in stdout (locks the seam).

Plus a **smoke sanity** pass: run `npm run smoke`, expect green. (In the worktree this needs the
gitignored user-data files — `cv.md`, `config/profile.yml`, `portals.yml`, `modes/_profile.md` —
symlinked from the main checkout so `doctor` passes; these are not part of the committed diff.)

## Process gates

- **`api-key-security` skill** before editing the `GEMINI_API_KEY` presence-check block (modifying
  key-handling code; no secret value is read — mock mode just stops *requiring* the key).
- **Worktree** `~/.config/superpowers/worktrees/career-ops/token-free-smoke-test` (branch
  `token-free-smoke-test`) — created.
- **Fork divergence** contained to `gemini-eval.mjs` + net-new files.

## Acceptance criteria

- `node --test scripts/test/*.test.mjs` green (existing 26 + new).
- `gemini-eval.mjs --mock --no-save` produces a parsed `Score` with **no `GEMINI_API_KEY`** set and
  **no network call**.
- `npm run smoke` exits 0 with a `✅` checklist (doctor · eval-mock parsed a score · verify) when
  user-data files are present; exits 1 with a clear failure list otherwise.
- Real eval behavior unchanged (the non-mock path still builds the real client with the same
  model / temperature / token budget).
- No new dependencies; diff limited to the files listed above.
