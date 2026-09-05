(function startBravePowerhouse() {
  'use strict';

  const settingsApi = globalThis.BravePowerhouse;
  if (!settingsApi || !document.documentElement) return;

  const root = document.documentElement;
  const hostname = settingsApi.normalizeHostname(location.hostname);
  const currentSiteKey = settingsApi.siteKey(hostname);
  const MANAGED_ATTRIBUTES = [
    'data-bph-active',
    'data-bph-scrollbars',
    'data-bph-scrollbar-autohide',
    'data-bph-scrollbar-active',
    'data-bph-selection',
    'data-bph-focus-ring',
    'data-bph-accent',
    'data-bph-motion',
    'data-bph-smooth-scroll',
    'data-bph-dimmer',
    'data-bph-focus-mode',
    'data-bph-fullscreen'
  ];
  const MANAGED_PROPERTIES = [
    '--bph-scrollbar-rail',
    '--bph-scrollbar-inset',
    '--bph-scrollbar-thumb',
    '--bph-scrollbar-hover',
    '--bph-scrollbar-track',
    '--bph-scrollbar-radius',
    '--bph-scrollbar-min-thumb',
    '--bph-selection-background',
    '--bph-selection-color',
    '--bph-focus-color',
    '--bph-focus-width',
    '--bph-accent-color',
    '--bph-dimmer-opacity'
  ];

  let effectiveSettings = settingsApi.clone(settingsApi.DEFAULT_SETTINGS);
  let refreshSequence = 0;
  let bodyReadyListenerAdded = false;
  let scrollbarIdleTimer;
  const SCROLLBAR_IDLE_DELAY = 850;

  function setFeatureAttribute(name, enabled) {
    root.setAttribute(name, enabled ? 'true' : 'false');
  }

  function clearManagedState() {
    clearTimeout(scrollbarIdleTimer);
    MANAGED_ATTRIBUTES.forEach((name) => root.removeAttribute(name));
    MANAGED_PROPERTIES.forEach((name) => root.style.removeProperty(name));
    removeElement('bph-page-dimmer');
    removeElement('bph-exit-focus');
  }

  function markScrollbarActive() {
    if (!effectiveSettings.enabled || !effectiveSettings.scrollbar.enabled || !effectiveSettings.scrollbar.autoHide) return;
    root.setAttribute('data-bph-scrollbar-active', 'true');
    clearTimeout(scrollbarIdleTimer);
    scrollbarIdleTimer = setTimeout(() => {
      root.setAttribute('data-bph-scrollbar-active', 'false');
    }, SCROLLBAR_IDLE_DELAY);
  }

  function handleScrollKey(event) {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) {
      markScrollbarActive();
    }
  }

  function removeElement(id) {
    const element = document.getElementById(id);
    if (element) element.remove();
  }

  function ensureDimmer() {
    let dimmer = document.getElementById('bph-page-dimmer');
    if (dimmer) return dimmer;
    dimmer = document.createElement('div');
    dimmer.id = 'bph-page-dimmer';
    dimmer.setAttribute('aria-hidden', 'true');
    root.appendChild(dimmer);
    return dimmer;
  }

  function ensureExitFocusButton() {
    if (!document.body) {
      if (!bodyReadyListenerAdded) {
        bodyReadyListenerAdded = true;
        document.addEventListener('DOMContentLoaded', () => {
          bodyReadyListenerAdded = false;
          syncInjectedControls();
        }, { once: true });
      }
      return null;
    }

    let button = document.getElementById('bph-exit-focus');
    if (button) return button;
    button = document.createElement('button');
    button.id = 'bph-exit-focus';
    button.type = 'button';
    button.textContent = 'Exit focus';
    button.setAttribute('aria-label', 'Exit FlowPlay focus mode');
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        const stored = await chrome.storage.sync.get(currentSiteKey);
        const existing = settingsApi.isPlainObject(stored[currentSiteKey])
          ? stored[currentSiteKey]
          : {};
        const next = settingsApi.deepMerge(existing, {
          preset: 'custom',
          focusMode: { enabled: false }
        });
        await chrome.storage.sync.set({ [currentSiteKey]: next });
      } catch (_) {
        root.setAttribute('data-bph-focus-mode', 'false');
        button.remove();
      }
    }, true);
    document.body.appendChild(button);
    return button;
  }

  function syncInjectedControls() {
    if (!effectiveSettings.enabled) {
      removeElement('bph-page-dimmer');
      removeElement('bph-exit-focus');
      return;
    }

    if (effectiveSettings.dimmer.enabled && effectiveSettings.dimmer.amount > 0) {
      ensureDimmer();
    } else {
      removeElement('bph-page-dimmer');
    }

    if (effectiveSettings.focusMode.enabled) {
      ensureExitFocusButton();
    } else {
      removeElement('bph-exit-focus');
    }
  }

  function syncFullscreenState() {
    const fullscreen = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
    setFeatureAttribute('data-bph-fullscreen', fullscreen);
  }

  function applySettings(settings) {
    clearTimeout(scrollbarIdleTimer);
    effectiveSettings = settingsApi.normalizeSettings(settings);
    if (!effectiveSettings.enabled) {
      clearManagedState();
      return;
    }

    const scrollbar = effectiveSettings.scrollbar;
    const inset = Math.max(0, (scrollbar.railWidth - scrollbar.thumbWidth) / 2);

    root.setAttribute('data-bph-active', 'true');
    setFeatureAttribute('data-bph-scrollbars', scrollbar.enabled);
    setFeatureAttribute('data-bph-scrollbar-autohide', scrollbar.autoHide);
    setFeatureAttribute('data-bph-scrollbar-active', !scrollbar.autoHide);
    setFeatureAttribute('data-bph-selection', effectiveSettings.selection.enabled);
    setFeatureAttribute('data-bph-focus-ring', effectiveSettings.focusRing.enabled);
    setFeatureAttribute('data-bph-accent', effectiveSettings.formAccent.enabled);
    root.setAttribute('data-bph-motion', effectiveSettings.motion.mode);
    setFeatureAttribute('data-bph-smooth-scroll', effectiveSettings.motion.smoothScroll);
    setFeatureAttribute('data-bph-dimmer', effectiveSettings.dimmer.enabled && effectiveSettings.dimmer.amount > 0);
    setFeatureAttribute('data-bph-focus-mode', effectiveSettings.focusMode.enabled);

    root.style.setProperty('--bph-scrollbar-rail', `${scrollbar.railWidth}px`);
    root.style.setProperty('--bph-scrollbar-inset', `${inset}px`);
    root.style.setProperty('--bph-scrollbar-thumb', scrollbar.thumbColor);
    root.style.setProperty('--bph-scrollbar-hover', scrollbar.hoverColor);
    root.style.setProperty('--bph-scrollbar-track', scrollbar.trackColor);
    root.style.setProperty('--bph-scrollbar-radius', `${scrollbar.radius}px`);
    root.style.setProperty('--bph-scrollbar-min-thumb', `${scrollbar.minThumb}px`);
    root.style.setProperty('--bph-selection-background', effectiveSettings.selection.background);
    root.style.setProperty('--bph-selection-color', effectiveSettings.selection.color);
    root.style.setProperty('--bph-focus-color', effectiveSettings.focusRing.color);
    root.style.setProperty('--bph-focus-width', `${effectiveSettings.focusRing.width}px`);
    root.style.setProperty('--bph-accent-color', effectiveSettings.formAccent.color);
    root.style.setProperty('--bph-dimmer-opacity', `${effectiveSettings.dimmer.amount}%`);

    syncFullscreenState();
    syncInjectedControls();
  }

  async function refreshSettings() {
    const sequence = ++refreshSequence;
    try {
      const stored = await chrome.storage.sync.get([settingsApi.SETTINGS_KEY, currentSiteKey]);
      if (sequence !== refreshSequence) return;
      applySettings(settingsApi.resolveSettings(
        stored[settingsApi.SETTINGS_KEY],
        stored[currentSiteKey]
      ));
    } catch (_) {
      if (sequence === refreshSequence) applySettings(settingsApi.DEFAULT_SETTINGS);
    }
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync') return;
    if (changes[settingsApi.SETTINGS_KEY] || changes[currentSiteKey]) refreshSettings();
  });

  document.addEventListener('fullscreenchange', syncFullscreenState, true);
  document.addEventListener('webkitfullscreenchange', syncFullscreenState, true);
  document.addEventListener('scroll', markScrollbarActive, { capture: true, passive: true });
  document.addEventListener('wheel', markScrollbarActive, { capture: true, passive: true });
  document.addEventListener('keydown', handleScrollKey, true);
  refreshSettings();
})();
