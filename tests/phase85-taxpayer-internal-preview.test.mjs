import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const taxpayer = readFileSync(new URL('../src/modules/taxpayer.ts', import.meta.url), 'utf8');

test('phase 4 creates only a clearly labeled internal review JSON, not an official payload', () => {
  assert.match(taxpayer, /documentKind: 'anbarin-taxpayer-internal-review'/);
  assert.match(taxpayer, /isOfficialOrganizationPayload: false/);
  assert.match(taxpayer, /JSON\.stringify\(preview, null, 2\)/);
  assert.match(taxpayer, /دانلود پیش‌نویس داخلی JSON/);
});

test('phase 4 blocks previews for unresolved issues or missing snapshots and unsafe totals', () => {
  assert.match(taxpayer, /if \(!item\.snapshot \|\| currentQueueIssues\(item, profile, mappings\)\.length\) return null/);
  assert.match(taxpayer, /mappedItems\.some\(line => line === null\)/);
  assert.match(taxpayer, /Number\.isSafeInteger\(value\) && value >= 0/);
});

test('phase 4 reads invoice snapshot and does not write to commerce accounting', () => {
  assert.match(taxpayer, /const invoice = item\.snapshot\.invoice/);
  assert.match(taxpayer, /totalRial: line\.totalRial/);
  assert.doesNotMatch(taxpayer, /saveCommerceData|postInvoice|updateDraftInvoice/);
});
