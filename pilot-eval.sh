#!/usr/bin/env bash
set -uo pipefail
# pilot-eval.sh — Phase-B pilot eval harness (Gemini baseline + metrics capture).
#
# For each candidate URL in jds/candidates.tsv (cols: url<TAB>label), fetch the
# full JD (fetch-jd.mjs, zero-token) then evaluate it with gemini-eval.mjs and
# record quantitative metrics to data/pilot-metrics.tsv. Designed to be the
# measurement baseline against which a local model can later be A/B'd.
#
# Usage: ./pilot-eval.sh [candidates.tsv]

CAND="${1:-jds/candidates.tsv}"
METRICS="data/eval-observability.tsv"

# Observability header — speed/cost/accuracy trifecta + energy (write once)
if [[ ! -f "$METRICS" ]]; then
  printf 'ts\tmodel\tcompany\trole\tscore\tlegitimacy\tjd_chars\ttokens_in\ttokens_out\ttokens_total\twall_s\ttokens_per_s\tcost_usd\tenergy_wh\treport\turl\tmodel_version\n' > "$METRICS"
fi

n=0
while IFS=$'\t' read -r url label; do
  [[ -z "${url:-}" || "$url" == \#* ]] && continue
  n=$((n+1))
  slug=$(echo "$label" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-|-$//g')
  jd="jds/${slug}.txt"
  echo "── [$n] $label"

  # 1. fetch JD (zero-token)
  if ! node fetch-jd.mjs "$url" > "$jd" 2>/tmp/fetch-err; then
    echo "   ⚠️  fetch failed: $(cat /tmp/fetch-err | head -1) — skipping"
    continue
  fi
  jd_chars=$(wc -c < "$jd" | tr -d ' ')
  if [[ "$jd_chars" -lt 120 ]]; then
    echo "   ⚠️  JD too short ($jd_chars chars) — likely closed posting — skipping"
    continue
  fi

  # 2. Gemini eval (timed)
  start=$(date +%s)
  out=$(node gemini-eval.mjs --file "$jd" 2>&1)
  wall=$(( $(date +%s) - start ))

  # 3. parse the SCORE_SUMMARY + USAGE blocks
  score=$(echo "$out"     | grep -E '^SCORE:'        | head -1 | sed -E 's/^SCORE:[[:space:]]*//')
  company=$(echo "$out"   | grep -E '^COMPANY:'      | head -1 | sed -E 's/^COMPANY:[[:space:]]*//')
  role=$(echo "$out"      | grep -E '^ROLE:'         | head -1 | sed -E 's/^ROLE:[[:space:]]*//')
  legit=$(echo "$out"     | grep -E '^LEGITIMACY:'   | head -1 | sed -E 's/^LEGITIMACY:[[:space:]]*//')
  model=$(echo "$out"     | grep -E '^MODEL:'         | head -1 | sed -E 's/^MODEL:[[:space:]]*//')
  mver=$(echo "$out"      | grep -E '^MODEL_VERSION:' | head -1 | sed -E 's/^MODEL_VERSION:[[:space:]]*//')
  tin=$(echo "$out"       | grep -E '^TOKENS_IN:'    | head -1 | sed -E 's/^TOKENS_IN:[[:space:]]*//')
  tout=$(echo "$out"      | grep -E '^TOKENS_OUT:'   | head -1 | sed -E 's/^TOKENS_OUT:[[:space:]]*//')
  ttot=$(echo "$out"      | grep -E '^TOKENS_TOTAL:' | head -1 | sed -E 's/^TOKENS_TOTAL:[[:space:]]*//')
  report=$(echo "$out"    | grep -oE 'reports/[0-9a-zA-Z._-]+\.md' | head -1)
  [[ -z "$score" ]] && score="ERR" && echo "   ⚠️  no score parsed (rate-limit or eval error)"

  # speed: output-tokens / wall-second
  tps=$(awk -v o="${tout:-}" -v w="$wall" 'BEGIN{ if(o!="" && w>0) printf "%.1f", o/w; else printf "" }')
  # cost: list-price-equivalent from config/model-prices.yml (empty if unknown)
  cost=$(node scripts/cost.mjs "${model:-}" "${tin:-}" "${tout:-}" 2>/dev/null)
  # energy: cloud is not client-measurable; left blank (filled for local models)
  energy=""

  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$(date +%FT%T)" "${model:-?}" "${company:-$label}" "${role:-?}" "$score" "${legit:-?}" \
    "$jd_chars" "${tin:-}" "${tout:-}" "${ttot:-}" "$wall" "$tps" "$cost" "$energy" \
    "${report:-?}" "$url" "${mver:-}" >> "$METRICS"
  echo "   ✓ score=${score}  ${ttot:-?}tok  ${wall}s  ${tps:-?}tok/s  \$${cost:-?}  ${report:-no-report}"
done < "$CAND"

echo ""
echo "═══ pilot eval done — $n candidates processed ═══"
echo "metrics → $METRICS"
