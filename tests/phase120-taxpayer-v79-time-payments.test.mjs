import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/modules/taxpayer.ts', import.meta.url), 'utf8');
const conversion = readFileSync(new URL('../src/modules/taxpayer-v79-conversion.ts', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../src/modules/taxpayer-schema-v79.ts', import.meta.url), 'utf8');

test('phase 12 provides Jalali-to-Unix millisecond conversion for explicit local time', () => {
  assert.match(conversion, /jalaliDateTimeToUnixMs/);
  assert.match(conversion, /en-US-u-ca-persian-nu-latn/);
  assert.match(conversion, /getTime\(\)/);
  assert.match(conversion, /hh > 23 \|\| mm > 59/);
});

test('phase 12 uses V7.9 payment codes and keeps ambiguous card channel explicit', () => {
  assert.match(source, /part\.method === 'cash'\) pmt = 3/);
  assert.match(source, /part\.method === 'cheque'\) pmt = 1/);
  assert.match(source, /cardPmt/);
  assert.match(source, /پرداخت کارت/);
  assert.match(source, /header\.setm/);
  assert.match(schema, /payments\?: V79Payment\[\]/);
  assert.match(schema, /header\.setm === undefined/);
  assert.match(schema, /header\.indatim === undefined/);
});

test('phase 12 asks for issue time and exposes official payment channel selection', () => {
  assert.match(source, /data-tax-issued-time/);
  assert.match(source, /data-tax-card-pmt/);
  assert.match(source, /ساعت محلی دستگاه/);
  assert.match(source, /cap و insp/);
});
