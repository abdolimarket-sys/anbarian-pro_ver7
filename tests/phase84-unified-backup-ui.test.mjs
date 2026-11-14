import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const main = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const accountingUi = fs.readFileSync(new URL('../src/modules/accounting-ui.ts', import.meta.url), 'utf8');
const backup = fs.readFileSync(new URL('../src/modules/device-auto-backup.ts', import.meta.url), 'utf8');

test('accounting no longer exposes a second backup screen or separate payload', () => {
  assert.doesNotMatch(accountingUi, /accBackup(Download|Share|Restore|File)/);
  assert.doesNotMatch(accountingUi, /anbarin-accounting-backup/);
  assert.doesNotMatch(accountingUi, /data-acc-section="backup"/);
});

test('settings exposes the single encrypted unified backup and restore entry point', () => {
  assert.match(main, /btnExportUnifiedBackup/);
  assert.match(main, /btnImportUnifiedBackup/);
  assert.match(main, /encryptBackupPayload\(payload\)/);
  assert.match(main, /restoreBackupFile\(file\)/);
});

test('manual restore uses shared license intersection, validation and emergency rollback', () => {
  assert.match(backup, /export async function restoreBackupFile/);
  assert.match(backup, /getBackupScopeFromPayload\(parsed/);
  assert.match(backup, /if \(restoreScope\.count && parsed\.app\)/);
  assert.match(backup, /if \(restoreScope\.accounting && parsed\.accounting\)/);
  assert.match(backup, /emergency_before_selected_restore/);
  assert.match(backup, /anbarin_restore_journal_v1/);
});

test('generic inventory export no longer exposes a second full-backup path', () => {
  const imports = fs.readFileSync(new URL('../src/modules/import-export.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(main, /btnExportJson/);
  assert.doesNotMatch(main, /exportJSON/);
  assert.doesNotMatch(imports, /export async function exportJSON/);
  assert.match(imports, /full backup and restore live only in Settings/);
  assert.match(imports, /data\?\.type === 'anbar-backup'/);
  assert.match(imports, /بازیابی پشتیبان کامل فقط از بخش تنظیمات انجام می‌شود/);
});
