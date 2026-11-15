/**
 * فاز ۲۴: پل اختیاری دفتر ثبت ارسال.
 * بدون پیکربندی صریح هیچ درخواستی نمی‌فرستد و رفتار فعلی مؤدیان را تغییر نمی‌دهد.
 * به main.ts / taxpayer.ts وابسته نیست؛ اتصال UI باید صریحاً این ماژول را فراخوانی کند.
 * ارسال واقعی به سامانه مؤدیان همچنان غیرفعال است.
 */
import type { TaxConnectionEnvironment } from './taxpayer-connection';
import {
  createTaxLedgerRecord,
  reserveTaxSubmission,
  transitionTaxLedgerRecord,
  type TaxLedgerIssue,
  type TaxSubmissionRecord,
} from './taxpayer-submission-ledger';
import {
  createWordPressTaxLedgerRepository,
  validateTaxLedgerServerConfig,
  type TaxLedgerServerConfig,
} from './taxpayer-ledger-server';

const CONFIG_KEY = 'anbarin_taxpayer_ledger_bridge_v1';

export interface TaxLedgerBridgeConfig {
  /** نشانی HTTPS سرویس واسط (فاز ۲۳) یا در محیط کنترل‌شده نشانی سازگار */
  baseUrl: string;
  /** کلید API سرویس واسط — نباید Application Password وردپرس باشد */
  apiKey: string;
  environment: TaxConnectionEnvironment;
  enabled: boolean;
}

export interface TaxLedgerBridgeStatus {
  configured: boolean;
  enabled: boolean;
  issues: TaxLedgerIssue[];
  submissionDisabled: true;
}

function emptyConfig(): TaxLedgerBridgeConfig {
  return { baseUrl: '', apiKey: '', environment: 'sandbox', enabled: false };
}

function readStored(): TaxLedgerBridgeConfig {
  try {
    const raw = JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null') as Partial<TaxLedgerBridgeConfig> | null;
    if (!raw || typeof raw !== 'object') return emptyConfig();
    return {
      baseUrl: typeof raw.baseUrl === 'string' ? raw.baseUrl.trim() : '',
      apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : '',
      environment: raw.environment === 'production' ? 'production' : 'sandbox',
      enabled: raw.enabled === true,
    };
  } catch {
    return emptyConfig();
  }
}

/** ذخیره تنظیمات اختیاری؛ بدون enabled و URL/کلید معتبر، پل غیرفعال می‌ماند. */
export function saveTaxLedgerBridgeConfig(input: Partial<TaxLedgerBridgeConfig>): TaxLedgerBridgeConfig {
  const current = readStored();
  const next: TaxLedgerBridgeConfig = {
    baseUrl: typeof input.baseUrl === 'string' ? input.baseUrl.trim() : current.baseUrl,
    apiKey: typeof input.apiKey === 'string' ? input.apiKey : current.apiKey,
    environment: input.environment === 'production' || input.environment === 'sandbox'
      ? input.environment
      : current.environment,
    enabled: input.enabled === true,
  };
  localStorage.setItem(CONFIG_KEY, JSON.stringify({
    baseUrl: next.baseUrl,
    // apiKey فقط در صورت ورود جدید بازنویسی می‌شود؛ برای پاک‌سازی رشته خالی بفرستید
    apiKey: next.apiKey,
    environment: next.environment,
    enabled: next.enabled,
  }));
  return next;
}

export function loadTaxLedgerBridgeConfig(): TaxLedgerBridgeConfig {
  return readStored();
}

export function getTaxLedgerBridgeStatus(): TaxLedgerBridgeStatus {
  const cfg = readStored();
  const issues: TaxLedgerIssue[] = [];
  if (!cfg.enabled) {
    issues.push({ code: 'bridge_disabled', message: 'پل دفتر ثبت غیرفعال است؛ رفتار فعلی مؤدیان بدون تغییر می‌ماند.' });
    return { configured: false, enabled: false, issues, submissionDisabled: true };
  }
  if (!cfg.baseUrl || !cfg.apiKey || cfg.apiKey.length < 24) {
    issues.push({ code: 'bridge_incomplete', message: 'نشانی سرویس واسط یا کلید API کامل نیست.' });
    return { configured: false, enabled: true, issues, submissionDisabled: true };
  }
  const serverIssues = validateTaxLedgerServerConfig({
    baseUrl: cfg.baseUrl,
    getAuthHeaders: () => ({ 'X-Api-Key': cfg.apiKey }),
  });
  for (const s of serverIssues) issues.push({ code: s.code, message: s.message });
  if (issues.length) {
    return { configured: false, enabled: true, issues, submissionDisabled: true };
  }
  return { configured: true, enabled: true, issues: [], submissionDisabled: true };
}

function repositoryOrNull(): ReturnType<typeof createWordPressTaxLedgerRepository> | null {
  const status = getTaxLedgerBridgeStatus();
  if (!status.configured) return null;
  const cfg = readStored();
  const serverConfig: TaxLedgerServerConfig = {
    baseUrl: cfg.baseUrl,
    getAuthHeaders: () => ({ 'X-Api-Key': cfg.apiKey }),
  };
  return createWordPressTaxLedgerRepository(serverConfig);
}

/**
 * رزرو اختیاری در دفتر ثبت سرور.
 * اگر پل پیکربندی نشده باشد، هیچ شبکه درخواستی نمی‌فرستد و فقط issues برمی‌گرداند.
 */
export async function tryReserveTaxLedger(input: {
  id: string;
  invoiceReference: string;
  idempotencyKey: string;
}): Promise<{ record?: TaxSubmissionRecord; created?: boolean; issues: TaxLedgerIssue[]; skipped: boolean }> {
  const status = getTaxLedgerBridgeStatus();
  if (!status.configured) {
    return { issues: status.issues, skipped: true };
  }
  const repo = repositoryOrNull();
  if (!repo) return { issues: status.issues, skipped: true };
  const cfg = readStored();
  const record = createTaxLedgerRecord({
    id: input.id,
    invoiceReference: input.invoiceReference,
    idempotencyKey: input.idempotencyKey,
    environment: cfg.environment,
  });
  try {
    const result = await reserveTaxSubmission(repo, record);
    return { record: result.record, created: result.created, issues: result.issues, skipped: false };
  } catch (err) {
    return {
      issues: [{
        code: 'bridge_reserve_failed',
        message: err instanceof Error ? err.message : 'ارتباط با دفتر ثبت ناموفق بود.',
      }],
      skipped: false,
    };
  }
}

/** خواندن وضعیت؛ بدون پیکربندی، درخواست شبکه زده نمی‌شود. */
export async function tryGetTaxLedgerStatus(idempotencyKey: string): Promise<{
  record?: TaxSubmissionRecord;
  issues: TaxLedgerIssue[];
  skipped: boolean;
}> {
  const status = getTaxLedgerBridgeStatus();
  if (!status.configured) return { issues: status.issues, skipped: true };
  const repo = repositoryOrNull();
  if (!repo) return { issues: status.issues, skipped: true };
  const cfg = readStored();
  try {
    const record = await repo.getByKey(cfg.environment, idempotencyKey);
    if (!record) {
      return { issues: [{ code: 'ledger_record_not_found', message: 'رکورد ارسال پیدا نشد.' }], skipped: false };
    }
    return { record, issues: [], skipped: false };
  } catch (err) {
    return {
      issues: [{
        code: 'bridge_get_failed',
        message: err instanceof Error ? err.message : 'خواندن وضعیت دفتر ثبت ناموفق بود.',
      }],
      skipped: false,
    };
  }
}

/**
 * انتقال اختیاری وضعیت روی سرور.
 * ماشین حالت همان فاز ۲۰ است؛ ارسال به سازمان انجام نمی‌شود.
 */
export async function tryTransitionTaxLedger(input: {
  idempotencyKey: string;
  next: TaxSubmissionRecord['state'];
  trackingId?: string;
  message?: string;
}): Promise<{ record?: TaxSubmissionRecord; issues: TaxLedgerIssue[]; skipped: boolean }> {
  const status = getTaxLedgerBridgeStatus();
  if (!status.configured) return { issues: status.issues, skipped: true };
  const repo = repositoryOrNull();
  if (!repo) return { issues: status.issues, skipped: true };
  const cfg = readStored();
  try {
    const current = await repo.getByKey(cfg.environment, input.idempotencyKey);
    if (!current) {
      return { issues: [{ code: 'ledger_record_not_found', message: 'رکورد ارسال پیدا نشد.' }], skipped: false };
    }
    const changed = transitionTaxLedgerRecord(current, input.next, {
      status: input.next === 'submitting' ? 'unknown' : input.next as 'accepted' | 'rejected' | 'unknown',
      trackingId: input.trackingId,
      message: input.message,
    });
    if (!changed.record) return { issues: changed.issues, skipped: false };
    await repo.save(changed.record);
    return { record: changed.record, issues: [], skipped: false };
  } catch (err) {
    return {
      issues: [{
        code: 'bridge_transition_failed',
        message: err instanceof Error ? err.message : 'انتقال وضعیت دفتر ثبت ناموفق بود.',
      }],
      skipped: false,
    };
  }
}
