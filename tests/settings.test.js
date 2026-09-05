'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../shared/settings.js');

test('defaults are safe, minimal, and normalized', () => {
  const defaults = api.normalizeSettings();
  assert.equal(defaults.enabled, true);
  assert.equal(defaults.preset, 'minimal');
  assert.deepEqual(defaults.scrollbar, {
    enabled: true,
    autoHide: true,
    railWidth: 6,
    thumbWidth: 4,
    thumbColor: '#a3a3a3',
    hoverColor: '#d4d4d4',
    trackColor: 'transparent',
    minThumb: 36,
    radius: 999
  });
  assert.equal(defaults.dimmer.enabled, false);
  assert.equal(defaults.dimmer.amount, 10);
  assert.equal(defaults.focusMode.enabled, false);
  assert.equal(defaults.motion.mode, 'system');
  assert.equal(defaults.motion.smoothScroll, false);
});

test('each preset applies its promised scrollbar and focus dimensions', () => {
  const minimal = api.applyPreset(api.DEFAULT_SETTINGS, 'minimal');
  const comfortable = api.applyPreset(api.DEFAULT_SETTINGS, 'comfortable');
  const contrast = api.applyPreset(api.DEFAULT_SETTINGS, 'highContrast');
  assert.deepEqual([minimal.scrollbar.railWidth, minimal.scrollbar.thumbWidth, minimal.scrollbar.trackColor], [6, 4, 'transparent']);
  assert.deepEqual([comfortable.scrollbar.railWidth, comfortable.scrollbar.thumbWidth, comfortable.scrollbar.trackColor], [10, 8, '#0f172a']);
  assert.deepEqual([contrast.scrollbar.railWidth, contrast.scrollbar.thumbWidth, contrast.scrollbar.thumbColor], [12, 10, '#f8fafc']);
  assert.deepEqual([contrast.focusRing.width, contrast.focusRing.color], [3, '#22d3ee']);
});

test('site settings merge over global settings without losing inherited values', () => {
  const globalSettings = api.normalizeSettings({
    scrollbar: { railWidth: 10, thumbWidth: 8, thumbColor: '#112233' },
    dimmer: { enabled: true, amount: 18 }
  });
  const resolved = api.resolveSettings(globalSettings, {
    scrollbar: { thumbColor: '#abcdef' },
    focusMode: { enabled: true }
  });
  assert.equal(resolved.scrollbar.railWidth, 10);
  assert.equal(resolved.scrollbar.thumbWidth, 8);
  assert.equal(resolved.scrollbar.thumbColor, '#abcdef');
  assert.equal(resolved.dimmer.amount, 18);
  assert.equal(resolved.focusMode.enabled, true);
});

test('exact hostname keys isolate domains and subdomains', () => {
  assert.equal(api.siteKey('Example.COM'), 'bph.site.example.com');
  assert.equal(api.siteKey('www.example.com'), 'bph.site.www.example.com');
  assert.notEqual(api.siteKey('example.com'), api.siteKey('www.example.com'));
  assert.equal(api.hostnameFromUrl('https://courses.example.com/watch/1'), 'courses.example.com');
});

test('restricted URL detection accepts only HTTP and HTTPS pages', () => {
  assert.equal(api.isRestrictedUrl('https://example.com/page'), false);
  assert.equal(api.isRestrictedUrl('http://localhost:3000'), false);
  assert.equal(api.isRestrictedUrl('brave://settings'), true);
  assert.equal(api.isRestrictedUrl('chrome-extension://abc/options.html'), true);
  assert.equal(api.isRestrictedUrl('file:///C:/notes.html'), true);
  assert.equal(api.isRestrictedUrl('not a url'), true);
});

test('hostname input accepts hostnames and URLs but rejects protected schemes', () => {
  assert.equal(api.normalizeHostnameInput('Example.com/path'), 'example.com');
  assert.equal(api.normalizeHostnameInput('https://Sub.Example.com:8443/course'), 'sub.example.com');
  assert.equal(api.normalizeHostnameInput('brave://settings'), '');
  assert.equal(api.normalizeHostnameInput(''), '');
});

test('malformed storage falls back and clamps unsafe values', () => {
  const resolved = api.normalizeSettings({
    enabled: 'yes',
    preset: 'unknown',
    scrollbar: {
      railWidth: 500,
      thumbWidth: 80,
      thumbColor: 'red',
      trackColor: 'rgba(0,0,0,.5)',
      minThumb: -3
    },
    focusRing: { width: 99, color: '#ABCDEF' },
    dimmer: { amount: Infinity },
    motion: { mode: 'fast' }
  });
  assert.equal(resolved.enabled, true);
  assert.equal(resolved.preset, 'minimal');
  assert.equal(resolved.scrollbar.railWidth, 16);
  assert.equal(resolved.scrollbar.thumbWidth, 16);
  assert.equal(resolved.scrollbar.thumbColor, '#a3a3a3');
  assert.equal(resolved.scrollbar.trackColor, 'transparent');
  assert.equal(resolved.scrollbar.minThumb, 20);
  assert.equal(resolved.focusRing.width, 5);
  assert.equal(resolved.focusRing.color, '#abcdef');
  assert.equal(resolved.dimmer.amount, 10);
  assert.equal(resolved.motion.mode, 'system');
});
