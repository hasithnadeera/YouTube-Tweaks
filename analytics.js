const ANALYTICS_KEY = 'analytics';
const STATS_KEY = 'skip_stats';
const EMPTY_ANALYTICS = { days: {} };
const EMPTY_STATS = { seconds: 0, count: 0, byCategory: {}, byChannel: {} };
const WRITE_ERROR_KEY = 'analytics_write_error';
const SCHEMA_VERSION = 2;
const PIE_COLORS = ['#00d400', '#3b82f6', '#a855f7', '#f59e0b', '#ec4899', '#14b8a6', '#6366f1', '#ef4444'];
const MAX_RANGE_DAYS = 366;
const RETENTION_DEFAULT = 180;

/**
 * Average streaming bitrate per quality rung, MB per hour, video + ~128 kbps
 * audio, as served by YouTube's VP9/AV1 ladder. Rough by nature - the estimate
 * built on it is labelled as such in the UI.
 */
const MB_PER_HOUR = {
  144: 40, 240: 65, 360: 130, 480: 235,
  720: 615, 1080: 1100, 1440: 2500, 2160: 5000
};

/** MB implied by a { quality: seconds } map, or null when nothing was recorded. */
function estimateMegabytes(byQuality) {
  if (!byQuality || typeof byQuality !== 'object') return null;
  const entries = Object.entries(byQuality);
  if (!entries.length) return null;
  let mb = 0;
  let known = false;
  entries.forEach(([quality, seconds]) => {
    const rate = MB_PER_HOUR[quality];
    if (!rate || !(seconds > 0)) return;
    known = true;
    mb += (seconds / 3600) * rate;
  });
  return known ? mb : null;
}

/** "1.4 GB" / "320 MB" / "8.2 MB". Null (no quality data recorded) reads as an em dash. */
function formatMegabytes(mb) {
  if (mb === null || mb === undefined || !Number.isFinite(mb)) return '—';
  if (mb >= 1024) return `${(mb / 1024).toFixed(mb >= 10240 ? 0 : 1)} GB`;
  if (mb >= 10) return `${Math.round(mb)} MB`;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.round(mb * 1024)} KB`;
}

function mergeQuality(target, source) {
  if (!source || typeof source !== 'object') return;
  Object.entries(source).forEach(([key, value]) => {
    if (value > 0 && Number.isFinite(value)) target[key] = (target[key] || 0) + value;
  });
}

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
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return new Date(NaN);
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(0);
  date.setHours(0, 0, 0, 0);
  date.setFullYear(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    return new Date(NaN);
  }
  return date;
}

function addDays(date, n) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
}

/**
 * Inclusive day keys from one date to another. Returns `{ keys, error }` rather
 * than a bare array: an unbounded range used to walk hundreds of thousands of
 * days and hang the page, and a reversed one silently rendered an empty
 * dashboard with no explanation.
 */
function keysBetween(fromKey, toKey) {
  let start = parseDayKey(fromKey);
  let end = parseDayKey(toKey);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { keys: [], error: 'Pick a valid start and end date.' };
  }

  // A backwards range is a slip, not a request for nothing.
  if (start > end) [start, end] = [end, start];

  const span = Math.round((end - start) / 86400000) + 1;
  if (span > MAX_RANGE_DAYS) {
    return { keys: [], error: `That range is ${span} days. Pick ${MAX_RANGE_DAYS} days or fewer.` };
  }

  const keys = [];
  let cur = start;
  while (cur <= end) {
    keys.push(todayKey(cur));
    cur = addDays(cur, 1);
  }
  return { keys, error: '' };
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

/** Normalise a stored channel bucket's videos to the v2 map, whatever version wrote it. */
function channelVideos(ch) {
  if (ch && ch.videos && typeof ch.videos === 'object' && !Array.isArray(ch.videos)) return ch.videos;
  const map = {};
  (ch && Array.isArray(ch.videoIds) ? ch.videoIds : []).forEach((id) => {
    if (id) map[id] = { title: '', watched: 0, skipped: 0 };
  });
  return map;
}

function aggregateRange(days, keys) {
  let watched = 0;
  let skipped = 0;
  let skipCount = 0;
  const channels = {};
  const videos = {};
  const byQuality = {};
  const watchedVideoIds = new Set();

  keys.forEach((key) => {
    const day = days[key];
    if (!day || typeof day !== 'object') return;
    watched += day.watched || 0;
    skipped += day.skipped || 0;
    skipCount += day.skipCount || 0;
    mergeQuality(byQuality, day.byQuality);

    Object.entries(day.channels || {}).forEach(([id, ch]) => {
      if (!ch || typeof ch !== 'object') return;
      if (!channels[id]) {
        channels[id] = {
          id,
          name: ch.name || id,
          avatar: ch.avatar || '',
          watched: 0,
          skipped: 0,
          skipCount: 0,
          videoIds: [],
          watchedVideoIds: [],
          byQuality: {}
        };
      }
      const entry = channels[id];
      if (ch.name) entry.name = ch.name;
      if (ch.avatar) entry.avatar = ch.avatar;
      entry.watched += ch.watched || 0;
      entry.skipped += ch.skipped || 0;
      entry.skipCount += ch.skipCount || 0;
      mergeQuality(entry.byQuality, ch.byQuality);

      Object.entries(channelVideos(ch)).forEach(([vid, rawInfo]) => {
        const info = rawInfo && typeof rawInfo === 'object' ? rawInfo : {};
        if (!entry.videoIds.includes(vid)) entry.videoIds.push(vid);

        // "Videos" and the per-video average must count what was actually
        // watched. Counting skip-only videos dragged every average down.
        if ((info.watched || 0) > 0) {
          watchedVideoIds.add(vid);
          if (!entry.watchedVideoIds.includes(vid)) entry.watchedVideoIds.push(vid);
        }

        if (!videos[vid]) {
          videos[vid] = {
            id: vid,
            title: info.title || '',
            channelId: id,
            channelName: entry.name,
            watched: 0,
            skipped: 0
          };
        }
        const video = videos[vid];
        if (info.title) video.title = info.title;
        video.channelName = entry.name;
        video.watched += info.watched || 0;
        video.skipped += info.skipped || 0;
      });
    });
  });

  return {
    watched,
    skipped,
    skipCount,
    channels,
    videos,
    byQuality,
    estimatedMb: estimateMegabytes(byQuality),
    videoCount: watchedVideoIds.size,
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

  // Gate on the actual span: a long *custom* range used to fall through and
  // render one labelled column per day.
  if (keys.length > 14) {
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
  const btnExportCsv = document.getElementById('btn-export-csv');
  const btnExportJson = document.getElementById('btn-export-json');
  const inputImport = document.getElementById('input-import');
  const retentionSelect = document.getElementById('retention-select');
  const rangeError = document.getElementById('range-error');
  const writeBanner = document.getElementById('write-banner');
  const videoTableBody = document.getElementById('video-table-body');
  const videoTableEmpty = document.getElementById('video-table-empty');
  const statData = document.getElementById('stat-data');

  let lastAggregate = null;
  let lastKeys = [];

  const statWatched = document.getElementById('stat-watched');
  const statSaved = document.getElementById('stat-saved');
  const statVideos = document.getElementById('stat-videos');
  const statChannels = document.getElementById('stat-channels');

  let range = 'day';
  let analytics = EMPTY_ANALYTICS;

  dateTo.value = todayKey();
  dateFrom.value = todayKey(addDays(new Date(), -6));
  // Stop a stray year like 0001 from asking for a 700,000-day walk.
  [dateFrom, dateTo].forEach((input) => {
    input.min = '2020-01-01';
    input.max = todayKey();
  });

  function resolveKeys() {
    if (range === 'day') return { keys: [todayKey()], error: '' };
    if (range === 'week') return { keys: lastNDayKeys(7), error: '' };
    if (range === 'month') return { keys: lastNDayKeys(30), error: '' };
    return keysBetween(dateFrom.value || todayKey(), dateTo.value || todayKey());
  }

  function renderTrend(series) {
    trendChart.replaceChildren();
    // The old 0.01h floor meant a day with <36s watched rendered a bar taller
    // than its container. Take the real peak and clamp every bar to it.
    const peak = Math.max(0, ...series.map((s) => Math.max(s.watched, s.saved)));
    const max = peak > 0 ? peak : 1;
    const pct = (value) => `${Math.min(100, Math.max(0, (value / max) * 100))}%`;

    series.forEach((point) => {
      const col = document.createElement('div');
      col.className = 'chart-col';

      const bars = document.createElement('div');
      bars.className = 'chart-bars';

      const w = document.createElement('div');
      w.className = 'chart-bar watched';
      w.style.height = pct(point.watched);
      w.title = `${point.label}: ${point.watched.toFixed(2)}h watched`;

      const s = document.createElement('div');
      s.className = 'chart-bar saved';
      s.style.height = pct(point.saved);
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
      fill.style.width = `${Math.min(100, Math.max(2, (ch.watched / max) * 100))}%`;
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
      skipPie.setAttribute('hidden', '');
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'No skips in this range.';
      pieLegend.appendChild(empty);
      return;
    }

    skipPie.removeAttribute('hidden');
    const total = rows.reduce((sum, c) => sum + c.skipped, 0);
    const cx = 60;
    const cy = 60;
    const r = 48;
    let angle = -Math.PI / 2;

    rows.forEach((ch, i) => {
      const slice = (ch.skipped / total) * Math.PI * 2;
      const color = PIE_COLORS[i % PIE_COLORS.length];

      // A full-circle SVG arc (start === end) renders blank - use a circle.
      if (rows.length === 1 || slice >= Math.PI * 2 - 1e-6) {
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', String(cx));
        circle.setAttribute('cy', String(cy));
        circle.setAttribute('r', String(r));
        circle.setAttribute('fill', color);
        skipPie.appendChild(circle);
      } else if (slice > 1e-6) {
        const x1 = cx + r * Math.cos(angle);
        const y1 = cy + r * Math.sin(angle);
        const end = angle + slice;
        const x2 = cx + r * Math.cos(end);
        const y2 = cy + r * Math.sin(end);
        const large = slice > Math.PI ? 1 : 0;

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute(
          'd',
          `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`
        );
        path.setAttribute('fill', color);
        skipPie.appendChild(path);
        angle = end;
      }

      const legendRow = document.createElement('div');
      legendRow.className = 'pie-legend-row';
      const dot = document.createElement('span');
      dot.className = 'pie-dot';
      dot.style.background = color;
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = ch.name;
      const time = document.createElement('span');
      time.className = 'pie-time';
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
      const videos = (ch.watchedVideoIds && ch.watchedVideoIds.length) || 0;
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

      const tdData = document.createElement('td');
      tdData.className = 'num';
      tdData.textContent = formatMegabytes(estimateMegabytes(ch.byQuality));

      tr.appendChild(tdAvatar);
      tr.appendChild(tdName);
      tr.appendChild(tdWatched);
      tr.appendChild(tdSaved);
      tr.appendChild(tdVideos);
      tr.appendChild(tdAvg);
      tr.appendChild(tdData);
      tableBody.appendChild(tr);
    });
  }

  function render() {
    const { keys, error } = resolveKeys();
    rangeError.textContent = error || '';
    rangeError.hidden = !error;

    const days = analytics.days || {};
    const agg = aggregateRange(days, keys);

    statWatched.textContent = formatDuration(agg.watched);
    statSaved.textContent = formatDuration(agg.skipped);
    statVideos.textContent = String(agg.videoCount);
    statChannels.textContent = String(agg.channelCount);
    statData.textContent = formatMegabytes(agg.estimatedMb);

    if (range === 'day') trendTitle.textContent = 'Watch time today';
    else if (range === 'week') trendTitle.textContent = 'Watch time by day';
    else if (range === 'month') trendTitle.textContent = 'Watch time by week';
    else trendTitle.textContent = 'Watch time by day';

    renderTrend(seriesForKeys(days, keys, range));
    renderWatchBars(agg.channels);
    renderPie(agg.channels);
    renderTable(agg.channels);
    renderVideos(agg.videos);
    lastAggregate = agg;
    lastKeys = keys;
  }

  // ─── Top videos ──────────────────────────────────────────────────

  function renderVideos(videos) {
    videoTableBody.replaceChildren();
    const rows = Object.values(videos)
      .filter((v) => v.watched > 0 || v.skipped > 0)
      .sort((a, b) => b.watched - a.watched || b.skipped - a.skipped)
      .slice(0, 25);

    videoTableEmpty.hidden = rows.length > 0;
    if (!rows.length) return;

    rows.forEach((video) => {
      const tr = document.createElement('tr');

      const tdThumb = document.createElement('td');
      const thumb = document.createElement('img');
      thumb.className = 'video-thumb';
      thumb.src = `https://i.ytimg.com/vi/${encodeURIComponent(video.id)}/default.jpg`;
      thumb.alt = '';
      thumb.width = 64;
      thumb.height = 36;
      thumb.referrerPolicy = 'no-referrer';
      thumb.addEventListener('error', () => thumb.remove());
      tdThumb.appendChild(thumb);

      const tdTitle = document.createElement('td');
      const link = document.createElement('a');
      link.className = 'video-title';
      link.href = `https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}`;
      link.target = '_blank';
      link.rel = 'noreferrer';
      // Titles are scraped from the page - textContent only, never innerHTML.
      link.textContent = video.title || video.id;
      link.title = video.title || video.id;
      tdTitle.appendChild(link);

      const tdChannel = document.createElement('td');
      tdChannel.className = 'muted';
      tdChannel.textContent = video.channelName || '';

      const tdWatched = document.createElement('td');
      tdWatched.className = 'num';
      tdWatched.textContent = formatDuration(video.watched);

      const tdSaved = document.createElement('td');
      tdSaved.className = 'num';
      tdSaved.textContent = formatDuration(video.skipped);

      tr.appendChild(tdThumb);
      tr.appendChild(tdTitle);
      tr.appendChild(tdChannel);
      tr.appendChild(tdWatched);
      tr.appendChild(tdSaved);
      videoTableBody.appendChild(tr);
    });
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

  function showBanner(message, kind) {
    writeBanner.textContent = message;
    writeBanner.className = kind === 'ok' ? 'banner banner-ok' : 'banner';
    writeBanner.hidden = false;
  }

  function resetLocalAnalytics() {
    const zeroStats = { seconds: 0, count: 0, byCategory: {}, byChannel: {} };
    const zeroAnalytics = { days: {}, schemaVersion: SCHEMA_VERSION };
    chrome.storage.local.set(
      { [STATS_KEY]: zeroStats, [ANALYTICS_KEY]: zeroAnalytics },
      () => {
        const err = chrome.runtime.lastError;
        if (err) {
          showBanner(`Reset failed: ${err.message}`);
          return;
        }
        analytics = zeroAnalytics;
        writeBanner.hidden = true;
        render();
      }
    );
  }

  btnReset.addEventListener('click', () => {
    if (!confirm('Reset all watch-time and skip analytics?')) return;
    try {
      chrome.runtime.sendMessage({ type: 'RESET_ANALYTICS' }, (response) => {
        const err = chrome.runtime.lastError;
        if (err || !response || !response.ok) {
          resetLocalAnalytics();
          return;
        }
        analytics = { days: {}, schemaVersion: SCHEMA_VERSION };
        writeBanner.hidden = true;
        render();
      });
    } catch (_) {
      resetLocalAnalytics();
    }
  });

  // ─── Export / import ─────────────────────────────────────────────

  function download(filename, mime, text) {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoke on the next turn so the download has picked the blob up.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /**
   * One CSV field. Channel and video titles are scraped from YouTube, so they
   * routinely contain commas and quotes; a leading =, +, - or @ also gets a
   * quote prefix so spreadsheets treat it as text rather than executing it.
   */
  function csvField(value) {
    let text = value === null || value === undefined ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }

  function buildCsv(days, keys) {
    const header = [
      'date', 'channel_id', 'channel_name', 'watched_seconds',
      'skipped_seconds', 'skip_count', 'videos', 'est_data_mb'
    ];
    const lines = [header.join(',')];

    keys.forEach((key) => {
      const day = days[key];
      if (!day) return;
      Object.entries(day.channels || {}).forEach(([id, ch]) => {
        const videos = Object.values(channelVideos(ch))
          .filter((v) => v && (v.watched || 0) > 0).length;
        const mb = estimateMegabytes(ch.byQuality);
        lines.push([
          csvField(key),
          csvField(id),
          csvField(ch.name || id),
          csvField(Math.round(ch.watched || 0)),
          csvField(Math.round(ch.skipped || 0)),
          csvField(ch.skipCount || 0),
          csvField(videos),
          csvField(mb === null ? '' : mb.toFixed(1))
        ].join(','));
      });
    });

    return lines.join('\r\n');
  }

  btnExportCsv.addEventListener('click', () => {
    const keys = lastKeys.length ? lastKeys : Object.keys(analytics.days || {}).sort();
    download(
      `youtube-tweaks-${todayKey()}.csv`,
      'text/csv;charset=utf-8',
      buildCsv(analytics.days || {}, keys)
    );
  });

  btnExportJson.addEventListener('click', () => {
    chrome.storage.local.get({ [ANALYTICS_KEY]: EMPTY_ANALYTICS, [STATS_KEY]: EMPTY_STATS }, (data) => {
      const err = chrome.runtime.lastError;
      if (err) {
        showBanner(`Export failed: ${err.message}`);
        return;
      }
      download(
        `youtube-tweaks-${todayKey()}.json`,
        'application/json',
        JSON.stringify({
          schemaVersion: SCHEMA_VERSION,
          exportedAt: new Date().toISOString(),
          [ANALYTICS_KEY]: data[ANALYTICS_KEY] || EMPTY_ANALYTICS,
          [STATS_KEY]: data[STATS_KEY] || EMPTY_STATS
        }, null, 2)
      );
    });
  });

  /** Fold an imported day-bucket set into the existing one, summing rather than replacing. */
  function mergeAnalytics(current, incoming) {
    const days = current.days || {};
    Object.entries(incoming.days || {}).forEach(([key, day]) => {
      if (!day || typeof day !== 'object' || Array.isArray(day)) return;
      if (!days[key]) {
        days[key] = { watched: 0, skipped: 0, skipCount: 0, channels: {}, byQuality: {} };
      }
      const target = days[key];
      target.watched = (target.watched || 0) + (day.watched || 0);
      target.skipped = (target.skipped || 0) + (day.skipped || 0);
      target.skipCount = (target.skipCount || 0) + (day.skipCount || 0);
      if (!target.byQuality) target.byQuality = {};
      mergeQuality(target.byQuality, day.byQuality);

      if (!target.channels) target.channels = {};
      Object.entries(day.channels || {}).forEach(([id, ch]) => {
        if (!ch || typeof ch !== 'object' || Array.isArray(ch)) return;
        if (!target.channels[id]) {
          target.channels[id] = {
            name: ch.name || id, avatar: ch.avatar || '',
            watched: 0, skipped: 0, skipCount: 0, videos: {}, byQuality: {}
          };
        }
        const entry = target.channels[id];
        if (ch.name) entry.name = ch.name;
        if (ch.avatar) entry.avatar = ch.avatar;
        entry.watched = (entry.watched || 0) + (ch.watched || 0);
        entry.skipped = (entry.skipped || 0) + (ch.skipped || 0);
        entry.skipCount = (entry.skipCount || 0) + (ch.skipCount || 0);
        if (!entry.byQuality) entry.byQuality = {};
        mergeQuality(entry.byQuality, ch.byQuality);

        if (!entry.videos) entry.videos = {};
        Object.entries(channelVideos(ch)).forEach(([vid, info]) => {
          if (!info || typeof info !== 'object') return;
          if (!entry.videos[vid]) entry.videos[vid] = { title: '', watched: 0, skipped: 0 };
          const video = entry.videos[vid];
          if (info.title) video.title = info.title;
          video.watched = (video.watched || 0) + (info.watched || 0);
          video.skipped = (video.skipped || 0) + (info.skipped || 0);
        });
      });
    });
    return { days, schemaVersion: SCHEMA_VERSION };
  }

  function mergeStats(current, incoming) {
    const result = {
      seconds: (current.seconds || 0) + (incoming.seconds || 0),
      count: (current.count || 0) + (incoming.count || 0),
      byCategory: { ...(current.byCategory || {}) },
      byChannel: { ...(current.byChannel || {}) }
    };
    Object.entries(incoming.byCategory || {}).forEach(([key, bucket]) => {
      if (!bucket || typeof bucket !== 'object') return;
      const target = result.byCategory[key] || { seconds: 0, count: 0 };
      result.byCategory[key] = {
        seconds: (target.seconds || 0) + (bucket.seconds || 0),
        count: (target.count || 0) + (bucket.count || 0)
      };
    });
    Object.entries(incoming.byChannel || {}).forEach(([key, bucket]) => {
      if (!bucket || typeof bucket !== 'object') return;
      const target = result.byChannel[key] || { seconds: 0, count: 0 };
      result.byChannel[key] = {
        ...target,
        name: bucket.name || target.name || key,
        ...(bucket.avatar || target.avatar ? { avatar: bucket.avatar || target.avatar } : {}),
        seconds: (target.seconds || 0) + (bucket.seconds || 0),
        count: (target.count || 0) + (bucket.count || 0)
      };
    });
    return result;
  }

  inputImport.addEventListener('change', () => {
    const file = inputImport.files && inputImport.files[0];
    if (!file) return;
    inputImport.value = ''; // let the same file be picked again after a failure

    file.text()
      .then((text) => {
        const parsed = JSON.parse(text);
        const incoming = parsed && parsed[ANALYTICS_KEY];
        if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming) ||
            !incoming.days || typeof incoming.days !== 'object' || Array.isArray(incoming.days)) {
          throw new Error('that file has no analytics data in it');
        }
        return new Promise((resolve, reject) => {
          chrome.storage.local.get(
            { [ANALYTICS_KEY]: EMPTY_ANALYTICS, [STATS_KEY]: EMPTY_STATS },
            (data) => {
              const getError = chrome.runtime.lastError;
              if (getError) {
                reject(new Error(getError.message));
                return;
              }
              const currentAnalytics = JSON.parse(JSON.stringify(data[ANALYTICS_KEY] || EMPTY_ANALYTICS));
              const merged = mergeAnalytics(currentAnalytics, incoming);
              const importedStats = parsed[STATS_KEY] && typeof parsed[STATS_KEY] === 'object'
                ? parsed[STATS_KEY]
                : EMPTY_STATS;
              const stats = mergeStats(data[STATS_KEY] || EMPTY_STATS, importedStats);
              chrome.storage.local.set({ [ANALYTICS_KEY]: merged, [STATS_KEY]: stats }, () => {
                const setError = chrome.runtime.lastError;
                if (setError) reject(new Error(setError.message));
                else resolve(merged);
              });
            }
          );
        });
      })
      .then((merged) => {
        analytics = merged;
        showBanner(`Imported ${file.name}.`, 'ok');
        render();
      })
      .catch((err) => showBanner(`Import failed: ${err.message || err}`));
  });

  // ─── Retention ───────────────────────────────────────────────────

  chrome.storage.sync.get({ retention_days: RETENTION_DEFAULT }, (data) => {
    if (chrome.runtime.lastError) return;
    const days = Number(data.retention_days);
    retentionSelect.value = String(Number.isFinite(days) && days >= 0 ? days : RETENTION_DEFAULT);
  });

  retentionSelect.addEventListener('change', () => {
    chrome.storage.sync.set({ retention_days: Number(retentionSelect.value) }, () => {
      void chrome.runtime.lastError;
    });
  });

  function checkWriteError() {
    chrome.storage.local.get({ [WRITE_ERROR_KEY]: null }, (data) => {
      if (chrome.runtime.lastError) return;
      const writeError = data[WRITE_ERROR_KEY];
      if (!writeError) return;
      showBanner(
        `Some activity could not be saved (${writeError.message}). ` +
        'Export your data, then shorten the retention window or reset.'
      );
    });
  }

  checkWriteError();

  chrome.storage.local.get({ [ANALYTICS_KEY]: EMPTY_ANALYTICS }, (data) => {
    analytics = data[ANALYTICS_KEY] || EMPTY_ANALYTICS;
    setRange('day');
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[ANALYTICS_KEY]) {
      analytics = changes[ANALYTICS_KEY].newValue || EMPTY_ANALYTICS;
      render();
    }
    if (changes[WRITE_ERROR_KEY]) checkWriteError();
  });
});
