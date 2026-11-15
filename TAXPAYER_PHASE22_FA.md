# فاز ۲۲ — آداپتور کلاینت دفتر ثبت ارسال سمت سرور

## هدف
اتصال قرارداد `TaxLedgerRepository` فاز ۲۰ به API پایدار فاز ۲۱ از طریق آداپتور HTTP امن، بدون فعال‌سازی ارسال واقعی به سامانه مؤدیان.

## تغییرات
- افزودن ماژول `taxpayer-ledger-server.ts`:
  - `createWordPressTaxLedgerRepository` پیاده‌سازی `reserve` / `getByKey` / `save` روی REST افزونه WordPress.
  - `validateTaxLedgerServerConfig` برای اجبار HTTPS و وجود تابع احراز هویت.
- `reserve` از `POST /anbarin/v1/taxpayer/submissions` استفاده می‌کند و در صورت کلید تکراری `created: false` برمی‌گرداند.
- `getByKey` از `GET` با `environment` و `idempotencyKey` وضعیت را می‌خواند.
- `save` از `PATCH` برای انتقال کنترل‌شده وضعیت استفاده می‌کند؛ رویدادهای ممیزی روی سرور ساخته می‌شوند.
- هیچ payload صورتحساب، کلید خصوصی، توکن یا Application Password در ماژول هاردکد نمی‌شود؛ احراز هویت فقط از طریق `getAuthHeaders` تزریقی است.

## محدودیت‌ها
- این فاز فقط پل کلاینت↔دفتر ثبت سرور است.
- `TaxConnectionAdapter.submit` و ارسال واقعی به سازمان همچنان تا تأیید پروتکل رسمی و backend امن غیرفعال می‌مانند.
- Application Password یا نشست مدیر نباید داخل اپ موبایل/وب عمومی قرار گیرد؛ فقط سرویس واسط امن مجاز است.
- تا زمان پیکربندی `baseUrl` و `getAuthHeaders` معتبر، repository سمت سرور در runtime استفاده نمی‌شود.

## نحوه استفاده (نمونه)

```ts
import { createWordPressTaxLedgerRepository, validateTaxLedgerServerConfig } from './taxpayer-ledger-server';
import { reserveTaxSubmission, createTaxLedgerRecord } from './taxpayer-submission-ledger';

const config = {
  baseUrl: 'https://example.com',
  getAuthHeaders: async () => ({ Authorization: 'Basic …' }), // فقط از سرویس واسط امن
};
const issues = validateTaxLedgerServerConfig(config);
if (issues.length) { /* نمایش خطا و توقف */ }

const repo = createWordPressTaxLedgerRepository(config);
const record = createTaxLedgerRecord({
  id: '…', invoiceReference: 'INV-1', idempotencyKey: 'idem-key-00000001', environment: 'sandbox',
});
const reserved = await reserveTaxSubmission(repo, record);
```

## آزمون پیشنهادی
- mock کردن `fetch` برای:
  - رزرو موفق و رزرو تکراری
  - GET وضعیت موجود / 404
  - PATCH انتقال معتبر و انتقال نامعتبر (409)
- اطمینان از ارسال نشدن فیلدهای payload / privateKey / secret در body درخواست‌ها.
- رد شدن `baseUrl` غیر HTTPS در `validateTaxLedgerServerConfig`.

## مسیر فایل‌ها
- `src/modules/taxpayer-ledger-server.ts`
- `TAXPAYER_PHASE22_FA.md`
