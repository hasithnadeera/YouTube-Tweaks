const SPONSOR_COLOR = '#00d400';
const STATS_KEY = 'skip_stats';
const ANALYTICS_KEY = 'analytics';
const EMPTY_STATS = { seconds: 0, count: 0, byCategory: {}, byChannel: {} };
const EMPTY_ANALYTICS = { days: {} };
const TOP_CHANNELS = 5;

/** "4h 12m" / "12m 30s" / "45s" - drops units that would read as zero. */
function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function initialLetter(name) {
  const ch = (name || '').trim().charAt(0);
  return ch ? ch.toUpperCase() : '?';
}

function todayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Local calendar dates for the last `n` days including today. */
function lastNDayKeys(n) {
  const keys = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    keys.push(todayKey(d));
  }
  return keys;
}

function sumWatched(days, keys) {
  let total = 0;
  keys.forEach((key) => {
    const day = days && days[key];
    if (day) total += day.watched || 0;
  });
  return total;
}

function openAnalytics() {
  chrome.tabs.create({ url: chrome.runtime.getURL('analytics.html') });
}

document.addEventListener('DOMContentLoaded', () => {
  const viewOverview = document.getElementById('view-overview');
  const viewSettings = document.getElementById('view-settings');
  const btnSettings = document.getElementById('btn-settings');
  const btnBack = document.getElementById('btn-back');
  const extVersion = document.getElementById('ext-version');

  if (extVersion) {
    extVersion.textContent = `v${chrome.runtime.getManifest().version}`;
  }

  const toggleShorts = document.getElementById('toggle-shorts');
  const toggleSpeed = document.getElementById('toggle-speed');
  const toggleSponsors = document.getElementById('toggle-sponsors');
  const toggleActions = document.getElementById('toggle-actions');
  const toggleLayout = document.getElementById('toggle-layout');

  const statsTime = document.getElementById('stats-time');
  const statsCount = document.getElementById('stats-count');
  const statsReset = document.getElementById('stats-reset');
  const channelBlock = document.getElementById('channel-block');
  const channelList = document.getElementById('channel-list');
  const btnAnalytics = document.getElementById('btn-analytics');
  const btnAnalyticsEmpty = document.getElementById('btn-analytics-empty');

  // Default state: all features enabled (mirrored in content.js)
  const defaults = {
    hide_shorts: true,
    speed_selector: true,
    hide_actions: true,
    center_player: true,
    skip_sponsors: true
  };

  let cachedStats = EMPTY_STATS;
  let cachedAnalytics = EMPTY_ANALYTICS;

  // ─── Views ───────────────────────────────────────────────────────

  function showOverview() {
    viewOverview.hidden = false;
    viewSettings.hidden = true;
  }

  function showSettings() {
    viewOverview.hidden = true;
    viewSettings.hidden = false;
  }

  btnSettings.addEventListener('click', showSettings);
  btnBack.addEventListener('click', showOverview);
  btnAnalytics.addEventListener('click', openAnalytics);
  btnAnalyticsEmpty.addEventListener('click', openAnalytics);

  // ─── Overview stats ──────────────────────────────────────────────

  function makeAvatar(name, avatarUrl) {
    const wrap = document.createElement('span');
    wrap.className = 'channel-avatar';
    if (avatarUrl) {
      const img = document.createElement('img');
      img.src = avatarUrl;
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      img.addEventListener('error', () => {
        wrap.replaceChildren();
        wrap.textContent = initialLetter(name);
      });
      wrap.appendChild(img);
    } else {
      wrap.textContent = initialLetter(name);
    }
    return wrap;
  }

  function renderChannelList(byChannel) {
    const rows = Object.entries(byChannel || {})
      .map(([id, bucket]) => ({
        id,
        name: bucket.name || id,
        avatar: bucket.avatar || '',
        seconds: bucket.seconds || 0
      }))
      .filter((row) => row.seconds > 0)
      .sort((a, b) => b.seconds - a.seconds)
      .slice(0, TOP_CHANNELS);

    channelList.replaceChildren();
    channelBlock.hidden = rows.length === 0;
    btnAnalyticsEmpty.hidden = rows.length > 0;
    if (!rows.length) return;

    const maxSeconds = rows[0].seconds;

    rows.forEach((row, index) => {
      const el = document.createElement('div');
      el.className = 'channel-row';

      const meta = document.createElement('div');
      meta.className = 'channel-meta';

      const rank = document.createElement('span');
      rank.className = 'channel-rank';
      rank.textContent = String(index + 1);

      const name = document.createElement('span');
      name.className = 'channel-name';
      name.textContent = row.name;
      name.title = row.name;

      const time = document.createElement('span');
      time.className = 'bar-time';
      time.textContent = formatDuration(row.seconds);

      meta.appendChild(rank);
      meta.appendChild(makeAvatar(row.name, row.avatar));
      meta.appendChild(name);
      meta.appendChild(time);

      const track = document.createElement('div');
      track.className = 'bar-track';
      const fill = document.createElement('div');
      fill.className = 'bar-fill';
      fill.style.backgroundColor = SPONSOR_COLOR;
      fill.style.width = `${Math.max(2, (row.seconds / maxSeconds) * 100)}%`;
      track.appendChild(fill);

      el.appendChild(meta);
      el.appendChild(track);
      channelList.appendChild(el);
    });
  }

  function renderOverview(stats, analytics) {
    cachedStats = stats || EMPTY_STATS;
    cachedAnalytics = analytics || EMPTY_ANALYTICS;

    const { seconds = 0, count = 0, byChannel = {} } = cachedStats;
    const weekWatched = sumWatched(cachedAnalytics.days, lastNDayKeys(7));

    if (count) {
      statsTime.textContent = formatDuration(seconds);
      const parts = [`${count} segment${count === 1 ? '' : 's'} skipped`];
      if (weekWatched > 0) parts.push(`${formatDuration(weekWatched)} watched this week`);
      statsCount.textContent = parts.join(' · ');
    } else {
      statsTime.textContent = '0s';
      statsCount.textContent = weekWatched > 0
        ? `Nothing skipped yet · ${formatDuration(weekWatched)} watched this week`
        : 'Nothing skipped yet';
    }

    renderChannelList(byChannel);
  }

  function loadStats() {
    chrome.storage.local.get(
      { [STATS_KEY]: EMPTY_STATS, [ANALYTICS_KEY]: EMPTY_ANALYTICS },
      (data) => {
        renderOverview(data[STATS_KEY] || EMPTY_STATS, data[ANALYTICS_KEY] || EMPTY_ANALYTICS);
      }
    );
  }

  statsReset.addEventListener('click', () => {
    const zeroStats = { seconds: 0, count: 0, byCategory: {}, byChannel: {} };
    const zeroAnalytics = { days: {} };
    chrome.storage.local.set(
      { [STATS_KEY]: zeroStats, [ANALYTICS_KEY]: zeroAnalytics },
      () => renderOverview(zeroStats, zeroAnalytics)
    );
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const stats = changes[STATS_KEY] ? changes[STATS_KEY].newValue : cachedStats;
    const analytics = changes[ANALYTICS_KEY] ? changes[ANALYTICS_KEY].newValue : cachedAnalytics;
    if (changes[STATS_KEY] || changes[ANALYTICS_KEY]) {
      renderOverview(stats || EMPTY_STATS, analytics || EMPTY_ANALYTICS);
    }
  });

  // ─── Load ────────────────────────────────────────────────────────

  chrome.storage.sync.get(defaults, (data) => {
    toggleShorts.checked = data.hide_shorts;
    toggleSpeed.checked = data.speed_selector;
    toggleSponsors.checked = data.skip_sponsors;
    toggleActions.checked = data.hide_actions;
    toggleLayout.checked = data.center_player;
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
  });

  toggleActions.addEventListener('change', (e) => {
    chrome.storage.sync.set({ hide_actions: e.target.checked });
  });

  toggleLayout.addEventListener('change', (e) => {
    chrome.storage.sync.set({ center_player: e.target.checked });
  });
});
