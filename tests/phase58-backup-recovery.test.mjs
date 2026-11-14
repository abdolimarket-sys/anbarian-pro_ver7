import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const storage = fs.readFileSync(new URL('../src/modules/storage.ts', import.meta.url), 'utf8');
const backup = fs.readFileSync(new URL('../src/modules/device-auto-backup.ts', import.meta.url), 'utf8');
const native = fs.readFileSync(new URL('../android/app/src/main/java/com/anbarian/app/AutoBackupPlugin.java', import.meta.url), 'utf8');

test('logical backup history is unlimited by default and supports configurable retention', () => {
  assert.match(storage, /autobackup_history/);
  assert.match(storage, /anbarin_backup_retention_count/);
  assert.match(storage, /: ordered/);
});

test('external backup captures core, accounting, commerce, costing and users', () => {
  for (const field of ['products', 'settings', 'session', 'auditLog', 'recentScans', 'inventoryDocs']) {
    assert.match(backup, new RegExp(`\\b${field}\\s*[,}]`));
  }
  for (const field of ['accounting', 'commerce', 'costing', 'localUsers']) assert.match(backup, new RegExp(`\\b${field}\\b`));
  assert.match(backup, /algorithm: 'SHA-256'/);
  assert.match(backup, /version: 4/);
});

test('restore validates checksum and data structures before first write', () => {
  const validation = backup.indexOf('مرحله ۳: کنترل زیرساختارها');
  const firstWrite = backup.indexOf('restoreStarted = true');
  assert.ok(validation > 0 && firstWrite > validation);
  assert.match(backup, /SHA-256/);
});

test('restore records emergency snapshot and rolls back all data domains on failure', () => {
  assert.match(backup, /emergency_before_selected_restore/);
  assert.match(backup, /rollbackMessage/);
  for (const call of ['persistAppState(rollback.app', 'saveAccountingData(rollback.accounting', 'saveCommerceData(rollback.commerce', 'saveInventoryCostData(rollback.costing']) {
    assert.ok(backup.includes(call), `missing rollback step: ${call}`);
  }
});

test('native backup writer no longer silently prunes old recovery files', () => {
  assert.match(native, /Retention is unlimited by default/);
  assert.match(native, /private void pruneOldBackups\(\)/);
});

test('new external backups use envelope encryption with separate user and organization key wraps', () => {
  const crypto = fs.readFileSync(new URL('../src/modules/backup-crypto.ts', import.meta.url), 'utf8');
  assert.match(backup, /encryptBackupPayload\(payload\)/);
  assert.match(backup, /decryptBackupWithPassword/);
  assert.match(backup, /decryptBackupWithOrganizationKeyPackage/);
  assert.match(crypto, /AES-256-GCM/);
  assert.match(crypto, /RSA-OAEP-3072-SHA256/);
  assert.match(crypto, /PBKDF2-SHA256\+A256GCM/);
  assert.match(crypto, /wrappedDek/);
  assert.match(crypto, /protectedPrivateKey/);
});

test('legacy plaintext versions remain supported by selected restore', () => {
  assert.match(backup, /const fileValue = JSON\.parse\(raw\)/);
  assert.match(backup, /if \(isEncryptedBackup\(fileValue\)\)/);
  assert.match(backup, /نسخه‌های ۱ تا ۳ برای سازگاری پذیرفته می‌شوند/);
  assert.match(backup, /version > 4/);
});

test('automatic recovery routes encrypted files through transactional selected restore', () => {
  assert.match(backup, /if \(chosenEncrypted\)/);
  assert.match(backup, /restoreSelectedExternalBackup\(chosen\)/);
});
