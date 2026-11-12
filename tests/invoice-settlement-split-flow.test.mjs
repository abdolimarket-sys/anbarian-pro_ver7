import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ui = readFileSync(new URL('../src/modules/accounting-commerce-ui.ts', import.meta.url), 'utf8');

test('invoice form directs settlement to a separate sheet instead of inline payment stages', () => {
  assert.match(ui, /تسویه از برگه مستقل/);
  assert.match(ui, /openInvoiceSettlementSheet|settlementRows/);
  assert.match(ui, /id="invoicePaymentRows"/);
});

test('separate settlement sheet defaults to cash and excludes the automatically generated credit balance', () => {
  assert.match(ui, /filter\(x=>x\.method!=='credit'\)/);
  assert.match(ui, /method:'cash' as const,amountRial:Math\.max\(0,target\.grossRial\)/);
});

test('settlement sheet shows invoice total, paid amount, and remaining balance live', () => {
  assert.match(ui, /settlementTotals/);
  assert.match(ui, /settlementCredit/);
  assert.match(ui, /مانده اعتباری/);
});
