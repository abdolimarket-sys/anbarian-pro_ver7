import test from 'node:test';
import assert from 'node:assert/strict';

const mod = await import('../src/modules/taxpayer-ledger-server.ts');
const ledger = await import('../src/modules/taxpayer-submission-ledger.ts');

function mockFetch(handler) {
  return async (url, init = {}) => {
    const result = await handler(String(url), init);
    const body = result.body;
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      json: async () => body,
    };
  };
}

const sample = () => ledger.createTaxLedgerRecord({
  id: 'rec-1',
  invoiceReference: 'INV-100',
  idempotencyKey: 'idem-key-00000001',
  environment: 'sandbox',
  at: '2026-11-15T12:00:00.000Z',
});

test('phase 22 rejects non-https ledger base url', () => {
  const issues = mod.validateTaxLedgerServerConfig({
    baseUrl: 'http://example.com',
    getAuthHeaders: () => ({}),
  });
  assert.ok(issues.some((i) => i.code === 'ledger_https_required'));
});

test('phase 22 reserve posts identity only and maps created flag', async () => {
  let posted;
  const repo = mod.createWordPressTaxLedgerRepository({
    baseUrl: 'https://example.com',
    getAuthHeaders: () => ({ Authorization: 'Basic test' }),
    fetchImpl: mockFetch(async (url, init) => {
      assert.match(url, /\/taxpayer\/submissions$/);
      assert.equal(init.method, 'POST');
      posted = JSON.parse(init.body);
      return {
        status: 201,
        body: { ok: true, created: true, record: { ...sample(), state: 'ready' }, issues: [] },
      };
    }),
  });
  const out = await repo.reserve(sample());
  assert.equal(out.created, true);
  assert.equal(out.record.idempotencyKey, 'idem-key-00000001');
  assert.equal(posted.idempotencyKey, 'idem-key-00000001');
  assert.equal(posted.invoiceReference, 'INV-100');
  assert.equal('payload' in posted, false);
  assert.equal('privateKey' in posted, false);
});

test('phase 22 reserve returns existing record on duplicate key', async () => {
  const existing = { ...sample(), id: 'rec-existing', state: 'submitting' };
  const repo = mod.createWordPressTaxLedgerRepository({
    baseUrl: 'https://example.com',
    getAuthHeaders: () => ({}),
    fetchImpl: mockFetch(async () => ({
      status: 200,
      body: {
        ok: true,
        created: false,
        record: existing,
        issues: [{ code: 'duplicate_idempotency_key', message: 'dup' }],
      },
    })),
  });
  const out = await repo.reserve(sample());
  assert.equal(out.created, false);
  assert.equal(out.record.id, 'rec-existing');
  assert.equal(out.record.state, 'submitting');
});

test('phase 22 getByKey returns undefined on 404', async () => {
  const repo = mod.createWordPressTaxLedgerRepository({
    baseUrl: 'https://example.com',
    getAuthHeaders: () => ({}),
    fetchImpl: mockFetch(async () => ({ status: 404, body: { code: 'anbarin_ledger_not_found' } })),
  });
  const found = await repo.getByKey('sandbox', 'idem-key-00000001');
  assert.equal(found, undefined);
});

test('phase 22 save uses PATCH transition and never sends payload secrets', async () => {
  let patched;
  const repo = mod.createWordPressTaxLedgerRepository({
    baseUrl: 'https://example.com',
    getAuthHeaders: () => ({ Authorization: 'Basic test' }),
    fetchImpl: mockFetch(async (url, init) => {
      assert.equal(init.method, 'PATCH');
      patched = JSON.parse(init.body);
      return {
        status: 200,
        body: {
          ok: true,
          record: { ...sample(), state: 'submitting' },
          submissionDisabled: true,
          issues: [],
        },
      };
    }),
  });
  const current = ledger.transitionTaxLedgerRecord(sample(), 'submitting').record;
  await repo.save(current);
  assert.equal(patched.state, 'submitting');
  assert.equal(patched.idempotencyKey, 'idem-key-00000001');
  assert.equal('payload' in patched, false);
  assert.equal('token' in patched, false);
  assert.equal('privateKey' in patched, false);
});

test('phase 22 works with reserveTaxSubmission helper for duplicate path', async () => {
  const repo = mod.createWordPressTaxLedgerRepository({
    baseUrl: 'https://example.com',
    getAuthHeaders: () => ({}),
    fetchImpl: mockFetch(async () => ({
      status: 200,
      body: {
        ok: true,
        created: false,
        record: sample(),
        issues: [{ code: 'duplicate_idempotency_key', message: 'exists' }],
      },
    })),
  });
  const result = await ledger.reserveTaxSubmission(repo, sample());
  assert.equal(result.created, false);
  assert.equal(result.issues[0].code, 'duplicate_idempotency_key');
});
