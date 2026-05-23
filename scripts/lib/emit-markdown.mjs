// Marker-bounded markdown replacement + section renderers for cv.md and
// modes/_profile.md. The script only ever rewrites text BETWEEN
// <!-- DERIVED:BEGIN section=X --> / <!-- DERIVED:END section=X --> fences;
// everything outside a fence (hand-curated content) is preserved byte-for-byte.

import { parseKeyValueBullets } from './job-profile-parser.mjs';

/** List the section names that currently have a BEGIN marker. */
export function findMarkers(md) {
  return [...md.matchAll(/<!--\s*DERIVED:BEGIN section=([\w-]+)/g)].map((m) => m[1]);
}

/**
 * Replace the body between BEGIN/END markers for `section`.
 * Throws if the section has no markers, or markers are unbalanced.
 */
export function replaceMarkedSection(md, section, newBody) {
  const beginTag = `DERIVED:BEGIN section=${section}`;
  const endTag = `<!-- DERIVED:END section=${section} -->`;
  const bi = md.indexOf(beginTag);
  if (bi < 0) {
    throw new Error(
      `no DERIVED:BEGIN marker for section=${section}. ` +
        `Run with --init-markers once to insert markers, review the diff, then re-run.`,
    );
  }
  const nlAfterBegin = md.indexOf('\n', bi);
  if (nlAfterBegin < 0) throw new Error(`unterminated BEGIN marker line for section=${section}`);
  const ei = md.indexOf(endTag, nlAfterBegin);
  if (ei < 0) throw new Error(`unbalanced markers: BEGIN without END for section=${section}`);
  const before = md.slice(0, nlAfterBegin + 1);
  const after = md.slice(ei);
  return `${before}${newBody}\n${after}`;
}

/**
 * Insert BEGIN/END marker pairs around the body of recognized headings.
 * specs: [{ heading, section }]. Content between headings is left unchanged.
 * Idempotent: skips a heading that already has its marker.
 */
export function initMarkers(md, specs) {
  let lines = md.split('\n');
  for (const { heading, section } of specs) {
    const hi = lines.findIndex(
      (l) => /^#{2,3}\s+/.test(l) && l.replace(/^#{2,3}\s+/, '').trim().startsWith(heading),
    );
    if (hi < 0) throw new Error(`initMarkers: heading "${heading}" not found`);
    let ni = lines.length;
    for (let i = hi + 1; i < lines.length; i++) {
      if (/^#{1,6}\s+/.test(lines[i])) { ni = i; break; }
    }
    if (lines.slice(hi, ni).some((l) => l.includes(`DERIVED:BEGIN section=${section}`))) continue;
    lines = [
      ...lines.slice(0, hi + 1),
      `<!-- DERIVED:BEGIN section=${section} -->`,
      ...lines.slice(hi + 1, ni),
      `<!-- DERIVED:END section=${section} -->`,
      ...lines.slice(ni),
    ];
  }
  return lines.join('\n');
}

// ---- Section renderers (auto-derivable regions only) ----

export function renderCvHeader(c) {
  return [
    `**Location:** ${c.city} · **Email:** ${c.email} · **Phone:** ${c.phone}`,
    `**LinkedIn:** ${c.linkedin} · **GitHub:** ${c.github} · **Portfolio:** ${c.portfolio_url} · **X:** ${c.twitter}`,
    `**Visa:** ${c.visa_status}`,
  ].join('  \n');
}

export function renderEducation(eduLines) {
  const kv = parseKeyValueBullets(eduLines);
  const degree = kv.get('Degree') ?? '';
  const uni = kv.get('University') ?? '';
  const year = kv.get('Graduation year');
  const gpa = kv.get('GPA');
  let line = `**${degree}** — ${uni}`;
  if (year) line += ` (${year})`;
  if (gpa) line += ` · GPA ${gpa}`;
  return line;
}

export function renderExitNarrative(text) {
  return (text ?? '').trim();
}

export function renderCompTargets(comp) {
  return [
    `- **Target total comp:** ${comp.target_range}`,
    `- **Minimum walk-away:** ${comp.minimum}`,
    `- **Location flexibility:** ${comp.location_flexibility}`,
  ].join('\n');
}
