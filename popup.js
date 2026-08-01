// Category list and colours mirror CATEGORIES in content.js - keep in sync.
const CATEGORIES = [
  { storageKey: 'cat_sponsor',        label: 'Sponsor',      color: '#00d400', on: true },
  { storageKey: 'cat_selfpromo',      label: 'Self-promo',   color: '#ffff00', on: false },
  { storageKey: 'cat_interaction',    label: 'Sub reminder', color: '#cc00ff', on: false },
  { storageKey: 'cat_intro',          label: 'Intro',        color: '#00ffff', on: false },
  { storageKey: 'cat_outro',          label: 'Outro',        color: '#0202ed', on: false },
  { storageKey: 'cat_preview',        label: 'Recap',        color: '#008fd6', on: false },
  { storageKey: 'cat_filler',         label: 'Filler',       color: '#7300ff', on: false },
  { storageKey: 'cat_music_offtopic', label: 'Non-music',    color: '#ff9900', on: false }
];

const STATS_KEY = 'skip_stats';

/** "4h 12m" / "12m 30s" / "45s" - drops units that would read as zero. */
function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

document.addEventListener('DOMContentLoaded', () => {
  const toggleShorts = document.getElementById('toggle-shorts');
  const toggleSpeed = document.getElementById('toggle-speed');
  const toggleSponsors = document.getElementById('toggle-sponsors');
  const toggleActions = document.getElementById('toggle-actions');
  const toggleLayout = document.getElementById('toggle-layout');

  const catSection = document.getElementById('cat-section');
  const catGrid = document.getElementById('cat-grid');
  const catMore = document.getElementById('cat-more');
  const catMoreLabel = document.getElementById('cat-more-label');

  const statsTime = document.getElementById('stats-time');
  const statsCount = document.getElementById('stats-count');
  const statsReset = document.getElementById('stats-reset');

  // Default state: all features enabled (mirrored in content.js)
  const defaults = {
    hide_shorts: true,
    speed_selector: true,
    hide_actions: true,
    center_player: true,
    skip_sponsors: true
  };
  CATEGORIES.forEach((c) => { defaults[c.storageKey] = c.on; });

  // ─── Category chips ──────────────────────────────────────────────

  const VISIBLE_CHIPS = 4; // the rest stay behind "N more"

  /**
   * A category that is on but sits in the hidden half would be invisible, so
   * the collapsed view opens itself rather than hiding an active setting.
   */
  function shouldStartExpanded(data) {
    return CATEGORIES.slice(VISIBLE_CHIPS).some((c) => data[c.storageKey]);
  }

  function setChipsExpanded(expanded) {
    catMore.setAttribute('aria-expanded', String(expanded));
    catMoreLabel.textContent = expanded
      ? 'Fewer'
      : `${CATEGORIES.length - VISIBLE_CHIPS} more`;
    [...catGrid.children].forEach((chip, i) => {
      chip.hidden = !expanded && i >= VISIBLE_CHIPS;
    });
  }

  function buildChips(data) {
    CATEGORIES.forEach((category) => {
      const chip = document.createElement('button');
      chip.className = 'cat-chip';
      chip.type = 'button';
      chip.setAttribute('aria-pressed', String(!!data[category.storageKey]));

      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.backgroundColor = category.color;
      chip.appendChild(dot);

      const label = document.createElement('span');
      label.textContent = category.label;
      chip.appendChild(label);

      chip.addEventListener('click', () => {
        const next = chip.getAttribute('aria-pressed') !== 'true';
        chip.setAttribute('aria-pressed', String(next));
        chrome.storage.sync.set({ [category.storageKey]: next });
      });

      catGrid.appendChild(chip);
    });
    setChipsExpanded(shouldStartExpanded(data));
  }

  catMore.addEventListener('click', () => {
    setChipsExpanded(catMore.getAttribute('aria-expanded') !== 'true');
  });

  // Categories are meaningless while the whole feature is off.
  function syncCatSectionState(enabled) {
    catSection.classList.toggle('disabled', !enabled);
  }

  // ─── Stats ───────────────────────────────────────────────────────

  function renderStats(stats) {
    const { seconds = 0, count = 0 } = stats || {};
    statsTime.textContent = count ? `${formatDuration(seconds)} skipped` : 'Nothing skipped yet';
    statsCount.textContent = count
      ? `${count} segment${count === 1 ? '' : 's'}`
      : 'Stats appear once a segment is skipped';
  }

  function loadStats() {
    chrome.storage.local.get({ [STATS_KEY]: { seconds: 0, count: 0 } }, (data) => {
      renderStats(data[STATS_KEY]);
    });
  }

  statsReset.addEventListener('click', () => {
    const zero = { seconds: 0, count: 0 };
    chrome.storage.local.set({ [STATS_KEY]: zero }, () => renderStats(zero));
  });

  // Keep the popup live if a skip lands while it is open.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[STATS_KEY]) renderStats(changes[STATS_KEY].newValue);
  });

  // ─── Load ────────────────────────────────────────────────────────

  chrome.storage.sync.get(defaults, (data) => {
    toggleShorts.checked = data.hide_shorts;
    toggleSpeed.checked = data.speed_selector;
    toggleSponsors.checked = data.skip_sponsors;
    toggleActions.checked = data.hide_actions;
    toggleLayout.checked = data.center_player;

    buildChips(data);
    syncCatSectionState(data.skip_sponsors);
  });

  loadStats();

  // ─── Save ────────────────────────────────────────────────────────

  toggleShorts.addEventListener('change', (e) => {
    chrome.storage.sync.set({ hide_shorts: e.target.checked });
  });

  toggleSpeed.addEventListener('change', (e) => {
    chrome.storage.sync.set({ speed_selector: e.target.checked });
  });

  toggleSponsors.addEventListener('change', (e) => {
    chrome.storage.sync.set({ skip_sponsors: e.target.checked });
    syncCatSectionState(e.target.checked);
  });

  toggleActions.addEventListener('change', (e) => {
    chrome.storage.sync.set({ hide_actions: e.target.checked });
  });

  toggleLayout.addEventListener('change', (e) => {
    chrome.storage.sync.set({ center_player: e.target.checked });
  });
});
