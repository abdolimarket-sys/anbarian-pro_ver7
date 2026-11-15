import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const schema = readFileSync(new URL('../src/modules/taxpayer-schema-v79.ts', import.meta.url), 'utf8');
const moduleSource = readFileSync(new URL('../src/modules/taxpayer.ts', import.meta.url), 'utf8');
const docs = readFileSync(new URL('../TAXPAYER_PHASE18_FA.md', import.meta.url), 'utf8');

test('phase 18 exposes a JSON-safe finalizer with schema validation and round-trip verification', () => {
  assert.match(schema, /export function serializeV79SaleDraft/);
  assert.match(schema, /JSON\.stringify\(payload\)/);
  assert.match(schema, /JSON\.parse\(json\)/);
  assert.match(schema, /json_circular_reference/);
  assert.match(schema, /json_non_finite_number/);
  assert.match(schema, /json_unsupported_value/);
});

test('phase 18 repeats payload validation at the actual download boundary and blocks invalid JSON', () => {
  assert.match(moduleSource, /serializeV79SaleDraft\(packageData\.payload\)/);
  assert.match(moduleSource, /restoredPayloadCheck/);
  assert.match(moduleSource, /اعتبارسنجی نهایی JSON ناموفق بود/);
  assert.match(moduleSource, /new Blob\(\[packageJson\]/);
});

test('phase 18 documents draft-only behavior and excludes signing or submission', () => {
  assert.match(docs, /پیش‌نویس/);
  assert.match(docs, /امضا/);
  assert.match(docs, /ارسال/);
});
