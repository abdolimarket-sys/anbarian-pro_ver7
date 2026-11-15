/** ماژول مستقل آماده‌سازی و پیگیری صورتحساب‌های سامانه مؤدیان.
 * عمداً از ذخیره‌سازی جداگانه استفاده می‌کند و هیچ تغییری در فاکتور/حسابداری نمی‌دهد.
 * ارسال عملیاتی تا زمان اتصال امن به سرویس سمت سرور فعال نیست.
 */
import { loadCommerceData, type CommercialInvoice, type AccountingParty } from './accounting-commerce';
import { toast } from './ui';
import { products } from './state';
import { TAX_SCHEMA_VERSION, validateV79SalePayload, serializeV79SaleDraft, type InvoiceKind, type V79SalePayload, type V79Payment } from './taxpayer-schema-v79';
import { jalaliDateTimeToUnixMs } from './taxpayer-v79-conversion';

type SendMethod = 'direct' | 'trusted';
interface TaxProfile {
  businessName: string;
  nationalId: string;
  economicCode: string;
  postalCode: string;
  taxMemoryId: string;
  sendMethod: SendMethod;
}
interface TaxProductMapping { productId: string; taxProductId: string; taxUnit: string; taxCategory: 'taxable' | 'exempt' | 'zero_rate'; exemptionReason: string; updatedAt: string; }
interface TaxInvoiceSnapshot {
  invoice: CommercialInvoice;
  buyer: Pick<AccountingParty, 'id' | 'name' | 'nationalId' | 'economicCode' | 'postalCode' | 'address'> | null;
  capturedAt: string;
}
interface TaxQueueItem {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  grossRial: number;
  createdAt: string;
  status: 'needs_review';
  issues: string[];
  snapshot?: TaxInvoiceSnapshot;
}
interface TaxModuleData { version: 3; profile: TaxProfile; queue: TaxQueueItem[]; productMappings: TaxProductMapping[]; }
interface InternalTaxPreview {
  documentKind: 'anbarin-taxpayer-internal-review';
  documentVersion: 1;
  isOfficialOrganizationPayload: false;
  generatedAt: string;
  source: { invoiceId: string; invoiceNumber: string; capturedAt: string };
  seller: TaxProfile;
  buyer: TaxInvoiceSnapshot['buyer'];
  invoice: { date: string; description: string; netRial: number; taxRial: number; grossRial: number; taxRateBps?: number };
  items: Array<{ description: string; quantityMilli: number; unitPriceRial: number; totalRial: number; discountRial: number; taxProductId: string; taxUnit: string; taxCategory: TaxProductMapping['taxCategory']; exemptionReason: string }> ;
}
const STORAGE_KEY = 'anbarin_taxpayer_module_v1';
const emptyProfile = (): TaxProfile => ({ businessName: '', nationalId: '', economicCode: '', postalCode: '', taxMemoryId: '', sendMethod: 'direct' });
const emptyData = (): TaxModuleData => ({ version: 3, profile: emptyProfile(), queue: [], productMappings: [] });
function readData(): TaxModuleData {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') as { version?: number; profile?: Partial<TaxProfile>; queue?: unknown[]; productMappings?: unknown[] } | null;
    if (!raw || ![1, 2, 3].includes(raw.version || 0) || !raw.profile || !Array.isArray(raw.queue)) return emptyData();
    // مهاجرت افزایشی: صف و تنظیمات قبلی حفظ می‌شوند؛ نگاشت‌ها در نسخه ۳ افزوده شده‌اند.
    const productMappings = Array.isArray(raw.productMappings) ? raw.productMappings.filter((x): x is TaxProductMapping => !!x && typeof x === 'object' && typeof (x as TaxProductMapping).productId === 'string' && typeof (x as TaxProductMapping).taxProductId === 'string') : [];
    return { version: 3, profile: { ...emptyProfile(), ...raw.profile }, queue: raw.queue.filter((x): x is TaxQueueItem => !!x && typeof x === 'object' && 'invoiceId' in x && typeof (x as { invoiceId?: unknown }).invoiceId === 'string'), productMappings };
  } catch { return emptyData(); }
}
function writeData(data: TaxModuleData): void { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]!));
const money = (v: number) => new Intl.NumberFormat('fa-IR').format(Math.round(v || 0));
function parseTaxRialInput(value: string | undefined, allowZero = false): number | undefined {
  if (!value?.trim()) return undefined;
  const normalized = value.replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))).replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).replace(/[٬,\s]/g, '');
  if (!/^\d+$/.test(normalized)) return undefined;
  const amount = Number(normalized);
  return Number.isSafeInteger(amount) && (allowZero ? amount >= 0 : amount > 0) ? amount : undefined;
}
function parseTaxRateInput(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined;
  const normalized = value.replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))).replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).replace(/[٬,]/g, '').replace('٫', '.');
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(normalized)) return undefined;
  const rate = Number(normalized);
  return Number.isFinite(rate) && rate >= 0 && rate <= 999.99 ? rate : undefined;
}
function readRowOtherTaxInputs(queue: HTMLElement, id: string, rowCount: number): V79RowOtherTaxInput[] {
  return Array.from({ length: rowCount }, (_, index) => {
    const get = (field: string) => queue.querySelector<HTMLInputElement>(`[data-tax-${field}="${CSS.escape(id)}-${index}"]`);
    const text = (field: string) => get(field)?.value.trim() || undefined;
    return {
      odt: text('odt'), odr: text('odr') ? (parseTaxRateInput(text('odr')) ?? Number.NaN) : undefined, odam: text('odam') ? (parseTaxRialInput(text('odam'), true) ?? Number.NaN) : undefined,
      olt: text('olt'), olr: text('olr') ? (parseTaxRateInput(text('olr')) ?? Number.NaN) : undefined, olam: text('olam') ? (parseTaxRialInput(text('olam'), true) ?? Number.NaN) : undefined,
    };
  });
}
function readPaymentInputs(queue: HTMLElement, id: string, count: number): V79PaymentInput[] {
  return Array.from({ length: count }, (_, index) => {
    const get = (field: string) => queue.querySelector<HTMLInputElement>(`[data-tax-pay-${field}="${CSS.escape(id)}-${index}"]`)?.value.trim() || '';
    const digits = (field: string) => get(field).replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))).replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
    const numeric = (field: string) => { const value = digits(field); return value ? (/^\d+$/.test(value) ? Number(value) : Number.NaN) : undefined; };
    return { trn: digits('trn') || undefined, pcn: digits('pcn') || undefined, pid: digits('pid') || undefined,
      pdt: numeric('pdt'), iinn: digits('iinn') || undefined, acn: digits('acn') || undefined, trmn: digits('trmn') || undefined };
  });
}

function invoiceIssues(invoice: CommercialInvoice, profile: TaxProfile, buyer: TaxInvoiceSnapshot['buyer'] | undefined, mappings: TaxProductMapping[] = []): string[] {
  const issues: string[] = [];
  if (!profile.businessName.trim()) issues.push('نام مؤدی/کسب‌وکار در تنظیمات ثبت نشده است.');
  if (!/^\d{10,11}$/.test(profile.nationalId.replace(/\D/g, ''))) issues.push('شناسه ملی/کد هویتی فروشنده باید بررسی شود.');
  if (!/^\d{10}$/.test(profile.postalCode.replace(/\D/g, ''))) issues.push('کد پستی فروشنده باید ۱۰ رقم باشد.');
  if (!profile.taxMemoryId.trim()) issues.push('شناسه یکتای حافظه مالیاتی ثبت نشده است.');
  if (!buyer) issues.push('طرف‌حساب خریدار به فاکتور متصل نیست.');
  else {
    if (!buyer.name.trim()) issues.push('نام خریدار ثبت نشده است.');
    if (buyer.nationalId && !/^\d{10,11}$/.test(buyer.nationalId.replace(/\D/g, ''))) issues.push('شناسه ملی/کد هویتی خریدار معتبر نیست.');
    if (buyer.postalCode && !/^\d{10}$/.test(buyer.postalCode.replace(/\D/g, ''))) issues.push('کد پستی خریدار باید ۱۰ رقم باشد.');
  }
  if (!invoice.date || !/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(invoice.date)) issues.push('تاریخ فاکتور معتبر نیست.');
  if (!invoice.lines.length) issues.push('فاکتور ردیف کالا/خدمت ندارد.');
  if (invoice.lines.some(line => !line.description.trim() || !Number.isFinite(line.quantityMilli) || line.quantityMilli <= 0 || !Number.isFinite(line.unitPriceRial) || line.unitPriceRial < 0)) issues.push('اطلاعات یک یا چند ردیف کالا/خدمت ناقص است.');
  if (invoice.lines.some(line => !line.unit?.trim())) issues.push('واحد اندازه‌گیری یک یا چند ردیف کالا/خدمت مشخص نشده است.');
  if (invoice.lines.some(line => !line.productId)) issues.push('یک یا چند ردیف فاکتور به کالای انبار متصل نیست.');
  if (invoice.lines.some(line => line.productId && !mappings.some(mapping => mapping.productId === line.productId && mapping.taxProductId.trim() && mapping.taxUnit.trim()))) issues.push('برای یک یا چند کالا، شناسه و واحد مالیاتی نگاشت نشده است.');
  if (invoice.lines.some(line => { const mapping = mappings.find(item => item.productId === line.productId); return mapping?.taxCategory === 'exempt' && !mapping.exemptionReason.trim(); })) issues.push('مبنای معافیت یک یا چند ردیف ثبت نشده است.');
  if (invoice.taxRateBps === undefined) issues.push('نرخ مالیات فاکتور مشخص نیست؛ نرخ/معافیت باید طبق الگوی مشمول بررسی شود.');
  if (invoice.taxRial < 0 || invoice.netRial < 0 || invoice.grossRial < 0) issues.push('مبالغ فاکتور نامعتبر است.');
  return issues;
}

function currentQueueIssues(item: TaxQueueItem, profile: TaxProfile, mappings: TaxProductMapping[]): string[] {
  if (!item.snapshot) return item.issues.length ? item.issues : ['این مورد snapshot ندارد و باید دوباره از فهرست فاکتورها بررسی شود.'];
  return invoiceIssues(item.snapshot.invoice, profile, item.snapshot.buyer ?? undefined, mappings);
}

function buildInternalPreview(item: TaxQueueItem, profile: TaxProfile, mappings: TaxProductMapping[]): InternalTaxPreview | null {
  if (!item.snapshot || currentQueueIssues(item, profile, mappings).length) return null;
  const invoice = item.snapshot.invoice;
  const mappedItems = invoice.lines.map(line => {
    const mapping = mappings.find(entry => entry.productId === line.productId);
    if (!mapping || !mapping.taxProductId.trim() || !mapping.taxUnit.trim()) return null;
    return {
      description: line.description, quantityMilli: line.quantityMilli, unitPriceRial: line.unitPriceRial,
      totalRial: line.totalRial, discountRial: Math.max(0, Math.round(line.discountRial || 0)),
      taxProductId: mapping.taxProductId, taxUnit: mapping.taxUnit, taxCategory: mapping.taxCategory,
      exemptionReason: mapping.exemptionReason || '',
    };
  });
  if (mappedItems.some(line => line === null)) return null;
  if (![invoice.netRial, invoice.taxRial, invoice.grossRial].every(value => Number.isSafeInteger(value) && value >= 0)) return null;
  return {
    documentKind: 'anbarin-taxpayer-internal-review', documentVersion: 1, isOfficialOrganizationPayload: false,
    generatedAt: new Date().toISOString(),
    source: { invoiceId: item.invoiceId, invoiceNumber: item.invoiceNumber, capturedAt: item.snapshot.capturedAt },
    seller: { ...profile }, buyer: item.snapshot.buyer,
    invoice: { date: invoice.date, description: invoice.description, netRial: invoice.netRial, taxRial: invoice.taxRial, grossRial: invoice.grossRial, taxRateBps: invoice.taxRateBps },
    items: mappedItems as NonNullable<(typeof mappedItems)[number]>[],
  };
}

type BuyerKind = 1 | 2 | 3 | 4;
interface V79RowOtherTaxInput { odt?: string; odr?: number; odam?: number; olt?: string; olr?: number; olam?: number; }
interface V79PaymentInput { trn?: string; pcn?: string; pid?: string; pdt?: number; iinn?: string; acn?: string; trmn?: string; }
interface V79DraftBuild { payload: V79SalePayload; issues: string[]; }
function buildV79SaleDraft(item: TaxQueueItem, profile: TaxProfile, mappings: TaxProductMapping[], kind: InvoiceKind, buyerKind?: BuyerKind, issuedTime?: string, cardPmt?: number, cashSettlement?: number, creditSettlement?: number, rowOtherTaxes: V79RowOtherTaxInput[] = [], paymentInputs: V79PaymentInput[] = []): V79DraftBuild | null {
  if (!item.snapshot) return null;
  const invoice = item.snapshot.invoice;
  const buyer = item.snapshot.buyer;
  const issues: string[] = [];
  const tins = profile.economicCode.replace(/\D/g, '');
  if (!tins) issues.push('شماره اقتصادی فروشنده برای header.tins ثبت نشده است.');
  if (!item.invoiceNumber.trim()) issues.push('شماره فاکتور داخلی برای header.inno موجود نیست.');
  if (kind === 1 && !buyerKind) issues.push('برای صورتحساب نوع اول، نوع شخص خریدار (tob) باید مشخص شود.');
  if (kind === 1 && !buyer) issues.push('برای صورتحساب نوع اول، اطلاعات خریدار در فاکتور موجود نیست.');
  const header: V79SalePayload['header'] = {
    inty: kind, inp: 1, ins: 1, tins, inno: item.invoiceNumber,
    tbill: Math.round(invoice.grossRial), tvam: Math.round(invoice.taxRial),
  };
  if (kind === 1 && buyerKind) {
    header.tob = buyerKind;
    if (buyer?.economicCode) header.tinb = buyer.economicCode.replace(/\D/g, '');
    if (buyer?.nationalId) header.bid = buyer.nationalId.replace(/\D/g, '');
    if ((buyerKind === 2 || buyerKind === 3) && !header.tinb)
      issues.push('برای خریدار حقوقی/مشارکت مدنی، شماره اقتصادی (tinb) لازم است.');
    if ((buyerKind === 1 || buyerKind === 4) && !header.tinb && !header.bid)
      issues.push('برای خریدار حقیقی/اتباع غیرایرانی، شماره اقتصادی یا شناسه هویتی لازم است.');
    if (buyer?.postalCode) header.bpc = buyer.postalCode.replace(/\D/g, '');
  }
  if (invoice.notes?.trim()) {
    if (invoice.notes.trim().length <= 30) header.nti1 = invoice.notes.trim();
    else issues.push('یادداشت فاکتور بیش از ۳۰ نویسه است و به nti1 منتقل نشد.');
  }
  const issuedAt = issuedTime ? jalaliDateTimeToUnixMs(invoice.date, issuedTime) : null;
  if (issuedAt !== null) header.indatim = issuedAt;

  const paymentParts = invoice.paymentParts || [];
  const paidParts = paymentParts.filter(part => part.method !== 'credit');
  const creditTotal = paymentParts.filter(part => part.method === 'credit').reduce((sum, part) => sum + part.amountRial, 0);
  const paidTotal = paidParts.reduce((sum, part) => sum + part.amountRial, 0);
  if (kind === 2) {
    header.setm = 1;
    if (creditTotal > 0) issues.push('طبق V7.9 کل مبلغ صورتحساب نوع دوم نقدی تلقی می‌شود؛ مانده اعتباری داخلی فاکتور با این قاعده سازگار نیست و باید پیش از استفاده اصلاح شود.');
  } else if (paymentParts.length) {
    header.setm = creditTotal > 0 ? (paidTotal > 0 ? 3 : 2) : 1;
    if (header.setm === 3) {
      // V7.9 §§8-23/8-24: final cap/insp equation is checked after body totals exist.
      // User-entered settlement values only; never infer them from gross payment parts.
      if (cashSettlement !== undefined) header.cap = cashSettlement;
      if (creditSettlement !== undefined) header.insp = creditSettlement;
      if (header.cap === undefined || header.insp === undefined)
        issues.push('برای تسویه ترکیبی، مبلغ cap و insp را وارد کنید.');
    }
  } else {
    issues.push('اطلاعات روش تسویه در فاکتور موجود نیست؛ setm باید مشخص شود.');
  }

  const payments: V79Payment[] = [];
  paidParts.forEach((part, index) => {
    let pmt: number | undefined;
    if (part.method === 'cash') pmt = 3; // وجه نقد
    else if (part.method === 'cheque') pmt = 1; // چک
    else if (part.method === 'card') {
      if ([4,5,6,7,8].includes(cardPmt || 0)) pmt = cardPmt;
      else issues.push(`پرداخت کارت در ردیف ${index + 1} مشخص نیست از طریق POS، درگاه، کارت‌به‌کارت، انتقال به حساب یا سایر بوده؛ کد pmt را انتخاب کنید.`);
    }
    if (pmt !== undefined) {
      const detail = paymentInputs[index] || {};
      payments.push({ pmt: pmt as V79Payment['pmt'], pv: Math.max(0, Math.round(part.amountRial)),
        ...(detail.trn ? { trn: detail.trn } : {}), ...(detail.pcn ? { pcn: detail.pcn } : {}),
        ...(detail.pid ? { pid: detail.pid } : {}), ...(detail.pdt !== undefined ? { pdt: detail.pdt } : {}),
        ...(detail.iinn ? { iinn: detail.iinn } : {}), ...(detail.acn ? { acn: detail.acn } : {}), ...(detail.trmn ? { trmn: detail.trmn } : {}) });
    }
  });
  const body: V79SalePayload['body'] = invoice.lines.map((line, index) => {
    const mapping = mappings.find(entry => entry.productId === line.productId);
    if (!mapping?.taxProductId.trim()) issues.push(`ردیف ${index + 1}: شناسه کالا/خدمت مالیاتی (sstid) موجود نیست.`);
    if (!mapping?.taxUnit.trim()) issues.push(`ردیف ${index + 1}: واحد مالیاتی (mu) موجود نیست.`);
    const dis = Math.max(0, Math.round(line.discountRial || 0));
    // buildInvoice stores totalRial after the line discount.
    const adis = Math.max(0, Math.round(line.totalRial));
    const prdis = adis + dis;
    const taxable = mapping?.taxCategory === 'taxable';
    const rate = taxable && invoice.taxRateBps !== undefined ? invoice.taxRateBps / 100 : 0;
    if (taxable && invoice.taxRateBps === undefined) issues.push(`ردیف ${index + 1}: نرخ مالیات مشخص نیست.`);
    const vam = taxable && invoice.taxRateBps !== undefined ? Math.round(adis * invoice.taxRateBps / 10000) : 0;
    const otherTax = rowOtherTaxes[index] || {};
    const odr = Number.isFinite(otherTax.odr) ? otherTax.odr : undefined; const olr = Number.isFinite(otherTax.olr) ? otherTax.olr : undefined;
    if (otherTax.odr !== undefined && odr === undefined) issues.push(`ردیف ${index + 1}: نرخ odr معتبر نیست.`);
    if (otherTax.olr !== undefined && olr === undefined) issues.push(`ردیف ${index + 1}: نرخ olr معتبر نیست.`);
    if (otherTax.odam !== undefined && (!Number.isSafeInteger(otherTax.odam) || otherTax.odam < 0)) issues.push(`ردیف ${index + 1}: مبلغ odam باید عدد صحیح نامنفی باشد.`);
    if (otherTax.olam !== undefined && (!Number.isSafeInteger(otherTax.olam) || otherTax.olam < 0)) issues.push(`ردیف ${index + 1}: مبلغ olam باید عدد صحیح نامنفی باشد.`);
    const odam = Number.isSafeInteger(otherTax.odam) && (otherTax.odam as number) >= 0 ? otherTax.odam as number : (odr !== undefined ? Math.round(adis * odr / 100) : 0);
    const olam = Number.isSafeInteger(otherTax.olam) && (otherTax.olam as number) >= 0 ? otherTax.olam as number : (olr !== undefined ? Math.round(adis * olr / 100) : 0);
    if (odr !== undefined && otherTax.odam !== undefined && Math.round(adis * odr / 100) !== otherTax.odam) issues.push(`ردیف ${index + 1}: مبلغ odam با نرخ odr و مبلغ پس از تخفیف تطبیق ندارد.`);
    if (olr !== undefined && otherTax.olam !== undefined && Math.round(adis * olr / 100) !== otherTax.olam) issues.push(`ردیف ${index + 1}: مبلغ olam با نرخ olr و مبلغ پس از تخفیف تطبیق ندارد.`);
    if (rate === 0 && (odam > 0 || olam > 0)) issues.push(`ردیف ${index + 1}: در نرخ مالیات بر ارزش افزوده صفر، مبلغ odam و olam باید صفر باشد.`);
    if (otherTax.odt && otherTax.odt.length > 255 || otherTax.olt && otherTax.olt.length > 255) issues.push(`ردیف ${index + 1}: شرح سایر مالیات/وجوه قانونی حداکثر ۲۵۵ نویسه است.`);
    if (mapping?.taxCategory === 'exempt' && !mapping.exemptionReason.trim())
      issues.push(`ردیف ${index + 1}: مبنای معافیت ثبت نشده است.`);
    return {
      sstid: mapping?.taxProductId || '', sstt: line.description,
      am: line.quantityMilli / 1000, mu: mapping?.taxUnit || '',
      fee: Math.max(0, Math.round(line.unitPriceRial)),
      prdis, dis, adis, vra: rate, vam, ...(otherTax.odt ? { odt: otherTax.odt } : {}), ...(odr !== undefined ? { odr } : {}), ...((otherTax.odam !== undefined || odr !== undefined || odam > 0) ? { odam } : {}), ...(otherTax.olt ? { olt: otherTax.olt } : {}), ...(olr !== undefined ? { olr } : {}), ...((otherTax.olam !== undefined || olr !== undefined || olam > 0) ? { olam } : {}), tsstam: adis + vam + odam + olam,
    };
  });
  // Header totals are derived from the exact body rows, never copied independently.
  header.tprdis = body.reduce((sum, row) => sum + row.prdis, 0);
  header.tdis = body.reduce((sum, row) => sum + row.dis, 0);
  header.tadis = body.reduce((sum, row) => sum + row.adis, 0);
  header.tvam = body.reduce((sum, row) => sum + row.vam, 0);
  const bodyTotal = body.reduce((sum, row) => sum + row.tsstam, 0);
  const declaredOtherTaxes = body.reduce((sum, row) => sum + (row.odam || 0) + (row.olam || 0), 0);
  header.todam = declaredOtherTaxes;
  header.tbill = bodyTotal;

  // V7.9 §§8-48/8-49/8-51: Os = Is + Ks + Ks2 + Ks3 (tsstam),
  // Vs = sum of discounted amounts (tadis), CPP = Os*C/Vs, VPP = Ks*C/Vs.
  // The general rule on page 23 requires truncation for rial amounts.
  const vs = header.tadis;
  const cashForShares = header.setm === 3 ? (header.cap ?? 0) : header.setm === 1 ? vs : 0;
  if (vs <= 0 && cashForShares > 0) issues.push('برای محاسبه cop و vop، مجموع مبلغ پس از تخفیف (Vs) باید بزرگ‌تر از صفر باشد.');
  for (const row of body) {
    const os = row.tsstam;
    row.cop = vs > 0 ? Math.trunc((os * cashForShares) / vs) : 0;
    row.vop = vs > 0 ? Math.trunc((row.vam * cashForShares) / vs) : 0;
  }
  header.tvop = body.reduce((sum, row) => sum + (row.vop || 0), 0);

  const payload: V79SalePayload = { header, body, ...(payments.length ? { payments } : {}) };
  const schemaIssues = validateV79SalePayload(payload);
  issues.push(...schemaIssues.map(issue => `${issue.path}: ${issue.message}`));
  const calculatedNet = body.reduce((sum, row) => sum + row.adis, 0);
  const calculatedTax = body.reduce((sum, row) => sum + row.vam, 0);
  if (calculatedNet !== invoice.netRial) issues.push(`جمع مبلغ پس از تخفیف ردیف‌ها (${calculatedNet}) با خالص فاکتور (${invoice.netRial}) برابر نیست.`);
  if (calculatedTax !== invoice.taxRial) issues.push(`مالیات محاسبه‌شده ردیف‌ها (${calculatedTax}) با مالیات ثبت‌شده فاکتور (${invoice.taxRial}) برابر نیست.`);
  return { payload, issues: [...new Set(issues)] };
}
function downloadV79Draft(item: TaxQueueItem, kind: InvoiceKind, buyerKind?: BuyerKind, issuedTime?: string, cardPmt?: number, cashSettlement?: number, creditSettlement?: number, rowOtherTaxes: V79RowOtherTaxInput[] = [], paymentInputs: V79PaymentInput[] = []): void {
  const current = readData();
  const freshItem = current.queue.find(entry => entry.id === item.id) || item;
  const built = buildV79SaleDraft(freshItem, current.profile, current.productMappings, kind, buyerKind, issuedTime, cardPmt, cashSettlement, creditSettlement, rowOtherTaxes, paymentInputs);
  if (!built) { toast('برای این فاکتور snapshot موجود نیست؛ آن را دوباره به صف اضافه کنید.', 'warning'); return; }
  // تفکیک گزارش برای بازبینی: موارد تاریخ/پرداخت هنوز نیازمند تکمیل‌اند؛
  // هیچ‌کدام از این موارد به‌عنوان مجوز ارسال یا تأیید سازمانی تفسیر نمی‌شوند.
  // indatim is mandatory in V7.9, so a missing issue time is blocking.
  const followUpWarnings: string[] = [];
  const blockingIssues = built.issues.filter(issue => !followUpWarnings.includes(issue));
  const itemNetRial = built.payload.body.reduce((sum, row) => sum + row.adis, 0);
  const itemTaxRial = built.payload.body.reduce((sum, row) => sum + row.vam, 0);
  const packageData = {
    documentKind: 'anbarin-local-taxpayer-draft',
    documentVersion: 2,
    schemaVersion: TAX_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    deliveryStatus: 'local_draft',
    officialSubmission: false,
    source: { invoiceId: freshItem.invoiceId, invoiceNumber: freshItem.invoiceNumber, invoiceDate: freshItem.invoiceDate, capturedAt: freshItem.snapshot?.capturedAt },
    validation: {
      valid: built.issues.length === 0,
      status: blockingIssues.length ? 'needs_correction' : followUpWarnings.length ? 'incomplete' : 'ready_for_manual_review',
      issueCount: built.issues.length,
      blockingIssues,
      followUpWarnings,
      issues: built.issues,
    },
    financialSummary: {
      currency: 'IRR',
      itemNetRial,
      itemTaxRial,
      invoiceNetRial: freshItem.snapshot?.invoice.netRial ?? null,
      invoiceTaxRial: freshItem.snapshot?.invoice.taxRial ?? null,
      invoiceGrossRial: freshItem.snapshot?.invoice.grossRial ?? null,
      netDifferenceRial: itemNetRial - (freshItem.snapshot?.invoice.netRial ?? 0),
      taxDifferenceRial: itemTaxRial - (freshItem.snapshot?.invoice.taxRial ?? 0),
    },
    payload: built.payload,
  };
  // Validate the exact payload again at the final export boundary and verify JSON round-trip.
  const payloadCheck = serializeV79SaleDraft(packageData.payload);
  if (!payloadCheck.json) {
    toast(`خروجی JSON ساخته نشد؛ ${payloadCheck.issues.length} خطای ساختاری وجود دارد.`, 'warning');
    return;
  }
  let packageJson: string;
  try {
    packageJson = JSON.stringify(packageData, null, 2);
    if (typeof packageJson !== 'string' || !packageJson.trim()) throw new Error('empty JSON');
    const restoredPackage = JSON.parse(packageJson) as typeof packageData;
    const restoredPayloadCheck = serializeV79SaleDraft(restoredPackage.payload);
    if (!restoredPayloadCheck.json) throw new Error('payload round-trip failed');
  } catch {
    toast('اعتبارسنجی نهایی JSON ناموفق بود؛ فایل دانلود نشد.', 'warning');
    return;
  }
  const blob = new Blob([packageJson], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = `anbarin-v79-type${kind}-${freshItem.invoiceNumber || freshItem.invoiceId}-draft.json`;
  document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
  toast(built.issues.length ? `پیش‌نویس دانلود شد: ${blockingIssues.length} مورد نیازمند اصلاح و ${followUpWarnings.length} مورد پیگیری؛ ارسال نشده است.` : 'پیش‌نویس ساختاری V7.9 دانلود شد؛ هنوز ارسال نشده است.', built.issues.length ? 'warning' : 'success');
}

function downloadInternalPreview(item: TaxQueueItem): void {
  const current = readData();
  const freshItem = current.queue.find(entry => entry.id === item.id) || item;
  const preview = buildInternalPreview(freshItem, current.profile, current.productMappings);
  if (!preview) { toast('پیش‌نویس ساخته نشد؛ ابتدا نواقص را برطرف و فاکتور را دوباره به صف اضافه کنید.', 'warning'); return; }
  const blob = new Blob([JSON.stringify(preview, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = `anbarin-tax-review-${item.invoiceNumber || item.invoiceId}.json`;
  document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
  toast('فایل پیش‌نویس داخلی دانلود شد؛ این فایل صورتحساب رسمی سازمان نیست.', 'success');
}

function render(): void {
  const host = document.getElementById('page-accounting');
  if (!host) return;
  let root = document.getElementById('taxpayerModuleCard');
  if (!root) {
    root = document.createElement('section');
    root.id = 'taxpayerModuleCard';
    root.className = 'card';
    root.style.marginTop = '12px';
    host.appendChild(root);
  }
  const data = readData();
  root.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
      <div><h2 style="margin:0">سامانه مؤدیان</h2><p class="hint" style="margin:4px 0 0">مدیریت مشخصات مالیاتی و آماده‌سازی صورتحساب‌های فروش</p></div>
      <span class="badge badge-warning">اتصال عملیاتی فعال نیست</span>
    </div>
    <details class="report-fold" open style="margin-top:12px">
      <summary>مشخصات مؤدی و حافظه مالیاتی</summary>
      <div class="form-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-top:8px">
        <label>نام مؤدی / کسب‌وکار<input class="search-input" id="taxBusinessName" value="${esc(data.profile.businessName)}" /></label>
        <label>شناسه ملی / کد هویتی<input class="search-input" id="taxNationalId" inputmode="numeric" value="${esc(data.profile.nationalId)}" /></label>
        <label>شماره اقتصادی<input class="search-input" id="taxEconomicCode" value="${esc(data.profile.economicCode)}" /></label>
        <label>کد پستی<input class="search-input" id="taxPostalCode" inputmode="numeric" value="${esc(data.profile.postalCode)}" /></label>
        <label>شناسه یکتای حافظه مالیاتی<input class="search-input" id="taxMemoryId" value="${esc(data.profile.taxMemoryId)}" /></label>
        <label>روش ارسال انتخاب‌شده در کارپوشه<select class="search-input" id="taxSendMethod"><option value="direct" ${data.profile.sendMethod === 'direct' ? 'selected' : ''}>ارسال مستقیم مؤدی</option><option value="trusted" ${data.profile.sendMethod === 'trusted' ? 'selected' : ''}>شرکت معتمد / سامانه دولتی</option></select></label>
      </div>
      <div class="actions" style="margin-top:10px"><button class="btn btn-primary btn-sm" id="taxSaveProfile" type="button">ذخیره مشخصات</button></div>
      <p class="hint">کلید خصوصی، توکن و رمزهای اتصال در این بخش یا مرورگر ذخیره نمی‌شوند؛ نگهداری و امضای امن باید در سرویس سمت سرور انجام شود. کد پستی فروشنده باید ۱۰ رقم باشد.</p>
    </details>
    <details class="report-fold" style="margin-top:8px">
      <summary>نگاشت کالاهای انبار به شناسه کالا/خدمت مالیاتی (${products.length})</summary>
      <p class="hint">برای هر کالا، شناسه رسمی را از فهرست معتبر سازمان وارد کنید. این بخش صرفاً نگاشت داخلی است و به‌تنهایی تأییدکننده شناسه یا نرخ مالیات نیست.</p>
      <div id="taxProductMappings" style="margin-top:8px"></div>
    </details>
    <details class="report-fold" open style="margin-top:8px">
      <summary>صورتحساب‌های فروش آماده بررسی</summary>
      <div id="taxInvoiceList" style="margin-top:8px"><p class="hint">در حال دریافت فاکتورها...</p></div>
    </details>
    <details class="report-fold" style="margin-top:8px">
      <summary>صف آماده‌سازی (${data.queue.length})</summary>
      <div id="taxQueueList" style="margin-top:8px"></div>
    </details>
    <p class="hint" style="margin-top:10px">خروجی V7.9 در این مرحله بسته پیش‌نویس محلی است: payload درون آن با header/body ساخته می‌شود و گزارش هشدارها جداگانه درج می‌شود؛ این بسته امضای دیجیتال یا ارسال محسوب نمی‌شود. هیچ فاکتوری به‌عنوان «ارسال‌شده» نمایش داده نمی‌شود.</p>`;
  root.querySelector('#taxSaveProfile')?.addEventListener('click', () => {
    const profile: TaxProfile = {
      businessName: (root!.querySelector('#taxBusinessName') as HTMLInputElement).value.trim(),
      nationalId: (root!.querySelector('#taxNationalId') as HTMLInputElement).value.trim(),
      economicCode: (root!.querySelector('#taxEconomicCode') as HTMLInputElement).value.trim(),
      postalCode: (root!.querySelector('#taxPostalCode') as HTMLInputElement).value.trim(),
      taxMemoryId: (root!.querySelector('#taxMemoryId') as HTMLInputElement).value.trim(),
      sendMethod: (root!.querySelector('#taxSendMethod') as HTMLSelectElement).value === 'trusted' ? 'trusted' : 'direct',
    };
    writeData({ ...readData(), profile }); toast('مشخصات مالیاتی ذخیره شد.', 'success'); render();
  });
  renderProductMappings(root, data);
  void renderInvoices(root, data);
}
function renderProductMappings(root: HTMLElement, data: TaxModuleData): void {
  const host = root.querySelector<HTMLElement>('#taxProductMappings');
  if (!host) return;
  const sorted = [...products].sort((a, b) => a.name.localeCompare(b.name, 'fa'));
  if (!sorted.length) { host.innerHTML = '<p class="hint">کالایی برای نگاشت وجود ندارد.</p>'; return; }
  host.innerHTML = sorted.map(product => {
    const mapping = data.productMappings.find(item => item.productId === product.id);
    return `<div class="tax-map-row">
      <label class="tax-map-name">${esc(product.name)}<input class="search-input" data-tax-id="${esc(product.id)}" value="${esc(mapping?.taxProductId || '')}" placeholder="شناسه کالا/خدمت" inputmode="numeric" /></label>
      <label>واحد<input class="search-input" data-tax-unit="${esc(product.id)}" value="${esc(mapping?.taxUnit || product.unit || '')}" placeholder="واحد" /></label>
      <label>وضعیت<select class="search-input" data-tax-category="${esc(product.id)}"><option value="taxable" ${!mapping || mapping.taxCategory === 'taxable' ? 'selected' : ''}>مشمول</option><option value="exempt" ${mapping?.taxCategory === 'exempt' ? 'selected' : ''}>معاف</option><option value="zero_rate" ${mapping?.taxCategory === 'zero_rate' ? 'selected' : ''}>نرخ صفر</option></select></label>
      <button class="btn btn-sm btn-secondary" type="button" data-tax-map-save="${esc(product.id)}">ذخیره</button>
      ${mapping?.taxCategory === 'exempt' ? `<label class="tax-map-reason">مبنای معافیت<input class="search-input" data-tax-reason="${esc(product.id)}" value="${esc(mapping.exemptionReason)}" placeholder="مستند/بند معافیت" /></label>` : ''}
    </div>`;
  }).join('');
  host.querySelectorAll<HTMLButtonElement>('[data-tax-map-save]').forEach(button => button.addEventListener('click', () => {
    const id = button.dataset.taxMapSave || '';
    const taxProductId = host.querySelector<HTMLInputElement>(`[data-tax-id="${CSS.escape(id)}"]`)?.value.trim() || '';
    const taxUnit = host.querySelector<HTMLInputElement>(`[data-tax-unit="${CSS.escape(id)}"]`)?.value.trim() || '';
    const taxCategory = host.querySelector<HTMLSelectElement>(`[data-tax-category="${CSS.escape(id)}"]`)?.value as TaxProductMapping['taxCategory'] || 'taxable';
    const exemptionReason = host.querySelector<HTMLInputElement>(`[data-tax-reason="${CSS.escape(id)}"]`)?.value.trim() || '';
    if (!taxProductId || !taxUnit) { toast('شناسه مالیاتی و واحد را وارد کنید.', 'warning'); return; }
    if (taxCategory === 'exempt' && !exemptionReason) { toast('مبنای معافیت را وارد کنید.', 'warning'); return; }
    const current = readData();
    current.productMappings = current.productMappings.filter(item => item.productId !== id);
    current.productMappings.push({ productId: id, taxProductId, taxUnit, taxCategory, exemptionReason, updatedAt: new Date().toISOString() });
    writeData(current); toast('نگاشت مالیاتی کالا ذخیره شد.', 'success'); render();
  }));
}
async function renderInvoices(root: HTMLElement, data: TaxModuleData): Promise<void> {
  const list = root.querySelector<HTMLElement>('#taxInvoiceList');
  const queue = root.querySelector<HTMLElement>('#taxQueueList');
  if (!list || !queue) return;
  try {
    const commerce = await loadCommerceData();
    const invoices = commerce.invoices.filter(i => i.type === 'sale' && i.status === 'posted').sort((a,b) => b.createdAt.localeCompare(a.createdAt));
    if (!invoices.length) list.innerHTML = '<p class="hint">فاکتور فروش قطعی‌شده‌ای برای بررسی وجود ندارد.</p>';
    else list.innerHTML = invoices.map(invoice => {
      const buyer = commerce.parties.find(p => p.id === invoice.partyId);
      const issues = invoiceIssues(invoice, data.profile, buyer, data.productMappings);
      const already = data.queue.some(item => item.invoiceId === invoice.id);
      return `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;padding:9px 0;border-bottom:1px solid var(--border)">
        <div><strong>فاکتور ${esc(invoice.number)}</strong><div class="hint">${esc(invoice.date)} · ${money(invoice.grossRial)} ریال · ${issues.length ? `${issues.length} مورد نیازمند بررسی` : 'بررسی اولیه تکمیل شد'}</div></div>
        <button type="button" class="btn btn-sm ${already ? 'btn-secondary' : 'btn-primary'}" data-tax-add="${esc(invoice.id)}" ${already ? 'disabled' : ''}>${already ? 'در صف ثبت شده' : 'افزودن به صف بررسی'}</button>
      </div>`;
    }).join('');
    list.querySelectorAll<HTMLButtonElement>('[data-tax-add]').forEach(button => button.addEventListener('click', () => {
      const invoice = invoices.find(i => i.id === button.dataset.taxAdd);
      if (!invoice) return;
      const current = readData();
      if (current.queue.some(x => x.invoiceId === invoice.id)) { toast('این فاکتور قبلاً به صف اضافه شده است.', 'warning'); return; }
      const buyer = commerce.parties.find(p => p.id === invoice.partyId);
      const issues = invoiceIssues(invoice, current.profile, buyer, current.productMappings);
      const capturedAt = new Date().toISOString();
      current.queue.unshift({ id: `tax_${Date.now().toString(36)}`, invoiceId: invoice.id, invoiceNumber: invoice.number, invoiceDate: invoice.date, grossRial: invoice.grossRial, createdAt: capturedAt, status: 'needs_review', issues, snapshot: { invoice: structuredClone(invoice), buyer: buyer ? { id: buyer.id, name: buyer.name, nationalId: buyer.nationalId, economicCode: buyer.economicCode, postalCode: buyer.postalCode, address: buyer.address } : null, capturedAt } });
      writeData(current); toast('فاکتور به صف بررسی داخلی اضافه شد؛ هنوز ارسال نشده است.', 'success'); render();
    }));
    const latest = readData();
    let queueChanged = false;
    latest.queue = latest.queue.map(item => {
      if (!item.snapshot) return item;
      const freshIssues = currentQueueIssues(item, latest.profile, latest.productMappings);
      if (JSON.stringify(freshIssues) !== JSON.stringify(item.issues)) queueChanged = true;
      return { ...item, issues: freshIssues };
    });
    if (queueChanged) writeData(latest);
    queue.innerHTML = latest.queue.length ? latest.queue.map(item => {
      const payments = (item.snapshot?.invoice.paymentParts || []).filter(part => part.method !== 'credit');
      const lines = item.snapshot?.invoice.lines || [];
      const paymentHtml = payments.map((part, index) => `
        <div class="tax-subcard">
          <div class="tax-subcard-title">پرداخت ${index + 1} · ${money(part.amountRial)} ریال</div>
          <div class="tax-field-grid tax-field-grid-pay">
            <label>مرجع trn<input class="search-input" data-tax-pay-trn="${esc(item.id)}-${index}" maxlength="14" inputmode="numeric" /></label>
            <label>کارت pcn<input class="search-input" data-tax-pay-pcn="${esc(item.id)}-${index}" maxlength="16" inputmode="numeric" /></label>
            <label>پرداخت‌کننده pid<input class="search-input" data-tax-pay-pid="${esc(item.id)}-${index}" maxlength="12" inputmode="numeric" /></label>
            <label>زمان pdt<input class="search-input" data-tax-pay-pdt="${esc(item.id)}-${index}" inputmode="numeric" placeholder="unix ms" /></label>
            <label>IIN<input class="search-input" data-tax-pay-iinn="${esc(item.id)}-${index}" maxlength="9" inputmode="numeric" /></label>
            <label>شبا/حساب acn<input class="search-input" data-tax-pay-acn="${esc(item.id)}-${index}" maxlength="16" inputmode="numeric" /></label>
            <label>پایانه trmn<input class="search-input" data-tax-pay-trmn="${esc(item.id)}-${index}" maxlength="8" inputmode="numeric" /></label>
          </div>
        </div>`).join('');
      const lineHtml = lines.map((line, index) => `
        <div class="tax-subcard">
          <div class="tax-subcard-title">${index + 1}. ${esc(line.description)}</div>
          <div class="tax-field-grid tax-field-grid-line">
            <label>موضوع odt<input class="search-input" data-tax-odt="${esc(item.id)}-${index}" maxlength="255" /></label>
            <label>نرخ odr %<input class="search-input" data-tax-odr="${esc(item.id)}-${index}" inputmode="decimal" /></label>
            <label>مبلغ odam<input class="search-input" data-tax-odam="${esc(item.id)}-${index}" inputmode="numeric" /></label>
            <label>موضوع olt<input class="search-input" data-tax-olt="${esc(item.id)}-${index}" maxlength="255" /></label>
            <label>نرخ olr %<input class="search-input" data-tax-olr="${esc(item.id)}-${index}" inputmode="decimal" /></label>
            <label>مبلغ olam<input class="search-input" data-tax-olam="${esc(item.id)}-${index}" inputmode="numeric" /></label>
          </div>
        </div>`).join('');
      const body = item.snapshot ? `
        <div class="hint">خریدار: ${esc(item.snapshot.buyer?.name || 'نامشخص')} · ${item.snapshot.invoice.lines.length} ردیف</div>
        <div class="tax-field-grid tax-field-grid-main">
          <label>نوع شخص خریدار<select class="search-input" data-tax-buyer-kind="${esc(item.id)}"><option value="">انتخاب</option><option value="1">حقیقی</option><option value="2">حقوقی</option><option value="3">مشارکت مدنی</option><option value="4">اتباع غیرایرانی</option></select></label>
          <label>ساعت صدور<input class="search-input" type="time" data-tax-issued-time="${esc(item.id)}" /></label>
          <label>کد پرداخت کارت<select class="search-input" data-tax-card-pmt="${esc(item.id)}"><option value="">—</option><option value="4">۴ POS</option><option value="5">۵ درگاه</option><option value="6">۶ کارت‌به‌کارت</option><option value="7">۷ انتقال</option><option value="8">۸ سایر</option></select></label>
          <label>نقدی cap (ترکیبی)<input class="search-input" type="text" inputmode="numeric" data-tax-cap="${esc(item.id)}" placeholder="ریال" /></label>
          <label>نسیه insp (ترکیبی)<input class="search-input" type="text" inputmode="numeric" data-tax-insp="${esc(item.id)}" placeholder="ریال" /></label>
        </div>
        ${payments.length ? `<div class="tax-section-label">جزئیات پرداخت</div>${paymentHtml}` : ''}
        ${lines.length ? `<details class="tax-fold"><summary>سایر مالیات/عوارض ردیف‌ها (اختیاری)</summary>${lineHtml}</details>` : ''}
        <div class="tax-actions">
          <button class="btn btn-sm btn-primary" type="button" data-tax-v79-type1="${esc(item.id)}">پیش‌نویس نوع اول</button>
          <button class="btn btn-sm btn-secondary" type="button" data-tax-v79-type2="${esc(item.id)}">پیش‌نویس نوع دوم</button>
        </div>
        <p class="hint tax-hint-compact">سایر مالیات/عوارض فقط در صورت شمول. cap/insp فقط برای تسویه ترکیبی و بدون حدس از مبلغ ناخالص. پرداخت اعتباری در تراکنش صادر نمی‌شود.</p>` : '<p class="hint">snapshot ندارد؛ از فهرست فاکتورها دوباره بررسی کنید.</p>';
      return `<div class="tax-queue-item">
        <div class="tax-queue-head"><strong>فاکتور ${esc(item.invoiceNumber)}</strong><span class="hint">${esc(item.invoiceDate)} · ${money(item.grossRial)} ریال · ارسال نشده</span></div>
        ${body}
        ${item.issues.length ? `<ul class="hint tax-issues">${item.issues.map(issue => `<li>${esc(issue)}</li>`).join('')}</ul>` : '<p class="hint">آماده دریافت پیش‌نویس داخلی</p>'}
        <div class="tax-actions">
          ${item.snapshot && !item.issues.length ? `<button class="btn btn-sm btn-primary" type="button" data-tax-preview="${esc(item.id)}">دانلود JSON داخلی</button>` : ''}
          <button class="btn btn-sm btn-secondary" type="button" data-tax-remove="${esc(item.id)}">حذف از صف</button>
        </div>
      </div>`;
    }).join('') : '<p class="hint">صف بررسی خالی است.</p>';
    queue.querySelectorAll<HTMLButtonElement>('[data-tax-v79-type1]').forEach(button => button.addEventListener('click', () => {
      const item = readData().queue.find(entry => entry.id === button.dataset.taxV79Type1);
      const id = button.dataset.taxV79Type1 || '';
      const selected = queue.querySelector<HTMLSelectElement>(`[data-tax-buyer-kind="${CSS.escape(id)}"]`)?.value;
      const issuedTime = queue.querySelector<HTMLInputElement>(`[data-tax-issued-time="${CSS.escape(id)}"]`)?.value;
      const cardPmtValue = queue.querySelector<HTMLSelectElement>(`[data-tax-card-pmt="${CSS.escape(id)}"]`)?.value;
      const capValue = parseTaxRialInput(queue.querySelector<HTMLInputElement>(`[data-tax-cap="${CSS.escape(id)}"]`)?.value);
      const inspValue = parseTaxRialInput(queue.querySelector<HTMLInputElement>(`[data-tax-insp="${CSS.escape(id)}"]`)?.value);
      if (!item) return;
      const rowTaxes = readRowOtherTaxInputs(queue, id, item.snapshot?.invoice.lines.length || 0);
      const paymentInputs = readPaymentInputs(queue, id, (item.snapshot?.invoice.paymentParts || []).filter(part => part.method !== 'credit').length);
      downloadV79Draft(item, 1, selected ? Number(selected) as BuyerKind : undefined, issuedTime || undefined, cardPmtValue ? Number(cardPmtValue) : undefined, capValue, inspValue, rowTaxes, paymentInputs);
    }));
    queue.querySelectorAll<HTMLButtonElement>('[data-tax-v79-type2]').forEach(button => button.addEventListener('click', () => {
      const id = button.dataset.taxV79Type2 || '';
      const item = readData().queue.find(entry => entry.id === id);
      const issuedTime = queue.querySelector<HTMLInputElement>(`[data-tax-issued-time="${CSS.escape(id)}"]`)?.value;
      const cardPmtValue = queue.querySelector<HTMLSelectElement>(`[data-tax-card-pmt="${CSS.escape(id)}"]`)?.value;
      const capValue = parseTaxRialInput(queue.querySelector<HTMLInputElement>(`[data-tax-cap="${CSS.escape(id)}"]`)?.value);
      const inspValue = parseTaxRialInput(queue.querySelector<HTMLInputElement>(`[data-tax-insp="${CSS.escape(id)}"]`)?.value);
      if (item) { const rowTaxes = readRowOtherTaxInputs(queue, id, item.snapshot?.invoice.lines.length || 0); const paymentInputs = readPaymentInputs(queue, id, (item.snapshot?.invoice.paymentParts || []).filter(part => part.method !== 'credit').length); downloadV79Draft(item, 2, undefined, issuedTime || undefined, cardPmtValue ? Number(cardPmtValue) : undefined, capValue, inspValue, rowTaxes, paymentInputs); }
    }));
    queue.querySelectorAll<HTMLButtonElement>('[data-tax-preview]').forEach(button => button.addEventListener('click', () => {
      const item = readData().queue.find(entry => entry.id === button.dataset.taxPreview);
      if (item) downloadInternalPreview(item);
    }));
    queue.querySelectorAll<HTMLButtonElement>('[data-tax-remove]').forEach(button => button.addEventListener('click', () => {
      const current = readData(); current.queue = current.queue.filter(item => item.id !== button.dataset.taxRemove); writeData(current); render();
    }));
  } catch (error) {
    console.error('taxpayer invoice list failed', error);
    list.innerHTML = '<p class="hint">دریافت فاکتورها ناموفق بود. اطلاعات حسابداری تغییر نکرده است.</p>';
  }
}
export function initTaxpayerUI(): void { render(); }
