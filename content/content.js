(function startFlowPlayWebsiteControls() {
  'use strict';

  const settingsApi = globalThis.BravePowerhouse;
  if (!settingsApi || !document.documentElement) return;

  const root = document.documentElement;
  const hostname = settingsApi.normalizeHostname(location.hostname);
  const currentSiteKey = settingsApi.siteKey(hostname);
  const ACTIVE_ATTRIBUTES = [
    'data-bph-active',
    'data-bph-scrollbars',
    'data-bph-scrollbar-autohide',
    'data-bph-scrollbar-active'
  ];
  const ACTIVE_PROPERTIES = [
    '--bph-scrollbar-rail',
    '--bph-scrollbar-inset',
    '--bph-scrollbar-thumb',
    '--bph-scrollbar-hover',
    '--bph-scrollbar-track',
    '--bph-scrollbar-radius',
    '--bph-scrollbar-min-thumb'
  ];
  const RETIRED_ATTRIBUTES = [
    'data-bph-selection',
    'data-bph-focus-ring',
    'data-bph-accent',
    'data-bph-motion',
    'data-bph-smooth-scroll',
    'data-bph-dimmer',
    'data-bph-focus-mode',
    'data-bph-fullscreen'
  ];
  const RETIRED_PROPERTIES = [
    '--bph-selection-background',
    '--bph-selection-color',
    '--bph-focus-color',
    '--bph-focus-width',
    '--bph-accent-color',
    '--bph-dimmer-opacity'
  ];

  let effectiveSettings = settingsApi.clone(settingsApi.DEFAULT_SETTINGS);
  let refreshSequence = 0;
  let scrollbarIdleTimer;
  const SCROLLBAR_IDLE_DELAY = 850;

  function setFeatureAttribute(name, enabled) {
    root.setAttribute(name, enabled ? 'true' : 'false');
  }

  function removeElement(id) {
    const element = document.getElementById(id);
    if (element) element.remove();
  }

  function clearRetiredState() {
    RETIRED_ATTRIBUTES.forEach((name) => root.removeAttribute(name));
    RETIRED_PROPERTIES.forEach((name) => root.style.removeProperty(name));
    removeElement('bph-page-dimmer');
    removeElement('bph-exit-focus');
  }

  function clearManagedState() {
    clearTimeout(scrollbarIdleTimer);
    ACTIVE_ATTRIBUTES.forEach((name) => root.removeAttribute(name));
    ACTIVE_PROPERTIES.forEach((name) => root.style.removeProperty(name));
    clearRetiredState();
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

  function applySettings(settings) {
    clearTimeout(scrollbarIdleTimer);
    clearRetiredState();
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
    root.style.setProperty('--bph-scrollbar-rail', `${scrollbar.railWidth}px`);
    root.style.setProperty('--bph-scrollbar-inset', `${inset}px`);
    root.style.setProperty('--bph-scrollbar-thumb', scrollbar.thumbColor);
    root.style.setProperty('--bph-scrollbar-hover', scrollbar.hoverColor);
    root.style.setProperty('--bph-scrollbar-track', scrollbar.trackColor);
    root.style.setProperty('--bph-scrollbar-radius', `${scrollbar.radius}px`);
    root.style.setProperty('--bph-scrollbar-min-thumb', `${scrollbar.minThumb}px`);
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

  document.addEventListener('scroll', markScrollbarActive, { capture: true, passive: true });
  document.addEventListener('wheel', markScrollbarActive, { capture: true, passive: true });
  document.addEventListener('keydown', handleScrollKey, true);
  refreshSettings();
})();
