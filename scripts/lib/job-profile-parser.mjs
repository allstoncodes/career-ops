// Pure parsers for the canonical job-profile.md (no filesystem access here).
// Consumed by emit-profile-yml.mjs and emit-markdown.mjs.

/** Hard-fail with a derive-prefixed message. */
export function die(msg) {
  console.error(`derive: ${msg}`);
  process.exit(1);
}

/**
 * Split markdown into a Map of "## Heading" -> body lines (string[]).
 * Lines under "### " sub-headings stay inside their parent section's body.
 */
export function parseSections(md) {
  const sections = new Map();
  let current = null;
  for (const line of md.split('\n')) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m && !/^###/.test(line)) {
      current = m[1].trim();
      sections.set(current, []);
    } else if (current) {
      sections.get(current).push(line);
    }
  }
  return sections;
}

/** Require a section or die with the list of sections actually found. */
export function requireSection(sections, name) {
  if (!sections.has(name)) {
    die(
      `job-profile.md missing required "## ${name}". ` +
        `Found: ${[...sections.keys()].join(', ')}`,
    );
  }
  return sections.get(name);
}

/** Parse "- **Key:** value" bullets into a Map. */
export function parseKeyValueBullets(lines) {
  const out = new Map();
  for (const line of lines) {
    const m = /^\s*-\s+\*\*(.+?):\*\*\s*(.*)$/.exec(line);
    if (m) out.set(m[1].trim(), m[2].trim());
  }
  return out;
}

/**
 * Parse a GFM table into row objects keyed by the header cells.
 * Skips ragged rows (cell count != header count) rather than corrupting output.
 */
export function parseGfmTable(lines) {
  const rows = lines.filter((l) => l.trim().startsWith('|'));
  if (rows.length < 2) return [];
  const cells = (l) =>
    l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  const header = cells(rows[0]);
  const out = [];
  for (const r of rows.slice(1)) {
    if (/^\|?\s*:?-{2,}/.test(r.trim())) continue; // separator row
    const c = cells(r);
    if (c.length !== header.length) continue; // ragged → skip
    const obj = {};
    header.forEach((h, i) => (obj[h] = c[i]));
    out.push(obj);
  }
  return out;
}

/** Parse "- item" bullets into a string[]; skips "**Header**:" label lines. */
export function parseBulletList(lines) {
  const out = [];
  for (const line of lines) {
    if (/^\s*\*\*.+\*\*/.test(line)) continue; // label line like "**Primary** ..."
    const m = /^\s*-\s+(.+)$/.exec(line);
    if (m) out.push(m[1].trim());
  }
  return out;
}

/**
 * Parse bullets grouped under "**Label**" lines into a Map(label -> string[]).
 * e.g. "**Primary** (roles):" then "- A" "- B" -> { Primary: ['A','B'] }.
 */
export function parseLabeledBullets(lines) {
  const out = new Map();
  let label = null;
  for (const line of lines) {
    const lm = /^\s*\*\*(.+?)\*\*/.exec(line);
    if (lm) {
      label = lm[1].trim();
      out.set(label, []);
      continue;
    }
    const bm = /^\s*-\s+(.+)$/.exec(line);
    if (bm && label) out.get(label).push(bm[1].trim());
  }
  return out;
}

/** Split a section body into "### Heading" subsections. */
export function parseSubsections(lines) {
  const subs = [];
  let cur = null;
  for (const line of lines) {
    const m = /^###\s+(.+?)\s*$/.exec(line);
    if (m) {
      cur = { heading: m[1].trim(), bodyLines: [] };
      subs.push(cur);
    } else if (cur) {
      cur.bodyLines.push(line);
    }
  }
  return subs;
}
