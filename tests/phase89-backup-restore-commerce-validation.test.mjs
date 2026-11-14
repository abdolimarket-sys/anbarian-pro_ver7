import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidCommerceBackup } from '../src/modules/backup-commerce-validation.js';
import fs from 'node:fs';

const restoreSource = fs.readFileSync(new URL('../src/modules/device-auto-backup.ts', import.meta.url), 'utf8');

test('shared runtime validator accepts invoices with more than 500 item rows', () => {
  const items = Array.from({ length: 501 }, (_, index) => ({ productId: `p-${index + 1}`, quantity: 1 }));
  const commerce = { schemaVersion: 1, invoices: [{ id: 'large-invoice', items }], parties: [] };
  assert.equal(isValidCommerceBackup(commerce), true);
  assert.equal(commerce.invoices[0].items.length, 501);
  assert.equal(commerce.invoices[0].items[500].productId, 'p-501');
});

test('shared runtime validator rejects malformed invoice rows before restore writes', () => {
  assert.equal(isValidCommerceBackup({ schemaVersion: 1, invoices: [{ items: 'not-an-array' }], parties: [] }), false);
  assert.equal(isValidCommerceBackup({ schemaVersion: 1, invoices: [{ items: [null] }], parties: [] }), false);
});

test('manual and selected external restore both use the same commerce validator', () => {
  assert.match(restoreSource, /import \{ isValidCommerceBackup \} from '\.\/backup-commerce-validation\.js'/);
  assert.equal((restoreSource.match(/!isValidCommerceBackup\(parsed\.commerce\)/g) || []).length, 3);
});
