'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.name, 'FlowPlay');
assert.equal(manifest.version, JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version);
assert.deepEqual(manifest.permissions, ['storage', 'activeTab']);
assert.equal(manifest.content_scripts.length, 2);
assert.equal(manifest.content_scripts[0].all_frames, false);
assert.deepEqual(manifest.content_scripts[1].matches, ['https://www.youtube.com/*']);
const refs = [manifest.action.default_popup, manifest.options_ui.page, manifest.background.service_worker,
  ...Object.values(manifest.icons), ...manifest.content_scripts.flatMap(s => [...s.js, ...s.css])];
refs.forEach(p => assert(fs.existsSync(path.join(root, p)), 'Missing: ' + p));
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).filter(e => !['.git','node_modules'].includes(e.name))
    .flatMap(e => e.isDirectory() ? walk(path.join(dir,e.name)) : [path.join(dir,e.name)]);
}
for (const file of walk(root)) {
  if (file.endsWith('.js')) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  if (file.endsWith('.html')) {
    const html = fs.readFileSync(file, 'utf8');
    for (const match of html.matchAll(/(?:src|href)=["']([^"'#]+)["']/g)) {
      const ref = match[1];
      if (/^(https?:|data:)/.test(ref)) continue;
      assert(fs.existsSync(path.resolve(path.dirname(file), ref)), 'Missing HTML resource: ' + ref);
    }
    assert(!/<script[^>]+src=["']https?:/i.test(html), 'Remote script');
  }
}
for (const size of [16,32,48,128]) {
  const png = fs.readFileSync(path.join(root,'icons', 'icon'+size+'.png'));
  assert.equal(png.readUInt32BE(16), size);
  assert.equal(png.readUInt32BE(20), size);
}
console.log('FlowPlay manifest, syntax, page resources, and icons validated.');
