(function initializeYouTubeControls() {
  'use strict';

  const byId = (id) => document.getElementById(id);
  let statusTimer;

  const YOUTUBE_DEFAULTS = {
    hide_shorts: true,
    speed_selector: true,
    hide_actions: true,
    center_player: true,
    skip_sponsors: true,
    studio_analytics_shortcut: true,
    playback_speed: 1
  };

  const YOUTUBE_CONTROLS = [
    ['youtube-speed-selector', 'speed_selector'],
    ['youtube-center-player', 'center_player'],
    ['youtube-hide-shorts', 'hide_shorts'],
    ['youtube-hide-actions', 'hide_actions'],
    ['youtube-skip-sponsors', 'skip_sponsors'],
    ['youtube-analytics-shortcut', 'studio_analytics_shortcut']
  ];

  function setStatus(message, error = false) {
    const status = byId('status');
    status.textContent = message;
    status.style.color = error ? 'var(--ui-danger)' : '';
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { status.textContent = ''; }, 2200);
  }

  function renderYouTubeSettings(stored) {
    YOUTUBE_CONTROLS.forEach(([id, key]) => {
      byId(id).checked = typeof stored[key] === 'boolean' ? stored[key] : YOUTUBE_DEFAULTS[key];
    });
    const speed = Number(stored.playback_speed);
    byId('youtube-speed-value').textContent = `${Number.isFinite(speed) ? speed : YOUTUBE_DEFAULTS.playback_speed}×`;
  }

  function bindYouTubeControls() {
    YOUTUBE_CONTROLS.forEach(([id, key]) => {
      byId(id).addEventListener('change', async (event) => {
        try {
          await chrome.storage.sync.set({ [key]: event.target.checked });
          setStatus('YouTube setting saved');
        } catch (error) {
          setStatus(error.message || 'Could not save YouTube setting', true);
        }
      });
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      YOUTUBE_CONTROLS.forEach(([id, key]) => {
        if (changes[key]) byId(id).checked = Boolean(changes[key].newValue);
      });
      if (changes.playback_speed) {
        const speed = Number(changes.playback_speed.newValue);
        byId('youtube-speed-value').textContent = `${Number.isFinite(speed) ? speed : YOUTUBE_DEFAULTS.playback_speed}×`;
      }
    });
  }

  async function start() {
    const stored = await chrome.storage.sync.get(null);
    bindYouTubeControls();
    renderYouTubeSettings(stored);
  }

  start().catch((error) => setStatus(error.message || 'Could not load settings', true));
})();
