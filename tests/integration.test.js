'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const api = require('../shared/settings.js');

test('merged webpage controls react to storage and scrolling without touching YouTube data', async () => {
  const attrs = new Map();
  const listeners = {};
  const timers = new Map();
  let nextTimer = 0;
  let storageListener;
  const root = {
    setAttribute: (k,v) => attrs.set(k,v),
    removeAttribute: k => attrs.delete(k),
    style: { setProperty() {}, removeProperty() {} }
  };
  const stored = { playback_speed: 2, center_player: true, skip_sponsors: true };
  const sandbox = {
    BravePowerhouse: api,
    location: { hostname: 'www.youtube.com' },
    document: {
      documentElement: root,
      getElementById: () => null,
      addEventListener: (name,fn) => { listeners[name] = fn; }
    },
    chrome: { storage: {
      sync: { get: async () => stored },
      onChanged: { addListener: fn => { storageListener = fn; } }
    } },
    setTimeout: fn => { timers.set(++nextTimer,fn); return nextTimer; },
    clearTimeout: id => timers.delete(id)
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../content/content.js'),'utf8'),sandbox);
  await new Promise(setImmediate);
  assert.equal(attrs.get('data-bph-scrollbar-active'),'false');
  listeners.scroll();
  assert.equal(attrs.get('data-bph-scrollbar-active'),'true');
  for (const fn of timers.values()) fn();
  assert.equal(attrs.get('data-bph-scrollbar-active'),'false');
  stored['bph.site.www.youtube.com'] = { enabled: false };
  storageListener({ 'bph.site.www.youtube.com': {} }, 'sync');
  await new Promise(setImmediate);
  assert.equal(attrs.has('data-bph-active'),false);
  assert.equal(stored.playback_speed,2);
  assert.equal(stored.center_player,true);
  assert.equal(stored.skip_sponsors,true);
  delete stored['bph.site.www.youtube.com'];
  stored[api.SETTINGS_KEY] = { scrollbar: { autoHide: false } };
  storageListener({ [api.SETTINGS_KEY]: {} }, 'sync');
  await new Promise(setImmediate);
  assert.equal(attrs.get('data-bph-scrollbar-active'),'true');
  assert.equal(attrs.get('data-bph-scrollbar-autohide'),'false');
});
