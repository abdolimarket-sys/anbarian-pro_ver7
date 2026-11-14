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
import { getLicensedBackupScope, getBackupScopeFromPayload } from './backup-scope';
import { isValidCommerceBackup } from './backup-commerce-validation.js';
import { encryptBackupPayload, decryptBackupWithPassword, decryptBackupWithOrganizationKeyPackage, isEncryptedBackup, type BackupEnvelope } from './backup-crypto';

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

export async function buildFullDeviceBackupPayload(options: { includeAllModules?: boolean } = {}): Promise<Record<string, unknown>> {
  const scope = options.includeAllModules
    ? { count: true, accounting: true, modules: ['count', 'accounting'] as const }
    : getLicensedBackupScope();
  if (!scope.modules.length) throw new Error('برای تهیه پشتیبان، حداقل یک ماژول باید لایسنس فعال داشته باشد.');
  const [accounting, commerce, costing] = await Promise.all([
    scope.accounting ? loadAccountingData().catch(() => null) : Promise.resolve(null),
    scope.accounting ? loadCommerceData().catch(() => null) : Promise.resolve(null),
    scope.accounting ? loadInventoryCostData().catch(() => null) : Promise.resolve(null),
  ]);
  let localUsers: unknown = [];
  try {
    localUsers = JSON.parse(localStorage.getItem('anbarin_local_users_v1') || '[]');
  } catch {
    localUsers = [];
  }
  const body = {
    schema: 'anbarin-full-device-backup',
    version: 4,
    scope: { modules: [...scope.modules] },
    compatibility: { minReaderVersion: 1, dataSchema: 'incremental-v1' },
    exportedAt: new Date().toISOString(),
    app: scope.count ? {
      products,
      settings,
      session,
      auditLog: (auditLog || []).slice(),
      recentScans,
      inventoryDocs,
    } : null,
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
    const hasAccountingData = !!payload.accounting || !!payload.commerce || !!payload.costing;
    if (productCount === 0 && !hasUsers && invCount === 0 && !hasAccountingData) {
      return false;
    }

    const filename = backupFilename(new Date());
    const encrypted = await encryptBackupPayload(payload);
    const data = await toBase64(JSON.stringify(encrypted));
    // ذخیره محلی نقطه پایه است؛ در صورت اتصال، همان بسته بدون تغییر به Drive نیز فرستاده می‌شود.
    await NativeAutoBackup.write({ filename, data });
    let cloudWarning = '';
    try {
      const drive = await NativeDriveBackup.getStatus();
      if (drive.connected) await NativeDriveBackup.write({ filename, data });
    } catch (cloudError) {
      cloudWarning = cloudError instanceof Error ? cloudError.message : String(cloudError);
      console.warn('[Anbarin] cloud backup upload failed; local copy is safe', cloudError);
    }
    localStorage.setItem(LAST_KEY, String(Date.now()));
    localStorage.setItem('anbarin_last_external_backup_iso', new Date().toISOString());
    if (cloudWarning) localStorage.setItem('anbarin_last_external_backup_error', `پشتیبان محلی موفق؛ ارسال ابری ناموفق: ${cloudWarning}`);
    else localStorage.removeItem('anbarin_last_external_backup_error');
    console.log('[Anbarin] external auto-backup written', filename, cloudWarning ? '(cloud pending)' : '');
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
      scope?: { modules?: unknown };
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
    let chosenEncrypted = false;

    for (const cand of tryList) {
      try {
        const file = cand.source === 'drive'
          ? await NativeDriveBackup.read({ id: cand.id, name: cand.name })
          : await NativeAutoBackup.read({ name: cand.name });
        const raw = fromBase64(file.data);
        const p = JSON.parse(raw) as BackupPayload | BackupEnvelope;
        if (isEncryptedBackup(p)) { chosen = cand; chosenEncrypted = true; break; }
        if (!p || p.schema !== 'anbarin-full-device-backup') continue;
        const candidateScope = getBackupScopeFromPayload(p);
        if (!candidateScope.count && !candidateScope.accounting) continue;
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
        const count = Array.isArray(p.app?.products) ? p.app.products.length : 0;
        const hasAccounting = candidateScope.accounting && !!(p.accounting || p.commerce || p.costing);
        // اولویت با پشتیبانی که واقعاً کالا دارد
        if (count > 0 || hasAccounting) {
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

    if (!chosen) {
      toast('پشتیبان پیدا شد ولی خواندن فایل ممکن نشد', 'error');
      return 'none';
    }
    if (chosenEncrypted) {
      const secureRestore = await restoreSelectedExternalBackup(chosen);
      if (secureRestore.ok) return 'restored';
      toast(secureRestore.message, 'error');
      return 'none';
    }
    if (!parsed) return 'none';
    const restoreScope = getBackupScopeFromPayload(parsed);
    if (!restoreScope.count && !restoreScope.accounting) return 'none';

    const productCount = Array.isArray(parsed.app?.products) ? parsed.app.products.length : 0;
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
    const restoredProducts = (parsed.app?.products as never[]) || [];
    if (restoreScope.count && parsed.app) {
      await persistAppState({
        products: restoredProducts,
        settings: (parsed.app.settings as never) || settings,
        session: (parsed.app.session as never) || null,
        auditLog: (parsed.app.auditLog as never[]) || [],
        recentScans: (parsed.app.recentScans as never[]) || [],
        inventoryDocs: (parsed.app.inventoryDocs as never[]) || [],
      } as never);
    }

    if (restoreScope.accounting && parsed.accounting) await saveAccountingData(parsed.accounting as never);
    if (restoreScope.accounting && parsed.commerce) await saveCommerceData(parsed.commerce as never);
    if (restoreScope.accounting && parsed.costing) await saveInventoryCostData(parsed.costing as never);

    await bootState();
    saveAppState(true);

    // علامت برای جلوگیری از پیام «هنوز کالایی ثبت نشده» بعد از بازیابی موفق
    if (restoreScope.count) {
      try { sessionStorage.setItem('anbarin_just_restored_external', String(restoredProducts.length)); } catch { /* ignore */ }
    }

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
      for (const f of listed.files || []) if (f?.name && /anbarin-auto.*\.json$/i.test(f.name))
        result.push({ name: f.name, modified: f.modified ? Date.parse(f.modified) || 0 : 0, source: 'drive', id: f.id });
    }
  } catch (e) { console.warn('[Anbarin] drive backup listing failed', e); }
  try {
    const listed = await NativeAutoBackup.list();
    for (const f of listed.files || []) if (f?.name && /anbarin-auto.*\.json$/i.test(f.name))
      result.push({ name: f.name, modified: f.modified || 0, source: 'local' });
  } catch (e) { console.warn('[Anbarin] local backup listing failed', e); }
  return result.sort((a, b) => b.modified - a.modified);
}



/** بازیابی نسخه انتخاب‌شده با اعتبارسنجی پیشینی، snapshot اضطراری و rollback چندلایه. */
export async function restoreSelectedExternalBackup(
  backup: { name: string; source: 'drive' | 'local'; id?: string }
): Promise<{ ok: boolean; message: string }> {
  if (!isNativeAndroid()) return { ok: false, message: 'بازیابی نسخه‌های بیرونی فقط در اپ اندروید فعال است' };
  const { idbPut, persistAppState } = await import('./storage');
  let rollback: { app: Record<string, unknown>; accounting: unknown; commerce: unknown; costing: unknown; users: string | null; operator: string | null } | null = null;
  let restoreStarted = false;
  try {
    const response = backup.source === 'drive'
      ? await NativeDriveBackup.read({ id: backup.id, name: backup.name })
      : await NativeAutoBackup.read({ name: backup.name });
    const raw = fromBase64(response.data);
    const fileValue = JSON.parse(raw) as Record<string, any> | BackupEnvelope;
    let parsed: Record<string, any>;
    if (isEncryptedBackup(fileValue)) {
      let recovered: unknown;
      const password = window.prompt('رمز بازیابی این نسخه را وارد کنید. برای بازیابی سازمانی، رمز را خالی بگذارید و لغو کنید.');
      if (password !== null && password.length > 0) {
        try { recovered = await decryptBackupWithPassword(fileValue, password); }
        catch (passwordError) {
          const useAdmin = window.confirm(`${passwordError instanceof Error ? passwordError.message : 'رمز بازیابی پذیرفته نشد'}\nآیا می‌خواهید مدیر اصلی سازمان با کلید خصوصی بازیابی کند؟`);
          if (!useAdmin) throw passwordError;
        }
      }
      if (recovered === undefined) {
        const packageText = window.prompt('مدیر اصلی: محتوای کامل فایل JSON کلید خصوصی سازمانی را وارد کنید.');
        if (!packageText) throw new Error('بازیابی لغو شد؛ رمز عبور یا کلید خصوصی سازمانی لازم است');
        const managerPassword = window.prompt('رمز محافظ کلید خصوصی مدیر را وارد کنید.');
        if (!managerPassword) throw new Error('رمز محافظ کلید مدیر وارد نشد');
        recovered = await decryptBackupWithOrganizationKeyPackage(fileValue, JSON.parse(packageText), managerPassword);
      }
      if (!recovered || typeof recovered !== 'object') throw new Error('محتوای رمزگشایی‌شده معتبر نیست');
      parsed = recovered as Record<string, any>;
    } else {
      parsed = fileValue as Record<string, any>;
    }

    // مرحله ۱: نسخه‌های ۱ تا ۳ برای سازگاری پذیرفته می‌شوند؛ نسخه ۴ محدوده ماژول‌های مجاز را ثبت می‌کند.
    const restoreScope = parsed && parsed.schema === 'anbarin-full-device-backup'
      ? getBackupScopeFromPayload(parsed as { version?: number; scope?: { modules?: unknown } })
      : { count: false, accounting: false, modules: [] };
    if (!parsed || parsed.schema !== 'anbarin-full-device-backup' ||
        (restoreScope.count && (!parsed.app || !Array.isArray(parsed.app.products) ||
          !parsed.app.products.every((v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v)))) ||
        (!restoreScope.count && !restoreScope.accounting)) {
      throw new Error('مرحله ۱ اعتبارسنجی ناموفق: ساختار یا محدوده لایسنس فایل پشتیبان معتبر نیست');
    }
    const version = Number(parsed.version || 1);
    if (!Number.isInteger(version) || version < 1 || version > 4) throw new Error('نسخه پشتیبان با این برنامه سازگار نیست');

    // مرحله ۲: یکپارچگی رمزنگارانه؛ SHA-256 برای کشف خرابی/تغییر ناخواسته است، نه امضای هویت.
    if (parsed.integrity) {
      if (parsed.integrity.algorithm !== 'SHA-256' || typeof parsed.integrity.digest !== 'string')
        throw new Error('مرحله ۲ اعتبارسنجی ناموفق: ساختار امضا معتبر نیست');
      const { integrity, ...body } = parsed;
      if (await sha256(body) !== integrity.digest) throw new Error('مرحله ۲ اعتبارسنجی ناموفق: کنترل SHA-256 شکست خورد');
    } else if (version >= 2) {
      throw new Error('مرحله ۲ اعتبارسنجی ناموفق: فایل جدید فاقد SHA-256 است');
    }

    // مرحله ۳: کنترل زیرساختارها پیش از هرگونه نوشتن.
    if (restoreScope.accounting && parsed.accounting != null && (parsed.accounting.schemaVersion !== 1 || !Array.isArray(parsed.accounting.accounts) || !Array.isArray(parsed.accounting.journalEntries)))
      throw new Error('مرحله ۳: ساختار حسابداری معتبر نیست');
    if (restoreScope.accounting && parsed.commerce != null && !isValidCommerceBackup(parsed.commerce))
      throw new Error('مرحله ۳: ساختار فاکتورها، ردیف‌های کالا یا تراکنش‌ها معتبر نیست');
    if (restoreScope.accounting && parsed.costing != null && (parsed.costing.schemaVersion !== 1 || !Array.isArray(parsed.costing.layers) || !Array.isArray(parsed.costing.movements)))
      throw new Error('مرحله ۳: ساختار بهای تمام‌شده معتبر نیست');

    // مرحله ۴: ثبت وضعیت فعلی برای rollback و نسخه اضطراری قابل بازیابی.
    const [currentAccounting, currentCommerce, currentCosting] = await Promise.all([
      loadAccountingData(), loadCommerceData(), loadInventoryCostData(),
    ]);
    rollback = {
      app: { products: [...products], settings: structuredClone(settings), session: structuredClone(session),
        auditLog: structuredClone(auditLog), recentScans: structuredClone(recentScans), inventoryDocs: structuredClone(inventoryDocs) },
      accounting: currentAccounting, commerce: currentCommerce, costing: currentCosting,
      users: localStorage.getItem('anbarin_local_users_v1'), operator: localStorage.getItem('anbar_operator'),
    };
    const emergency = await buildFullDeviceBackupPayload({ includeAllModules: true });
    await idbPut('emergency_before_selected_restore', { savedAt: new Date().toISOString(), payload: emergency, source: backup.name });
    // نشانگر پایدار برای بازیابی پس از بسته‌شدن ناگهانی اپ/فرآیند؛ پیش از اولین نوشتن ثبت می‌شود.
    localStorage.setItem('anbarin_restore_journal_v1', JSON.stringify({ version: 1, startedAt: new Date().toISOString(), source: backup.name }));

    // مرحله ۵: اعمال تغییرات؛ نشانگر تا تأیید کامل همه لایه‌ها باقی می‌ماند.
    restoreStarted = true;
    const app = parsed.app;
    if (restoreScope.count && app) {
      await persistAppState({
        products: app.products,
        settings: app.settings || settings,
        session: app.session ?? null,
        auditLog: Array.isArray(app.auditLog) ? app.auditLog : [],
        recentScans: Array.isArray(app.recentScans) ? app.recentScans : [],
        inventoryDocs: Array.isArray(app.inventoryDocs) ? app.inventoryDocs : [],
      } as never);
    }
    if (restoreScope.accounting && parsed.accounting) await saveAccountingData(parsed.accounting as never);
    if (restoreScope.accounting && parsed.commerce) await saveCommerceData(parsed.commerce as never);
    if (restoreScope.accounting && parsed.costing) await saveInventoryCostData(parsed.costing as never);
    if (Array.isArray(parsed.localUsers)) localStorage.setItem('anbarin_local_users_v1', JSON.stringify(parsed.localUsers));
    if (typeof parsed.operator === 'string') localStorage.setItem('anbar_operator', parsed.operator);

    await bootState();
    saveAppState(true);
    if (restoreScope.count && app) { try { sessionStorage.setItem('anbarin_just_restored_external', String(app.products.length)); } catch { /* ignore */ } }
    localStorage.setItem('anbarin_last_restore_iso', new Date().toISOString());
    localStorage.removeItem('anbarin_restore_journal_v1');
    return { ok: true, message: restoreScope.count && app
      ? `بازیابی و کنترل نهایی موفق؛ ${app.products.length.toLocaleString('fa-IR')} کالا`
      : 'بازیابی اطلاعات حسابداری با موفقیت انجام شد' };
  } catch (error) {
    console.error('[Anbarin] selected backup restore failed', error);
    let rollbackMessage = '';
    if (restoreStarted && rollback) {
      try {
        await persistAppState(rollback.app as never);
        await saveAccountingData(rollback.accounting as never);
        await saveCommerceData(rollback.commerce as never);
        await saveInventoryCostData(rollback.costing as never);
        if (rollback.users === null) localStorage.removeItem('anbarin_local_users_v1');
        else localStorage.setItem('anbarin_local_users_v1', rollback.users);
        if (rollback.operator === null) localStorage.removeItem('anbar_operator');
        else localStorage.setItem('anbar_operator', rollback.operator);
        await bootState();
        saveAppState(true);
        rollbackMessage = ' اطلاعات قبلی با موفقیت بازگردانی شد.';
        localStorage.removeItem('anbarin_restore_journal_v1');
      } catch (rollbackError) {
        console.error('[Anbarin] rollback failed', rollbackError);
        rollbackMessage = ' هشدار بحرانی: بازگردانی خودکار کامل نشد؛ snapshot اضطراری در IndexedDB نگهداری شده است.';
      }
    }
    return { ok: false, message: (error instanceof Error ? error.message : 'بازیابی ناموفق بود') + rollbackMessage };
  }
}

/** بازیابی فایل دستی از همان موتور و سیاست لایسنس پشتیبان خودکار استفاده می‌کند. */
export async function restoreBackupFile(file: File): Promise<{ ok: boolean; message: string }> {
  const { idbPut, persistAppState } = await import('./storage');
  let rollback: { app: Record<string, unknown>; accounting: unknown; commerce: unknown; costing: unknown } | null = null;
  let restoreStarted = false;
  try {
    const raw = await file.text();
    const value = JSON.parse(raw) as Record<string, any> | BackupEnvelope;
    let parsed: Record<string, any>;
    if (isEncryptedBackup(value)) {
      let recovered: unknown;
      const password = window.prompt('رمز بازیابی این نسخه را وارد کنید. برای بازیابی سازمانی، رمز را خالی بگذارید و لغو کنید.');
      if (password !== null && password.length > 0) {
        try { recovered = await decryptBackupWithPassword(value, password); }
        catch (passwordError) {
          const useAdmin = window.confirm(`${passwordError instanceof Error ? passwordError.message : 'رمز بازیابی پذیرفته نشد'}\nآیا می‌خواهید مدیر اصلی سازمان با کلید خصوصی بازیابی کند؟`);
          if (!useAdmin) throw passwordError;
        }
      }
      if (recovered === undefined) {
        const packageText = window.prompt('مدیر اصلی: محتوای کامل فایل JSON کلید خصوصی سازمانی را وارد کنید.');
        if (!packageText) throw new Error('بازیابی لغو شد؛ رمز عبور یا کلید خصوصی سازمانی لازم است');
        const managerPassword = window.prompt('رمز محافظ کلید خصوصی مدیر را وارد کنید.');
        if (!managerPassword) throw new Error('رمز محافظ کلید مدیر وارد نشد');
        recovered = await decryptBackupWithOrganizationKeyPackage(value, JSON.parse(packageText), managerPassword);
      }
      if (!recovered || typeof recovered !== 'object') throw new Error('محتوای رمزگشایی‌شده معتبر نیست');
      parsed = recovered as Record<string, any>;
    } else parsed = value as Record<string, any>;

    if (!parsed || parsed.schema !== 'anbarin-full-device-backup') throw new Error('ساختار فایل پشتیبان معتبر نیست.');
    const restoreScope = getBackupScopeFromPayload(parsed as { version?: number; scope?: { modules?: unknown } });
    if (!restoreScope.count && !restoreScope.accounting) throw new Error('این فایل هیچ ماژول مجاز و مشترکی با لایسنس فعلی ندارد.');
    if (restoreScope.count && (!parsed.app || !Array.isArray(parsed.app.products) || !parsed.app.products.every((v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v))))
      throw new Error('ساختار اطلاعات انبار در فایل پشتیبان معتبر نیست.');
    const version = Number(parsed.version || 1);
    if (!Number.isInteger(version) || version < 1 || version > 4) throw new Error('نسخه پشتیبان با این برنامه سازگار نیست.');
    if (parsed.integrity) {
      if (parsed.integrity.algorithm !== 'SHA-256' || typeof parsed.integrity.digest !== 'string') throw new Error('ساختار کنترل صحت فایل معتبر نیست.');
      const { integrity, ...body } = parsed;
      if (await sha256(body) !== integrity.digest) throw new Error('کنترل صحت فایل پشتیبان ناموفق بود.');
    } else if (version >= 2) throw new Error('فایل پشتیبان فاقد اطلاعات کنترل صحت است.');
    if (restoreScope.accounting && parsed.accounting != null && (parsed.accounting.schemaVersion !== 1 || !Array.isArray(parsed.accounting.accounts) || !Array.isArray(parsed.accounting.journalEntries)))
      throw new Error('ساختار اطلاعات حسابداری معتبر نیست.');
    if (restoreScope.accounting && parsed.commerce != null && !isValidCommerceBackup(parsed.commerce))
      throw new Error('ساختار اطلاعات بازرگانی یا ردیف‌های فاکتور معتبر نیست.');
    if (restoreScope.accounting && parsed.costing != null && (parsed.costing.schemaVersion !== 1 || !Array.isArray(parsed.costing.layers) || !Array.isArray(parsed.costing.movements)))
      throw new Error('ساختار بهای تمام‌شده معتبر نیست.');

    const [currentAccounting, currentCommerce, currentCosting] = await Promise.all([loadAccountingData(), loadCommerceData(), loadInventoryCostData()]);
    rollback = {
      app: { products: [...products], settings: structuredClone(settings), session: structuredClone(session), auditLog: structuredClone(auditLog), recentScans: structuredClone(recentScans), inventoryDocs: structuredClone(inventoryDocs) },
      accounting: currentAccounting, commerce: currentCommerce, costing: currentCosting,
    };
    const emergency = await buildFullDeviceBackupPayload({ includeAllModules: true });
    await idbPut('emergency_before_selected_restore', { savedAt: new Date().toISOString(), payload: emergency, source: file.name });
    localStorage.setItem('anbarin_restore_journal_v1', JSON.stringify({ version: 1, startedAt: new Date().toISOString(), source: file.name }));
    restoreStarted = true;
    if (restoreScope.count && parsed.app) {
      await persistAppState({
        products: parsed.app.products,
        settings: parsed.app.settings || settings,
        session: parsed.app.session ?? null,
        auditLog: Array.isArray(parsed.app.auditLog) ? parsed.app.auditLog : [],
        recentScans: Array.isArray(parsed.app.recentScans) ? parsed.app.recentScans : [],
        inventoryDocs: Array.isArray(parsed.app.inventoryDocs) ? parsed.app.inventoryDocs : [],
      } as never);
    }
    if (restoreScope.accounting && parsed.accounting) await saveAccountingData(parsed.accounting as never);
    if (restoreScope.accounting && parsed.commerce) await saveCommerceData(parsed.commerce as never);
    if (restoreScope.accounting && parsed.costing) await saveInventoryCostData(parsed.costing as never);
    await bootState();
    saveAppState(true);
    if (restoreScope.count && parsed.app) {
      try { sessionStorage.setItem('anbarin_just_restored_external', String(parsed.app.products.length)); } catch { /* ignore */ }
    }
    localStorage.setItem('anbarin_last_restore_iso', new Date().toISOString());
    localStorage.removeItem('anbarin_restore_journal_v1');
    const restored: string[] = [];
    if (restoreScope.count) restored.push('شمارش و انبار');
    if (restoreScope.accounting) restored.push('حسابداری و بازرگانی');
    return { ok: true, message: `بازیابی موفق: ${restored.join(' و ')}` };
  } catch (error) {
    console.error('[Anbarin] manual unified backup restore failed', error);
    let rollbackMessage = '';
    if (restoreStarted && rollback) {
      try {
        await persistAppState(rollback.app as never);
        await saveAccountingData(rollback.accounting as never);
        await saveCommerceData(rollback.commerce as never);
        await saveInventoryCostData(rollback.costing as never);
        await bootState();
        saveAppState(true);
        localStorage.removeItem('anbarin_restore_journal_v1');
        rollbackMessage = ' اطلاعات قبلی بازگردانی شد.';
      } catch (rollbackError) {
        console.error('[Anbarin] manual restore rollback failed', rollbackError);
        rollbackMessage = ' هشدار: بازگردانی خودکار کامل نشد؛ snapshot اضطراری نگهداری شده است.';
      }
    }
    return { ok: false, message: (error instanceof Error ? error.message : 'بازیابی ناموفق بود') + rollbackMessage };
  }
}

/**
 * اگر اپ هنگام بازیابی بسته/کشته شده باشد، snapshot اضطراری را در شروع بعدی برمی‌گرداند.
 * این مسیر فقط با وجود journal پایدار فعال می‌شود و در صورت شکست، نشانگر را نگه می‌دارد.
 */
export async function recoverInterruptedSelectedRestore(): Promise<'clean' | 'recovered' | 'failed'> {
  let journal: { version?: number; source?: string } | null = null;
  try {
    const raw = localStorage.getItem('anbarin_restore_journal_v1');
    if (!raw) return 'clean';
    journal = JSON.parse(raw);
    if (journal?.version !== 1) throw new Error('نشانگر بازیابی اضطراری ناشناخته است');

    const { idbGet, persistAppState } = await import('./storage');
    const snapshot = await idbGet<{ payload?: Record<string, any> }>('emergency_before_selected_restore');
    const parsed = snapshot?.payload;
    if (!parsed || parsed.schema !== 'anbarin-full-device-backup' || !parsed.app || !Array.isArray(parsed.app.products) ||
        !parsed.app.products.every((item: unknown) => !!item && typeof item === 'object' && !Array.isArray(item)))
      throw new Error('snapshot اضطراری معتبر یا کامل نیست');
    const recoveryVersion = Number(parsed.version || 1);
    if (!Number.isInteger(recoveryVersion) || recoveryVersion < 1 || recoveryVersion > 4)
      throw new Error('نسخه snapshot اضطراری با این برنامه سازگار نیست');
    // همه لایه‌ها پیش از اولین نوشتن بررسی می‌شوند تا snapshot ناقص داده‌های فعلی را نیمه‌کاره جایگزین نکند.
    if (parsed.accounting != null && (parsed.accounting.schemaVersion !== 1 || !Array.isArray(parsed.accounting.accounts) || !Array.isArray(parsed.accounting.journalEntries)))
      throw new Error('ساختار حسابداری snapshot اضطراری معتبر نیست');
    if (parsed.commerce != null && !isValidCommerceBackup(parsed.commerce))
      throw new Error('ساختار فاکتورها و ردیف‌های snapshot اضطراری معتبر نیست');
    if (parsed.costing != null && (parsed.costing.schemaVersion !== 1 || !Array.isArray(parsed.costing.layers) || !Array.isArray(parsed.costing.movements)))
      throw new Error('ساختار بهای تمام‌شده snapshot اضطراری معتبر نیست');
    if (parsed.integrity?.algorithm === 'SHA-256') {
      const { integrity, ...body } = parsed;
      if (typeof integrity.digest !== 'string' || await sha256(body) !== integrity.digest)
        throw new Error('کنترل یکپارچگی snapshot اضطراری ناموفق بود');
    }

    await persistAppState({
      products: parsed.app.products,
      settings: parsed.app.settings || settings,
      session: parsed.app.session ?? null,
      auditLog: Array.isArray(parsed.app.auditLog) ? parsed.app.auditLog : [],
      recentScans: Array.isArray(parsed.app.recentScans) ? parsed.app.recentScans : [],
      inventoryDocs: Array.isArray(parsed.app.inventoryDocs) ? parsed.app.inventoryDocs : [],
    } as never);
    if (parsed.accounting) await saveAccountingData(parsed.accounting as never);
    if (parsed.commerce) await saveCommerceData(parsed.commerce as never);
    if (parsed.costing) await saveInventoryCostData(parsed.costing as never);
    if (Array.isArray(parsed.localUsers)) localStorage.setItem('anbarin_local_users_v1', JSON.stringify(parsed.localUsers));
    if (typeof parsed.operator === 'string') localStorage.setItem('anbar_operator', parsed.operator);
    await bootState();
    saveAppState(true);
    localStorage.removeItem('anbarin_restore_journal_v1');
    localStorage.setItem('anbarin_last_restore_recovery_iso', new Date().toISOString());
    toast('بازیابی قبلی نیمه‌تمام بود؛ snapshot امن قبلی با موفقیت بازگردانده شد', 'success');
    return 'recovered';
  } catch (error) {
    console.error('[Anbarin] interrupted restore recovery failed', error);
    toast('هشدار: بازیابی قبلی نیمه‌تمام مانده و snapshot اضطراری خودکار بازنگشت؛ داده‌ها را پاک نکنید', 'error');
    return 'failed';
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
