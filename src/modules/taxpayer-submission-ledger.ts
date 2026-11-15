/**
 * فاز ۲۰: دفتر وضعیت ارسال و ممیزی امن صورتحساب مؤدیان.
 * این ماژول فاقد ذخیره‌سازی عملیاتی است؛ repository باید در backend با
 * تراکنش/قید یکتایی واقعی پیاده‌سازی شود. هیچ payload یا راز امنیتی ثبت نمی‌شود.
 */
import type { TaxConnectionEnvironment, TaxConnectionState, TaxSubmissionResult } from './taxpayer-connection';

export type TaxLedgerEventKind = 'prepared' | 'submission_started' | 'accepted' | 'rejected' | 'unknown' | 'status_checked';
export interface TaxLedgerEvent { id: string; kind: TaxLedgerEventKind; at: string; message?: string; }
export interface TaxSubmissionRecord {
  id: string; invoiceReference: string; idempotencyKey: string; environment: TaxConnectionEnvironment;
  state: TaxConnectionState; createdAt: string; updatedAt: string; trackingId?: string; lastMessage?: string;
  events: TaxLedgerEvent[];
}
export interface TaxLedgerRepository {
  /** در backend باید اتمیک و با UNIQUE(environment, idempotencyKey) اجرا شود. */
  reserve(record: TaxSubmissionRecord): Promise<{ created: boolean; record: TaxSubmissionRecord }>;
  getByKey(environment: TaxConnectionEnvironment, idempotencyKey: string): Promise<TaxSubmissionRecord | undefined>;
  save(record: TaxSubmissionRecord): Promise<void>;
}
export interface TaxLedgerIssue { code: string; message: string; }

const nowIso = () => new Date().toISOString();
const safeText = (value: unknown, max = 240): string | undefined =>
  typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) || undefined : undefined;

export function createTaxLedgerRecord(input: {
  id: string; invoiceReference: string; idempotencyKey: string; environment: TaxConnectionEnvironment; at?: string;
}): TaxSubmissionRecord {
  const at = input.at ?? nowIso();
  return { id: input.id, invoiceReference: input.invoiceReference.trim(), idempotencyKey: input.idempotencyKey,
    environment: input.environment, state: 'ready', createdAt: at, updatedAt: at,
    events: [{ id: `${input.id}:prepared`, kind: 'prepared', at }] };
}

export function transitionTaxLedgerRecord(current: TaxSubmissionRecord, next: TaxConnectionState,
  result?: TaxSubmissionResult, at = nowIso()): { record?: TaxSubmissionRecord; issues: TaxLedgerIssue[] } {
  const allowed: Record<TaxConnectionState, TaxConnectionState[]> = {
    draft: ['ready'], ready: ['submitting'], submitting: ['accepted', 'rejected', 'unknown'],
    accepted: [], rejected: [], unknown: ['accepted', 'rejected', 'unknown'],
  };
  if (!allowed[current.state].includes(next)) return { issues: [{ code: 'invalid_state_transition', message: `تغییر وضعیت از ${current.state} به ${next} مجاز نیست.` }] };
  const trackingId = safeText(result?.trackingId, 160);
  if (next === 'accepted' && !trackingId) return { issues: [{ code: 'tracking_id_required', message: 'برای وضعیت پذیرفته‌شده، شناسه پیگیری معتبر لازم است.' }] };
  const eventKind: TaxLedgerEventKind = next === 'submitting' ? 'submission_started' : next;
  const message = safeText(result?.message);
  return { record: { ...current, state: next, updatedAt: at,
    ...(trackingId ? { trackingId } : {}), ...(message ? { lastMessage: message } : {}),
    events: [...current.events, { id: `${current.id}:${current.events.length + 1}`, kind: eventKind, at, ...(message ? { message } : {}) }] }, issues: [] };
}

/** رزرو اولیه با قفل یکتایی repository؛ کلید موجود هرگز رکورد ارسال دوم نمی‌سازد. */
export async function reserveTaxSubmission(repository: TaxLedgerRepository, record: TaxSubmissionRecord): Promise<{
  record?: TaxSubmissionRecord; created: boolean; issues: TaxLedgerIssue[];
}> {
  if (!record.invoiceReference.trim() || !/^[A-Za-z0-9._:-]{12,128}$/.test(record.idempotencyKey))
    return { created: false, issues: [{ code: 'invalid_ledger_identity', message: 'مرجع فاکتور یا کلید جلوگیری از ارسال تکراری معتبر نیست.' }] };
  const reserved = await repository.reserve(record);
  if (!reserved.created) return { record: reserved.record, created: false,
    issues: [{ code: 'duplicate_idempotency_key', message: 'برای این کلید قبلاً رکورد وجود دارد؛ ارسال مجدد ایجاد نشد.' }] };
  return { record: reserved.record, created: true, issues: [] };
}

/** وضعیت unknown فقط با استعلام شناسه پیگیری موجود رفع می‌شود؛ این تابع هیچ ارسال مجددی نمی‌کند. */
export async function reconcileUnknownTaxSubmission(repository: TaxLedgerRepository, input: {
  environment: TaxConnectionEnvironment; idempotencyKey: string; getStatus: (trackingId: string) => Promise<TaxSubmissionResult>;
}): Promise<{ record?: TaxSubmissionRecord; issues: TaxLedgerIssue[] }> {
  const current = await repository.getByKey(input.environment, input.idempotencyKey);
  if (!current) return { issues: [{ code: 'ledger_record_not_found', message: 'رکورد ارسال برای استعلام پیدا نشد.' }] };
  if (current.state !== 'unknown') return { record: current, issues: [{ code: 'record_not_unknown', message: 'این رکورد در وضعیت نامشخص نیست و نیازی به تطبیق ندارد.' }] };
  if (!current.trackingId) return { record: current, issues: [{ code: 'tracking_id_unavailable', message: 'شناسه پیگیری موجود نیست؛ استعلام خودکار ممکن نیست و بررسی دستی لازم است.' }] };
  try {
    const result = await input.getStatus(current.trackingId);
    if (!result || !['accepted', 'rejected', 'unknown'].includes(result.status))
      return { record: current, issues: [{ code: 'invalid_status_response', message: 'پاسخ استعلام معتبر نیست؛ وضعیت قبلی حفظ شد.' }] };
    const changed = transitionTaxLedgerRecord(current, result.status, result);
    if (!changed.record) return { record: current, issues: changed.issues };
    const events = changed.record.events.slice();
    events[events.length - 1] = { ...events[events.length - 1], kind: 'status_checked' };
    const updated = { ...changed.record, events };
    await repository.save(updated);
    return { record: updated, issues: [] };
  } catch {
    return { record: current, issues: [{ code: 'status_check_failed', message: 'استعلام ناموفق بود؛ وضعیت نامشخص حفظ شد و ارسال مجدد انجام نشد.' }] };
  }
}
