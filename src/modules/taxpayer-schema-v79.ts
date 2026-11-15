/**
 * Versioned schema boundary for RC_IITP.IS_V7.9, invoice template 1 (sales).
 * This is a structural pre-validator only. It does not sign, encrypt, authenticate,
 * assign taxid, or submit anything to the Tax Authority.
 */
export const TAX_SCHEMA_VERSION = 'RC_IITP.IS_V7.9' as const;
export const TAX_SCHEMA_TEMPLATE = 1 as const;

export type InvoiceKind = 1 | 2;
export interface V79SaleHeader {
  taxid?: string;
  indatim?: number;
  indati2m?: number;
  inty: InvoiceKind;
  inno?: string;
  irtaxid?: string;
  inp: 1;
  ins: 1;
  tins: string;
  tob?: 1 | 2 | 3 | 4;
  bid?: string;
  tinb?: string;
  sbc?: string;
  bpc?: string;
  bbc?: string;
  nti1?: string;
  nti2?: string;
  insr?: 1;
  setm?: 1 | 2 | 3;
  tprdis?: number;
  tdis?: number;
  tadis?: number;
  tbill?: number;
  tvam?: number;
  todam?: number;
  tvop?: number;
  cap?: number;
  insp?: number;
}
export interface V79SaleBodyItem {
  sstid: string;
  sstt?: string;
  am: number;
  mu?: string;
  fee: number;
  prdis: number;
  dis: number;
  adis: number;
  vra: number;
  vam: number;
  odt?: string;
  odr?: number;
  odam?: number;
  olt?: string;
  olr?: number;
  olam?: number;
  cop?: number;
  vop?: number;
  tsstam: number;
}
export interface V79Payment {
  iinn?: string; acn?: string; trmn?: string; pmt: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  trn?: string; pcn?: string; pid?: string; pdt?: number; pv: number;
}
export interface V79SalePayload {
  header: V79SaleHeader;
  body: V79SaleBodyItem[];
  payments?: V79Payment[];
  extension?: Array<Record<string, string | number>>;
}
export interface SchemaIssue { path: string; code: string; message: string; }

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const isFiniteNonNegative = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/**
 * Rules grounded in V7.9 sections 8-7..8-9 and JSON example 9-3:
 * type 1 and type 2 both support template 1 (sales); buyer fields are not
 * mandatory for type 2. The exact buyer identity rules for type 1 depend on tob.
 */
export function validateV79SalePayload(value: unknown): SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  if (!isRecord(value)) return [{ path: '$', code: 'object_required', message: 'ساختار صورتحساب باید یک شیء JSON باشد.' }];
  const header = value.header;
  const body = value.body;
  if (!isRecord(header)) issues.push({ path: 'header', code: 'required_object', message: 'بخش سرآمد (header) الزامی است.' });
  if (!Array.isArray(body) || body.length === 0) issues.push({ path: 'body', code: 'required_array', message: 'بخش بدنه (body) باید دست‌کم یک ردیف داشته باشد.' });
  if (!isRecord(header)) return issues;

  if (header.inty !== 1 && header.inty !== 2) issues.push({ path: 'header.inty', code: 'enum', message: 'نوع صورتحساب برای این مرحله باید ۱ یا ۲ باشد.' });
  if (header.inp !== 1) issues.push({ path: 'header.inp', code: 'template', message: 'این مرحله فقط الگوی اول (فروش) با کد ۱ را پشتیبانی می‌کند.' });
  if (header.ins !== 1) issues.push({ path: 'header.ins', code: 'subject', message: 'در این مرحله فقط موضوع اصلی با کد ۱ پشتیبانی می‌شود.' });
  if (!isNonEmptyString(header.tins)) issues.push({ path: 'header.tins', code: 'required', message: 'شماره اقتصادی فروشنده الزامی است.' });
  if (header.taxid !== undefined && !isNonEmptyString(header.taxid)) issues.push({ path: 'header.taxid', code: 'string', message: 'شماره منحصر به‌فرد مالیاتی، در صورت درج، باید رشته غیرخالی باشد.' });
  if (header.indatim === undefined) issues.push({ path: 'header.indatim', code: 'required', message: 'تاریخ و زمان صدور (indatim) اجباری است؛ ساعت صدور را وارد کنید.' });
  else if (!Number.isSafeInteger(header.indatim) || (header.indatim as number) < 0)
    issues.push({ path: 'header.indatim', code: 'timestamp', message: 'مقدار زمان صدور باید timestamp عددی معتبر باشد.' });
  if (header.indati2m !== undefined && (!Number.isSafeInteger(header.indati2m) || (header.indati2m as number) < 0))
    issues.push({ path: 'header.indati2m', code: 'timestamp', message: 'مقدار زمان ثبت باید timestamp عددی معتبر باشد.' });
  for (const field of ['nti1', 'nti2'] as const) {
    if (header[field] !== undefined && (typeof header[field] !== 'string' || (header[field] as string).length > 30))
      issues.push({ path: `header.${field}`, code: 'max_length', message: 'یادداشت باید رشته‌ای با حداکثر ۳۰ نویسه باشد.' });
  }
  if (header.insr !== undefined && header.insr !== 1) issues.push({ path: 'header.insr', code: 'enum', message: 'قاعده ارسال صورتحساب در این مرحله فقط مقدار ۱ را می‌پذیرد.' });
  if (header.setm === undefined) issues.push({ path: 'header.setm', code: 'required', message: 'روش تسویه (setm) برای الگوی فروش اجباری است.' });
  if (header.setm !== undefined && header.setm !== 1 && header.setm !== 2 && header.setm !== 3) issues.push({ path: 'header.setm', code: 'enum', message: 'روش تسویه باید ۱ نقدی، ۲ نسیه یا ۳ نقدی/نسیه باشد.' });
  if (header.inty === 2 && header.setm !== undefined && header.setm !== 1) issues.push({ path: 'header.setm', code: 'type2_cash_only', message: 'طبق V7.9 صورتحساب نوع دوم با روش تسویه نقدی ثبت می‌شود.' });
  if (header.setm === 3) {
    if (![header.tbill, header.tvam, header.todam].every(isFiniteNonNegative)) issues.push({ path: 'header.tbill|tvam|todam', code: 'settlement_basis_required', message: 'برای کنترل تسویه ترکیبی، tbill، tvam و todam لازم است.' });
    if (!isFiniteNonNegative(header.cap) || header.cap <= 0) issues.push({ path: 'header.cap', code: 'cash_amount_required', message: 'در روش نقدی/نسیه، مبلغ پرداختی نقدی (cap) باید مثبت باشد.' });
    if (!isFiniteNonNegative(header.insp) || header.insp <= 0) issues.push({ path: 'header.insp', code: 'credit_amount_required', message: 'در روش نقدی/نسیه، مبلغ نسیه (insp) باید مثبت باشد.' });
    if ([header.tbill, header.tvam, header.todam, header.cap, header.insp].every(isFiniteNonNegative)) {
      const settlementBase = (header.tbill as number) - (header.tvam as number) - (header.todam as number);
      if ((header.cap as number) >= (header.tbill as number)) issues.push({ path: 'header.cap', code: 'cash_below_invoice_total', message: 'مبلغ پرداختی نقدی باید از مجموع صورتحساب کمتر باشد.' });
      if ((header.insp as number) >= (header.tbill as number)) issues.push({ path: 'header.insp', code: 'credit_below_invoice_total', message: 'مبلغ نسیه باید از مجموع صورتحساب کمتر باشد.' });
      if (settlementBase <= 0 || (header.cap as number) + (header.insp as number) !== settlementBase) issues.push({ path: 'header.cap|insp', code: 'settlement_equation', message: 'رابطه تسویه باید برقرار باشد: cap + insp = tbill - tvam - todam.' });
    }
  }
  if (Array.isArray(body) && body.length > 0) {
    const rows = body.filter(isRecord);
    const sums = {
      tvop: rows.reduce((sum, row) => sum + (isFiniteNonNegative(row.vop) ? row.vop : 0), 0),
      tprdis: rows.reduce((sum, row) => sum + (isFiniteNonNegative(row.prdis) ? row.prdis : 0), 0),
      tdis: rows.reduce((sum, row) => sum + (isFiniteNonNegative(row.dis) ? row.dis : 0), 0),
      tadis: rows.reduce((sum, row) => sum + (isFiniteNonNegative(row.adis) ? row.adis : 0), 0),
      tvam: rows.reduce((sum, row) => sum + (isFiniteNonNegative(row.vam) ? row.vam : 0), 0),
      lineTotal: rows.reduce((sum, row) => sum + (isFiniteNonNegative(row.tsstam) ? row.tsstam : 0), 0),
      otherTaxTotal: rows.reduce((sum, row) => sum + (isFiniteNonNegative(row.odam) ? row.odam : 0) + (isFiniteNonNegative(row.olam) ? row.olam : 0), 0),
    };
    for (const field of ['tprdis', 'tdis', 'tadis', 'tvam'] as const) {
      if (!isFiniteNonNegative(header[field])) issues.push({ path: `header.${field}`, code: 'header_total_required', message: `مجموع ${field} باید از جمع ردیف‌های بدنه محاسبه و درج شود.` });
      else if (header[field] !== sums[field]) issues.push({ path: `header.${field}`, code: 'header_total_mismatch', message: `مقدار ${field} با جمع متناظر ردیف‌های بدنه برابر نیست.` });
    }
    if (header.tvop !== undefined && (!Number.isSafeInteger(header.tvop) || (header.tvop as number) < 0 || header.tvop !== sums.tvop)) issues.push({ path: 'header.tvop', code: 'vat_payment_share_total_mismatch', message: 'tvop باید برابر جمع vop تمام ردیف‌ها باشد.' });
    if (!isFiniteNonNegative(header.tbill)) issues.push({ path: 'header.tbill', code: 'invoice_total_required', message: 'مجموع صورتحساب (tbill) الزامی است.' });
    else {
      if (header.todam !== undefined && (!Number.isSafeInteger(header.todam) || (header.todam as number) < 0)) issues.push({ path: 'header.todam', code: 'other_tax_total_integer', message: 'todam باید عدد صحیح نامنفی در محدوده امن عددی باشد.' });
      if (header.todam !== sums.otherTaxTotal) issues.push({ path: 'header.todam', code: 'other_tax_total_mismatch', message: 'todam باید برابر جمع odam و olam تمام ردیف‌ها باشد.' });
      if (header.tbill !== sums.lineTotal) issues.push({ path: 'header.tbill', code: 'invoice_total_mismatch', message: 'مجموع صورتحساب باید برابر جمع tsstam ردیف‌ها باشد.' });
    }
  }

  if (Array.isArray(value.payments)) value.payments.forEach((payment, index) => {
    const path = `payments[${index}]`;
    if (!isRecord(payment)) { issues.push({ path, code: 'object_required', message: 'هر پرداخت باید شیء باشد.' }); return; }
    if (![1,2,3,4,5,6,7,8].includes(payment.pmt as number)) issues.push({ path: `${path}.pmt`, code: 'payment_method', message: 'کد روش پرداخت باید بین ۱ تا ۸ باشد.' });
    if (!isFiniteNonNegative(payment.pv)) issues.push({ path: `${path}.pv`, code: 'payment_amount', message: 'مبلغ پرداخت باید عددی نامنفی باشد.' });
    if (payment.pdt !== undefined && (!Number.isSafeInteger(payment.pdt) || (payment.pdt as number) < 0 || String(payment.pdt).length > 13)) issues.push({ path: `${path}.pdt`, code: 'payment_timestamp', message: 'تاریخ پرداخت باید timestamp عددی معتبر باشد.' });
    for (const [field, max] of [['iinn', 9], ['acn', 14], ['trmn', 8], ['trn', 14], ['pcn', 16], ['pid', 12]] as const) {
      const entry = payment[field];
      if (entry !== undefined && (typeof entry !== 'string' || !/^\d+$/.test(entry) || entry.length > max))
        issues.push({ path: `${path}.${field}`, code: 'payment_identifier_format', message: `${field} باید فقط رقم و حداکثر ${max} رقم باشد.` });
    }
    if (typeof payment.pv === 'number' && (!Number.isSafeInteger(payment.pv) || payment.pv < 0 || (isFiniteNonNegative(header.tbill) && payment.pv > (header.tbill as number))))
      issues.push({ path: `${path}.pv`, code: 'payment_amount_integer', message: 'pv باید مبلغ صحیح ریالی نامنفی باشد.' });
    if (payment.pmt === 1 && payment.trn !== undefined && (typeof payment.trn !== 'string' || payment.trn.length > 14))
      issues.push({ path: `${path}.trn`, code: 'payment_reference_length', message: 'شماره مرجع حداکثر ۱۴ رقم است.' });
  });

  // V7.9: buyer data is optional for invoice type 2. For type 1, tob controls
  // buyer identity requirements; do not invent an identity rule without tob.
  if (header.inty === 1 && header.tob !== undefined && ![1, 2, 3, 4].includes(header.tob as number))
    issues.push({ path: 'header.tob', code: 'enum', message: 'نوع شخص خریدار باید یکی از کدهای ۱ تا ۴ باشد.' });
  if (header.inty === 1 && (header.tob === 2 || header.tob === 3) && !isNonEmptyString(header.tinb))
    issues.push({ path: 'header.tinb', code: 'buyer_economic_code_required', message: 'برای خریدار حقوقی/مشارکت مدنی در نوع اول، شماره اقتصادی خریدار الزامی است.' });
  if (header.inty === 1 && (header.tob === 1 || header.tob === 4) && !isNonEmptyString(header.tinb) && !isNonEmptyString(header.bid))
    issues.push({ path: 'header.tinb|header.bid', code: 'buyer_identity_required', message: 'برای خریدار حقیقی/اتباع غیرایرانی در نوع اول، شماره اقتصادی یا شناسه هویتی خریدار لازم است.' });

  if (Array.isArray(body)) body.forEach((row, index) => {
    const path = `body[${index}]`;
    if (!isRecord(row)) { issues.push({ path, code: 'object_required', message: 'هر ردیف بدنه باید شیء باشد.' }); return; }
    for (const field of ['sstid'] as const) if (!isNonEmptyString(row[field])) issues.push({ path: `${path}.${field}`, code: 'required', message: 'شناسه کالا/خدمت الزامی است.' });
    for (const field of ['am', 'fee', 'prdis', 'dis', 'adis', 'vra', 'vam', 'tsstam'] as const)
      if (!isFiniteNonNegative(row[field])) issues.push({ path: `${path}.${field}`, code: 'non_negative_number', message: 'این قلم باید عددی نامنفی باشد.' });
    for (const field of ['odr', 'olr'] as const)
      if (row[field] !== undefined && !isFiniteNonNegative(row[field])) issues.push({ path: `${path}.${field}`, code: 'non_negative_number', message: 'نرخ اختیاری باید عددی نامنفی باشد.' });
    for (const field of ['cop', 'vop'] as const)
      if (row[field] !== undefined && (!Number.isSafeInteger(row[field]) || (row[field] as number) < 0)) issues.push({ path: `${path}.${field}`, code: 'payment_share_integer', message: `${field} باید عدد صحیح نامنفی باشد.` });
    if (typeof row.cop === 'number' && isFiniteNonNegative(header.tbill) && row.cop >= (header.tbill as number)) issues.push({ path: `${path}.cop`, code: 'cash_share_below_invoice_total', message: 'سهم نقدی هر ردیف باید از مجموع صورتحساب کمتر باشد.' });
    if (typeof row.cop === 'number' && isFiniteNonNegative(row.tsstam) && row.cop > (row.tsstam as number)) issues.push({ path: `${path}.cop`, code: 'cash_share_above_row_total', message: 'سهم نقدی ردیف نباید از مبلغ کل همان ردیف بیشتر باشد.' });
    if (typeof row.vop === 'number' && isFiniteNonNegative(row.vam) && row.vop > (row.vam as number)) issues.push({ path: `${path}.vop`, code: 'vat_share_above_row_vat', message: 'سهم مالیات از پرداخت نباید از مالیات همان ردیف بیشتر باشد.' });
    if (typeof row.vop === 'number' && isFiniteNonNegative(row.vam) && row.vam === 0 && row.vop !== 0) issues.push({ path: `${path}.vop`, code: 'zero_vat_zero_vop', message: 'در صورت صفر بودن مالیات بر ارزش افزوده ردیف، vop نیز باید صفر باشد.' });
    for (const field of ['odam', 'olam'] as const)
      if (row[field] !== undefined && (!Number.isSafeInteger(row[field]) || (row[field] as number) < 0)) issues.push({ path: `${path}.${field}`, code: 'non_negative_integer', message: 'مبلغ اختیاری باید عدد صحیح نامنفی و در محدوده امن عددی باشد.' });
    for (const field of ['odt', 'olt'] as const) if (row[field] !== undefined && (typeof row[field] !== 'string' || (row[field] as string).length > 255)) issues.push({ path: `${path}.${field}`, code: 'max_length', message: 'موضوع مالیات/عوارض باید حداکثر ۲۵۵ نویسه باشد.' });
    for (const field of ['odr', 'olr'] as const) if (row[field] !== undefined && (!isFiniteNonNegative(row[field]) || ((row[field] as number) > 999.99 || Math.round((row[field] as number) * 100) !== (row[field] as number) * 100))) issues.push({ path: `${path}.${field}`, code: 'rate_range', message: 'نرخ سایر مالیات یا وجوه قانونی باید بین صفر تا ۹۹۹٫۹۹ باشد.' });
    if (isFiniteNonNegative(row.adis) && isFiniteNonNegative(row.vam) && isFiniteNonNegative(row.odam ?? 0) && isFiniteNonNegative(row.olam ?? 0) && isFiniteNonNegative(row.tsstam) && row.tsstam !== (row.adis as number) + (row.vam as number) + Number(row.odam ?? 0) + Number(row.olam ?? 0)) issues.push({ path: `${path}.tsstam`, code: 'line_total_equation', message: 'tsstam باید برابر adis + vam + odam + olam باشد.' });
    if (row.odr !== undefined && isFiniteNonNegative(row.odr) && isFiniteNonNegative(row.adis) && row.odam !== undefined && row.odam !== Math.round(row.adis * row.odr / 100)) issues.push({ path: `${path}.odam`, code: 'other_tax_rate_equation', message: 'مبلغ odam با نرخ odr و مبلغ پس از تخفیف تطبیق ندارد.' });
    if (row.olr !== undefined && isFiniteNonNegative(row.olr) && isFiniteNonNegative(row.adis) && row.olam !== undefined && row.olam !== Math.round(row.adis * row.olr / 100)) issues.push({ path: `${path}.olam`, code: 'other_levy_rate_equation', message: 'مبلغ olam با نرخ olr و مبلغ پس از تخفیف تطبیق ندارد.' });
    if (row.odr !== undefined && row.odam === undefined) issues.push({ path: `${path}.odam`, code: 'other_tax_amount_required', message: 'در صورت درج نرخ odr، مبلغ odam نیز باید درج شود.' });
    if (row.olr !== undefined && row.olam === undefined) issues.push({ path: `${path}.olam`, code: 'other_levy_amount_required', message: 'در صورت درج نرخ olr، مبلغ olam نیز باید درج شود.' });
    if (isFiniteNonNegative(row.vra) && row.vra === 0 && (Number(row.odam ?? 0) > 0 || Number(row.olam ?? 0) > 0)) issues.push({ path, code: 'zero_vat_other_tax_zero', message: 'طبق قاعده V7.9 در نرخ مالیات بر ارزش افزوده صفر، مبلغ سایر مالیات‌ها و وجوه قانونی باید صفر باشد.' });
    if (isFiniteNonNegative(row.prdis) && isFiniteNonNegative(row.dis) && isFiniteNonNegative(row.adis) && row.prdis - row.dis !== row.adis)
      issues.push({ path: `${path}.adis`, code: 'discount_equation', message: 'مبلغ بعد از تخفیف باید برابر مبلغ قبل از تخفیف منهای تخفیف باشد.' });
  });
  return issues;
}



/**
 * Phase 18: produce a deterministic, JSON-round-tripped local draft only.
 * Reject values JSON.stringify would silently drop or rewrite (undefined,
 * non-finite numbers, bigint, functions, symbols, cycles, and non-plain objects).
 */
export function serializeV79SaleDraft(payload: unknown): { json: string | null; issues: SchemaIssue[] } {
  const issues = validateV79SalePayload(payload);
  const seen = new WeakSet<object>();
  const inspect = (entry: unknown, path: string): void => {
    if (entry === null || typeof entry === 'string' || typeof entry === 'boolean') return;
    if (typeof entry === 'number') {
      if (!Number.isFinite(entry)) issues.push({ path, code: 'json_non_finite_number', message: 'JSON نمی‌تواند مقدار عددی نامتناهی یا NaN را نگهداری کند.' });
      return;
    }
    if (entry === undefined || typeof entry === 'function' || typeof entry === 'symbol' || typeof entry === 'bigint') {
      issues.push({ path, code: 'json_unsupported_value', message: 'این مقدار در JSON قابل نگهداری مطمئن نیست.' });
      return;
    }
    if (typeof entry !== 'object') return;
    if (seen.has(entry)) { issues.push({ path, code: 'json_circular_reference', message: 'ساختار JSON نباید ارجاع حلقوی داشته باشد.' }); return; }
    seen.add(entry);
    if (!Array.isArray(entry) && Object.getPrototypeOf(entry) !== Object.prototype && Object.getPrototypeOf(entry) !== null) {
      issues.push({ path, code: 'json_plain_object_required', message: 'فقط شیء ساده و آرایه برای خروجی JSON مجاز است.' });
    }
    if (Array.isArray(entry)) entry.forEach((child, index) => inspect(child, `${path}[${index}]`));
    else Object.entries(entry as Record<string, unknown>).forEach(([key, child]) => inspect(child, `${path}.${key}`));
    seen.delete(entry); // shared references are JSON-safe; only active recursion indicates a cycle
  };
  inspect(payload, '$');
  if (issues.length) return { json: null, issues };
  try {
    const json = JSON.stringify(payload);
    if (typeof json !== 'string') return { json: null, issues: [{ path: '$', code: 'json_empty_output', message: 'خروجی JSON خالی است.' }] };
    const restored: unknown = JSON.parse(json);
    const secondPass = validateV79SalePayload(restored);
    if (secondPass.length) return { json: null, issues: secondPass.map(issue => ({ ...issue, code: `roundtrip_${issue.code}` })) };
    return { json, issues: [] };
  } catch {
    return { json: null, issues: [{ path: '$', code: 'json_serialization_failed', message: 'تبدیل پیش‌نویس به JSON ناموفق بود.' }] };
  }
}

/** Returns a copy tagged with its source schema version; never labels it as sent. */
export function tagV79Draft<T extends V79SalePayload>(payload: T): T & { schemaVersion: typeof TAX_SCHEMA_VERSION; deliveryStatus: 'local_draft' } {
  return { ...payload, schemaVersion: TAX_SCHEMA_VERSION, deliveryStatus: 'local_draft' };
}
