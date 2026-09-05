(function initializePopup() {
  'use strict';

  const api = globalThis.BravePowerhouse;
  const elements = {};
  let hostname = '';
  let key = '';
  let globalSettings = api.clone(api.DEFAULT_SETTINGS);
  let siteOverride;
  let saveTimer;

  const ids = [
    'hostname', 'scope-badge', 'restricted-card', 'controls', 'site-enabled',
    'scrollbar-enabled', 'scrollbar-autohide', 'reset-site', 'open-options', 'status'
  ];

  ids.forEach((id) => { elements[id] = document.getElementById(id); });

  function setStatus(message, error = false) {
    elements.status.textContent = message;
    elements.status.style.color = error ? 'var(--ui-danger)' : '';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { elements.status.textContent = ''; }, 1800);
  }

  function render() {
    const settings = api.resolveSettings(globalSettings, siteOverride);
    elements['site-enabled'].checked = settings.enabled;
    elements['scrollbar-enabled'].checked = settings.scrollbar.enabled;
    elements['scrollbar-autohide'].checked = settings.scrollbar.autoHide;
    elements['scope-badge'].textContent = siteOverride ? 'Site override' : 'Inherited';
    elements['reset-site'].disabled = !siteOverride;

    const featuresDisabled = !settings.enabled;
    [
      'scrollbar-enabled', 'scrollbar-autohide'
    ].forEach((id) => { elements[id].disabled = featuresDisabled; });
    if (!featuresDisabled) {
      elements['scrollbar-autohide'].disabled = !settings.scrollbar.enabled;
    }
  }

  async function saveSitePatch(patch, markCustom = true) {
    const base = api.isPlainObject(siteOverride) ? siteOverride : {};
    siteOverride = api.deepMerge(base, patch);
    if (markCustom) siteOverride.preset = 'custom';
    await chrome.storage.sync.set({ [key]: siteOverride });
    render();
    setStatus('Saved for this hostname');
  }

  function bindControls() {
    elements['site-enabled'].addEventListener('change', (event) => {
      saveSitePatch({ enabled: event.target.checked }, false).catch(showError);
    });
    elements['scrollbar-enabled'].addEventListener('change', (event) => {
      saveSitePatch({ scrollbar: { enabled: event.target.checked } }).catch(showError);
    });
    elements['scrollbar-autohide'].addEventListener('change', (event) => {
      saveSitePatch({ scrollbar: { autoHide: event.target.checked } }).catch(showError);
    });
    elements['reset-site'].addEventListener('click', async () => {
      try {
        await chrome.storage.sync.remove(key);
        siteOverride = undefined;
        render();
        setStatus('Using global settings');
      } catch (error) {
        showError(error);
      }
    });
  }

  function showError(error) {
    setStatus(error && error.message ? error.message : 'Could not save settings', true);
  }

  async function start() {
    elements['open-options'].addEventListener('click', () => chrome.runtime.openOptionsPage());
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabUrl = tabs[0] && tabs[0].url ? tabs[0].url : '';
    hostname = api.hostnameFromUrl(tabUrl);

    if (!hostname) {
      elements.hostname.textContent = 'Protected browser page';
      elements['scope-badge'].textContent = 'Unavailable';
      elements['restricted-card'].hidden = false;
      elements.controls.hidden = true;
      elements['reset-site'].hidden = true;
      return;
    }

    key = api.siteKey(hostname);
    elements.hostname.textContent = hostname;
    const stored = await chrome.storage.sync.get([api.SETTINGS_KEY, key]);
    globalSettings = api.normalizeSettings(stored[api.SETTINGS_KEY]);
    siteOverride = api.isPlainObject(stored[key]) ? stored[key] : undefined;
    bindControls();
    render();
  }

  start().catch(showError);
})();
