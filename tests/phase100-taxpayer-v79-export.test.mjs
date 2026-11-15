import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/modules/taxpayer.ts', import.meta.url), 'utf8');

test('phase 10 connects queued sales invoices to V7.9 draft builder', () => {
  assert.match(source, /buildV79SaleDraft/);
  assert.match(source, /validateV79SalePayload\(payload\)/);
  assert.match(source, /TAX_SCHEMA_VERSION/);
  assert.match(source, /payload: built\.payload/);
});

test('phase 10 exposes type 1 and type 2 draft actions and buyer classification', () => {
  assert.match(source, /data-tax-v79-type1/);
  assert.match(source, /data-tax-v79-type2/);
  assert.match(source, /data-tax-buyer-kind/);
  assert.match(source, /buyerKind === 2 \|\| buyerKind === 3/);
});

test('phase 10 preserves discounted line totals and reports unmapped timestamp/payments', () => {
  assert.match(source, /const adis = Math\.max\(0, Math\.round\(line\.totalRial\)\)/);
  assert.match(source, /const prdis = adis \+ dis/);
  assert.match(source, /indatim/);
  assert.match(source, /payments/);
});
