import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/modules/taxpayer.ts', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../src/modules/taxpayer-schema-v79.ts', import.meta.url), 'utf8');

test('phase 13 captures cap and insp explicitly and never infers them from gross payments', () => {
  assert.match(source, /data-tax-cap/);
  assert.match(source, /data-tax-insp/);
  assert.match(source, /header\.cap = cashSettlement/);
  assert.match(source, /header\.insp = creditSettlement/);
  assert.match(source, /از مبلغ ناخالص حدس نمی‌زند/);
});

test('phase 13 parses Persian and Arabic numerals for settlement inputs', () => {
  assert.match(source, /۰۱۲۳۴۵۶۷۸۹/);
  assert.match(source, /٠١٢٣٤٥٦٧٨٩/);
  assert.match(source, /parseTaxRialInput/);
});

test('V7.9 mixed settlement requires positive cap and insp', () => {
  assert.match(schema, /header\.setm === 3/);
  assert.match(schema, /header\.cap <= 0/);
  assert.match(schema, /header\.insp <= 0/);
});
