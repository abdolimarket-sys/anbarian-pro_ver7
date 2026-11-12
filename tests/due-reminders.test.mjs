import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

test('due reminder is opt-in and deduplicates once per local day', () => {
  const source = fs.readFileSync(path.join(root, 'src/modules/due-reminders.ts'), 'utf8');
  assert.match(source, /if \(!settings\.dueReminderEnabled\) return/);
  assert.match(source, /anbarin_due_reminder_\$\{today\}/);
  assert.match(source, /localStorage\.setItem\(key, '1'\)/);
  assert.match(source, /overdueCheques/);
  assert.match(source, /overdueInvoices/);
});

test('due reminder setting defaults off and is wired into settings form', () => {
  const storage = fs.readFileSync(path.join(root, 'src/modules/storage.ts'), 'utf8');
  const types = fs.readFileSync(path.join(root, 'src/types/index.ts'), 'utf8');
  const settings = fs.readFileSync(path.join(root, 'src/modules/session-settings.ts'), 'utf8');
  assert.match(storage, /dueReminderEnabled: false/);
  assert.match(types, /dueReminderEnabled\?: boolean/);
  assert.match(settings, /setDueReminderEnabled/);
});
