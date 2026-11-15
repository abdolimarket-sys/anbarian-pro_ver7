package com.anbarian.app;

import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.os.Build;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final String PREFS = "anbarin_update";
    private static final String KEY_LAST_VERSION = "last_version_name";
    private static final String KEY_LAST_CODE = "last_version_code";

    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(SaveFilePlugin.class);
        registerPlugin(ShareFilePlugin.class);
        registerPlugin(AutoBackupPlugin.class);
        registerPlugin(DriveBackupPlugin.class);
        registerPlugin(BiometricPlugin.class);
        registerPlugin(NativePrintPlugin.class);
        registerPlugin(DueNotificationsPlugin.class);
        super.onCreate(savedInstanceState);
        clearWebAssetsIfUpdated();
    }

    /**
     * پس از نصب نسخه جدید روی همان applicationId، کش WebView و Service Worker
     * ممکن است پوسته قدیمی را نگه دارد. با تغییر versionName/versionCode یک‌بار پاک می‌شود.
     */
    private void clearWebAssetsIfUpdated() {
        try {
            PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
            String versionName = info.versionName != null ? info.versionName : "";
            long versionCode;
            if (Build.VERSION.SDK_INT >= 28) {
                versionCode = info.getLongVersionCode();
            } else {
                versionCode = info.versionCode;
            }

            SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
            String lastName = prefs.getString(KEY_LAST_VERSION, "");
            long lastCode = prefs.getLong(KEY_LAST_CODE, -1L);

            if (!versionName.equals(lastName) || versionCode != lastCode) {
                WebView webView = getBridge() != null ? getBridge().getWebView() : null;
                if (webView != null) {
                    webView.clearCache(true);
                    webView.clearHistory();
                }
                // پاک‌سازی storage مربوط به SW در WebView (بهترین تلاش)
                deleteDatabase("ServiceWorker");
                deleteDatabase("WebViewChromiumCache");
                prefs.edit()
                    .putString(KEY_LAST_VERSION, versionName)
                    .putLong(KEY_LAST_CODE, versionCode)
                    .apply();
            }
        } catch (Exception ignored) {
            // عدم موفقیت پاک‌سازی نباید مانع شروع برنامه شود
        }
    }
}
