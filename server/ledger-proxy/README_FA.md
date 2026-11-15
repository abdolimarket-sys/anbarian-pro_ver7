# سرویس واسط امن دفتر ثبت ارسال (فاز ۲۳)

این سرویس بین **اپ انبارین** و **افزونه WordPress دفتر ثبت (فاز ۲۱)** قرار می‌گیرد تا Application Password مدیر هرگز داخل اپ عمومی نرود.

## چه کار می‌کند

- پروکسی امن برای:
  - `POST /v1/submissions` — رزرو رکورد
  - `GET /v1/submissions` — بازیابی وضعیت
  - `PATCH /v1/submissions` — انتقال وضعیت
  - `GET /v1/submissions/list` — فهرست متادیتا
- احراز هویت کلاینت با `X-Api-Key` یا `Authorization: Bearer <CLIENT_API_KEY>`
- احراز هویت وردپرس با Application Password فقط در حافظه/محیط این سرویس
- پاک‌سازی body: فقط فیلدهای هویت و وضعیت؛ بدون payload صورتحساب
- در همه پاسخ‌ها `submissionDisabled: true`

## چه کار نمی‌کند

- ارسال به سامانه مؤدیان / سازمان امور مالیاتی
- ذخیره payload، کلید خصوصی، یا توکن سازمان
- قرار دادن رمز مدیر در کلاینت

## پیش‌نیاز

1. افزونه فاز ۲۱ روی وردپرس فعال باشد.
2. Application Password برای یک کاربر با `manage_options` ساخته شده باشد.
3. Node.js 18+ (برای `fetch` داخلی).

## اجرا

```bash
cd server/ledger-proxy
cp .env.example .env
# مقادیر را ویرایش کنید

export $(grep -v '^#' .env | xargs)
node server.mjs
```

سلامت:

```bash
curl -s http://127.0.0.1:8787/health
```

نمونه رزرو (از سرویس واسط امن، نه از اپ خام):

```bash
curl -s -X POST http://127.0.0.1:8787/v1/submissions \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: $CLIENT_API_KEY" \
  -d '{"id":"rec-1","invoiceReference":"INV-1","idempotencyKey":"idem-key-00000001","environment":"sandbox"}'
```

## اتصال از کلاینت (فاز ۲۲)

`baseUrl` را به نشانی **این سرویس واسط** بدهید (نه مستقیم به وردپرس). مسیرهای سازگار با فاز ۲۲ حفظ شده‌اند (`/wp-json/anbarin/v1/taxpayer/submissions`)، بنابراین نیازی به تغییر `apiPrefix` نیست:

```ts
createWordPressTaxLedgerRepository({
  baseUrl: 'https://proxy.example.com', // reverse-proxy HTTPS به این سرویس
  getAuthHeaders: () => ({ 'X-Api-Key': loadedFromSecureConfig }), // نه هاردکد در باینری عمومی
})
```

مسیر کوتاه `/v1/submissions` هم پشتیبانی می‌شود. API Key را داخل اپ عمومی سخت‌کد نکنید؛ از کانفیگ نصب/سرور فروشنده تأمین شود. سرویس را پشت HTTPS و در صورت امکان فقط شبکه خصوصی قرار دهید.

## استقرار پیشنهادی

- فقط `127.0.0.1` یا شبکه خصوصی گوش دهد؛ از طریق reverse proxy (Caddy/Nginx) با HTTPS منتشر شود.
- `CLIENT_API_KEY` حداقل ۲۴ نویسه تصادفی؛ چرخش دوره‌ای.
- لاگ‌ها فقط متادیتا دارند؛ body و رمز در لاگ نیست.
- وردپرس و این سرویس هر دو فقط HTTPS.

## محدودیت‌ها

- این فاز زیرساخت امن اتصال به دفتر ثبت است، نه مجوز ارسال مالیاتی.
- تا دریافت مستندات رسمی سازمان و پیاده‌سازی backend امضا/رمزنگاری، ارسال عملیاتی فعال نمی‌شود.
