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
    max_quality: true,
    hide_comments: true,
    hide_notifications: true,
    compact_description: true,
    frame_screenshot: true,
    playback_speed: 1
  };

  const YOUTUBE_CONTROLS = [
    ['youtube-speed-selector', 'speed_selector'],
    ['youtube-center-player', 'center_player'],
    ['youtube-max-quality', 'max_quality'],
    ['youtube-frame-screenshot', 'frame_screenshot'],
    ['youtube-hide-shorts', 'hide_shorts'],
    ['youtube-hide-actions', 'hide_actions'],
    ['youtube-hide-comments', 'hide_comments'],
    ['youtube-hide-notifications', 'hide_notifications'],
    ['youtube-compact-description', 'compact_description'],
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

  // The switches live in a panel that slides in from the right.
  function bindSettingsPanel() {
    const panel = byId('settings-panel');
    const backdrop = byId('settings-backdrop');
    const openBtn = byId('btn-settings');

    function setOpen(open) {
      document.body.classList.toggle('settings-open', open);
      panel.setAttribute('aria-hidden', open ? 'false' : 'true');
      openBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      backdrop.hidden = !open;
      if (open) byId('btn-settings-close').focus();
      else openBtn.focus();
    }

    openBtn.addEventListener('click', () => setOpen(true));
    byId('btn-settings-close').addEventListener('click', () => setOpen(false));
    backdrop.addEventListener('click', () => setOpen(false));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && document.body.classList.contains('settings-open')) setOpen(false);
    });
  }

  async function start() {
    bindSettingsPanel();
    const stored = await chrome.storage.sync.get(null);
    bindYouTubeControls();
    renderYouTubeSettings(stored);
  }

  start().catch((error) => setStatus(error.message || 'Could not load settings', true));
})();
