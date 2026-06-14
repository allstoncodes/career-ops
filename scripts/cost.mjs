#!/usr/bin/env node
/**
 * cost.mjs — compute per-eval USD cost from token counts + config/model-prices.yml.
 *
 * Config-driven so no price is hardcoded in logic (the prices live in a
 * user-verifiable YAML). Prints the list-price-equivalent cost — the number to
 * use for apples-to-apples model comparison even when actually billed $0 (free
 * tier / local). Unknown model or missing tokens → prints empty (not a fake 0).
 *
 * Usage: node scripts/cost.mjs <model> <tokens_in> <tokens_out>
 *   → prints e.g. "0.000412"
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import yaml from 'js-yaml';

const HERE = dirname(fileURLToPath(import.meta.url));
const PRICES_PATH = join(HERE, '..', 'config', 'model-prices.yml');

export function computeCost(model, tokensIn, tokensOut, prices) {
  const m = prices?.models?.[model];
  if (!m || tokensIn == null || tokensOut == null) return null;
  const rate = m.list_usd_per_mtok || {};
  const inRate = Number(rate.input ?? 0);
  const outRate = Number(rate.output ?? 0);
  return (Number(tokensIn) / 1e6) * inRate + (Number(tokensOut) / 1e6) * outRate;
}

function main() {
  const [model, tIn, tOut] = process.argv.slice(2);
  let prices;
  try {
    prices = yaml.load(readFileSync(PRICES_PATH, 'utf-8'));
  } catch {
    process.stdout.write('');
    return;
  }
  const cost = computeCost(model, tIn === '' ? null : tIn, tOut === '' ? null : tOut, prices);
  process.stdout.write(cost == null ? '' : cost.toFixed(6));
}

// Run only when invoked directly (keeps computeCost importable/testable).
if (process.argv[1] && process.argv[1].endsWith('cost.mjs')) main();
