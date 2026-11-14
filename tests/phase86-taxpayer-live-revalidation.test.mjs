import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const taxpayer = readFileSync(new URL('../src/modules/taxpayer.ts', import.meta.url), 'utf8');

test('phase 5 recalculates queued invoice issues from its immutable snapshot and current tax settings', () => {
  assert.match(taxpayer, /function currentQueueIssues\(item: TaxQueueItem, profile: TaxProfile, mappings: TaxProductMapping\[\]\): string\[\]/);
  assert.match(taxpayer, /invoiceIssues\(item\.snapshot\.invoice, profile, item\.snapshot\.buyer \?\? undefined, mappings\)/);
  assert.match(taxpayer, /const freshIssues = currentQueueIssues\(item, latest\.profile, latest\.productMappings\)/);
});

test('phase 5 persists changed validation results and prevents stale preview eligibility', () => {
  assert.match(taxpayer, /if \(queueChanged\) writeData\(latest\)/);
  assert.match(taxpayer, /if \(!item\.snapshot \|\| currentQueueIssues\(item, profile, mappings\)\.length\) return null/);
  assert.match(taxpayer, /اعتبارسنجی با آخرین مشخصات مؤدی و نگاشت کالاها به‌روز شده است/);
});

test('phase 5 keeps revalidation isolated from commercial invoice persistence', () => {
  assert.doesNotMatch(taxpayer, /saveCommerceData|postInvoice|updateDraftInvoice/);
  assert.match(taxpayer, /localStorage\.setItem\(STORAGE_KEY, JSON\.stringify\(data\)\)/);
});
