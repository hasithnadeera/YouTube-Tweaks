(function exposeBravePowerhouse(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BravePowerhouse = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createSettingsApi() {
  'use strict';

  const SETTINGS_KEY = 'bph.settings.v1';
  const SITE_PREFIX = 'bph.site.';

  const DEFAULT_SETTINGS = {
    version: 1,
    enabled: true,
    preset: 'minimal',
    scrollbar: {
      enabled: true,
      autoHide: true,
      railWidth: 6,
      thumbWidth: 4,
      thumbColor: '#a3a3a3',
      hoverColor: '#d4d4d4',
      trackColor: 'transparent',
      minThumb: 36,
      radius: 999
    },
    selection: {
      enabled: true,
      background: '#5eead4',
      color: '#042f2e'
    },
    focusRing: {
      enabled: true,
      color: '#5eead4',
      width: 2
    },
    formAccent: {
      enabled: true,
      color: '#5eead4'
    },
    motion: {
      mode: 'system',
      smoothScroll: false
    },
    dimmer: {
      enabled: false,
      amount: 10
    },
    focusMode: {
      enabled: false
    }
  };

  const PRESETS = {
    minimal: {
      scrollbar: {
        enabled: true,
        autoHide: true,
        railWidth: 6,
        thumbWidth: 4,
        thumbColor: '#a3a3a3',
        hoverColor: '#d4d4d4',
        trackColor: 'transparent',
        minThumb: 36,
        radius: 999
      },
      focusRing: { enabled: true, color: '#5eead4', width: 2 }
    },
    comfortable: {
      scrollbar: {
        enabled: true,
        autoHide: true,
        railWidth: 10,
        thumbWidth: 8,
        thumbColor: '#9ca3af',
        hoverColor: '#e5e7eb',
        trackColor: '#0f172a',
        minThumb: 40,
        radius: 999
      },
      focusRing: { enabled: true, color: '#22d3ee', width: 2 }
    },
    highContrast: {
      scrollbar: {
        enabled: true,
        autoHide: true,
        railWidth: 12,
        thumbWidth: 10,
        thumbColor: '#f8fafc',
        hoverColor: '#ffffff',
        trackColor: '#111827',
        minThumb: 44,
        radius: 999
      },
      focusRing: { enabled: true, color: '#22d3ee', width: 3 }
    }
  };

  function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function deepMerge(base, override) {
    const output = isPlainObject(base) ? clone(base) : {};
    if (!isPlainObject(override)) return output;

    Object.entries(override).forEach(([key, value]) => {
      if (isPlainObject(value) && isPlainObject(output[key])) {
        output[key] = deepMerge(output[key], value);
      } else if (value !== undefined) {
        output[key] = clone(value);
      }
    });
    return output;
  }

  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  }

  function normalizeColor(value, fallback, allowTransparent = false) {
    if (allowTransparent && value === 'transparent') return value;
    return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
      ? value.toLowerCase()
      : fallback;
  }

  function normalizeSettings(raw) {
    const input = isPlainObject(raw) ? raw : {};
    const defaults = DEFAULT_SETTINGS;
    const railWidth = clampNumber(
      input.scrollbar && input.scrollbar.railWidth,
      2,
      16,
      defaults.scrollbar.railWidth
    );
    const thumbWidth = clampNumber(
      input.scrollbar && input.scrollbar.thumbWidth,
      1,
      railWidth,
      Math.min(defaults.scrollbar.thumbWidth, railWidth)
    );
    const preset = ['minimal', 'comfortable', 'highContrast', 'custom'].includes(input.preset)
      ? input.preset
      : defaults.preset;
    const motionMode = ['system', 'reduce', 'normal'].includes(input.motion && input.motion.mode)
      ? input.motion.mode
      : defaults.motion.mode;

    return {
      version: 1,
      enabled: typeof input.enabled === 'boolean' ? input.enabled : defaults.enabled,
      preset,
      scrollbar: {
        enabled: typeof (input.scrollbar && input.scrollbar.enabled) === 'boolean'
          ? input.scrollbar.enabled
          : defaults.scrollbar.enabled,
        autoHide: typeof (input.scrollbar && input.scrollbar.autoHide) === 'boolean'
          ? input.scrollbar.autoHide
          : defaults.scrollbar.autoHide,
        railWidth,
        thumbWidth,
        thumbColor: normalizeColor(
          input.scrollbar && input.scrollbar.thumbColor,
          defaults.scrollbar.thumbColor
        ),
        hoverColor: normalizeColor(
          input.scrollbar && input.scrollbar.hoverColor,
          defaults.scrollbar.hoverColor
        ),
        trackColor: normalizeColor(
          input.scrollbar && input.scrollbar.trackColor,
          defaults.scrollbar.trackColor,
          true
        ),
        minThumb: clampNumber(
          input.scrollbar && input.scrollbar.minThumb,
          20,
          100,
          defaults.scrollbar.minThumb
        ),
        radius: clampNumber(
          input.scrollbar && input.scrollbar.radius,
          0,
          999,
          defaults.scrollbar.radius
        )
      },
      selection: {
        enabled: typeof (input.selection && input.selection.enabled) === 'boolean'
          ? input.selection.enabled
          : defaults.selection.enabled,
        background: normalizeColor(
          input.selection && input.selection.background,
          defaults.selection.background
        ),
        color: normalizeColor(input.selection && input.selection.color, defaults.selection.color)
      },
      focusRing: {
        enabled: typeof (input.focusRing && input.focusRing.enabled) === 'boolean'
          ? input.focusRing.enabled
          : defaults.focusRing.enabled,
        color: normalizeColor(input.focusRing && input.focusRing.color, defaults.focusRing.color),
        width: clampNumber(
          input.focusRing && input.focusRing.width,
          1,
          5,
          defaults.focusRing.width
        )
      },
      formAccent: {
        enabled: typeof (input.formAccent && input.formAccent.enabled) === 'boolean'
          ? input.formAccent.enabled
          : defaults.formAccent.enabled,
        color: normalizeColor(input.formAccent && input.formAccent.color, defaults.formAccent.color)
      },
      motion: {
        mode: motionMode,
        smoothScroll: typeof (input.motion && input.motion.smoothScroll) === 'boolean'
          ? input.motion.smoothScroll
          : defaults.motion.smoothScroll
      },
      dimmer: {
        enabled: typeof (input.dimmer && input.dimmer.enabled) === 'boolean'
          ? input.dimmer.enabled
          : defaults.dimmer.enabled,
        amount: clampNumber(
          input.dimmer && input.dimmer.amount,
          0,
          30,
          defaults.dimmer.amount
        )
      },
      focusMode: {
        enabled: typeof (input.focusMode && input.focusMode.enabled) === 'boolean'
          ? input.focusMode.enabled
          : defaults.focusMode.enabled
      }
    };
  }

  function applyPreset(settings, presetId) {
    if (!Object.prototype.hasOwnProperty.call(PRESETS, presetId)) {
      return normalizeSettings(settings);
    }
    const merged = deepMerge(normalizeSettings(settings), PRESETS[presetId]);
    merged.preset = presetId;
    return normalizeSettings(merged);
  }

  function resolveSettings(globalSettings, siteOverride) {
    const globalNormalized = normalizeSettings(globalSettings);
    return normalizeSettings(deepMerge(globalNormalized, isPlainObject(siteOverride) ? siteOverride : {}));
  }

  function normalizeHostname(hostname) {
    return typeof hostname === 'string'
      ? hostname.trim().toLowerCase().replace(/\.$/, '')
      : '';
  }

  function hostnameFromUrl(rawUrl) {
    try {
      const url = new URL(rawUrl);
      return url.protocol === 'http:' || url.protocol === 'https:'
        ? normalizeHostname(url.hostname)
        : '';
    } catch (_) {
      return '';
    }
  }

  function normalizeHostnameInput(value) {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) return '';
    const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    return hostnameFromUrl(candidate);
  }

  function siteKey(hostname) {
    const normalized = normalizeHostname(hostname);
    return normalized ? `${SITE_PREFIX}${normalized}` : '';
  }

  function isRestrictedUrl(rawUrl) {
    return !hostnameFromUrl(rawUrl);
  }

  return {
    SETTINGS_KEY,
    SITE_PREFIX,
    DEFAULT_SETTINGS: clone(DEFAULT_SETTINGS),
    PRESETS: clone(PRESETS),
    isPlainObject,
    clone,
    deepMerge,
    normalizeSettings,
    applyPreset,
    resolveSettings,
    normalizeHostname,
    normalizeHostnameInput,
    hostnameFromUrl,
    siteKey,
    isRestrictedUrl
  };
});
