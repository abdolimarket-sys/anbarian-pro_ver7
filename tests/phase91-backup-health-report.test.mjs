import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackupHealthReport, compareBackupHealthReports } from '../src/modules/backup-health-report.js';

const snapshot = () => ({
  app: { products: [{ id: 'p1' }, { id: 'p2' }], auditLog: [{}, {}], inventoryDocs: [{}] },
  commerce: { invoices: [{ items: Array.from({ length: 501 }, () => ({})) }, { items: [{}, {}] }], parties: [{}, {}] },
  accounting: { accounts: [{}, {}], journalEntries: [{}] },
  costing: { layers: [{}, {}], movements: [{}, {}, {}] },
});

test('health report counts full backup sections and invoice rows beyond 500', () => {
  const report = createBackupHealthReport(snapshot(), '2026-11-14T12:00:00.000Z');
  assert.deepEqual(report, {
    generatedAt: '2026-11-14T12:00:00.000Z', products: 2, invoices: 2, invoiceRows: 503,
    parties: 2, accounts: 2, journalEntries: 1, inventoryCostLayers: 2,
    inventoryCostMovements: 3, auditEntries: 2, inventoryDocuments: 1,
  });
});

test('matching pre/post restore reports have no differences', () => {
  const before = createBackupHealthReport(snapshot());
  const after = createBackupHealthReport(snapshot());
  assert.deepEqual(compareBackupHealthReports(before, after), { matches: true, differences: [] });
});

test('report comparison identifies missing rows and products', () => {
  const before = createBackupHealthReport(snapshot());
  const changed = snapshot();
  changed.app.products.pop();
  changed.commerce.invoices[0].items.pop();
  const after = createBackupHealthReport(changed);
  const result = compareBackupHealthReports(before, after);
  assert.equal(result.matches, false);
  assert.deepEqual(result.differences.map((d) => d.field), ['products', 'invoiceRows']);
});

test('malformed optional sections are reported as zero without throwing', () => {
  const report = createBackupHealthReport({ app: { products: 'bad' }, commerce: null });
  assert.equal(report.products, 0);
  assert.equal(report.invoices, 0);
  assert.equal(report.invoiceRows, 0);
});
