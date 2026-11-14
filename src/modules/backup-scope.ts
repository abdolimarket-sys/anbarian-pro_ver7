/** Shared backup scope policy: backup and restore only licensed modules. */
import { hasModule, type AppModuleId } from './license-modules';

export interface BackupModuleScope { count: boolean; accounting: boolean; modules: AppModuleId[]; }

export function getLicensedBackupScope(): BackupModuleScope {
  const count = hasModule('count');
  const accounting = hasModule('accounting');
  return { count, accounting, modules: (['count', 'accounting'] as AppModuleId[]).filter((m) => m === 'count' ? count : accounting) };
}

/** Legacy v1-v3 backups predate module scopes and are treated as full backups. */
export function getBackupScopeFromPayload(payload: { version?: number; scope?: { modules?: unknown } }): BackupModuleScope {
  const current = getLicensedBackupScope();
  if ((payload.version || 1) < 4) return current;
  if (!Array.isArray(payload.scope?.modules)) return { count: false, accounting: false, modules: [] };
  const included = new Set(payload.scope.modules.filter((m): m is AppModuleId => m === 'count' || m === 'accounting'));
  const count = current.count && included.has('count');
  const accounting = current.accounting && included.has('accounting');
  return { count, accounting, modules: (['count', 'accounting'] as AppModuleId[]).filter((m) => m === 'count' ? count : accounting) };
}
