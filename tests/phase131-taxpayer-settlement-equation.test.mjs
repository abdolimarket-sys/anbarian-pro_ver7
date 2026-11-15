import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const schema = readFileSync(new URL('../src/modules/taxpayer-schema-v79.ts', import.meta.url), 'utf8');
const source = readFileSync(new URL('../src/modules/taxpayer.ts', import.meta.url), 'utf8');

test('V7.9 settlement equation uses tbill - tvam - todam', () => {
  assert.match(schema, /settlementBase = \(header\.tbill as number\) - \(header\.tvam as number\) - \(header\.todam as number\)/);
  assert.match(schema, /\(header\.cap as number\) \+ \(header\.insp as number\) !== settlementBase/);
});

test('settlement basis includes invoice gross and VAT, with explicit other-tax input', () => {
  assert.match(source, /tbill: Math\.round\(invoice\.grossRial\), tvam: Math\.round\(invoice\.taxRial\)/);
  assert.match(source, /header\.todam = declaredOtherTaxes/);
  assert.match(source, /header\.tbill = bodyTotal/);
  assert.match(source, /final cap\/insp equation is checked after body totals exist/);
  assert.match(schema, /settlement_equation/);
});

test('zero other statutory charges are accepted while cash and credit remain positive', () => {
  assert.match(source, /allowZero \? amount >= 0 : amount > 0/);
  assert.match(schema, /header\.cap <= 0/);
  assert.match(schema, /header\.insp <= 0/);
});
