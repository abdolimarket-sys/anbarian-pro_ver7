# فاز ۲۱ — دفتر ثبت ارسال سمت سرور

## هدف
پیاده‌سازی دفتر ثبت ارسال (Submission Ledger) در سمت سرور با ذخیره‌سازی پایدار، قید یکتایی برای جلوگیری از ثبت تکراری، API بازیابی وضعیت و کنترل انتقال وضعیت‌ها. ارسال واقعی به سامانه مؤدیان همچنان تا تأیید پروتکل رسمی غیرفعال می‌ماند.

## تغییرات
- افزودن افزونه WordPress `anbarin-taxpayer-submission-ledger` در مسیر `server/wordpress-plugin/`.
- جدول پایدار با قید `UNIQUE (environment, idempotency_key)` در سطح پایگاه‌داده برای رزرو اتمیک.
- APIهای REST:
  - `POST /anbarin/v1/taxpayer/submissions` — رزرو رکورد (اتمی؛ در صورت تکراری بودن کلید، رکورد موجود برگردانده می‌شود).
  - `GET /anbarin/v1/taxpayer/submissions` — بازیابی وضعیت با `environment` و `idempotencyKey`.
  - `PATCH /anbarin/v1/taxpayer/submissions` — انتقال کنترل‌شده وضعیت مطابق ماشین حالت فاز ۲۰.
  - `GET /anbarin/v1/taxpayer/submissions/list` — فهرست متادیتای رکوردها.
- ماشین حالت یکسان با ماژول کلاینت فاز ۲۰:
  - `ready` → `submitting` → `accepted` | `rejected` | `unknown`
  - `unknown` فقط به `accepted` / `rejected` / `unknown` (از طریق استعلام)
  - وضعیت‌های نهایی قابل بازگشت به ارسال نیستند.
- الزام شناسه پیگیری برای وضعیت `accepted`.
- ذخیره فقط متادیتا و رویدادهای ممیزی پاک‌سازی‌شده؛ هیچ payload صورتحساب، کلید خصوصی، توکن یا راز ذخیره نمی‌شود.
- هدرهای `no-store` و محدودیت دسترسی به `manage_options`.

## محدودیت و پیش‌نیاز
- این فاز repository سمت سرور و API کنترل وضعیت را فراهم می‌کند؛ endpoint رسمی سازمان، امضا، رمزنگاری و ارسال واقعی را پیاده‌سازی نمی‌کند.
- فیلد `submissionDisabled: true` در پاسخ انتقال وضعیت صریحاً اعلام می‌کند که ارسال انجام نشده است.
- اتصال کلاینت به این افزونه نیازمند طراحی احراز هویت مناسب (مثلاً Application Password فقط در سرویس واسط امن) است؛ اعتبار مدیر نباید در اپ عمومی قرار گیرد.
- تا زمان دریافت مستندات رسمی جاری، آزمون sandbox و تأیید امنیت، ارسال عملیاتی فعال نمی‌شود.

## هم‌خوانی با فاز ۲۰
- قرارداد `TaxLedgerRepository` (reserve / getByKey / save) و توابع `reserveTaxSubmission`، `transitionTaxLedgerRecord` و `reconcileUnknownTaxSubmission` بدون تغییر باقی می‌مانند.
- پیاده‌سازی حافظه‌ای/مرورگری برای production کافی نیست؛ این فاز همان قرارداد را در سرور با قید یکتایی واقعی اجرا می‌کند.

## آزمون پیشنهادی
- رزرو دو بار با یک idempotencyKey → بار دوم `created: false` و همان رکورد.
- انتقال `ready` → `submitting` → `accepted` با trackingId معتبر.
- تلاش برای `accepted` بدون trackingId → خطا.
- تلاش برای `accepted` → `submitting` → خطای انتقال نامعتبر.
- GET وضعیت پس از انتقال و تطبیق state و events.
- اطمینان از نبود فیلدهای payload / privateKey / token / secret در ردیف ذخیره‌شده.

## مسیر فایل‌ها
- `server/wordpress-plugin/anbarin-taxpayer-submission-ledger/anbarin-taxpayer-submission-ledger.php`
- `server/wordpress-plugin/anbarin-taxpayer-submission-ledger/README_FA.md`
- `TAXPAYER_PHASE21_FA.md`
