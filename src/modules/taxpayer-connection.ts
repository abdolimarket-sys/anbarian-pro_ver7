/**
 * فاز ۱۹: مرز امن اتصال سامانه مؤدیان.
 * این ماژول عمداً هیچ endpoint، مسیر امضا یا قرارداد API را حدس نمی‌زند.
 * مدیریت کلید و گواهی فقط باید در سرویس سمت سرور باشد؛ کلید خصوصی/گواهی فقط باید در سرویس سمت سرور نگهداری شود؛ این کد مرورگر
 * صرفاً قرارداد و کنترل‌های fail-closed را برای آداپتور مورد تأیید تعریف می‌کند.
 */
import { serializeV79SaleDraft, TAX_SCHEMA_VERSION, type V79SalePayload } from './taxpayer-schema-v79';

export type TaxConnectionEnvironment = 'sandbox' | 'production';
export type TaxConnectionState = 'draft' | 'ready' | 'submitting' | 'accepted' | 'rejected' | 'unknown';

export interface TaxConnectionConfig {
  environment: TaxConnectionEnvironment;
  /** آدرس HTTPS سرویس واسط تحت کنترل مالک سامانه؛ نه آدرس حدسی سازمان */
  backendProxyUrl: string;
  enabled: boolean;
  /** ارسال مستقیم از مرورگر عمداً پشتیبانی نمی‌شود. */
  credentialMode: 'server_managed';
}

export interface TaxConnectionIssue { code: string; message: string; }
export interface TaxSubmissionRequest {
  schemaVersion: typeof TAX_SCHEMA_VERSION;
  environment: TaxConnectionEnvironment;
  idempotencyKey: string;
  invoiceReference: string;
  payloadJson: string;
}
export interface TaxSubmissionResult {
  status: 'accepted' | 'rejected' | 'unknown';
  trackingId?: string;
  message?: string;
}

/** پیاده‌سازی این آداپتور باید در سمت سرور و مطابق قرارداد رسمی روز انجام شود. */
export interface TaxConnectionAdapter {
  submit(request: TaxSubmissionRequest): Promise<TaxSubmissionResult>;
  getStatus?(trackingId: string): Promise<TaxSubmissionResult>;
}

export function validateTaxConnectionConfig(config: TaxConnectionConfig): TaxConnectionIssue[] {
  const issues: TaxConnectionIssue[] = [];
  if (!config.enabled) issues.push({ code: 'connection_disabled', message: 'اتصال تا زمان تکمیل و تأیید تنظیمات غیرفعال است.' });
  if (config.credentialMode !== 'server_managed') issues.push({ code: 'unsafe_credential_mode', message: 'مدیریت کلید و گواهی در مرورگر مجاز نیست؛ فقط مدیریت سمت سرور پشتیبانی می‌شود.' });
  let url: URL | undefined;
  try { url = new URL(config.backendProxyUrl); } catch { /* reported below */ }
  if (!url) issues.push({ code: 'proxy_url_invalid', message: 'نشانی سرویس واسط معتبر نیست.' });
  else {
    if (url.protocol !== 'https:') issues.push({ code: 'https_required', message: 'ارتباط عملیاتی فقط از طریق HTTPS مجاز است.' });
    if (url.username || url.password) issues.push({ code: 'credentials_in_url', message: 'نام کاربری یا رمز نباید داخل نشانی URL قرار گیرد.' });
    if (url.search || url.hash) issues.push({ code: 'url_query_forbidden', message: 'پارامتر و fragment در نشانی پایه سرویس واسط مجاز نیست.' });
    if (config.environment === 'production' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname))
      issues.push({ code: 'production_loopback_forbidden', message: 'محیط عملیاتی نمی‌تواند به نشانی loopback متصل شود.' });
  }
  return issues;
}

export function buildTaxSubmissionRequest(input: {
  config: TaxConnectionConfig;
  invoiceReference: string;
  idempotencyKey: string;
  payload: V79SalePayload;
}): { request?: TaxSubmissionRequest; issues: TaxConnectionIssue[] } {
  const issues = validateTaxConnectionConfig(input.config);
  if (!input.invoiceReference.trim()) issues.push({ code: 'invoice_reference_required', message: 'شناسه مرجع فاکتور الزامی است.' });
  if (!/^[A-Za-z0-9._:-]{12,128}$/.test(input.idempotencyKey))
    issues.push({ code: 'idempotency_key_invalid', message: 'کلید جلوگیری از ارسال تکراری باید ۱۲ تا ۱۲۸ نویسه معتبر داشته باشد.' });
  const serialized = serializeV79SaleDraft(input.payload);
  if (!serialized.json || serialized.issues.length) issues.push({ code: 'payload_invalid', message: 'پیش‌نویس V7.9 معتبر نیست و برای اتصال آماده نمی‌شود.' });
  if (issues.length || !serialized.json) return { issues };
  return {
    request: {
      schemaVersion: TAX_SCHEMA_VERSION,
      environment: input.config.environment,
      idempotencyKey: input.idempotencyKey,
      invoiceReference: input.invoiceReference.trim(),
      payloadJson: serialized.json,
    },
    issues,
  };
}

/**
 * دروازه ارسال fail-closed؛ بدون آداپتور سمت سرور، درخواست هرگز ارسال نمی‌شود.
 * این تابع فقط پس از اتصال آداپتور رسمی/تأییدشده قابل استفاده است.
 */
export async function submitTaxDraft(input: {
  config: TaxConnectionConfig;
  adapter?: TaxConnectionAdapter;
  invoiceReference: string;
  idempotencyKey: string;
  payload: V79SalePayload;
}): Promise<{ result?: TaxSubmissionResult; issues: TaxConnectionIssue[] }> {
  const prepared = buildTaxSubmissionRequest(input);
  if (prepared.issues.length || !prepared.request) return { issues: prepared.issues };
  if (!input.adapter || typeof input.adapter.submit !== 'function') {
    return { issues: [{ code: 'server_adapter_unavailable', message: 'آداپتور امن سمت سرور متصل نیست؛ ارسال واقعی انجام نشد.' }] };
  }
  try {
    const result = await input.adapter.submit(prepared.request);
    if (!result || !['accepted', 'rejected', 'unknown'].includes(result.status))
      return { issues: [{ code: 'invalid_gateway_response', message: 'پاسخ دروازه اتصال قابل تشخیص نیست؛ وضعیت ارسال نامشخص باقی می‌ماند.' }] };
    return { result, issues: [] };
  } catch {
    // پس از timeout یا خطای شبکه، ارسال مجدد کورکورانه ممنوع است؛ ابتدا وضعیت با همان کلید پیگیری شود.
    return { result: { status: 'unknown', message: 'نتیجه ارسال نامشخص است؛ پیش از تلاش مجدد باید وضعیت با همان کلید پیگیری شود.' }, issues: [] };
  }
}
