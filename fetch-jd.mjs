#!/usr/bin/env node

/**
 * fetch-jd.mjs — Single Job-Description fetcher (zero-token).
 *
 * Turns ONE pipeline role URL into plain-text JD content suitable for piping
 * into `gemini-eval.mjs --file`. Reuses the same public-ATS endpoints as
 * scan.mjs (Greenhouse boards-api, Ashby posting-api, Lever v0) but pulls the
 * FULL description for a single posting instead of the title-only board list.
 *
 * Pure HTTP + JSON + HTML-strip — no Claude/Gemini tokens spent here.
 *
 * Usage:
 *   node fetch-jd.mjs "https://job-boards.greenhouse.io/anthropic/jobs/4641822008"
 *   node fetch-jd.mjs "<url>" > jds/anthropic-inference.txt
 */

const FETCH_TIMEOUT_MS = 15_000;

// ── ATS detection: URL → { type, apiUrl, board, id } ────────────────────────

// Company-hosted Greenhouse embeds expose roles via `?gh_jid=<id>` on their own
// domain instead of job-boards.greenhouse.io. Map the domain → greenhouse board
// slug so those still resolve. Extend as new gh_jid-style companies appear.
const DOMAIN_TO_GH_BOARD = {
  'databricks.com': 'databricks',
  'stripe.com': 'stripe',
};

function detectJd(url) {
  // Greenhouse: job-boards(.eu).greenhouse.io/<board>/jobs/<id>  OR boards.greenhouse.io/<board>/jobs/<id>
  const gh = url.match(/(?:job-boards(?:\.eu)?|boards)\.greenhouse\.io\/([^/?#]+)\/jobs\/(\d+)/);
  if (gh) {
    return {
      type: 'greenhouse',
      board: gh[1],
      id: gh[2],
      apiUrl: `https://boards-api.greenhouse.io/v1/boards/${gh[1]}/jobs/${gh[2]}?questions=false`,
    };
  }

  // Company-hosted Greenhouse embed: <domain>/...?gh_jid=<id>
  const ghJid = url.match(/gh_jid=(\d+)/);
  if (ghJid) {
    const host = (url.match(/^https?:\/\/(?:www\.)?([^/]+)/) || [])[1] || '';
    const board = DOMAIN_TO_GH_BOARD[host];
    if (board) {
      return {
        type: 'greenhouse',
        board,
        id: ghJid[1],
        apiUrl: `https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${ghJid[1]}?questions=false`,
      };
    }
  }

  // Ashby: jobs.ashbyhq.com/<board>/<uuid>
  const ashby = url.match(/jobs\.ashbyhq\.com\/([^/?#]+)\/([0-9a-f-]{8,})/i);
  if (ashby) {
    return {
      type: 'ashby',
      board: ashby[1],
      id: ashby[2],
      apiUrl: `https://api.ashbyhq.com/posting-api/job-board/${ashby[1]}?includeCompensation=true`,
    };
  }

  // Lever: jobs.lever.co/<board>/<id>
  const lever = url.match(/jobs\.lever\.co\/([^/?#]+)\/([0-9a-f-]{8,})/i);
  if (lever) {
    return {
      type: 'lever',
      board: lever[1],
      id: lever[2],
      apiUrl: `https://api.lever.co/v0/postings/${lever[1]}/${lever[2]}`,
    };
  }

  return null;
}

// ── HTTP with timeout ───────────────────────────────────────────────────────

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ── HTML → plain text (good-enough for an LLM eval input) ───────────────────

function htmlToText(html) {
  if (!html) return '';
  return html
    // Greenhouse double-encodes its content (&lt;div&gt;…) — decode the angle
    // brackets + ampersand FIRST so the tag-strip below actually sees real tags.
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|li|h[1-6]|tr)\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '  • ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&mdash;/g, '—')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

// ── Per-ATS extractors → a normalized { title, company, location, comp, body } ──

function extractGreenhouse(json) {
  return {
    title: json.title || '',
    location: json.location?.name || '',
    comp: '',
    body: htmlToText(json.content || ''),
  };
}

function extractAshby(json, id) {
  const jobs = json.jobs || [];
  const job =
    jobs.find(j => (j.jobUrl || '').includes(id)) ||
    jobs.find(j => j.id === id);
  if (!job) throw new Error(`Ashby posting ${id} not found on board (it may be closed)`);
  let comp = '';
  if (job.compensation?.compensationTierSummary) {
    comp = job.compensation.compensationTierSummary;
  } else if (Array.isArray(job.secondaryLocations) && job.compensationTierSummary) {
    comp = job.compensationTierSummary;
  }
  return {
    title: job.title || '',
    location: job.location || '',
    comp,
    body: htmlToText(job.descriptionHtml || job.descriptionPlain || ''),
  };
}

function extractLever(json) {
  const lists = Array.isArray(json.lists)
    ? json.lists.map(l => `${l.text}\n${htmlToText(l.content)}`).join('\n\n')
    : '';
  return {
    title: json.text || '',
    location: json.categories?.location || '',
    comp: json.salaryRange ? `${json.salaryRange.min}-${json.salaryRange.max} ${json.salaryRange.currency}` : '',
    body: `${htmlToText(json.description || '')}\n\n${lists}`.trim(),
  };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error('Usage: node fetch-jd.mjs "<role url>"');
    process.exit(1);
  }

  const det = detectJd(url);
  if (!det) {
    console.error(`❌  Unsupported ATS URL (not greenhouse/ashby/lever): ${url}`);
    process.exit(2);
  }

  const json = await fetchJson(det.apiUrl);
  let out;
  if (det.type === 'greenhouse') out = extractGreenhouse(json);
  else if (det.type === 'ashby') out = extractAshby(json, det.id);
  else out = extractLever(json);

  if (!out.body || out.body.length < 80) {
    console.error(`⚠️   JD body looks empty/too short for ${url} — posting may be closed.`);
  }

  // Emit a clean JD block for gemini-eval --file
  const header = [
    `# ${out.title}`,
    `Company board: ${det.board}`,
    out.location ? `Location: ${out.location}` : '',
    out.comp ? `Compensation: ${out.comp}` : '',
    `Source: ${url}`,
    '',
    '---',
    '',
  ].filter(Boolean).join('\n');

  process.stdout.write(header + '\n' + out.body + '\n');
}

main().catch(err => {
  console.error(`❌  ${err.message}`);
  process.exit(3);
});
