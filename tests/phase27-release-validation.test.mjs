import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('phase 27 release-critical modules remain present', () => {
  for (const file of [
    'src/modules/scanner.ts',
    'src/modules/inventory-costing.ts',
    'src/modules/accounting.ts',
    'src/modules/accounting-reports.ts',
    'src/modules/offline-license.ts',
    'src/modules/license-platform.ts',
  ]) assert.equal(existsSync(new URL(`../${file}`, import.meta.url)), true, `${file} missing`);
});

test('phase 27 records release blockers instead of claiming APK validation', () => {
  assert.equal(existsSync(new URL('../PHASE27_RELEASE_VALIDATION_FA.md', import.meta.url)), false);
});

test('release versions are synchronized across web, lockfile, and Android', () => {
  const pkg = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  const gradle = read('android/app/build.gradle');
  const serviceWorker = read('public/sw.js');
  const androidServiceWorker = read('android/app/src/main/assets/public/sw.js');
  const appSource = read('src/main.ts');
  const androidBundle = read('android/app/src/main/assets/public/assets/index-DxaCzbpb.js');
  const releaseNotes = read('RELEASE_NOTES_2.0.5_FA.md');
  assert.equal(pkg.version, '2.0.5');
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.match(gradle, /versionCode\s+34/);
  assert.ok(serviceWorker.includes(`anbarin-v${pkg.version}`));
  assert.ok(androidServiceWorker.includes(`anbarin-v${pkg.version}`));
  assert.ok(appSource.includes(`v${pkg.version}`));
  assert.ok(androidBundle.includes(`v${pkg.version}`));
  assert.match(gradle, new RegExp(`versionName\\s+\"${pkg.version}\"`));
  assert.match(releaseNotes, new RegExp(`Anbarin Pro ${pkg.version}`));
  assert.match(releaseNotes, /versionCode.*34/);
});
