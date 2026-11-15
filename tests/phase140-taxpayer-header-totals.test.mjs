import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const schema = readFileSync(new URL('../src/modules/taxpayer-schema-v79.ts', import.meta.url), 'utf8');
const source = readFileSync(new URL('../src/modules/taxpayer.ts', import.meta.url), 'utf8');

test('V7.9 header totals are declared and aggregated from body rows', () => {
  for (const field of ['tprdis', 'tdis', 'tadis', 'tvam', 'tbill']) assert.match(schema, new RegExp(`${field}\\?: number`));
  for (const field of ['tprdis', 'tdis', 'tadis', 'tvam']) assert.match(source, new RegExp(`header\\.${field} = body\\.reduce`));
  assert.match(source, /tsstam: adis \+ vam/);
  assert.match(source, /header\.tbill = bodyTotal/);
  assert.match(source, /header\.todam = declaredOtherTaxes/);
});

test('schema rejects mismatches between header aggregates and body sums', () => {
  assert.match(schema, /header_total_mismatch/);
  assert.match(schema, /invoice_total_mismatch/);
  assert.match(schema, /header\.tbill !== sums\.lineTotal/);
  assert.match(schema, /other_tax_total_mismatch/);
});

test('other taxes are now allocated to body rows instead of blocked at header level', () => {
  assert.match(source, /data-tax-odam/);
  assert.match(source, /data-tax-olam/);
  assert.doesNotMatch(source, /تفکیک سایر مالیات‌ها\/عوارض در ردیف‌ها لازم است/);
});
