import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const source = fs.readFileSync(new URL('../src/modules/backup-crypto.ts', import.meta.url), 'utf8');
const javascript = stripTypeScriptTypes(source, { mode: 'transform' });
const cryptoModule = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
  clear() { this.values.clear(); }
}
globalThis.localStorage = new MemoryStorage();

const userPassword = 'Anbarin-user-recovery-2026!';
const managerPassword = 'Anbarin-org-manager-2026!';
const payload = {
  schema: 'anbarin-full-device-backup',
  version: 3,
  app: { products: [{ id: 'p-1', name: 'نمونه کالا', quantity: 17 }] },
  accounting: { accounts: [], journalEntries: [] },
};
let envelope;
let organizationPackage;

async function setup() {
  if (envelope) return;
  await cryptoModule.initializeBackupPassword(userPassword);
  const organization = await cryptoModule.initializeOrganizationRecoveryKey(managerPassword);
  organizationPackage = organization.privateKeyPackage;
  await cryptoModule.importOrganizationPublicKey(organization.publicKeyPem);
  envelope = await cryptoModule.encryptBackupPayload(payload);
}

test('runtime: encrypted backup round-trips through user password and organization recovery', async () => {
  await setup();
  assert.equal(cryptoModule.isEncryptedBackup(envelope), true);
  assert.deepEqual(await cryptoModule.decryptBackupWithPassword(envelope, userPassword), payload);
  assert.deepEqual(
    await cryptoModule.decryptBackupWithOrganizationKeyPackage(envelope, organizationPackage, managerPassword),
    payload,
  );
});

test('runtime: wrong user password and wrong manager password are rejected', async () => {
  await setup();
  await assert.rejects(
    cryptoModule.decryptBackupWithPassword(envelope, 'Wrong-password-000'),
    /رمز بازیابی اشتباه است|آسیب دیده/,
  );
  await assert.rejects(
    cryptoModule.decryptBackupWithOrganizationKeyPackage(envelope, organizationPackage, 'Wrong-manager-000'),
    /رمز بازیابی اشتباه است|آسیب دیده/,
  );
});

test('runtime: modified ciphertext is rejected by AES-GCM authentication', async () => {
  await setup();
  const altered = structuredClone(envelope);
  const bytes = Buffer.from(altered.ciphertext, 'base64');
  bytes[bytes.length - 1] ^= 1;
  altered.ciphertext = bytes.toString('base64');
  await assert.rejects(
    cryptoModule.decryptBackupWithPassword(altered, userPassword),
    /اعتبارسنجی اصالت AES-GCM ناموفق/,
  );
  await assert.rejects(
    cryptoModule.decryptBackupWithOrganizationKeyPackage(altered, organizationPackage, managerPassword),
    /اعتبارسنجی اصالت AES-GCM ناموفق/,
  );
});

test('runtime: organization key identifier prevents using an unrelated recovery key', async () => {
  await setup();
  const altered = structuredClone(envelope);
  altered.organizationKey.keyId = '000000000000000000000000';
  await assert.rejects(
    cryptoModule.decryptBackupWithOrganizationKeyPackage(altered, organizationPackage, managerPassword),
    /مطابقت ندارد/,
  );
});

test('runtime: password rotation preserves access to newly created backups', async () => {
  await setup();
  const nextPassword = 'Anbarin-user-recovery-rotated!';
  await cryptoModule.changeBackupPassword(userPassword, nextPassword);
  const nextEnvelope = await cryptoModule.encryptBackupPayload(payload);
  assert.deepEqual(await cryptoModule.decryptBackupWithPassword(nextEnvelope, nextPassword), payload);
  await assert.rejects(cryptoModule.decryptBackupWithPassword(nextEnvelope, userPassword));
});

test('runtime: v2 authenticates metadata and wrapped recovery-key slots', async () => {
  await setup();
  assert.equal(envelope.version, 2);
  const alteredMetadata = structuredClone(envelope);
  alteredMetadata.createdAt = '2000-01-01T00:00:00.000Z';
  await assert.rejects(
    cryptoModule.decryptBackupWithOrganizationKeyPackage(alteredMetadata, organizationPackage, managerPassword),
    /اعتبارسنجی اصالت AES-GCM ناموفق/,
  );
  const alteredWrap = structuredClone(envelope);
  const wrapBytes = Buffer.from(alteredWrap.organizationKey.wrappedDek, 'base64');
  wrapBytes[0] ^= 1;
  alteredWrap.organizationKey.wrappedDek = wrapBytes.toString('base64');
  await assert.rejects(
    cryptoModule.decryptBackupWithOrganizationKeyPackage(alteredWrap, organizationPackage, managerPassword),
    /OperationError|اعتبارسنجی اصالت AES-GCM ناموفق/,
  );
});

test('compatibility: v2 reader decrypts a legacy v1 envelope', async () => {
  globalThis.localStorage.clear();
  const legacySource = fs.readFileSync(new URL('./fixtures/backup-crypto-v1.ts', import.meta.url), 'utf8');
  const legacyJs = stripTypeScriptTypes(legacySource, { mode: 'transform' });
  const legacyModule = await import(`data:text/javascript;base64,${Buffer.from(legacyJs).toString('base64')}`);
  const legacyUserPassword = 'Legacy-user-password-2026!';
  const legacyManagerPassword = 'Legacy-manager-password-2026!';
  await legacyModule.initializeBackupPassword(legacyUserPassword);
  const organization = await legacyModule.initializeOrganizationRecoveryKey(legacyManagerPassword);
  await legacyModule.importOrganizationPublicKey(organization.publicKeyPem);
  const legacyEnvelope = await legacyModule.encryptBackupPayload(payload);
  assert.equal(legacyEnvelope.version, 1);
  assert.deepEqual(await cryptoModule.decryptBackupWithPassword(legacyEnvelope, legacyUserPassword), payload);
  assert.deepEqual(
    await cryptoModule.decryptBackupWithOrganizationKeyPackage(legacyEnvelope, organization.privateKeyPackage, legacyManagerPassword),
    payload,
  );
});
