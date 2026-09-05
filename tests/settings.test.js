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
  assert.equal('selection' in defaults, false);
  assert.equal('focusRing' in defaults, false);
  assert.equal('formAccent' in defaults, false);
  assert.equal('motion' in defaults, false);
  assert.equal('dimmer' in defaults, false);
  assert.equal('focusMode' in defaults, false);
});

test('each preset applies its promised scrollbar dimensions', () => {
  const minimal = api.applyPreset(api.DEFAULT_SETTINGS, 'minimal');
  const comfortable = api.applyPreset(api.DEFAULT_SETTINGS, 'comfortable');
  const contrast = api.applyPreset(api.DEFAULT_SETTINGS, 'highContrast');
  assert.deepEqual([minimal.scrollbar.railWidth, minimal.scrollbar.thumbWidth, minimal.scrollbar.trackColor], [6, 4, 'transparent']);
  assert.deepEqual([comfortable.scrollbar.railWidth, comfortable.scrollbar.thumbWidth, comfortable.scrollbar.trackColor], [10, 8, '#0f172a']);
  assert.deepEqual([contrast.scrollbar.railWidth, contrast.scrollbar.thumbWidth, contrast.scrollbar.thumbColor], [12, 10, '#f8fafc']);
});

test('site settings merge over global settings without losing inherited values', () => {
  const globalSettings = api.normalizeSettings({
    scrollbar: { railWidth: 10, thumbWidth: 8, thumbColor: '#112233' }
  });
  const resolved = api.resolveSettings(globalSettings, {
    scrollbar: { thumbColor: '#abcdef' }
  });
  assert.equal(resolved.scrollbar.railWidth, 10);
  assert.equal(resolved.scrollbar.thumbWidth, 8);
  assert.equal(resolved.scrollbar.thumbColor, '#abcdef');
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
  assert.equal('focusRing' in resolved, false);
  assert.equal('dimmer' in resolved, false);
  assert.equal('motion' in resolved, false);
});
