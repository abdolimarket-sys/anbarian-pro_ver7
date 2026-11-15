# افزونه دفتر ثبت ارسال سامانه مؤدیان انبارین (فاز ۲۱)

این افزونه **دفتر ثبت ارسال سمت سرور** را با ذخیره‌سازی پایدار، قید یکتایی برای جلوگیری از ثبت تکراری، API بازیابی وضعیت و کنترل انتقال وضعیت‌ها فراهم می‌کند.

**ارسال واقعی به سامانه مؤدیان تا تأیید پروتکل رسمی و اتصال امن غیرفعال است.** این افزونه هیچ endpoint رسمی سازمان، امضا، رمزنگاری یا درخواست شبکه‌ای به سازمان امور مالیاتی را اجرا نمی‌کند.

## نصب

1. پوشه `anbarin-taxpayer-submission-ledger` را در `wp-content/plugins/` قرار دهید.
2. از پیشخوان WordPress افزونه «Anbarin Taxpayer Submission Ledger» را فعال کنید (جدول با `dbDelta` ساخته می‌شود).
3. سایت را فقط با HTTPS در دسترس قرار دهید.
4. درخواست‌ها باید با احراز هویت استاندارد REST وردپرس ارسال شوند: نشست مدیر همراه REST nonce، یا Application Password اختصاصی مدیر از یک سرویس سمت سرور. **Application Password را داخل برنامه موبایل/وب عمومی قرار ندهید.**

## مدل داده

هر رکورد شامل:

- `record_id` — شناسه سمت کلاینت
- `invoice_reference` — مرجع فاکتور
- `idempotency_key` — کلید یکتای جلوگیری از تکرار (۱۲–۱۲۸ نویسه)
- `environment` — `sandbox` یا `production`
- `state` — یکی از: `ready` | `submitting` | `accepted` | `rejected` | `unknown`
- `tracking_id` — شناسه پیگیری (در صورت پذیرش)
- `last_message` — آخرین پیام کوتاه (بدون payload)
- `events` — لیست محدود رویدادهای ممیزی (`prepared`, `submission_started`, `accepted`, `rejected`, `unknown`, `status_checked`)
- زمان‌های ایجاد و به‌روزرسانی

**قید یکتایی:** `UNIQUE (environment, idempotency_key)` در سطح پایگاه‌داده. هیچ payload صورتحساب، کلید خصوصی، توکن یا راز در این جدول ذخیره نمی‌شود.

## ماشین حالت (مطابق فاز ۲۰)

| وضعیت فعلی | وضعیت‌های مجاز بعدی |
|------------|---------------------|
| ready      | submitting          |
| submitting | accepted, rejected, unknown |
| accepted   | (نهایی)             |
| rejected   | (نهایی)             |
| unknown    | accepted, rejected, unknown |

- بازگشت از `accepted` / `rejected` به `submitting` مجاز نیست.
- برای رفتن به `accepted` شناسه پیگیری الزامی است.
- وضعیت `unknown` فقط با استعلام شناسه پیگیری موجود (از طریق PATCH با `statusChecked`) رفع می‌شود؛ ارسال مجدد انجام نمی‌شود.

## API

پایه: `/wp-json/anbarin/v1/taxpayer/submissions`

### رزرو رکورد (اتمی)

`POST /taxpayer/submissions`

بدنه JSON:

```json
{
  "id": "record-uuid-or-id",
  "invoiceReference": "INV-1404-001",
  "idempotencyKey": "idem-key-00000001",
  "environment": "sandbox"
}
```

- موفقیت ایجاد: `201` با `created: true` و `record`
- کلید تکراری: `200` با `created: false` و `issues[].code = duplicate_idempotency_key` (رکورد موجود برگردانده می‌شود)

### بازیابی وضعیت

`GET /taxpayer/submissions?environment=sandbox&idempotencyKey=idem-key-00000001`

- موفقیت: `200` با `record`
- یافت نشد: `404`

### انتقال وضعیت

`PATCH /taxpayer/submissions`

بدنه JSON:

```json
{
  "environment": "sandbox",
  "idempotencyKey": "idem-key-00000001",
  "state": "submitting",
  "trackingId": null,
  "message": "اختیاری",
  "statusChecked": false
}
```

- انتقال نامعتبر: `409` با کد `anbarin_ledger_invalid_transition`
- پذیرفته‌شده بدون trackingId: `400`
- در پاسخ همیشه `submissionDisabled: true` است تا مشخص باشد ارسال واقعی انجام نشده.

### فهرست (متادیتا)

`GET /taxpayer/submissions/list?limit=30&environment=sandbox&state=unknown`

رویدادهای کامل در این فهرست برنمی‌گردند.

## محدودیت‌ها و پیش‌نیاز اتصال واقعی

- این فاز فقط دفتر ثبت و کنترل وضعیت سمت سرور را پیاده‌سازی می‌کند.
- آداپتور ارسال واقعی، endpoint رسمی سازمان، امضا و رمزنگاری عمداً پیاده‌سازی نشده‌اند.
- تا دریافت مستندات رسمی جاری، پیاده‌سازی backend امن گواهی/کلید، آزمون sandbox و تأیید مالک سامانه، ارسال عملیاتی فعال نمی‌شود.
- برنامه کلاینت فعلی هنوز به‌صورت خودکار به این افزونه متصل نیست؛ برای اتصال باید روش احراز هویت مناسب زیرساخت میزبانی طراحی شود و اعتبار مدیر WordPress در کلاینت عمومی جاسازی نشود.

## حفاظت داده

- دسترسی فقط برای `manage_options`.
- پاسخ‌ها با هدر `no-store` از کش منع می‌شوند.
- مدیر باید سیاست نگهداری، پشتیبان‌گیری و دسترسی پایگاه‌داده را مانند سایر داده‌های مالی تعیین کند.
