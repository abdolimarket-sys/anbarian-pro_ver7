import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const schema = readFileSync(new URL('../src/modules/taxpayer-schema-v79.ts', import.meta.url), 'utf8');
const source = readFileSync(new URL('../src/modules/taxpayer.ts', import.meta.url), 'utf8');

test('V7.9 row and header schemas include cop, vop and tvop', () => {
  assert.match(schema, /cop\?: number/);
  assert.match(schema, /vop\?: number/);
  assert.match(schema, /tvop\?: number/);
});

test('cash share follows CPP = Os * C / Vs with Os sourced from tsstam', () => {
  assert.match(source, /const os = row\.tsstam/);
  assert.match(source, /Math\.trunc\(\(os \* cashForShares\) \/ vs\)/);
  assert.match(source, /const vs = header\.tadis/);
});

test('VAT payment share follows VPP = Ks * C / Vs and total tvop aggregates row vop', () => {
  assert.match(source, /Math\.trunc\(\(row\.vam \* cashForShares\) \/ vs\)/);
  assert.match(source, /header\.tvop = body\.reduce\(\(sum, row\) => sum \+ \(row\.vop \|\| 0\), 0\)/);
  assert.match(schema, /vat_payment_share_total_mismatch/);
});

test('cash amount basis respects settlement method without guessing mixed settlement', () => {
  assert.match(source, /header\.setm === 3 \? \(header\.cap \?\? 0\) : header\.setm === 1 \? vs : 0/);
  assert.match(source, /User-entered settlement values only; never infer them from gross payment parts/);
});

test('share fields are validated as nonnegative integer rial amounts', () => {
  assert.match(schema, /payment_share_integer/);
  assert.match(schema, /cash_share_below_invoice_total/);
  assert.match(schema, /zero_vat_zero_vop/);
  assert.match(schema, /cash_share_above_row_total/);
  assert.match(schema, /vat_share_above_row_vat/);
});

test('zero VAT rows cannot have a positive vop', () => {
  assert.match(schema, /row\.vam === 0 && row\.vop !== 0/);
});

test('rial share calculations use truncation, not rounding', () => {
  assert.match(source, /Math\.trunc\(\(os \* cashForShares\) \/ vs\)/);
  assert.match(source, /Math\.trunc\(\(row\.vam \* cashForShares\) \/ vs\)/);
  assert.doesNotMatch(source, /Math\.round\(\(os \* cashForShares\)/);
});
