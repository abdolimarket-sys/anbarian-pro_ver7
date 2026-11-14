import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const backup = fs.readFileSync(new URL('../src/modules/device-auto-backup.ts', import.meta.url), 'utf8');
const taxpayerServer = fs.readFileSync(new URL('../server/wordpress-plugin/anbarin-taxpayer-review/anbarin-taxpayer-review.php', import.meta.url), 'utf8');

test('full backup and restore do not impose the taxpayer draft 500-item ceiling', () => {
  assert.match(backup, /commerce,\s*costing/);
  assert.match(backup, /if \(restoreScope\.accounting && parsed\.commerce\) await saveCommerceData\(parsed\.commerce as never\)/);
  assert.match(backup, /saveCommerceData\(parsed\.commerce as never\)/);
  assert.doesNotMatch(backup, /MAX_ITEMS|items\.length\s*>\s*500|count\([^)]*items[^)]*\)\s*>\s*500/i);
  assert.match(taxpayerServer, /const MAX_ITEMS = 500/);
  assert.match(taxpayerServer, /count\(\$data\['items'\]\) > self::MAX_ITEMS/);
});

test('a backup JSON round-trip retains every line in a 501-line invoice fixture', () => {
  const lines = Array.from({ length: 501 }, (_, index) => ({ productId: `p-${index + 1}`, quantity: 1 }));
  const payload = { schema: 'anbarin-full-device-backup', version: 4, commerce: { schemaVersion: 1, invoices: [{ id: 'large-invoice', items: lines }], parties: [] } };
  const restored = JSON.parse(JSON.stringify(payload));
  assert.equal(restored.commerce.invoices[0].items.length, 501);
  assert.equal(restored.commerce.invoices[0].items[500].productId, 'p-501');
});
