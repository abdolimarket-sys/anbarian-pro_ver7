# مرحله ششم — زیرساخت امن بازبینی سمت سرور

## آنچه اضافه شد
- افزونه اختیاری WordPress برای ذخیره پیش‌نویس داخلی مؤدی در سمت سرور.
- REST API با مجوز `manage_options` و تکیه بر احراز هویت استاندارد REST وردپرس (Cookie/Nonce یا Application Password).
- محدودیت حجم ورودی ۵۱۲ کیلوبایت و بررسی ساختار سند داخلی پیش از ذخیره.
- ذخیره در جدول اختصاصی با کلید idempotency برای جلوگیری از ثبت تکراری همان snapshot.
- API فهرست متادیتا، بدون بازگرداندن محتوای کامل فاکتورها.
- وضعیت صریح `internal_review`؛ هیچ وضعیت ارسال/تأیید رسمی ایجاد نمی‌شود.

## عمداً انجام نشد
- اتصال به برنامه وب/موبایل؛ چون قراردادن اعتبار مدیر WordPress در کلاینت ناامن است و پروژه فعلاً سرویس هویت/واسط سمت سرور برای کاربران اپ ندارد.
- ارسال مستقیم یا از طریق شرکت معتمد، تولید payload رسمی، امضا، رمزنگاری و تفسیر پاسخ سازمان.
- استفاده از endpoint یا schema حدسی.

## فایل‌ها
- `server/wordpress-plugin/anbarin-taxpayer-review/anbarin-taxpayer-review.php`
- `server/wordpress-plugin/anbarin-taxpayer-review/README_FA.md`
- `tests/phase86-taxpayer-server-review.test.mjs`

## نصب اختیاری
راهنمای کامل نصب و محدودیت‌ها در README افزونه است. افزونه را فقط روی WordPress دارای HTTPS نصب کنید. Application Password مدیر را هرگز داخل برنامه موبایل یا وب عمومی جاسازی نکنید.
