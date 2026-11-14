/** Envelope encryption for portable Anbarin backups (envelope v2; reads legacy v1).
 * Data: AES-256-GCM with a fresh DEK per backup.
 * User recovery: per-device RSA-OAEP keypair; PKCS8 private key is PBKDF2/AES-GCM protected.
 * Organization recovery: DEK is additionally wrapped to an organization RSA-OAEP public key.
 * The organization private key is exported once and must be kept offline by the organization.
 */
const USER_PUBLIC = 'anbarin_backup_user_public_v1';
const USER_PRIVATE = 'anbarin_backup_user_private_envelope_v1';
const ORG_PUBLIC = 'anbarin_backup_org_public_v1';
const enc = new TextEncoder();
const dec = new TextDecoder();
const ITERATIONS = 600_000;
const RSA_ALGORITHM = { name: 'RSA-OAEP', modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' } as const;

type JsonWebKeyPair = { publicKey: JsonWebKey; privateKey: JsonWebKey };
type ProtectedPrivate = { algorithm: 'PBKDF2-SHA256+A256GCM'; iterations: number; salt: string; iv: string; ciphertext: string };
export type BackupEnvelope = {
  format: 'anbarin-encrypted-backup'; version: 1 | 2; cipher: 'AES-256-GCM';
  iv: string; ciphertext: string;
  userKey: { algorithm: 'RSA-OAEP-3072-SHA256'; publicKey: string; protectedPrivateKey: ProtectedPrivate; wrappedDek: string };
  organizationKey?: { algorithm: 'RSA-OAEP-3072-SHA256'; keyId: string; wrappedDek: string };
  createdAt: string;
};

function webCrypto(): Crypto {
  if (!globalThis.crypto?.subtle || !globalThis.crypto.getRandomValues) throw new Error('رمزنگاری امن در این دستگاه در دسترس نیست');
  return globalThis.crypto;
}
function random(length: number): Uint8Array { return webCrypto().getRandomValues(new Uint8Array(length)); }
function b64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = ''; for (let i = 0; i < view.length; i += 0x8000) out += String.fromCharCode(...view.subarray(i, i + 0x8000));
  return btoa(out);
}
function unb64(value: string): Uint8Array { return Uint8Array.from(atob(value), c => c.charCodeAt(0)); }
function pem(type: string, bytes: ArrayBuffer): string {
  const data = b64(bytes).match(/.{1,64}/g)?.join('\n') || '';
  return `-----BEGIN ${type}-----\n${data}\n-----END ${type}-----`;
}
function pemBytes(value: string, type: string): Uint8Array {
  const body = value.replace(new RegExp(`-----BEGIN ${type}-----|-----END ${type}-----|\\s`, 'g'), '');
  if (!body || !/^[A-Za-z0-9+/]+=*$/.test(body)) throw new Error('قالب کلید PEM معتبر نیست');
  return unb64(body);
}
async function derivePasswordKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  if (password.length < 12) throw new Error('رمز بازیابی باید حداقل ۱۲ نویسه داشته باشد');
  const material = await webCrypto().subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return webCrypto().subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function protectPrivateKey(pkcs8: ArrayBuffer, password: string): Promise<ProtectedPrivate> {
  const salt = random(16), iv = random(12), key = await derivePasswordKey(password, salt);
  const ciphertext = await webCrypto().subtle.encrypt({ name: 'AES-GCM', iv }, key, pkcs8);
  return { algorithm: 'PBKDF2-SHA256+A256GCM', iterations: ITERATIONS, salt: b64(salt), iv: b64(iv), ciphertext: b64(ciphertext) };
}
async function unprotectPrivateKey(protectedKey: ProtectedPrivate, password: string): Promise<ArrayBuffer> {
  if (!protectedKey || protectedKey.algorithm !== 'PBKDF2-SHA256+A256GCM' || protectedKey.iterations !== ITERATIONS) throw new Error('پارامترهای کلید بازیابی ناشناخته یا نامعتبر است');
  const key = await derivePasswordKey(password, unb64(protectedKey.salt));
  try { return await webCrypto().subtle.decrypt({ name: 'AES-GCM', iv: unb64(protectedKey.iv) }, key, unb64(protectedKey.ciphertext)); }
  catch { throw new Error('رمز بازیابی اشتباه است یا بسته کلید آسیب دیده است'); }
}
async function importPublic(spki: string): Promise<CryptoKey> {
  return webCrypto().subtle.importKey('spki', unb64(spki), RSA_ALGORITHM, true, ['encrypt']);
}
async function importPrivate(pkcs8: ArrayBuffer): Promise<CryptoKey> {
  return webCrypto().subtle.importKey('pkcs8', pkcs8, RSA_ALGORITHM, false, ['decrypt']);
}
async function sha256Hex(value: string): Promise<string> {
  const digest = await webCrypto().subtle.digest('SHA-256', enc.encode(value));
  return [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, '0')).join('');
}

/** Canonical authenticated metadata for envelope v2. The wrapped keys and KDF envelope
 * are bound to the ciphertext so metadata/key-slot substitution is detected by GCM.
 */
function envelopeAad(envelope: BackupEnvelope): Uint8Array {
  const protectedKey = envelope.userKey.protectedPrivateKey;
  const fields = [
    envelope.format, String(envelope.version), envelope.cipher, envelope.iv, envelope.createdAt,
    envelope.userKey.algorithm, envelope.userKey.publicKey, envelope.userKey.wrappedDek,
    protectedKey.algorithm, String(protectedKey.iterations), protectedKey.salt, protectedKey.iv, protectedKey.ciphertext,
    envelope.organizationKey?.algorithm || '', envelope.organizationKey?.keyId || '', envelope.organizationKey?.wrappedDek || '',
  ];
  return enc.encode(JSON.stringify(fields));
}

export async function initializeBackupPassword(password: string): Promise<void> {
  if (localStorage.getItem(USER_PUBLIC) || localStorage.getItem(USER_PRIVATE)) throw new Error('کلید رمز بازیابی قبلاً ساخته شده است؛ برای تغییر رمز از فرایند تغییر رمز استفاده کنید');
  const pair = await webCrypto().subtle.generateKey(RSA_ALGORITHM, true, ['encrypt', 'decrypt']) as CryptoKeyPair;
  const publicKey = await webCrypto().subtle.exportKey('spki', pair.publicKey);
  const privateKey = await webCrypto().subtle.exportKey('pkcs8', pair.privateKey);
  const protectedPrivateKey = await protectPrivateKey(privateKey, password);
  localStorage.setItem(USER_PUBLIC, b64(publicKey));
  localStorage.setItem(USER_PRIVATE, JSON.stringify(protectedPrivateKey));
}

export async function changeBackupPassword(currentPassword: string, nextPassword: string): Promise<void> {
  const stored = localStorage.getItem(USER_PRIVATE);
  if (!stored) throw new Error('کلید رمز بازیابی هنوز تنظیم نشده است');
  const oldEnvelope = JSON.parse(stored) as ProtectedPrivate;
  const pkcs8 = await unprotectPrivateKey(oldEnvelope, currentPassword);
  const protectedNext = await protectPrivateKey(pkcs8, nextPassword);
  localStorage.setItem(USER_PRIVATE, JSON.stringify(protectedNext));
}

export type OrganizationPrivateKeyPackage = { format: 'anbarin-org-private-key'; version: 1; keyId: string; publicKey: string; protectedPrivateKey: ProtectedPrivate };

export async function initializeOrganizationRecoveryKey(managerPassword: string): Promise<{ publicKeyPem: string; privateKeyPackage: OrganizationPrivateKeyPackage; keyId: string }> {
  if (managerPassword.length < 12) throw new Error('رمز محافظ کلید مدیر باید حداقل ۱۲ نویسه داشته باشد');
  const pair = await webCrypto().subtle.generateKey(RSA_ALGORITHM, true, ['encrypt', 'decrypt']) as CryptoKeyPair;
  const publicRaw = await webCrypto().subtle.exportKey('spki', pair.publicKey);
  const privateRaw = await webCrypto().subtle.exportKey('pkcs8', pair.privateKey);
  const publicKeyPem = pem('PUBLIC KEY', publicRaw);
  const publicEncoded = b64(publicRaw);
  const keyId = (await sha256Hex(publicEncoded)).slice(0, 24);
  const privateKeyPackage: OrganizationPrivateKeyPackage = {
    format: 'anbarin-org-private-key', version: 1, keyId, publicKey: publicEncoded,
    protectedPrivateKey: await protectPrivateKey(privateRaw, managerPassword),
  };
  localStorage.setItem(ORG_PUBLIC, publicEncoded);
  return { publicKeyPem, privateKeyPackage, keyId };
}

export async function decryptBackupWithOrganizationKeyPackage(envelope: BackupEnvelope, keyPackage: OrganizationPrivateKeyPackage, managerPassword: string): Promise<unknown> {
  validateEnvelope(envelope);
  if (!envelope.organizationKey || !keyPackage || keyPackage.format !== 'anbarin-org-private-key' || keyPackage.version !== 1 || keyPackage.keyId !== envelope.organizationKey.keyId) throw new Error('کلید خصوصی سازمان با این بکاپ مطابقت ندارد');
  const actualKeyId = (await sha256Hex(keyPackage.publicKey)).slice(0, 24);
  if (actualKeyId !== keyPackage.keyId) throw new Error('شناسه کلید سازمانی معتبر نیست');
  const pkcs8 = await unprotectPrivateKey(keyPackage.protectedPrivateKey, managerPassword);
  const privateKey = await importPrivate(pkcs8);
  const dek = await webCrypto().subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, unb64(envelope.organizationKey.wrappedDek));
  return decryptPayload(envelope, dek);
}

export async function importOrganizationPublicKey(publicKeyPem: string): Promise<string> {
  const raw = pemBytes(publicKeyPem, 'PUBLIC KEY');
  await webCrypto().subtle.importKey('spki', raw, RSA_ALGORITHM, true, ['encrypt']);
  const encoded = b64(raw); localStorage.setItem(ORG_PUBLIC, encoded);
  return (await sha256Hex(encoded)).slice(0, 24);
}

export function hasBackupPasswordSetup(): boolean {
  return !!localStorage.getItem(USER_PUBLIC) && !!localStorage.getItem(USER_PRIVATE);
}
export function hasBackupEncryptionSetup(): boolean {
  return hasBackupPasswordSetup() && !!localStorage.getItem(ORG_PUBLIC);
}

export async function encryptBackupPayload(payload: unknown): Promise<BackupEnvelope> {
  const userPublic = localStorage.getItem(USER_PUBLIC);
  const protectedPrivateRaw = localStorage.getItem(USER_PRIVATE);
  if (!userPublic || !protectedPrivateRaw) throw new Error('ابتدا رمز بازیابی پشتیبان را تنظیم کنید');
  const orgPublic = localStorage.getItem(ORG_PUBLIC);
  if (!orgPublic) throw new Error('کلید عمومی بازیابی سازمان تنظیم نشده است');
  const dek = random(32), iv = random(12);
  const userKey = await importPublic(userPublic);
  const wrappedUserDek = await webCrypto().subtle.encrypt({ name: 'RSA-OAEP' }, userKey, dek);
  const orgKey = await importPublic(orgPublic);
  const wrappedOrgDek = await webCrypto().subtle.encrypt({ name: 'RSA-OAEP' }, orgKey, dek);
  const orgKeyId = (await sha256Hex(orgPublic)).slice(0, 24);
  const base = {
    format: 'anbarin-encrypted-backup' as const, version: 2 as const, cipher: 'AES-256-GCM' as const,
    iv: b64(iv),
    userKey: {
      algorithm: 'RSA-OAEP-3072-SHA256' as const, publicKey: userPublic,
      protectedPrivateKey: JSON.parse(protectedPrivateRaw) as ProtectedPrivate, wrappedDek: b64(wrappedUserDek),
    },
    organizationKey: { algorithm: 'RSA-OAEP-3072-SHA256' as const, keyId: orgKeyId, wrappedDek: b64(wrappedOrgDek) },
    createdAt: new Date().toISOString(),
  };
  const aad = envelopeAad({ ...base, ciphertext: '' });
  const dataKey = await webCrypto().subtle.importKey('raw', dek, 'AES-GCM', false, ['encrypt']);
  const ciphertext = await webCrypto().subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 }, dataKey, enc.encode(JSON.stringify(payload)),
  );
  return { ...base, ciphertext: b64(ciphertext) };
}

export async function decryptBackupWithPassword(envelope: BackupEnvelope, password: string): Promise<unknown> {
  validateEnvelope(envelope);
  const pkcs8 = await unprotectPrivateKey(envelope.userKey.protectedPrivateKey, password);
  const privateKey = await importPrivate(pkcs8);
  const dek = await webCrypto().subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, unb64(envelope.userKey.wrappedDek));
  return decryptPayload(envelope, dek);
}

async function decryptPayload(envelope: BackupEnvelope, rawDek: ArrayBuffer): Promise<unknown> {
  const dek = await webCrypto().subtle.importKey('raw', rawDek, 'AES-GCM', false, ['decrypt']);
  try {
    const algorithm: AesGcmParams = envelope.version >= 2
      ? { name: 'AES-GCM', iv: unb64(envelope.iv), additionalData: envelopeAad(envelope), tagLength: 128 }
      : { name: 'AES-GCM', iv: unb64(envelope.iv), tagLength: 128 };
    const plaintext = await webCrypto().subtle.decrypt(algorithm, dek, unb64(envelope.ciphertext));
    return JSON.parse(dec.decode(plaintext));
  } catch { throw new Error('اعتبارسنجی اصالت AES-GCM ناموفق است؛ فایل دستکاری شده یا خراب است'); }
}

export function isEncryptedBackup(value: unknown): value is BackupEnvelope {
  return !!value && typeof value === 'object' && (value as BackupEnvelope).format === 'anbarin-encrypted-backup';
}
function validateEnvelope(value: BackupEnvelope): void {
  if (!isEncryptedBackup(value) || ![1, 2].includes(value.version) || value.cipher !== 'AES-256-GCM' || value.userKey?.algorithm !== 'RSA-OAEP-3072-SHA256' || !value.userKey.protectedPrivateKey || !value.userKey.wrappedDek || !value.iv || !value.ciphertext) throw new Error('ساختار بکاپ رمزنگاری‌شده معتبر نیست');
  if (value.organizationKey && value.organizationKey.algorithm !== 'RSA-OAEP-3072-SHA256') throw new Error('الگوریتم کلید سازمانی پشتیبانی نمی‌شود');
}

