/**
 * فاز ۲۲: آداپتور کلاینت برای دفتر ثبت ارسال سمت سرور (فاز ۲۱).
 * پیاده‌سازی TaxLedgerRepository روی REST افزونه WordPress.
 * هیچ payload، کلید خصوصی یا توکن در این لایه ذخیره/ارسال نمی‌شود.
 * ارسال واقعی به سامانه مؤدیان همچنان غیرفعال است.
 */
import type { TaxConnectionEnvironment } from './taxpayer-connection';
import type { TaxLedgerRepository, TaxSubmissionRecord } from './taxpayer-submission-ledger';

export interface TaxLedgerServerConfig {
  /** نشانی پایه HTTPS سرویس وردپرس، مثلاً https://example.com — بدون trailing slash اجباری */
  baseUrl: string;
  /**
   * تابع احراز هویت امن.
   * باید هدر Authorization (یا X-WP-Nonce + cookie در محیط وردپرس) را برگرداند.
   * Application Password را داخل اپ عمومی قرار ندهید؛ فقط از سرویس واسط امن استفاده کنید.
   */
  getAuthHeaders: () => Promise<Record<string, string>> | Record<string, string>;
  /** مسیر پیش‌فرض REST؛ معمولاً /wp-json/anbarin/v1 */
  apiPrefix?: string;
  fetchImpl?: typeof fetch;
}

export interface TaxLedgerServerIssue {
  code: string;
  message: string;
}

function normalizeBase(url: string): string {
  return url.replace(/\/+$/, '');
}

function route(config: TaxLedgerServerConfig, path: string): string {
  const prefix = (config.apiPrefix ?? '/wp-json/anbarin/v1').replace(/\/+$/, '');
  return `${normalizeBase(config.baseUrl)}${prefix}${path}`;
}

function asRecord(value: unknown): TaxSubmissionRecord | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const r = value as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.invoiceReference !== 'string' ||
      typeof r.idempotencyKey !== 'string' || typeof r.environment !== 'string' ||
      typeof r.state !== 'string' || typeof r.createdAt !== 'string' || typeof r.updatedAt !== 'string') {
    return undefined;
  }
  const events = Array.isArray(r.events)
    ? r.events.filter((e): e is TaxSubmissionRecord['events'][number] =>
        !!e && typeof e === 'object' && typeof (e as { id?: unknown }).id === 'string' &&
        typeof (e as { kind?: unknown }).kind === 'string' && typeof (e as { at?: unknown }).at === 'string')
    : [];
  return {
    id: r.id,
    invoiceReference: r.invoiceReference,
    idempotencyKey: r.idempotencyKey,
    environment: r.environment as TaxConnectionEnvironment,
    state: r.state as TaxSubmissionRecord['state'],
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    trackingId: typeof r.trackingId === 'string' ? r.trackingId : undefined,
    lastMessage: typeof r.lastMessage === 'string' ? r.lastMessage : undefined,
    events,
  };
}

async function authHeaders(config: TaxLedgerServerConfig): Promise<Record<string, string>> {
  const headers = await config.getAuthHeaders();
  return { Accept: 'application/json', 'Content-Type': 'application/json', ...headers };
}

/**
 * repository سمت سرور؛ reserve اتمیک و با قید یکتایی روی سرور اجرا می‌شود.
 * save از طریق PATCH انتقال وضعیت انجام می‌شود (نه بازنویسی آزاد).
 */
export function createWordPressTaxLedgerRepository(config: TaxLedgerServerConfig): TaxLedgerRepository {
  const doFetch = config.fetchImpl ?? fetch;

  return {
    async reserve(record: TaxSubmissionRecord): Promise<{ created: boolean; record: TaxSubmissionRecord }> {
      const res = await doFetch(route(config, '/taxpayer/submissions'), {
        method: 'POST',
        headers: await authHeaders(config),
        body: JSON.stringify({
          id: record.id,
          invoiceReference: record.invoiceReference,
          idempotencyKey: record.idempotencyKey,
          environment: record.environment,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok && res.status !== 200) {
        throw new Error(
          typeof (data as { message?: string }).message === 'string'
            ? (data as { message: string }).message
            : `ledger_reserve_failed:${res.status}`,
        );
      }
      const parsed = asRecord((data as { record?: unknown }).record);
      if (!parsed) throw new Error('ledger_reserve_invalid_response');
      return {
        created: !!(data as { created?: boolean }).created,
        record: parsed,
      };
    },

    async getByKey(environment: TaxConnectionEnvironment, idempotencyKey: string): Promise<TaxSubmissionRecord | undefined> {
      const qs = new URLSearchParams({ environment, idempotencyKey });
      const res = await doFetch(`${route(config, '/taxpayer/submissions')}?${qs}`, {
        method: 'GET',
        headers: await authHeaders(config),
      });
      if (res.status === 404) return undefined;
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof (data as { message?: string }).message === 'string'
            ? (data as { message: string }).message
            : `ledger_get_failed:${res.status}`,
        );
      }
      return asRecord((data as { record?: unknown }).record);
    },

    /**
     * ذخیره از طریق انتقال وضعیت سمت سرور.
     * فقط state / trackingId / lastMessage اعمال می‌شود؛ events روی سرور ساخته می‌شوند.
     */
    async save(record: TaxSubmissionRecord): Promise<void> {
      const res = await doFetch(route(config, '/taxpayer/submissions'), {
        method: 'PATCH',
        headers: await authHeaders(config),
        body: JSON.stringify({
          environment: record.environment,
          idempotencyKey: record.idempotencyKey,
          state: record.state,
          trackingId: record.trackingId ?? null,
          message: record.lastMessage ?? null,
          statusChecked: record.events.at(-1)?.kind === 'status_checked',
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          typeof (data as { message?: string }).message === 'string'
            ? (data as { message: string }).message
            : `ledger_save_failed:${res.status}`,
        );
      }
    },
  };
}

/** اعتبارسنجی تنظیمات اتصال به دفتر سرور (بدون حدس endpoint سازمان). */
export function validateTaxLedgerServerConfig(config: TaxLedgerServerConfig): TaxLedgerServerIssue[] {
  const issues: TaxLedgerServerIssue[] = [];
  let url: URL | undefined;
  try { url = new URL(config.baseUrl); } catch { /* reported below */ }
  if (!url) {
    issues.push({ code: 'ledger_base_url_invalid', message: 'نشانی پایه سرویس دفتر ثبت معتبر نیست.' });
  } else {
    if (url.protocol !== 'https:') {
      issues.push({ code: 'ledger_https_required', message: 'ارتباط با دفتر ثبت فقط از طریق HTTPS مجاز است.' });
    }
    if (url.username || url.password) {
      issues.push({ code: 'ledger_credentials_in_url', message: 'نام کاربری یا رمز نباید داخل نشانی URL قرار گیرد.' });
    }
  }
  if (typeof config.getAuthHeaders !== 'function') {
    issues.push({ code: 'ledger_auth_required', message: 'تابع احراز هویت امن برای دفتر ثبت الزامی است.' });
  }
  return issues;
}
