import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/modules/taxpayer.ts', import.meta.url), 'utf8');

test('phase 11 exports an auditable versioned local package', () => {
  assert.match(source, /documentVersion: 2/);
  assert.match(source, /generatedAt: new Date\(\)\.toISOString\(\)/);
  assert.match(source, /deliveryStatus: 'local_draft'/);
  assert.match(source, /officialSubmission: false/);
});

test('phase 11 separates blockers from follow-up warnings without hiding issues', () => {
  assert.match(source, /blockingIssues/);
  assert.match(source, /followUpWarnings/);
  assert.match(source, /issueCount: built\.issues\.length/);
  assert.match(source, /issues: built\.issues/);
  assert.match(source, /status: blockingIssues\.length \? 'needs_correction'/);
});

test('phase 11 includes invoice and line-level reconciliation totals', () => {
  assert.match(source, /itemNetRial/);
  assert.match(source, /itemTaxRial/);
  assert.match(source, /netDifferenceRial/);
  assert.match(source, /taxDifferenceRial/);
  assert.match(source, /currency: 'IRR'/);
});
