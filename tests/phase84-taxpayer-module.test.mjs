import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const taxpayer = readFileSync(new URL('../src/modules/taxpayer.ts', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const commerce = readFileSync(new URL('../src/modules/accounting-commerce.ts', import.meta.url), 'utf8');

test('taxpayer module is initialized independently after existing accounting modules', () => {
  assert.match(main, /import \{ initTaxpayerUI \} from '\.\/modules\/taxpayer'/);
  assert.match(main, /await initAccountingReportsUI\(\);\s*initTaxpayerUI\(\);/);
});

test('taxpayer settings and review queue use an isolated versioned storage key', () => {
  assert.match(taxpayer, /anbarin_taxpayer_module_v1/);
  assert.match(taxpayer, /interface TaxModuleData \{ version: 3;/);
  assert.match(taxpayer, /!\[1, 2, 3\]\.includes\(raw\.version \\|\\| 0\)/);
  assert.match(taxpayer, /productMappings/);
  assert.match(taxpayer, /snapshot: \{ invoice: structuredClone\(invoice\), buyer:/);
  assert.match(taxpayer, /localStorage\.getItem\(STORAGE_KEY/);
  assert.match(taxpayer, /localStorage\.setItem\(STORAGE_KEY/);
});

test('only posted sales invoices enter the review list; no existing invoice is mutated', () => {
  assert.match(taxpayer, /i\.type === 'sale' && i\.status === 'posted'/);
  assert.match(taxpayer, /status: 'needs_review'/);
  assert.match(taxpayer, /برای یک یا چند کالا، شناسه و واحد مالیاتی نگاشت نشده است/);
  assert.match(taxpayer, /مبنای معافیت یک یا چند ردیف ثبت نشده است/);
  assert.match(taxpayer, /کد پستی فروشنده باید ۱۰ رقم باشد/);
  assert.match(taxpayer, /طرف‌حساب خریدار به فاکتور متصل نیست/);
  assert.match(taxpayer, /await loadCommerceData\(\)/);
  assert.doesNotMatch(taxpayer, /saveCommerceData|postInvoice|updateDraftInvoice/);
  assert.match(commerce, /export async function loadCommerceData/);
});

test('UI explicitly prevents claiming that local review is a successful tax submission', () => {
  assert.match(taxpayer, /اتصال عملیاتی فعال نیست/);
  assert.match(taxpayer, /هیچ فاکتوری به‌عنوان «ارسال‌شده» نمایش داده نمی‌شود/);
  assert.match(taxpayer, /کلید خصوصی، توکن و رمزهای اتصال/);
});


test('phase 3 keeps tax product mappings isolated and validates missing mappings and exemptions', () => {
  assert.match(taxpayer, /interface TaxProductMapping/);
  assert.match(taxpayer, /data-tax-map-save/);
  assert.match(taxpayer, /taxProductId/);
  assert.match(taxpayer, /taxUnit/);
  assert.match(taxpayer, /taxCategory/);
  assert.match(taxpayer, /مبنای معافیت یک یا چند ردیف ثبت نشده است/);
  assert.match(taxpayer, /return \{ version: 3/);
  assert.doesNotMatch(taxpayer, /saveCommerceData|postInvoice|updateDraftInvoice/);
});
