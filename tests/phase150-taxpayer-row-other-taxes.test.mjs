import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const schema = readFileSync(new URL('../src/modules/taxpayer-schema-v79.ts', import.meta.url), 'utf8');
const source = readFileSync(new URL('../src/modules/taxpayer.ts', import.meta.url), 'utf8');

test('V7.9 row schema exposes other tax and statutory levy fields', () => {
  for (const field of ['odt', 'odr', 'odam', 'olt', 'olr', 'olam']) assert.match(schema, new RegExp(`${field}\\?:`));
  assert.match(source, /interface V79RowOtherTaxInput/);
  assert.match(source, /data-tax-odam/);
  assert.match(source, /data-tax-olam/);
});

test('row total includes VAT, other taxes and other legal charges', () => {
  assert.match(source, /tsstam: adis \+ vam \+ odam \+ olam/);
  assert.match(schema, /row\.tsstam !== \(row\.adis as number\) \+ \(row\.vam as number\) \+ Number\(row\.odam \?\? 0\) \+ Number\(row\.olam \?\? 0\)/);
});

test('other-tax and statutory-levy header total is aggregated from row amounts', () => {
  assert.match(source, /const declaredOtherTaxes = body\.reduce\(\(sum, row\) => sum \+ \(row\.odam \|\| 0\) \+ \(row\.olam \|\| 0\), 0\)/);
  assert.match(source, /header\.todam = declaredOtherTaxes/);
  assert.match(schema, /other_tax_total_mismatch/);
});

test('rate-based amounts use the discounted row value and are validated', () => {
  assert.match(source, /Math\.round\(adis \* odr \/ 100\)/);
  assert.match(source, /Math\.round\(adis \* olr \/ 100\)/);
  assert.match(schema, /other_tax_rate_equation/);
  assert.match(schema, /other_levy_rate_equation/);
});

test('zero VAT rate does not permit nonzero other tax or levy amounts', () => {
  assert.match(schema, /zero_vat_other_tax_zero/);
  assert.match(source, /در نرخ مالیات بر ارزش افزوده صفر، مبلغ odam و olam باید صفر باشد/);
});

test('other tax and levy fields remain optional for rows that are not subject to them', () => {
  assert.match(schema, /if \(row\[field\] !== undefined && !isFiniteNonNegative\(row\[field\]\)\)/);
  assert.match(schema, /header\.todam !== sums\.otherTaxTotal/);
});
