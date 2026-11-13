/**
 * پشتیبان خودکار روی حافظه عمومی دستگاه (Documents/AnbarinBackups)
 * هدف: نجات داده وقتی Clear Data / مشکل اپ IndexedDB را پاک می‌کند.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';
import { products, settings, session, auditLog, recentScans, inventoryDocs, bootState, save as saveAppState } from './state';
import { loadAccountingData, saveAccountingData } from './accounting';
import { loadCommerceData, saveCommerceData } from './accounting-commerce';
import { loadInventoryCostData, saveInventoryCostData } from './inventory-costing';
import { toast } from './ui';

interface AutoBackupAPI {
  write(options: { filename: string; data: string }): Promise<{ ok: boolean; filename?: string; uri?: string; mode?: string }>;
  list(): Promise<{ files: Array<{ name: string; size?: number; modified?: number }> }>;
  read(options: { name: string }): Promise<{ data: string; name: string }>;
  getStatus(): Promise<{ mode: 'default' | 'custom'; label: string; uri?: string; defaultPath?: string; isDrive?: boolean }>;
  pickFolder(options?: { preferDrive?: boolean }): Promise<{ cancelled?: boolean; mode?: string; label?: string; uri?: string; isDrive?: boolean }>;
  clearFolder(): Promise<{ mode: string; label?: string }>;
}

const NativeAutoBackup = registerPlugin<AutoBackupAPI>('AutoBackup');

interface DriveBackupAPI {
  getStatus(): Promise<{ connected: boolean; email?: string; folderId?: string }>;
  connect(): Promise<{ connected?: boolean; cancelled?: boolean; email?: string; needsFolderFallback?: boolean; errorCode?: number; message?: string }>;
  disconnect(): Promise<{ connected: boolean }>;
  write(options: { filename: string; data: string }): Promise<{ ok: boolean; filename?: string }>;
  list(): Promise<{ files: Array<{ name: string; id?: string; modified?: string }> }>;
  read(options: { id?: string; name?: string }): Promise<{ data: string; name?: string }>;
}
const NativeDriveBackup = registerPlugin<DriveBackupAPI>('DriveBackup');

export async function getGoogleDriveAccountStatus(): Promise<{ connected: boolean; email: string }> {
  if (!isNativeAndroid()) return { connected: false, email: '' };
  try {
    const s = await NativeDriveBackup.getStatus();
    return { connected: !!s.connected, email: s.email || '' };
  } catch {
    return { connected: false, email: '' };
  }
}

export async function connectGoogleDriveAccount(): Promise<'ok' | 'cancelled' | 'unsupported' | 'error' | 'folder-fallback-ok' | 'folder-fallback-needed'> {
  if (!isNativeAndroid()) return 'unsupported';
  try {
    const r = await NativeDriveBackup.connect();
    if (r.cancelled) return 'cancelled';
    if (r.connected) return 'ok';
    // اگر OAuth روی گوشی تنظیم نشده، یک‌بار پوشه Drive را می‌گیریم تا پشتیبان آنلاین کار کند
    if (r.needsFolderFallback) {
      const folder = await pickAutoBackupFolder({ preferDrive: true });
      if (folder === 'ok') return 'folder-fallback-ok';
      if (folder === 'cancelled') return 'cancelled';
      return 'folder-fallback-needed';
    }
    return 'error';
  } catch (e) {
    console.warn('[Anbarin] Drive connect failed, try folder fallback', e);
    try {
      const folder = await pickAutoBackupFolder({ preferDrive: true });
      if (folder === 'ok') return 'folder-fallback-ok';
    } catch { /* ignore */ }
    return 'error';
  }
}

export async function disconnectGoogleDriveAccount(): Promise<'ok' | 'unsupported' | 'error'> {
  if (!isNativeAndroid()) return 'unsupported';
  try {
    await NativeDriveBackup.disconnect();
    return 'ok';
  } catch {
    return 'error';
  }
}

const LAST_KEY = 'anbarin_last_external_backup_at';
const MIN_INTERVAL_MS = 10 * 60 * 1000; // حداکثر هر ۱۰ دقیقه یک‌بار (به‌جز force)

function isNativeAndroid(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

export async function getAutoBackupLocationStatus(): Promise<{
  mode: 'default' | 'custom' | 'unsupported';
  label: string;
  isDrive?: boolean;
}> {
  if (!isNativeAndroid()) {
    return { mode: 'unsupported', label: 'فقط در اپ اندروید — Documents/AnbarinBackups', isDrive: false };
  }
  try {
    const s = await NativeAutoBackup.getStatus();
    return {
      mode: s.mode === 'custom' ? 'custom' : 'default',
      label: s.label || s.defaultPath || 'Documents/AnbarinBackups',
      isDrive: !!s.isDrive,
    };
  } catch {
    return { mode: 'default', label: 'Documents/AnbarinBackups', isDrive: false };
  }
}

export async function pickAutoBackupFolder(opts?: { preferDrive?: boolean }): Promise<'ok' | 'cancelled' | 'unsupported' | 'error'> {
  if (!isNativeAndroid()) return 'unsupported';
  try {
    const r = await NativeAutoBackup.pickFolder({ preferDrive: !!opts?.preferDrive });
    if (r.cancelled) return 'cancelled';
    return 'ok';
  } catch (e) {
    console.warn('[Anbarin] pick backup folder failed', e);
    return 'error';
  }
}

export async function clearAutoBackupFolder(): Promise<'ok' | 'unsupported' | 'error'> {
  if (!isNativeAndroid()) return 'unsupported';
  try {
    await NativeAutoBackup.clearFolder();
    return 'ok';
  } catch (e) {
    console.warn('[Anbarin] clear backup folder failed', e);
    return 'error';
  }
}

async function toBase64(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function fromBase64(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** SHA-256 روی محتوای canonical؛ در محیط‌های فاقد WebCrypto پشتیبان‌گیری متوقف می‌شود. */
async function sha256(value: unknown): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('SHA-256 is not available');
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function backupFilename(date = new Date()): string {
  const stamp = date.toISOString().replace(/[:.]/g, '-');
  return `anbarin-auto-${stamp}.json`;
}

export async function buildFullDeviceBackupPayload(): Promise<Record<string, unknown>> {
  const [accounting, commerce, costing] = await Promise.all([
    loadAccountingData().catch(() => null),
    loadCommerceData().catch(() => null),
    loadInventoryCostData().catch(() => null),
  ]);
  let localUsers: unknown = [];
  try {
    localUsers = JSON.parse(localStorage.getItem('anbarin_local_users_v1') || '[]');
  } catch {
    localUsers = [];
  }
  const body = {
    schema: 'anbarin-full-device-backup',
    version: 2,
    exportedAt: new Date().toISOString(),
    app: {
      products,
      settings,
      session,
      auditLog: (auditLog || []).slice(-500),
      recentScans,
      inventoryDocs,
    },
    accounting,
    commerce,
    costing,
    localUsers,
    operator: localStorage.getItem('anbar_operator') || '',
  };
  return { ...body, integrity: { algorithm: 'SHA-256', digest: await sha256(body) } };
}

export async function writeExternalAutoBackup(force = false): Promise<boolean> {
  if (!isNativeAndroid()) return false;
  try {
    const last = Number(localStorage.getItem(LAST_KEY) || 0);
    if (!force && Date.now() - last < MIN_INTERVAL_MS) return false;

    const payload = await buildFullDeviceBackupPayload();
    // اگر تقریباً هیچ داده‌ای نیست، فایل خالی ننویس
    const app = payload.app as { products?: unknown[] };
    const productCount = Array.isArray(app?.products) ? app.products.length : 0;
    const hasUsers = Array.isArray(payload.localUsers) && (payload.localUsers as unknown[]).length > 0;
    const invCount = Array.isArray((payload.commerce as { invoices?: unknown[] } | null)?.invoices)
      ? ((payload.commerce as { invoices: unknown[] }).invoices.length)
      : 0;
    if (productCount === 0 && !hasUsers && invCount === 0) {
      return false;
    }

    const filename = backupFilename(new Date());
    const data = await toBase64(JSON.stringify(payload));
    await NativeAutoBackup.write({ filename, data });
    localStorage.setItem(LAST_KEY, String(Date.now()));
    localStorage.setItem('anbarin_last_external_backup_iso', new Date().toISOString());
    localStorage.removeItem('anbarin_last_external_backup_error');
    console.log('[Anbarin] external auto-backup written', filename);
    return true;
  } catch (e) {
    console.warn('[Anbarin] external auto-backup failed', e);
    try { localStorage.setItem('anbarin_last_external_backup_error', e instanceof Error ? e.message : String(e)); } catch { /* ignore */ }
    return false;
  }
}

export async function tryRecoverFromExternalBackup(): Promise<'restored' | 'none' | 'skipped'> {
  if (!isNativeAndroid()) return 'skipped';
  try {
    // فقط وقتی داده داخلی خالی است
    if (products.length > 0) return 'skipped';
    let usersEmpty = true;
    try {
      const u = JSON.parse(localStorage.getItem('anbarin_local_users_v1') || '[]');
      usersEmpty = !Array.isArray(u) || u.length === 0;
    } catch {
      usersEmpty = true;
    }

    type Cand = { name: string; modified?: number; id?: string; source: 'drive' | 'local' };
    const candidates: Cand[] = [];

    try {
      const st = await NativeDriveBackup.getStatus();
      if (st.connected) {
        const listed = await NativeDriveBackup.list();
        for (const f of listed.files || []) {
          if (f?.name && /anbarin-auto.*\.json$/i.test(f.name)) {
            const mod = f.modified ? Date.parse(f.modified) || 0 : 0;
            candidates.push({ name: f.name, modified: mod, id: f.id, source: 'drive' });
          }
        }
      }
    } catch (e) {
      console.warn('[Anbarin] drive list for recover failed', e);
    }

    try {
      const listed = await NativeAutoBackup.list();
      for (const f of listed.files || []) {
        if (f?.name && /anbarin-auto.*\.json$/i.test(f.name)) {
          candidates.push({ name: f.name, modified: f.modified || 0, source: 'local' });
        }
      }
    } catch (e) {
      console.warn('[Anbarin] local list for recover failed', e);
    }

    if (!candidates.length) return 'none';
    candidates.sort((a, b) => (b.modified || 0) - (a.modified || 0));

    // چند فایل اخیر را امتحان می‌کنیم تا به اولین پشتیبانِ دارای کالا برسیم
    const tryList = candidates.slice(0, 5);
    type BackupPayload = {
      schema?: string;
      version?: number;
      app?: {
        products?: unknown[];
        settings?: unknown;
        session?: unknown;
        auditLog?: unknown[];
        recentScans?: unknown[];
        inventoryDocs?: unknown[];
      };
      accounting?: unknown;
      commerce?: unknown;
      costing?: unknown;
      localUsers?: unknown;
      operator?: string;
    };
    let chosen: Cand | null = null;
    let parsed: BackupPayload | null = null;

    for (const cand of tryList) {
      try {
        const file = cand.source === 'drive'
          ? await NativeDriveBackup.read({ id: cand.id, name: cand.name })
          : await NativeAutoBackup.read({ name: cand.name });
        const raw = fromBase64(file.data);
        const p = JSON.parse(raw) as BackupPayload;
        if (!p || p.schema !== 'anbarin-full-device-backup' || !p.app) continue;
        // نسخه‌های قدیمی بدون امضا برای سازگاری پذیرفته می‌شوند؛ نسخه جدید باید SHA-256 معتبر داشته باشد.
        if ((p.version || 0) >= 2) {
          const integrity = (p as any).integrity;
          if (!integrity || integrity.algorithm !== 'SHA-256' || typeof integrity.digest !== 'string') continue;
          const { integrity: _integrity, ...body } = p as any;
          if (await sha256(body) !== integrity.digest) {
            console.warn('[Anbarin] backup integrity check failed', cand.name);
            continue;
          }
        }
        const count = Array.isArray(p.app.products) ? p.app.products.length : 0;
        // اولویت با پشتیبانی که واقعاً کالا دارد
        if (count > 0) {
          chosen = cand;
          parsed = p;
          break;
        }
        if (!chosen) {
          chosen = cand;
          parsed = p;
        }
      } catch (e) {
        console.warn('[Anbarin] skip unreadable backup', cand.name, e);
      }
    }

    if (!chosen || !parsed || !parsed.app) {
      toast('پشتیبان پیدا شد ولی خواندن فایل ممکن نشد', 'error');
      return 'none';
    }

    const productCount = Array.isArray(parsed.app.products) ? parsed.app.products.length : 0;
    const where = chosen.source === 'drive' ? 'Google Drive' : 'حافظه دستگاه';

    // اگر کالا داخل پشتیبان هست و داخل اپ خالی است، بازیابی را خودکار انجام بده
    // (دیالوگ confirm روی بعضی گوشی‌ها قطع یا اشتباه لغو می‌شود)
    const shouldAuto = productCount > 0;
    if (!shouldAuto) {
      const msg = usersEmpty
        ? `یک پشتیبان خودکار در ${where} پیدا شد (${chosen.name}). بازیابی شود تا کالاها و حساب‌ها برگردند؟`
        : `داده کالا خالی است ولی پشتیبان در ${where} هست (${chosen.name}). بازیابی شود؟`;
      if (!confirm(msg)) return 'none';
    } else {
      console.log('[Anbarin] auto-restoring external backup', chosen.name, 'products=', productCount);
    }

    if (Array.isArray(parsed.localUsers)) {
      localStorage.setItem('anbarin_local_users_v1', JSON.stringify(parsed.localUsers));
    }
    if (typeof parsed.operator === 'string' && parsed.operator) {
      localStorage.setItem('anbar_operator', parsed.operator);
    }

    // بازگردانی state اصلی از طریق بازنویسی و boot دوباره
    const { persistAppState } = await import('./storage');
    const restoredProducts = (parsed.app.products as never[]) || [];
    await persistAppState({
      products: restoredProducts,
      settings: (parsed.app.settings as never) || settings,
      session: (parsed.app.session as never) || null,
      auditLog: (parsed.app.auditLog as never[]) || [],
      recentScans: (parsed.app.recentScans as never[]) || [],
      inventoryDocs: (parsed.app.inventoryDocs as never[]) || [],
    } as never);

    if (parsed.accounting) await saveAccountingData(parsed.accounting as never);
    if (parsed.commerce) await saveCommerceData(parsed.commerce as never);
    if (parsed.costing) await saveInventoryCostData(parsed.costing as never);

    await bootState();
    saveAppState(true);

    // علامت برای جلوگیری از پیام «هنوز کالایی ثبت نشده» بعد از بازیابی موفق
    try {
      sessionStorage.setItem('anbarin_just_restored_external', String(restoredProducts.length));
    } catch { /* ignore */ }

    toast(
      productCount > 0
        ? `بازیابی انجام شد — ${productCount.toLocaleString('fa-IR')} کالا از ${where}`
        : 'بازیابی از پشتیبان خودکار انجام شد',
      'success'
    );
    return 'restored';
  } catch (e) {
    console.warn('[Anbarin] recover external backup failed', e);
    toast('خطا در بازیابی پشتیبان خودکار', 'error');
    return 'none';
  }
}

/** گزارش آخرین اجرای پشتیبان‌گیری برای نمایش در تنظیمات/عیب‌یابی */
export function getAutoBackupReport(): { lastSuccessAt: string; lastError: string } {
  return {
    lastSuccessAt: localStorage.getItem('anbarin_last_external_backup_iso') || '',
    lastError: localStorage.getItem('anbarin_last_external_backup_error') || '',
  };
}

/** فهرست نسخه‌های قابل انتخاب؛ نسخه‌های Drive و حافظه دستگاه جداگانه خوانده می‌شوند. */
export async function listExternalBackups(): Promise<Array<{ name: string; modified: number; source: 'drive' | 'local'; id?: string }>> {
  if (!isNativeAndroid()) return [];
  const result: Array<{ name: string; modified: number; source: 'drive' | 'local'; id?: string }> = [];
  try {
    const status = await NativeDriveBackup.getStatus();
    if (status.connected) {
      const listed = await NativeDriveBackup.list();
      for (const f of listed.files || []) if (f?.name && /anbarin-auto.*\\.json$/i.test(f.name))
        result.push({ name: f.name, modified: f.modified ? Date.parse(f.modified) || 0 : 0, source: 'drive', id: f.id });
    }
  } catch (e) { console.warn('[Anbarin] drive backup listing failed', e); }
  try {
    const listed = await NativeAutoBackup.list();
    for (const f of listed.files || []) if (f?.name && /anbarin-auto.*\\.json$/i.test(f.name))
      result.push({ name: f.name, modified: f.modified || 0, source: 'local' });
  } catch (e) { console.warn('[Anbarin] local backup listing failed', e); }
  return result.sort((a, b) => b.modified - a.modified);
}



/** بازیابی نسخه انتخاب‌شده؛ اعتبارسنجی SHA-256 و snapshot اضطراری پیش از جایگزینی. */
export async function restoreSelectedExternalBackup(
  backup: { name: string; source: 'drive' | 'local'; id?: string }
): Promise<{ ok: boolean; message: string }> {
  if (!isNativeAndroid()) return { ok: false, message: 'بازیابی نسخه‌های بیرونی فقط در اپ اندروید فعال است' };
  try {
    const response = backup.source === 'drive'
      ? await NativeDriveBackup.read({ id: backup.id, name: backup.name })
      : await NativeAutoBackup.read({ name: backup.name });
    const raw = fromBase64(response.data);
    const parsed = JSON.parse(raw) as Record<string, any>;
    if (!parsed || parsed.schema !== 'anbarin-full-device-backup' || !parsed.app ||
        !Array.isArray(parsed.app.products) ||
        !parsed.app.products.every((p: unknown) => !!p && typeof p === 'object' && !Array.isArray(p))) {
      throw new Error('ساختار فایل پشتیبان معتبر نیست');
    }

    // نسخه‌های جدید باید حتماً SHA-256 معتبر داشته باشند؛ نسخه‌های قدیمی‌تر قابل بازیابی می‌مانند.
    if (parsed.integrity) {
      if (parsed.integrity.algorithm !== 'SHA-256' || typeof parsed.integrity.digest !== 'string') {
        throw new Error('ساختار امضای فایل معتبر نیست');
      }
      const { integrity, ...body } = parsed;
      const actual = await sha256(body);
      if (actual !== integrity.digest) throw new Error('کنترل SHA-256 ناموفق بود؛ فایل خراب یا تغییر داده شده است');
    } else if (Number(parsed.version) >= 2) {
      throw new Error('فایل جدید فاقد امضای SHA-256 است');
    }

    // قبل از هر تغییری، وضعیت کامل فعلی در IndexedDB نگهداری می‌شود.
    const { idbPut, persistAppState } = await import('./storage');
    const emergency = await buildFullDeviceBackupPayload();
    await idbPut('emergency_before_selected_restore', {
      savedAt: new Date().toISOString(),
      payload: emergency,
      source: backup.name,
    });

    const app = parsed.app;
    await persistAppState({
      products: app.products,
      settings: app.settings || settings,
      session: app.session ?? null,
      auditLog: Array.isArray(app.auditLog) ? app.auditLog : [],
      recentScans: Array.isArray(app.recentScans) ? app.recentScans : [],
      inventoryDocs: Array.isArray(app.inventoryDocs) ? app.inventoryDocs : [],
    } as never);
    if (parsed.accounting) await saveAccountingData(parsed.accounting as never);
    if (parsed.commerce) await saveCommerceData(parsed.commerce as never);
    if (parsed.costing) await saveInventoryCostData(parsed.costing as never);
    if (Array.isArray(parsed.localUsers)) localStorage.setItem('anbarin_local_users_v1', JSON.stringify(parsed.localUsers));
    if (typeof parsed.operator === 'string') localStorage.setItem('anbar_operator', parsed.operator);

    await bootState();
    saveAppState(true);
    try { sessionStorage.setItem('anbarin_just_restored_external', String(app.products.length)); } catch { /* ignore */ }
    return { ok: true, message: `بازیابی موفق؛ ${app.products.length.toLocaleString('fa-IR')} کالا` };
  } catch (error) {
    console.error('[Anbarin] selected backup restore failed', error);
    return { ok: false, message: error instanceof Error ? error.message : 'بازیابی ناموفق بود' };
  }
}

/** زمان‌بندی پشتیبان: بعد از ذخیره، و وقتی برنامه به پس‌زمینه می‌رود */
export function initExternalAutoBackupScheduler(): void {
  if (!isNativeAndroid()) return;

  // بعد از اولین رندر
  setTimeout(() => { void writeExternalAutoBackup(false); }, 8000);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      // موقع بستن/رفتن به پس‌زمینه حتماً بنویس (بدون محدودیت فاصله ۱۰ دقیقه‌ای)
      void writeExternalAutoBackup(true);
    }
  });
  // برخی WebViewها فقط pagehide می‌دهند
  window.addEventListener('pagehide', () => {
    void writeExternalAutoBackup(true);
  });

  window.addEventListener('anbarin:auth-ready', () => {
    void writeExternalAutoBackup(true);
  });

  // هر ۳۰ دقیقه در صورت باز بودن برنامه
  setInterval(() => { void writeExternalAutoBackup(false); }, 30 * 60 * 1000);
}
