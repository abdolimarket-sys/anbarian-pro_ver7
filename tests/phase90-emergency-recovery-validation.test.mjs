import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/modules/device-auto-backup.ts', import.meta.url), 'utf8');
const start = source.indexOf('export async function recoverInterruptedSelectedRestore');
const end = source.indexOf('/** زمان‌بندی پشتیبان', start);
const recovery = source.slice(start, end);

test('emergency recovery validates all commerce/accounting/costing layers before the first write', () => {
  const commerceCheck = recovery.indexOf('!isValidCommerceBackup(parsed.commerce)');
  const accountingCheck = recovery.indexOf('parsed.accounting.schemaVersion !== 1');
  const costingCheck = recovery.indexOf('parsed.costing.schemaVersion !== 1');
  const firstWrite = recovery.indexOf('await persistAppState(');
  assert.ok(commerceCheck >= 0 && accountingCheck >= 0 && costingCheck >= 0);
  assert.ok(firstWrite > commerceCheck && firstWrite > accountingCheck && firstWrite > costingCheck);
});

test('emergency recovery accepts large invoice line arrays without a 500-row ceiling', () => {
  assert.match(recovery, /isValidCommerceBackup\(parsed\.commerce\)/);
  assert.doesNotMatch(recovery, /items\.length\s*>?=??\s*500/);
});

test('emergency recovery rejects unsupported snapshot versions before writes', () => {
  const versionCheck = recovery.indexOf('recoveryVersion > 4');
  const firstWrite = recovery.indexOf('await persistAppState(');
  assert.ok(versionCheck >= 0 && firstWrite > versionCheck);
});
