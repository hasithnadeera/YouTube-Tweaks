const ANALYTICS_KEY = 'analytics';
const STATS_KEY = 'skip_stats';
const EMPTY_ANALYTICS = { days: {} };
const EMPTY_STATS = { seconds: 0, count: 0, byCategory: {}, byChannel: {} };
const PIE_COLORS = ['#00d400', '#3b82f6', '#a855f7', '#f59e0b', '#ec4899', '#14b8a6', '#6366f1', '#ef4444'];

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

function parseDayKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(date, n) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
}

function keysBetween(fromKey, toKey) {
  const keys = [];
  let cur = parseDayKey(fromKey);
  const end = parseDayKey(toKey);
  if (cur > end) return keys;
  while (cur <= end) {
    keys.push(todayKey(cur));
    cur = addDays(cur, 1);
  }
  return keys;
}

function lastNDayKeys(n) {
  const keys = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    keys.push(todayKey(addDays(now, -i)));
  }
  return keys;
}

function shortLabel(key, range) {
  const d = parseDayKey(key);
  if (range === 'day') {
    return `${String(d.getHours()).padStart(2, '0')}:00`; // unused for day aggregate
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function weekdayLabel(key) {
  return parseDayKey(key).toLocaleDateString(undefined, { weekday: 'short' });
}

function makeAvatar(name, avatarUrl, sizeClass) {
  const wrap = document.createElement('span');
  wrap.className = sizeClass || 'avatar';
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

function aggregateRange(days, keys) {
  let watched = 0;
  let skipped = 0;
  let skipCount = 0;
  const channels = {};
  const videoSet = new Set();

  keys.forEach((key) => {
    const day = days[key];
    if (!day) return;
    watched += day.watched || 0;
    skipped += day.skipped || 0;
    skipCount += day.skipCount || 0;

    Object.entries(day.channels || {}).forEach(([id, ch]) => {
      if (!channels[id]) {
        channels[id] = {
          name: ch.name || id,
          avatar: ch.avatar || '',
          watched: 0,
          skipped: 0,
          skipCount: 0,
          videoIds: []
        };
      }
      const entry = channels[id];
      if (ch.name) entry.name = ch.name;
      if (ch.avatar) entry.avatar = ch.avatar;
      entry.watched += ch.watched || 0;
      entry.skipped += ch.skipped || 0;
      entry.skipCount += ch.skipCount || 0;
      (ch.videoIds || []).forEach((vid) => {
        if (!entry.videoIds.includes(vid)) entry.videoIds.push(vid);
        videoSet.add(vid);
      });
    });
  });

  return {
    watched,
    skipped,
    skipCount,
    channels,
    videoCount: videoSet.size,
    channelCount: Object.keys(channels).length
  };
}

function seriesForKeys(days, keys, range) {
  // Day view: single bucket labeled "Today" (we don't store hourly).
  if (range === 'day') {
    const day = days[keys[0]] || {};
    return [{
      label: 'Today',
      watched: (day.watched || 0) / 3600,
      saved: (day.skipped || 0) / 3600
    }];
  }

  if (range === 'month' && keys.length > 14) {
    // Group into ~weekly chunks for readability.
    const chunks = [];
    for (let i = 0; i < keys.length; i += 7) {
      const slice = keys.slice(i, i + 7);
      let watched = 0;
      let saved = 0;
      slice.forEach((k) => {
        const day = days[k];
        if (!day) return;
        watched += day.watched || 0;
        saved += day.skipped || 0;
      });
      chunks.push({
        label: `W${chunks.length + 1}`,
        watched: watched / 3600,
        saved: saved / 3600
      });
    }
    return chunks;
  }

  return keys.map((key) => {
    const day = days[key] || {};
    return {
      label: range === 'week' ? weekdayLabel(key) : shortLabel(key, range),
      watched: (day.watched || 0) / 3600,
      saved: (day.skipped || 0) / 3600
    };
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const tabs = [...document.querySelectorAll('.range-tab')];
  const customRange = document.getElementById('custom-range');
  const dateFrom = document.getElementById('date-from');
  const dateTo = document.getElementById('date-to');
  const trendTitle = document.getElementById('trend-title');
  const trendChart = document.getElementById('trend-chart');
  const channelWatchBars = document.getElementById('channel-watch-bars');
  const skipPie = document.getElementById('skip-pie');
  const pieLegend = document.getElementById('pie-legend');
  const tableBody = document.getElementById('channel-table-body');
  const tableEmpty = document.getElementById('table-empty');
  const btnReset = document.getElementById('btn-reset');

  const statWatched = document.getElementById('stat-watched');
  const statSaved = document.getElementById('stat-saved');
  const statVideos = document.getElementById('stat-videos');
  const statChannels = document.getElementById('stat-channels');

  let range = 'week';
  let analytics = EMPTY_ANALYTICS;

  const today = todayKey();
  dateTo.value = today;
  dateFrom.value = todayKey(addDays(new Date(), -6));

  function resolveKeys() {
    if (range === 'day') return [todayKey()];
    if (range === 'week') return lastNDayKeys(7);
    if (range === 'month') return lastNDayKeys(30);
    const from = dateFrom.value || today;
    const to = dateTo.value || today;
    return keysBetween(from, to);
  }

  function renderTrend(series) {
    trendChart.replaceChildren();
    const max = Math.max(0.01, ...series.map((s) => Math.max(s.watched, s.saved)));

    series.forEach((point) => {
      const col = document.createElement('div');
      col.className = 'chart-col';

      const bars = document.createElement('div');
      bars.className = 'chart-bars';

      const w = document.createElement('div');
      w.className = 'chart-bar watched';
      w.style.height = `${(point.watched / max) * 100}%`;
      w.title = `${point.label}: ${point.watched.toFixed(2)}h watched`;

      const s = document.createElement('div');
      s.className = 'chart-bar saved';
      s.style.height = `${(point.saved / max) * 100}%`;
      s.title = `${point.label}: ${point.saved.toFixed(2)}h saved`;

      bars.appendChild(w);
      bars.appendChild(s);

      const label = document.createElement('div');
      label.className = 'chart-label';
      label.textContent = point.label;

      col.appendChild(bars);
      col.appendChild(label);
      trendChart.appendChild(col);
    });
  }

  function renderWatchBars(channels) {
    channelWatchBars.replaceChildren();
    const rows = Object.values(channels)
      .filter((c) => c.watched > 0)
      .sort((a, b) => b.watched - a.watched)
      .slice(0, 8);

    if (!rows.length) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'No watch time in this range.';
      channelWatchBars.appendChild(empty);
      return;
    }

    const max = rows[0].watched;
    rows.forEach((ch) => {
      const row = document.createElement('div');
      row.className = 'hbar-row';

      const meta = document.createElement('div');
      meta.className = 'hbar-meta';
      meta.appendChild(makeAvatar(ch.name, ch.avatar));

      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = ch.name;
      meta.appendChild(name);

      const time = document.createElement('span');
      time.className = 'time';
      time.textContent = formatDuration(ch.watched);
      meta.appendChild(time);

      const track = document.createElement('div');
      track.className = 'hbar-track';
      const fill = document.createElement('div');
      fill.className = 'hbar-fill';
      fill.style.width = `${Math.max(2, (ch.watched / max) * 100)}%`;
      track.appendChild(fill);

      row.appendChild(meta);
      row.appendChild(track);
      channelWatchBars.appendChild(row);
    });
  }

  function renderPie(channels) {
    skipPie.replaceChildren();
    pieLegend.replaceChildren();

    const rows = Object.values(channels)
      .filter((c) => c.skipped > 0)
      .sort((a, b) => b.skipped - a.skipped)
      .slice(0, 8);

    if (!rows.length) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'No skips in this range.';
      pieLegend.appendChild(empty);
      return;
    }

    const total = rows.reduce((sum, c) => sum + c.skipped, 0);
    const cx = 60;
    const cy = 60;
    const r = 48;
    let angle = -Math.PI / 2;

    rows.forEach((ch, i) => {
      const slice = (ch.skipped / total) * Math.PI * 2;
      const x1 = cx + r * Math.cos(angle);
      const y1 = cy + r * Math.sin(angle);
      angle += slice;
      const x2 = cx + r * Math.cos(angle);
      const y2 = cy + r * Math.sin(angle);
      const large = slice > Math.PI ? 1 : 0;
      const color = PIE_COLORS[i % PIE_COLORS.length];

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute(
        'd',
        `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`
      );
      path.setAttribute('fill', color);
      skipPie.appendChild(path);

      const legendRow = document.createElement('div');
      legendRow.className = 'pie-legend-row';
      const dot = document.createElement('span');
      dot.className = 'pie-dot';
      dot.style.background = color;
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = ch.name;
      const time = document.createElement('span');
      time.textContent = formatDuration(ch.skipped);
      legendRow.appendChild(dot);
      legendRow.appendChild(name);
      legendRow.appendChild(time);
      pieLegend.appendChild(legendRow);
    });
  }

  function renderTable(channels) {
    tableBody.replaceChildren();
    const rows = Object.values(channels)
      .filter((c) => c.watched > 0 || c.skipped > 0)
      .sort((a, b) => b.watched - a.watched || b.skipped - a.skipped);

    tableEmpty.hidden = rows.length > 0;
    if (!rows.length) return;

    rows.forEach((ch) => {
      const tr = document.createElement('tr');
      const videos = (ch.videoIds && ch.videoIds.length) || 0;
      const avg = videos ? ch.watched / videos : 0;

      const tdAvatar = document.createElement('td');
      tdAvatar.appendChild(makeAvatar(ch.name, ch.avatar));

      const tdName = document.createElement('td');
      const cell = document.createElement('div');
      cell.className = 'channel-cell';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = ch.name;
      cell.appendChild(name);
      tdName.appendChild(cell);

      const tdWatched = document.createElement('td');
      tdWatched.className = 'num';
      tdWatched.textContent = formatDuration(ch.watched);

      const tdSaved = document.createElement('td');
      tdSaved.className = 'num';
      tdSaved.textContent = formatDuration(ch.skipped);

      const tdVideos = document.createElement('td');
      tdVideos.className = 'num';
      tdVideos.textContent = String(videos);

      const tdAvg = document.createElement('td');
      tdAvg.className = 'num';
      tdAvg.textContent = videos ? formatDuration(avg) : '—';

      tr.appendChild(tdAvatar);
      tr.appendChild(tdName);
      tr.appendChild(tdWatched);
      tr.appendChild(tdSaved);
      tr.appendChild(tdVideos);
      tr.appendChild(tdAvg);
      tableBody.appendChild(tr);
    });
  }

  function render() {
    const keys = resolveKeys();
    const days = analytics.days || {};
    const agg = aggregateRange(days, keys);

    statWatched.textContent = formatDuration(agg.watched);
    statSaved.textContent = formatDuration(agg.skipped);
    statVideos.textContent = String(agg.videoCount);
    statChannels.textContent = String(agg.channelCount);

    if (range === 'day') trendTitle.textContent = 'Watch time today';
    else if (range === 'week') trendTitle.textContent = 'Watch time by day';
    else if (range === 'month') trendTitle.textContent = 'Watch time by week';
    else trendTitle.textContent = 'Watch time by day';

    renderTrend(seriesForKeys(days, keys, range));
    renderWatchBars(agg.channels);
    renderPie(agg.channels);
    renderTable(agg.channels);
  }

  function setRange(next) {
    range = next;
    tabs.forEach((tab) => {
      tab.setAttribute('aria-selected', String(tab.dataset.range === range));
    });
    customRange.hidden = range !== 'custom';
    render();
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => setRange(tab.dataset.range));
  });

  dateFrom.addEventListener('change', () => { if (range === 'custom') render(); });
  dateTo.addEventListener('change', () => { if (range === 'custom') render(); });

  btnReset.addEventListener('click', () => {
    if (!confirm('Reset all watch-time and skip analytics?')) return;
    const zeroStats = { seconds: 0, count: 0, byCategory: {}, byChannel: {} };
    const zeroAnalytics = { days: {} };
    chrome.storage.local.set(
      { [STATS_KEY]: zeroStats, [ANALYTICS_KEY]: zeroAnalytics },
      () => {
        analytics = zeroAnalytics;
        render();
      }
    );
  });

  chrome.storage.local.get({ [ANALYTICS_KEY]: EMPTY_ANALYTICS }, (data) => {
    analytics = data[ANALYTICS_KEY] || EMPTY_ANALYTICS;
    setRange('week');
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[ANALYTICS_KEY]) {
      analytics = changes[ANALYTICS_KEY].newValue || EMPTY_ANALYTICS;
      render();
    }
  });
});
