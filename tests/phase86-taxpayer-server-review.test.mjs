import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const pluginPath = path.join(root, 'server/wordpress-plugin/anbarin-taxpayer-review/anbarin-taxpayer-review.php');
const readmePath = path.join(root, 'server/wordpress-plugin/anbarin-taxpayer-review/README_FA.md');
const source = fs.readFileSync(pluginPath, 'utf8');
const readme = fs.readFileSync(readmePath, 'utf8');

test('taxpayer server review endpoint is admin-authorized through WordPress REST auth', () => {
  assert.match(source, /'permission_callback'\s*=>\s*\[__CLASS__,\s*'authorize'\]/);
  assert.match(source, /return current_user_can\('manage_options'\)/);
  assert.match(source, /Cookie\+Nonce یا Application Password/);
  assert.doesNotMatch(source, /ANBARIN_TAX.*TOKEN|Bearer\s*\./i);
});

test('server review endpoint only accepts explicitly internal preview documents', () => {
  assert.match(source, /anbarin-taxpayer-internal-review/);
  assert.match(source, /\(\$data\['isOfficialOrganizationPayload'\]\s*\?\?\s*null\)\s*!==\s*false/);
  assert.match(source, /'internal_review'/);
  assert.match(source, /MAX_BYTES\s*=\s*524288/);
  assert.match(source, /hash\('sha256',\s*\$invoice_id\s*\.\s*'\|'\s*\.\s*\$captured_at\)/);
});

test('server API does not implement tax submission and documents client credential restriction', () => {
  assert.doesNotMatch(source, /wp_remote_post|curl_exec|file_get_contents\(['"]https?:/i);
  assert.match(readme, /Application Password را داخل برنامه موبایل\/وب عمومی قرار ندهید/);
  assert.match(readme, /ارسال نمی‌کند/);
});
