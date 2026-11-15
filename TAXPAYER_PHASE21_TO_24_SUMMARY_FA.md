# خلاصه فاز ۲۱ تا ۲۴ — دفتر ثبت ارسال سمت سرور

نسخه پایه: Anbarin Pro 2.0.4 (فاز ۲۰)

## اضافه شده (بدون تغییر رفتار پیش‌فرض اپ)

- **فاز ۲۱:** افزونه WordPress دفتر ثبت با قید یکتایی و API وضعیت
- **فاز ۲۲:** آداپتور کلاینت `taxpayer-ledger-server.ts`
- **فاز ۲۳:** سرویس واسط امن `server/ledger-proxy` (API Key؛ بدون Application Password در اپ)
- **فاز ۲۴:** پل اختیاری `taxpayer-ledger-bridge.ts` — بدون پیکربندی، هیچ درخواست شبکه‌ای زده نمی‌شود

## عمداً تغییر نکرده

- `taxpayer.ts`، صف بررسی، پیش‌نویس V7.9، حسابداری، انبار، پشتیبان
- ارسال واقعی به سامانه مؤدیان همچنان غیرفعال تا تأیید پروتکل رسمی

## مسیرهای مهم

- `server/wordpress-plugin/anbarin-taxpayer-submission-ledger/`
- `server/ledger-proxy/`
- `src/modules/taxpayer-ledger-server.ts`
- `src/modules/taxpayer-ledger-bridge.ts`
- مستند هر فاز: `TAXPAYER_PHASE21_FA.md` … `TAXPAYER_PHASE24_FA.md`
