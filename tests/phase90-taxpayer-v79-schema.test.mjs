import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const schema = readFileSync(new URL('../src/modules/taxpayer-schema-v79.ts', import.meta.url), 'utf8');
const docs = readFileSync(new URL('../TAXPAYER_PHASE9_FA.md', import.meta.url), 'utf8');

test('phase 9 pins the official document version and supports only type 1/type 2, template 1', () => {
  assert.match(schema, /RC_IITP\.IS_V7\.9/);
  assert.match(schema, /InvoiceKind = 1 \| 2/);
  assert.match(schema, /inp: 1/);
  assert.match(schema, /ins: 1/);
});

test('phase 9 validates V7.9 header/body structure, buyer conditions, notes and discount equation', () => {
  for (const token of ['header', 'body', 'tins', 'indatim', 'indati2m', 'nti1', 'nti2', 'insr', 'tinb', 'bid', 'prdis', 'dis', 'adis']) assert.ok(schema.includes(token));
  assert.match(schema, /header\.inty === 1 && \(header\.tob === 2 \|\| header\.tob === 3\)/);
  assert.match(schema, /header\.inty === 1 && \(header\.tob === 1 \|\| header\.tob === 4\)/);
  assert.match(schema, /row\.prdis - row\.dis !== row\.adis/);
});

test('phase 9 never claims transmission, signature or encryption and labels output local draft', () => {
  assert.match(schema, /deliveryStatus: 'local_draft'/);
  assert.match(schema, /does not sign, encrypt, authenticate/);
  assert.match(docs, /ارسال، استعلام و دریافت پاسخ سازمان پیاده‌سازی نشده‌اند/);
});
