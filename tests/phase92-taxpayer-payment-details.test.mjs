import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const schema = readFileSync(new URL('../src/modules/taxpayer-schema-v79.ts', import.meta.url), 'utf8');
const moduleSource = readFileSync(new URL('../src/modules/taxpayer.ts', import.meta.url), 'utf8');
const docs = readFileSync(new URL('../TAXPAYER_PHASE17_FA.md', import.meta.url), 'utf8');

test('phase 17 captures per-transaction payment metadata without inventing it', () => {
  for (const field of ['trn', 'pcn', 'pid', 'pdt', 'iinn', 'acn', 'trmn']) assert.ok(moduleSource.includes(`data-tax-pay-${field}`));
  assert.match(moduleSource, /readPaymentInputs/);
  assert.match(moduleSource, /paymentInputs\[index\]/);
});

test('phase 17 validates payment identifiers, timestamp, and rial amount', () => {
  for (const field of ['iinn', 'acn', 'trmn', 'trn', 'pcn', 'pid']) assert.ok(schema.includes(`['${field}'`));
  assert.match(schema, /payment_timestamp/);
  assert.match(schema, /payment_amount_integer/);
  assert.match(schema, /payment_identifier_format/);
});

test('phase 17 preserves V7.9 payment method code set and documents local-draft limitation', () => {
  assert.match(schema, /\[1,2,3,4,5,6,7,8\]/);
  assert.match(docs, /ارسال به سامانه/);
  assert.match(docs, /pdt/);
});
