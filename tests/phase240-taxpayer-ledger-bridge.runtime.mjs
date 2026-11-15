import test from 'node:test';
import assert from 'node:assert/strict';

const bridge = await import('../src/modules/taxpayer-ledger-bridge.ts');

// localStorage polyfill for Node
if (typeof globalThis.localStorage === 'undefined') {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

test('phase 24 skips network when bridge disabled (default)', async () => {
  localStorage.removeItem('anbarin_taxpayer_ledger_bridge_v1');
  const status = bridge.getTaxLedgerBridgeStatus();
  assert.equal(status.configured, false);
  assert.equal(status.submissionDisabled, true);
  const reserved = await bridge.tryReserveTaxLedger({
    id: 'r1', invoiceReference: 'INV-1', idempotencyKey: 'idem-key-00000001',
  });
  assert.equal(reserved.skipped, true);
  assert.ok(reserved.issues.length >= 1);
});

test('phase 24 remains skipped with enabled but incomplete config', async () => {
  bridge.saveTaxLedgerBridgeConfig({
    enabled: true,
    baseUrl: 'https://example.com',
    apiKey: 'short',
    environment: 'sandbox',
  });
  const status = bridge.getTaxLedgerBridgeStatus();
  assert.equal(status.configured, false);
  const got = await bridge.tryGetTaxLedgerStatus('idem-key-00000001');
  assert.equal(got.skipped, true);
});

test('phase 24 does not touch taxpayer queue storage key', () => {
  const before = localStorage.getItem('anbarin_taxpayer_module_v1');
  bridge.saveTaxLedgerBridgeConfig({ enabled: false, baseUrl: '', apiKey: '' });
  assert.equal(localStorage.getItem('anbarin_taxpayer_module_v1'), before);
});
