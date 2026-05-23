import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseSections,
  parseKeyValueBullets,
  parseGfmTable,
  parseBulletList,
} from '../lib/job-profile-parser.mjs';

const md = readFileSync(
  new URL('./fixtures/job-profile.fixture.md', import.meta.url),
  'utf-8',
);

test('parseSections keys every ## heading and ignores ###', () => {
  const s = parseSections(md);
  for (const k of [
    'Identity', 'Education', 'Work Experience', 'Projects', 'Skills',
    'Target Roles', 'Archetypes', 'Compensation', 'Narrative', 'Proof Points',
  ]) {
    assert.ok(s.has(k), `missing section ${k}`);
  }
  assert.ok(![...s.keys()].some((k) => k.startsWith('#')), 'no ### leakage into keys');
});

test('parseKeyValueBullets reads **Key:** value bullets', () => {
  const kv = parseKeyValueBullets([
    '- **Full name:** Jordan Rivera',
    '- **Email:** jordan.rivera@example.com',
  ]);
  assert.equal(kv.get('Full name'), 'Jordan Rivera');
  assert.equal(kv.get('Email'), 'jordan.rivera@example.com');
});

test('parseGfmTable returns row objects keyed by header', () => {
  const rows = parseGfmTable([
    '| Archetype | Level | Fit | Why |',
    '|---|---|---|---|',
    '| Developer Tools Engineer | Senior | primary | x |',
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].Archetype, 'Developer Tools Engineer');
  assert.equal(rows[0].Fit, 'primary');
});

test('parseBulletList returns plain bullets and skips **Header**: labels', () => {
  const items = parseBulletList([
    '**Primary** (roles):',
    '- Senior Software Engineer',
    '- Developer Experience Engineer',
  ]);
  assert.deepEqual(items, ['Senior Software Engineer', 'Developer Experience Engineer']);
});
