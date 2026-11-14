import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const moduleSource = await readFile(new URL('../src/modules/device-auto-backup.ts', import.meta.url), 'utf8');
const mainSource = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8');

test('selected restore persists emergency snapshot before setting the recovery journal', () => {
  const snapshot = moduleSource.indexOf("idbPut('emergency_before_selected_restore'");
  const journal = moduleSource.indexOf("localStorage.setItem('anbarin_restore_journal_v1'");
  const firstWrite = moduleSource.indexOf('restoreStarted = true', journal);
  assert.ok(snapshot >= 0 && journal > snapshot && firstWrite > journal);
});

test('successful restore clears the journal only after state boot/save completes', () => {
  const successBoot = moduleSource.indexOf('await bootState();', moduleSource.indexOf('export async function restoreSelectedExternalBackup'));
  const successSave = moduleSource.indexOf('saveAppState(true);', successBoot);
  const clearJournal = moduleSource.indexOf("localStorage.removeItem('anbarin_restore_journal_v1');", successSave);
  assert.ok(successBoot >= 0 && successSave > successBoot && clearJournal > successSave);
});

test('startup recovery validates and reapplies the emergency snapshot, then clears journal', () => {
  const recovery = moduleSource.slice(moduleSource.indexOf('export async function recoverInterruptedSelectedRestore'), moduleSource.indexOf('/** زمان‌بندی پشتیبان'));
  assert.match(recovery, /anbarin_restore_journal_v1/);
  assert.match(recovery, /emergency_before_selected_restore/);
  assert.match(recovery, /await sha256\(body\)/);
  assert.match(recovery, /await persistAppState/);
  assert.match(recovery, /await saveAccountingData/);
  assert.match(recovery, /await saveCommerceData/);
  assert.match(recovery, /await saveInventoryCostData/);
  assert.match(recovery, /removeItem\('anbarin_restore_journal_v1'\)/);
});

test('app startup attempts interrupted-restore recovery before external-backup discovery', () => {
  assert.match(mainSource, /recoverInterruptedSelectedRestore/);
  const interrupted = mainSource.indexOf('await recoverInterruptedSelectedRestore()');
  const external = mainSource.indexOf('await tryRecoverFromExternalBackup()', interrupted);
  assert.ok(interrupted >= 0 && external > interrupted);
  assert.match(mainSource, /interruptedRestore !== 'failed' && \(source === 'empty' \|\| products.length === 0\)/);
});
