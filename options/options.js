(function initializeOptions() {
  'use strict';

  const api = globalThis.BravePowerhouse;
  const byId = (id) => document.getElementById(id);
  let settings = api.clone(api.DEFAULT_SETTINGS);
  let siteEntries = {};
  let statusTimer;
  let saveQueue = Promise.resolve();

  function titleCasePreset(id) {
    return id === 'highContrast' ? 'High Contrast' : id.charAt(0).toUpperCase() + id.slice(1);
  }

  function setStatus(message, error = false) {
    const status = byId('status');
    status.textContent = message;
    status.style.color = error ? 'var(--ui-danger)' : '';
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { status.textContent = ''; }, 2200);
  }

  function renderSettings() {
    byId('global-enabled').checked = settings.enabled;
    byId('scrollbar-enabled').checked = settings.scrollbar.enabled;
    byId('scrollbar-autohide').checked = settings.scrollbar.autoHide;
    byId('rail-width').value = settings.scrollbar.railWidth;
    byId('thumb-width').value = settings.scrollbar.thumbWidth;
    byId('min-thumb').value = settings.scrollbar.minThumb;
    byId('thumb-color').value = settings.scrollbar.thumbColor;
    byId('hover-color').value = settings.scrollbar.hoverColor;
    const transparent = settings.scrollbar.trackColor === 'transparent';
    byId('transparent-track').checked = transparent;
    byId('track-color').disabled = transparent;
    byId('track-color').value = transparent ? '#0f172a' : settings.scrollbar.trackColor;
    byId('track-color-label').textContent = transparent ? 'transparent' : settings.scrollbar.trackColor;

    byId('selection-enabled').checked = settings.selection.enabled;
    byId('selection-background').value = settings.selection.background;
    byId('selection-color').value = settings.selection.color;
    byId('focus-ring-enabled').checked = settings.focusRing.enabled;
    byId('focus-color').value = settings.focusRing.color;
    byId('focus-width').value = settings.focusRing.width;
    byId('accent-enabled').checked = settings.formAccent.enabled;
    byId('accent-color').value = settings.formAccent.color;
    byId('motion-mode').value = settings.motion.mode;
    byId('smooth-scroll').checked = settings.motion.smoothScroll;
    byId('dimmer-enabled').checked = settings.dimmer.enabled;
    byId('dimmer-amount').value = settings.dimmer.amount;
    byId('dimmer-output').textContent = `${settings.dimmer.amount}%`;
    byId('focus-mode-enabled').checked = settings.focusMode.enabled;

    document.querySelectorAll('[data-preset]').forEach((button) => {
      button.classList.toggle('active', button.dataset.preset === settings.preset);
    });
    byId('preset-status').textContent = `Preset: ${titleCasePreset(settings.preset)}`;
  }

  function queueSave(nextSettings, message = 'Settings saved') {
    settings = api.normalizeSettings(nextSettings);
    renderSettings();
    saveQueue = saveQueue
      .catch(() => {})
      .then(() => chrome.storage.sync.set({ [api.SETTINGS_KEY]: settings }))
      .then(() => setStatus(message))
      .catch((error) => setStatus(error.message || 'Could not save settings', true));
    return saveQueue;
  }

  function update(patch, markCustom = true) {
    const next = api.deepMerge(settings, patch);
    if (markCustom) next.preset = 'custom';
    return queueSave(next);
  }

  function bindToggle(id, patchFactory, markCustom = true) {
    byId(id).addEventListener('change', (event) => {
      update(patchFactory(event.target.checked), markCustom);
    });
  }

  function bindValue(id, eventName, patchFactory) {
    byId(id).addEventListener(eventName, (event) => update(patchFactory(event.target.value)));
  }

  function renderExceptions() {
    const list = byId('exception-list');
    list.replaceChildren();
    const entries = Object.entries(siteEntries)
      .filter(([, value]) => api.isPlainObject(value) && value.enabled === false)
      .sort(([a], [b]) => a.localeCompare(b));

    entries.forEach(([storageKey]) => {
      const hostname = storageKey.slice(api.SITE_PREFIX.length);
      const item = document.createElement('li');
      const label = document.createElement('span');
      const remove = document.createElement('button');
      label.textContent = hostname;
      remove.type = 'button';
      remove.textContent = 'Remove';
      remove.addEventListener('click', async () => {
        try {
          await chrome.storage.sync.remove(storageKey);
          delete siteEntries[storageKey];
          renderExceptions();
          setStatus(`Removed ${hostname}`);
        } catch (error) {
          setStatus(error.message || 'Could not remove exception', true);
        }
      });
      item.append(label, remove);
      list.append(item);
    });

    byId('empty-exceptions').hidden = entries.length > 0;
    byId('clear-exceptions').disabled = entries.length === 0;
  }

  function bindEvents() {
    bindToggle('global-enabled', (enabled) => ({ enabled }), false);
    bindToggle('scrollbar-enabled', (enabled) => ({ scrollbar: { enabled } }));
    bindToggle('scrollbar-autohide', (autoHide) => ({ scrollbar: { autoHide } }));
    bindValue('rail-width', 'change', (value) => ({ scrollbar: { railWidth: Number(value) } }));
    bindValue('thumb-width', 'change', (value) => ({ scrollbar: { thumbWidth: Number(value) } }));
    bindValue('min-thumb', 'change', (value) => ({ scrollbar: { minThumb: Number(value) } }));
    bindValue('thumb-color', 'change', (value) => ({ scrollbar: { thumbColor: value } }));
    bindValue('hover-color', 'change', (value) => ({ scrollbar: { hoverColor: value } }));
    bindValue('track-color', 'change', (value) => ({ scrollbar: { trackColor: value } }));
    bindToggle('transparent-track', (enabled) => ({
      scrollbar: { trackColor: enabled ? 'transparent' : byId('track-color').value }
    }));
    bindToggle('selection-enabled', (enabled) => ({ selection: { enabled } }));
    bindValue('selection-background', 'change', (value) => ({ selection: { background: value } }));
    bindValue('selection-color', 'change', (value) => ({ selection: { color: value } }));
    bindToggle('focus-ring-enabled', (enabled) => ({ focusRing: { enabled } }));
    bindValue('focus-color', 'change', (value) => ({ focusRing: { color: value } }));
    bindValue('focus-width', 'change', (value) => ({ focusRing: { width: Number(value) } }));
    bindToggle('accent-enabled', (enabled) => ({ formAccent: { enabled } }));
    bindValue('accent-color', 'change', (value) => ({ formAccent: { color: value } }));
    bindValue('motion-mode', 'change', (value) => ({ motion: { mode: value } }));
    bindToggle('smooth-scroll', (enabled) => ({ motion: { smoothScroll: enabled } }));
    bindToggle('dimmer-enabled', (enabled) => ({ dimmer: { enabled } }));
    byId('dimmer-amount').addEventListener('input', (event) => {
      byId('dimmer-output').textContent = `${event.target.value}%`;
    });
    bindValue('dimmer-amount', 'change', (value) => ({ dimmer: { amount: Number(value) } }));
    bindToggle('focus-mode-enabled', (enabled) => ({ focusMode: { enabled } }));

    document.querySelectorAll('[data-preset]').forEach((button) => {
      button.addEventListener('click', () => queueSave(api.applyPreset(settings, button.dataset.preset), 'Preset applied'));
    });

    byId('exception-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = byId('exception-hostname');
      const hostname = api.normalizeHostnameInput(input.value);
      if (!hostname) {
        setStatus('Enter a valid hostname such as example.com', true);
        input.focus();
        return;
      }
      const storageKey = api.siteKey(hostname);
      const existing = api.isPlainObject(siteEntries[storageKey]) ? siteEntries[storageKey] : {};
      siteEntries[storageKey] = api.deepMerge(existing, { enabled: false });
      try {
        await chrome.storage.sync.set({ [storageKey]: siteEntries[storageKey] });
        input.value = '';
        renderExceptions();
        setStatus(`Disabled on ${hostname}`);
      } catch (error) {
        setStatus(error.message || 'Could not add exception', true);
      }
    });

    byId('clear-exceptions').addEventListener('click', async () => {
      const keys = Object.keys(siteEntries).filter((storageKey) =>
        api.isPlainObject(siteEntries[storageKey]) && siteEntries[storageKey].enabled === false
      );
      if (!keys.length || !confirm(`Remove ${keys.length} website exception${keys.length === 1 ? '' : 's'}?`)) return;
      try {
        await chrome.storage.sync.remove(keys);
        keys.forEach((storageKey) => delete siteEntries[storageKey]);
        renderExceptions();
        setStatus('Website exceptions cleared');
      } catch (error) {
        setStatus(error.message || 'Could not clear exceptions', true);
      }
    });

    byId('reset-defaults').addEventListener('click', () => {
      if (confirm('Reset global settings to the FlowPlay defaults? Website overrides will be kept.')) {
        queueSave(api.DEFAULT_SETTINGS, 'Global defaults restored');
      }
    });
  }

  async function start() {
    const stored = await chrome.storage.sync.get(null);
    settings = api.normalizeSettings(stored[api.SETTINGS_KEY]);
    siteEntries = Object.fromEntries(Object.entries(stored).filter(([key]) => key.startsWith(api.SITE_PREFIX)));
    bindEvents();
    renderSettings();
    renderExceptions();
  }

  start().catch((error) => setStatus(error.message || 'Could not load settings', true));
})();
