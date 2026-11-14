/** ماژول مستقل آماده‌سازی و پیگیری صورتحساب‌های سامانه مؤدیان.
 * عمداً از ذخیره‌سازی جداگانه استفاده می‌کند و هیچ تغییری در فاکتور/حسابداری نمی‌دهد.
 * ارسال عملیاتی تا زمان اتصال امن به سرویس سمت سرور فعال نیست.
 */
import { loadCommerceData, type CommercialInvoice, type AccountingParty } from './accounting-commerce';
import { toast } from './ui';
import { products } from './state';

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
      <div class="form-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:8px;margin-top:10px">
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
    <p class="hint" style="margin-top:10px">فایل قابل دانلود این مرحله فقط پیش‌نویس داخلی برای بازبینی است و قالب رسمی سازمان، امضای دیجیتال یا ارسال محسوب نمی‌شود. هیچ فاکتوری به‌عنوان «ارسال‌شده» نمایش داده نمی‌شود.</p>`;
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
    return `<div style="display:grid;grid-template-columns:minmax(130px,1fr) minmax(130px,1fr) minmax(100px,.7fr) auto;gap:7px;align-items:end;padding:8px 0;border-bottom:1px solid var(--border)">
      <label>${esc(product.name)}<input class="search-input" data-tax-id="${esc(product.id)}" value="${esc(mapping?.taxProductId || '')}" placeholder="شناسه کالا/خدمت" inputmode="numeric" /></label>
      <label>واحد مالیاتی<input class="search-input" data-tax-unit="${esc(product.id)}" value="${esc(mapping?.taxUnit || product.unit || '')}" placeholder="واحد" /></label>
      <label>وضعیت<select class="search-input" data-tax-category="${esc(product.id)}"><option value="taxable" ${!mapping || mapping.taxCategory === 'taxable' ? 'selected' : ''}>مشمول</option><option value="exempt" ${mapping?.taxCategory === 'exempt' ? 'selected' : ''}>معاف</option><option value="zero_rate" ${mapping?.taxCategory === 'zero_rate' ? 'selected' : ''}>نرخ صفر</option></select></label>
      <button class="btn btn-sm btn-secondary" type="button" data-tax-map-save="${esc(product.id)}">ذخیره</button>
      ${mapping?.taxCategory === 'exempt' ? `<label style="grid-column:1/-1">مبنای معافیت<input class="search-input" data-tax-reason="${esc(product.id)}" value="${esc(mapping.exemptionReason)}" placeholder="مستند/بند معافیت" /></label>` : ''}
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
    queue.innerHTML = latest.queue.length ? latest.queue.map(item => `<div style="padding:9px 0;border-bottom:1px solid var(--border)"><strong>فاکتور ${esc(item.invoiceNumber)}</strong><div class="hint">${esc(item.invoiceDate)} · ${money(item.grossRial)} ریال · نیازمند بررسی / ارسال نشده</div>${item.snapshot ? `<div class="hint">خریدار: ${esc(item.snapshot.buyer?.name || 'نامشخص')} · ${item.snapshot.invoice.lines.length} ردیف · نسخه اطلاعات ثبت‌شده: ${esc(item.snapshot.capturedAt)}</div>` : '<p class="hint">این مورد از نسخه قبلی مهاجرت شده و snapshot ندارد؛ برای تهیه نسخه جدید، از فهرست فاکتورها دوباره بررسی شود.</p>'}${item.issues.length ? `<ul class="hint">${item.issues.map(issue => `<li>${esc(issue)}</li>`).join('')}</ul>` : '<p class="hint">اعتبارسنجی با آخرین مشخصات مؤدی و نگاشت کالاها به‌روز شده است؛ فایل پیش‌نویس داخلی قابل دریافت است.</p>'}${item.snapshot && !item.issues.length ? `<button class="btn btn-sm btn-primary" type="button" data-tax-preview="${esc(item.id)}">دانلود پیش‌نویس داخلی JSON</button>` : ''} <button class="btn btn-sm btn-secondary" type="button" data-tax-remove="${esc(item.id)}">حذف از صف</button></div>`).join('') : '<p class="hint">صف بررسی خالی است.</p>';
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
