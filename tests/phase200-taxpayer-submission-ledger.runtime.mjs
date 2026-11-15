import test from 'node:test';
import assert from 'node:assert/strict';

const ledger = await import('../src/modules/taxpayer-submission-ledger.ts');
const base = () => ledger.createTaxLedgerRecord({
  id: 'record-1', invoiceReference: 'invoice-1', idempotencyKey: 'idem-key-00000001', environment: 'sandbox',
  at: '2026-11-15T10:00:00.000Z',
});

class MemoryRepository {
  rows = new Map();
  async reserve(record) {
    const key = `${record.environment}:${record.idempotencyKey}`;
    if (this.rows.has(key)) return { created: false, record: this.rows.get(key) };
    this.rows.set(key, structuredClone(record));
    return { created: true, record: structuredClone(record) };
  }
  async getByKey(environment, idempotencyKey) {
    const value = this.rows.get(`${environment}:${idempotencyKey}`);
    return value ? structuredClone(value) : undefined;
  }
  async save(record) { this.rows.set(`${record.environment}:${record.idempotencyKey}`, structuredClone(record)); }
}

test('phase 20 allows only valid state transitions and blocks resubmission from unknown', () => {
  const ready = base();
  const submitting = ledger.transitionTaxLedgerRecord(ready, 'submitting').record;
  assert.ok(submitting);
  const unknown = ledger.transitionTaxLedgerRecord(submitting, 'unknown', { status: 'unknown' }).record;
  assert.ok(unknown);
  assert.equal(ledger.transitionTaxLedgerRecord(unknown, 'submitting').record, undefined);
  assert.equal(ledger.transitionTaxLedgerRecord(unknown, 'submitting').issues[0].code, 'invalid_state_transition');
});

test('phase 20 requires tracking id for accepted and prevents terminal-state reopening', () => {
  const submitting = ledger.transitionTaxLedgerRecord(base(), 'submitting').record;
  assert.equal(ledger.transitionTaxLedgerRecord(submitting, 'accepted', { status: 'accepted' }).issues[0].code, 'tracking_id_required');
  const accepted = ledger.transitionTaxLedgerRecord(submitting, 'accepted', { status: 'accepted', trackingId: 'TRACK-123' }).record;
  assert.equal(accepted.trackingId, 'TRACK-123');
  assert.equal(ledger.transitionTaxLedgerRecord(accepted, 'submitting').issues[0].code, 'invalid_state_transition');
});

test('phase 20 atomically reserves idempotency key and rejects duplicate reservation', async () => {
  const repo = new MemoryRepository();
  const first = await ledger.reserveTaxSubmission(repo, base());
  const second = await ledger.reserveTaxSubmission(repo, { ...base(), id: 'record-2' });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.issues[0].code, 'duplicate_idempotency_key');
});

test('phase 20 reconciles unknown state only through status lookup, never resubmits', async () => {
  const repo = new MemoryRepository();
  const submitting = ledger.transitionTaxLedgerRecord(base(), 'submitting').record;
  const unknown = ledger.transitionTaxLedgerRecord(submitting, 'unknown', { status: 'unknown', trackingId: 'TRACK-9' }).record;
  await repo.reserve(unknown);
  let lookedUp = '';
  const reconciled = await ledger.reconcileUnknownTaxSubmission(repo, {
    environment: 'sandbox', idempotencyKey: unknown.idempotencyKey,
    getStatus: async (trackingId) => { lookedUp = trackingId; return { status: 'accepted', trackingId }; },
  });
  assert.equal(lookedUp, 'TRACK-9');
  assert.equal(reconciled.record.state, 'accepted');
  assert.equal(reconciled.record.events.at(-1).kind, 'status_checked');
});

test('phase 20 preserves unknown on status failure and does not invoke submit', async () => {
  const repo = new MemoryRepository();
  const submitting = ledger.transitionTaxLedgerRecord(base(), 'submitting').record;
  const unknown = ledger.transitionTaxLedgerRecord(submitting, 'unknown').record;
  await repo.reserve(unknown);
  const result = await ledger.reconcileUnknownTaxSubmission(repo, {
    environment: 'sandbox', idempotencyKey: unknown.idempotencyKey,
    getStatus: async () => { throw new Error('offline'); },
  });
  assert.equal(result.record.state, 'unknown');
  assert.equal(result.issues[0].code, 'tracking_id_unavailable');
});

test('phase 20 audit events contain no payload or secret fields', () => {
  const record = base();
  const serialized = JSON.stringify(record);
  assert.doesNotMatch(serialized, /payload|privateKey|token|password|secret/i);
});
