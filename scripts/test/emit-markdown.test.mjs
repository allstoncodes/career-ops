import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  replaceMarkedSection,
  initMarkers,
  renderCvHeader,
  renderEducation,
  renderExitNarrative,
  renderCompTargets,
} from '../lib/emit-markdown.mjs';

const HAND_CURATED = [
  '## Your Negotiation Scripts',
  '> "Based on market data, I was targeting..."',
  '',
  '<!-- DERIVED:BEGIN section=comp -->',
  '- **Target total comp:** OLD',
  '<!-- DERIVED:END section=comp -->',
  '',
  '## Your Location Policy',
  '- Visa: US citizen',
].join('\n');

test('replaceMarkedSection replaces ONLY the fenced block', () => {
  const out = replaceMarkedSection(HAND_CURATED, 'comp', '- **Target total comp:** $300K-450K');
  assert.match(out, /Target total comp:\*\* \$300K-450K/);
  assert.doesNotMatch(out, /Target total comp:\*\* OLD/);
});

test('hand-curated blocks survive a regen', () => {
  const out = replaceMarkedSection(HAND_CURATED, 'comp', '- **Target total comp:** NEW');
  assert.ok(out.includes('## Your Negotiation Scripts'));
  assert.ok(out.includes('> "Based on market data, I was targeting..."'));
  assert.ok(out.includes('## Your Location Policy'));
  assert.ok(out.includes('- Visa: US citizen'));
});

test('file with no markers throws actionable error', () => {
  assert.throws(
    () => replaceMarkedSection('# no markers here', 'comp', 'x'),
    /no DERIVED:BEGIN.*--init-markers/s,
  );
});

test('unbalanced markers throw', () => {
  assert.throws(
    () => replaceMarkedSection('<!-- DERIVED:BEGIN section=comp -->\nx', 'comp', 'y'),
    /unbalanced|unterminated/i,
  );
});

test('replace is idempotent for identical content', () => {
  const once = replaceMarkedSection(HAND_CURATED, 'comp', '- **Target total comp:** SAME');
  const twice = replaceMarkedSection(once, 'comp', '- **Target total comp:** SAME');
  assert.equal(once, twice);
});

test('initMarkers wraps a heading body, content unchanged between', () => {
  const noMark = ['## Your Comp Targets', '- old comp line', '', '## Next'].join('\n');
  const out = initMarkers(noMark, [{ heading: 'Your Comp Targets', section: 'comp' }]);
  assert.match(out, /<!-- DERIVED:BEGIN section=comp -->/);
  assert.match(out, /<!-- DERIVED:END section=comp -->/);
  assert.ok(out.includes('- old comp line'));
  assert.ok(out.includes('## Next'));
  // and it must now be replaceable
  const replaced = replaceMarkedSection(out, 'comp', '- new');
  assert.match(replaced, /- new/);
});

test('renderCvHeader uses the outreach city + contact fields', () => {
  const block = renderCvHeader({
    full_name: 'Jordan Rivera', city: 'Bellevue', email: 'jordan.rivera@example.com',
    phone: '+1 555-000-0000', linkedin: 'https://lnkd/x', github: 'jrivera',
    portfolio_url: 'https://jrivera.dev', twitter: 'https://x.com/jriverabuilds',
    visa_status: 'US citizen, no sponsorship needed',
  });
  assert.match(block, /Bellevue/);
  assert.match(block, /jordan\.rivera@example\.com/);
});

test('renderEducation projects the Education section', () => {
  const eduLines = [
    '- **University:** Example State University',
    '- **Degree:** B.S. Computer Science',
    '- **Graduation year:** 2019',
  ];
  const block = renderEducation(eduLines);
  assert.match(block, /Example State University/);
  assert.match(block, /B\.S\. Computer Science/);
});

test('renderExitNarrative emits the exit story text', () => {
  const block = renderExitNarrative('I want a higher-growth environment.');
  assert.match(block, /higher-growth environment/);
});

test('renderCompTargets emits target/minimum lines', () => {
  const block = renderCompTargets({
    target_range: '$250K-350K base + equity + bonus',
    minimum: '$200K total comp OR $170K base',
    location_flexibility: 'Hybrid or remote',
  });
  assert.match(block, /\$250K-350K/);
  assert.match(block, /\$200K total comp/);
});
