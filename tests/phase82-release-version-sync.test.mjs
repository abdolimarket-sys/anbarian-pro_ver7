import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('web package, lockfile root, Android versionName and release notes agree', () => {
  const pkg = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  const gradle = read('android/app/build.gradle');
  const serviceWorker = read('public/sw.js');
  const androidServiceWorker = read('android/app/src/main/assets/public/sw.js');
  const appSource = read('src/main.ts');
  const androidBundle = read('android/app/src/main/assets/public/assets/index-DxaCzbpb.js');
  const notes = read('RELEASE_NOTES_2.0.4_FA.md');
  assert.equal(pkg.version, '2.0.4');
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.match(gradle, /versionCode\s+33/);
  assert.ok(serviceWorker.includes(`anbarin-v${pkg.version}`));
  assert.ok(androidServiceWorker.includes(`anbarin-v${pkg.version}`));
  assert.ok(appSource.includes(`v${pkg.version}`));
  assert.ok(androidBundle.includes(`v${pkg.version}`));
  assert.ok(gradle.includes(`versionName "${pkg.version}"`));
  assert.ok(notes.includes(`Anbarin Pro ${pkg.version}`));
  assert.match(notes, /versionCode.*33/);
});
