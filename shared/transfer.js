'use strict';

// Only webpage-polish keys travel between the two extension identities.
const transferApi = globalThis.BravePowerhouse;
const transferStatus = document.getElementById('transfer-status');
document.getElementById('export-polish').addEventListener('click', async () => {
  try {
    const stored = await chrome.storage.sync.get(null);
    const data = Object.fromEntries(Object.entries(stored).filter(([key]) =>
      key === transferApi.SETTINGS_KEY || key.startsWith(transferApi.SITE_PREFIX)));
    if (!data[transferApi.SETTINGS_KEY]) data[transferApi.SETTINGS_KEY] = transferApi.DEFAULT_SETTINGS;
    const url = URL.createObjectURL(new Blob([JSON.stringify({ format: 'flowplay-polish-v1', data }, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'flowplay-website-settings.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    transferStatus.textContent = 'Website settings exported.';
  } catch (error) { transferStatus.textContent = error.message; }
});
document.getElementById('import-polish').addEventListener('change', async (event) => {
  try {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 100000) throw new Error('Settings file is too large.');
    const payload = JSON.parse(await file.text());
    if (payload.format !== 'flowplay-polish-v1' || !transferApi.isPlainObject(payload.data)) throw new Error('Choose an exported website settings file.');
    const data = {};
    for (const [key, value] of Object.entries(payload.data)) {
      if (key === transferApi.SETTINGS_KEY) data[key] = transferApi.normalizeSettings(value);
      else if (key.startsWith(transferApi.SITE_PREFIX) && transferApi.isPlainObject(value)) {
        const host = key.slice(transferApi.SITE_PREFIX.length);
        if (host && transferApi.normalizeHostnameInput(host) === host) data[key] = value;
      }
    }
    if (!Object.keys(data).length) throw new Error('No website settings found.');
    if (!confirm('Import these website settings? Matching global and hostname settings will be replaced. YouTube settings and analytics are kept.')) return;
    await chrome.storage.sync.set(data);
    location.reload();
  } catch (error) { transferStatus.textContent = error.message; }
  finally { event.target.value = ''; }
});
