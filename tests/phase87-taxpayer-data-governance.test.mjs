import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root = process.cwd();
const php = fs.readFileSync(path.join(root, 'server/wordpress-plugin/anbarin-taxpayer-review/anbarin-taxpayer-review.php'), 'utf8');
const readme = fs.readFileSync(path.join(root, 'server/wordpress-plugin/anbarin-taxpayer-review/README_FA.md'), 'utf8');
test('taxpayer review API exposes explicit admin-authorized deletion only', () => {
  assert.match(php, /'methods'\s*=>\s*'DELETE'/);
  assert.match(php, /'permission_callback'\s*=>\s*\[__CLASS__,\s*'authorize'\]/);
  assert.match(php, /public static function delete_review\(/);
  assert.match(php, /\$wpdb->delete\(\$table, \['id' => \$id\]/);
  assert.match(php, /anbarin_review_not_found/);
});
test('taxpayer review API prevents caching of sensitive responses', () => {
  assert.match(php, /Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0'/);
  assert.match(php, /X-Content-Type-Options', 'nosniff'/);
});
test('taxpayer review payload has a bounded item count and no automatic retention deletion', () => {
  assert.match(php, /MAX_ITEMS\s*=\s*500/);
  assert.match(php, /count\(\$data\['items'\]\)\s*>\s*self::MAX_ITEMS/);
  assert.match(readme, /پاک‌سازی زمان‌بندی‌شده یا حذف خودکار فعال نیست/);
  assert.doesNotMatch(php, /wp_schedule_event|wp_cron|DELETE FROM/);
});
