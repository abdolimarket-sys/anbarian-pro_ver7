import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const scope = fs.readFileSync(new URL('../src/modules/backup-scope.ts', import.meta.url), 'utf8');
const backup = fs.readFileSync(new URL('../src/modules/device-auto-backup.ts', import.meta.url), 'utf8');
const accountingUi = fs.readFileSync(new URL('../src/modules/accounting-ui.ts', import.meta.url), 'utf8');
const main = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

test('backup scope is derived from the active count/accounting licenses', () => {
  assert.match(scope, /hasModule\('count'\)/);
  assert.match(scope, /hasModule\('accounting'\)/);
  assert.match(scope, /getBackupScopeFromPayload/);
  assert.match(scope, /if \(!Array\.isArray\(payload\.scope\?\.modules\)\)/);
});

test('new automatic backups include only licensed modules and declare their scope', () => {
  assert.match(backup, /scope: \{ modules: \[\.\.\.scope\.modules\] \}/);
  assert.match(backup, /app: scope\.count \?/);
  assert.match(backup, /scope\.accounting \? loadAccountingData/);
  assert.match(backup, /version: 4/);
  assert.match(backup, /hasAccountingData/);
});

test('selected restore intersects backup scope with currently licensed modules', () => {
  assert.match(backup, /getBackupScopeFromPayload\(parsed/);
  assert.match(backup, /if \(restoreScope\.count && app\)/);
  assert.match(backup, /if \(restoreScope\.accounting && parsed\.accounting\)/);
});

test('accounting backup UI is consolidated into the settings backup manager', () => {
  assert.doesNotMatch(accountingUi, /accBackup(Download|Share|Restore|File)/);
  assert.doesNotMatch(accountingUi, /anbarin-accounting-backup/);
  assert.match(main, /btnExportUnifiedBackup/);
  assert.match(main, /btnImportUnifiedBackup/);
});
