/* Local service-worker helpers for analytics pages and reset actions. */

const STATS_KEY = 'skip_stats';
const ANALYTICS_KEY = 'analytics';
const WRITE_ERROR_KEY = 'analytics_write_error';
const SCHEMA_VERSION = 2;

function localSet(obj) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(obj, () => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve();
    });
  });
}

function localRemove(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.remove(keys, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

async function resetAnalytics() {
  await localSet({
    [STATS_KEY]: { seconds: 0, count: 0, byCategory: {}, byChannel: {} },
    [ANALYTICS_KEY]: { days: {}, schemaVersion: SCHEMA_VERSION }
  });
  // A reset also clears any standing "your last write failed" banner.
  await localRemove(WRITE_ERROR_KEY);
  return { ok: true };
}

function openAnalytics() {
  return new Promise((resolve) => {
    chrome.tabs.create({ url: chrome.runtime.getURL('analytics.html') }, () => {
      const err = chrome.runtime.lastError;
      resolve(err ? { ok: false, error: err.message } : { ok: true });
    });
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.type) {
    // Answer anyway: an unanswered sendMessage leaves the sender with an
    // opaque "message port closed" lastError instead of a real reason.
    sendResponse({ ok: false, error: 'Unrecognised message' });
    return false;
  }

  if (message.type === 'RESET_ANALYTICS') {
    resetAnalytics()
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === 'OPEN_ANALYTICS') {
    openAnalytics().then(sendResponse);
    return true;
  }

  sendResponse({ ok: false, error: `Unknown message type: ${message.type}` });
  return false;
});
