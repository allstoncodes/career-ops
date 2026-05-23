#!/usr/bin/env node
// derive-from-job-profile.mjs — regenerate the engine's derived config from the
// canonical personal-vault/_profiles/job-profile.md.
//
//   --target profile|cv|santifer-profile   (default: --all)
//   --all                                   regenerate all three
//   --dry-run, --check                      report changes, write nothing
//   --init-markers                          insert DERIVED markers (one-time, per target)
//   --source <path>                         job-profile.md path (else $JOB_PROFILE_PATH)
//
// Source of truth is job-profile.md. profile.yml is fully regenerated; cv.md and
// modes/_profile.md are only rewritten BETWEEN <!-- DERIVED:BEGIN/END --> markers.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { parseSections } from './lib/job-profile-parser.mjs';
import { buildProfileObject, serializeProfileYml } from './lib/emit-profile-yml.mjs';
import {
  replaceMarkedSection,
  initMarkers,
  renderEducation,
  renderExitNarrative,
  renderCompTargets,
} from './lib/emit-markdown.mjs';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };

if (has('-h') || has('--help')) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf-8').split('\n').slice(1, 12).join('\n'));
  process.exit(0);
}

const dryRun = has('--dry-run') || has('--check');
const initMode = has('--init-markers');
const t = val('--target');
const targets = has('--all') || !t ? ['profile', 'cv', 'santifer-profile'] : [t];

const source = val('--source') || (process.env.JOB_PROFILE_PATH || '').trim();
if (!source) {
  console.error('derive: no source. Pass --source <path> or set JOB_PROFILE_PATH.');
  process.exit(1);
}
if (!existsSync(source)) {
  console.error(`derive: source not found: ${source}`);
  process.exit(1);
}

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sections = parseSections(readFileSync(source, 'utf-8'));

// Carry forward cv.output_format from the existing profile.yml.
const profilePath = join(projectRoot, 'config', 'profile.yml');
let existingCvFormat = 'html';
if (existsSync(profilePath)) {
  try { existingCvFormat = yaml.load(readFileSync(profilePath, 'utf-8'))?.cv?.output_format ?? 'html'; }
  catch { /* keep default */ }
}

const profile = buildProfileObject(sections, { existingCvFormat });

function writeOrDiff(absPath, label, newContent) {
  const old = existsSync(absPath) ? readFileSync(absPath, 'utf-8') : '';
  if (old === newContent) { console.log(`  ${label}: no changes`); return; }
  if (dryRun) {
    console.log(`  ${label}: WOULD CHANGE (${old.split('\n').length} → ${newContent.split('\n').length} lines)`);
  } else {
    writeFileSync(absPath, newContent);
    console.log(`  ${label}: written`);
  }
}

function applyMarker(content, section, body, label) {
  try {
    return replaceMarkedSection(content, section, body);
  } catch (e) {
    if (/no DERIVED:BEGIN/.test(e.message)) {
      console.warn(`  ${label} [${section}]: ${e.message}`);
      if (!dryRun) process.exitCode = 1;
      return content; // leave file untouched
    }
    throw e;
  }
}

console.log(`derive (${dryRun ? 'dry-run' : 'write'}${initMode ? ', init-markers' : ''}) from ${source}`);

for (const target of targets) {
  if (target === 'profile') {
    writeOrDiff(profilePath, 'config/profile.yml', serializeProfileYml(profile));
  } else if (target === 'cv') {
    const p = join(projectRoot, 'cv.md');
    if (!existsSync(p)) { console.log('  cv.md: not found, skip'); continue; }
    let content = readFileSync(p, 'utf-8');
    if (initMode) content = initMarkers(content, [{ heading: 'Education', section: 'education' }]);
    content = applyMarker(content, 'education', renderEducation(sections.get('Education') ?? []), 'cv.md');
    writeOrDiff(p, 'cv.md', content);
  } else if (target === 'santifer-profile') {
    const p = join(projectRoot, 'modes', '_profile.md');
    if (!existsSync(p)) { console.log('  modes/_profile.md: not found, skip'); continue; }
    let content = readFileSync(p, 'utf-8');
    if (initMode) content = initMarkers(content, [
      { heading: 'Your Exit Narrative', section: 'exit-narrative' },
      { heading: 'Your Comp Targets', section: 'comp' },
    ]);
    content = applyMarker(content, 'exit-narrative', renderExitNarrative(profile.narrative.exit_story), 'modes/_profile.md');
    content = applyMarker(content, 'comp', renderCompTargets(profile.compensation), 'modes/_profile.md');
    writeOrDiff(p, 'modes/_profile.md', content);
  } else {
    console.error(`derive: unknown target "${target}"`);
    process.exit(1);
  }
}

// Surface residual <FILL IN> markers in the source (warn-level).
const fills = (readFileSync(source, 'utf-8').match(/<\s*FILL IN/gi) || []).length;
if (fills) console.warn(`derive: note — ${fills} "<FILL IN>" marker(s) remain in job-profile.md`);
