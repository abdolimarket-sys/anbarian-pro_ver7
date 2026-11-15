# فاز ۲۴ — پل اختیاری دفتر ثبت (بدون تغییر رفتار پیش‌فرض)

## هدف
فراهم کردن API اختیاری برای رزرو/خواندن/انتقال وضعیت دفتر ثبت، طوری که:

- بدون پیکربندی صریح **هیچ درخواست شبکه‌ای** زده نشود
- `taxpayer.ts`، صف بررسی، پیش‌نویس V7.9، حسابداری و بقیه ماژول‌ها **بدون تغییر** بمانند
- ارسال واقعی به سامانه مؤدیان همچنان غیرفعال باشد

## تغییرات
- افزودن `src/modules/taxpayer-ledger-bridge.ts` (ماژول مستقل)
- تنظیمات در `localStorage` کلید `anbarin_taxpayer_ledger_bridge_v1` (اختیاری)
- توابع:
  - `saveTaxLedgerBridgeConfig` / `loadTaxLedgerBridgeConfig` / `getTaxLedgerBridgeStatus`
  - `tryReserveTaxLedger` / `tryGetTaxLedgerStatus` / `tryTransitionTaxLedger`
- اگر `enabled !== true` یا URL/کلید نامعتبر باشد → `skipped: true` و بدون شبکه

## آنچه عمداً انجام نشده
- هیچ import در `main.ts` یا `taxpayer.ts` اضافه نشده است
- دکمه یا جریان UI اجباری برای ارسال اضافه نشده است
- Application Password وردپرس در کلاینت ذخیره نمی‌شود (فقط API Key سرویس واسط)
- endpoint سازمان امور مالیاتی فراخوانی نمی‌شود

## نحوه فعال‌سازی بعدی (اختیاری)
1. سرویس واسط فاز ۲۳ و افزونه فاز ۲۱ روی سرور
2. فراخوانی `saveTaxLedgerBridgeConfig({ baseUrl, apiKey, environment, enabled: true })` از تنظیمات امن
3. در UI دلخواه: `tryReserveTaxLedger(...)` فقط وقتی `getTaxLedgerBridgeStatus().configured === true`

## سازگاری
- فاز ۲۰–۲۳ بدون نیاز به این پل به کار خود ادامه می‌دهند
- نصب‌های بدون سرور دقیقاً مثل قبل عمل می‌کنند

## مسیر فایل‌ها
- `src/modules/taxpayer-ledger-bridge.ts`
- `TAXPAYER_PHASE24_FA.md`
