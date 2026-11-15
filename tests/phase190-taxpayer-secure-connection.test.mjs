import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/modules/taxpayer-connection.ts', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../src/modules/taxpayer-schema-v79.ts', import.meta.url), 'utf8');
const docs = readFileSync(new URL('../TAXPAYER_PHASE19_FA.md', import.meta.url), 'utf8');

test('phase 19 defines explicit sandbox/production and server-managed credential boundary', () => {
  assert.match(source, /'sandbox' \| 'production'/);
  assert.match(source, /credentialMode: 'server_managed'/);
  assert.match(source, /مدیریت کلید و گواهی فقط باید در سرویس سمت سرور/);
  assert.match(source, /unsafe_credential_mode/);
});

test('phase 19 requires HTTPS and rejects URL-embedded credentials and unsafe production loopback', () => {
  assert.match(source, /https_required/);
  assert.match(source, /credentials_in_url/);
  assert.match(source, /production_loopback_forbidden/);
});

test('phase 19 prepares only schema-validated V7.9 JSON and requires idempotency key', () => {
  assert.match(source, /serializeV79SaleDraft\(input\.payload\)/);
  assert.match(source, /idempotency_key_invalid/);
  assert.match(source, /schemaVersion: TAX_SCHEMA_VERSION/);
});

test('phase 19 fails closed without a server adapter and treats network failures as unknown', () => {
  assert.match(source, /server_adapter_unavailable/);
  assert.match(source, /status: 'unknown'/);
  assert.match(source, /ارسال مجدد کورکورانه ممنوع است/);
});

test('phase 19 does not invent official endpoints or implement browser-side signing/submission protocol', () => {
  assert.match(source, /هیچ endpoint، مسیر امضا یا قرارداد API را حدس نمی‌زند/);
  assert.match(docs, /endpoint رسمی/);
  assert.match(docs, /امضای دیجیتال/);
  assert.match(docs, /ارسال واقعی/);
  assert.match(schema, /does not sign, encrypt, authenticate/);
});
