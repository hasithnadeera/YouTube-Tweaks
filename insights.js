/* Weekly summary, year heatmap with streaks, channel categories and history
   search. Uses the helpers in analytics.js and redraws on its render event. */

(function startInsights() {
  'use strict';

  const CATEGORY_KEY = 'channel_categories';
  const CATEGORIES = ['Learning', 'Tech', 'Entertainment', 'Music', 'News', 'Gaming', 'Other'];
  const GENRE_KEY = 'channel_genres';
  // YouTube's own video categories, mapped onto ours.
  const GENRE_TO_CATEGORY = {
    'Education': 'Learning',
    'Howto & Style': 'Learning',
    'Science & Technology': 'Tech',
    'Entertainment': 'Entertainment',
    'Comedy': 'Entertainment',
    'Film & Animation': 'Entertainment',
    'People & Blogs': 'Entertainment',
    'Pets & Animals': 'Entertainment',
    'Travel & Events': 'Entertainment',
    'Autos & Vehicles': 'Entertainment',
    'Sports': 'Entertainment',
    'Shows': 'Entertainment',
    'Movies': 'Entertainment',
    'Trailers': 'Entertainment',
    'Music': 'Music',
    'News & Politics': 'News',
    'Gaming': 'Gaming',
    'Nonprofits & Activism': 'Other'
  };
  const UNSORTED = 'Not sorted';

  let days = {};
  let rangeKeys = [];
  let categories = {};
  let genres = {};
  let genresLoaded = false;
  let autoSortRunning = false;

  const $ = (id) => document.getElementById(id);

  function sumDays(keys) {
    const total = { watched: 0, saved: 0, channels: {} };
    keys.forEach((key) => {
      const day = days[key];
      if (!day) return;
      total.watched += day.watched || 0;
      total.saved += (day.skipped || 0) + (day.speedSaved || 0);
      Object.entries(day.channels || {}).forEach(([id, ch]) => {
        if (!total.channels[id]) total.channels[id] = { id, name: ch.name || id, avatar: ch.avatar || '', watched: 0 };
        total.channels[id].watched += ch.watched || 0;
        if (ch.name) total.channels[id].name = ch.name;
        if (ch.avatar) total.channels[id].avatar = ch.avatar;
      });
    });
    return total;
  }

  function lastKeys(n) {
    const keys = [];
    for (let i = n - 1; i >= 0; i -= 1) keys.push(todayKey(addDays(new Date(), -i)));
    return keys;
  }

  // ─── Weekly summary ─────────────────────────────────────────────

  function joinNames(names) {
    if (names.length < 2) return names.join('');
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  }

  function renderSummary() {
    const week = sumDays(lastKeys(7));
    const el = $('week-summary');
    if (week.watched < 60) {
      el.textContent = 'Nothing watched in the last 7 days yet.';
      return;
    }
    const top = Object.values(week.channels)
      .filter((c) => c.watched > 0)
      .sort((a, b) => b.watched - a.watched);
    const topThree = top.slice(0, 3);
    const share = topThree.reduce((sum, c) => sum + c.watched, 0) / week.watched;

    let text = `In the last 7 days you watched ${formatDuration(week.watched)}`;
    if (topThree.length) {
      text += `, ${Math.round(share * 100)}% of it from ${joinNames(topThree.map((c) => c.name))}`;
    }
    text += '.';
    if (week.saved >= 30) text += ` TubeTune saved you ${formatDuration(week.saved)}.`;
    el.textContent = text;
  }

  // ─── Year heatmap and streaks ───────────────────────────────────

  function streaks() {
    const watchedOn = (key) => (days[key] && days[key].watched >= 60);
    let current = 0;
    let date = new Date();
    // Today may not have started yet; a streak that ended yesterday still counts.
    if (!watchedOn(todayKey(date))) date = addDays(date, -1);
    while (watchedOn(todayKey(date))) {
      current += 1;
      date = addDays(date, -1);
    }

    let longest = 0;
    let run = 0;
    Object.keys(days).sort().forEach((key, i, keys) => {
      if (!watchedOn(key)) { run = 0; return; }
      const prev = i > 0 ? keys[i - 1] : null;
      const expected = todayKey(addDays(parseDayKey(key), -1));
      run = prev === expected && watchedOn(prev) ? run + 1 : 1;
      longest = Math.max(longest, run);
    });
    return { current, longest };
  }

  function renderHeatmap() {
    const grid = $('heatmap');
    grid.replaceChildren();

    // 53 weeks ending this week, columns are weeks starting on Sunday.
    const end = new Date();
    const start = addDays(end, -(52 * 7 + end.getDay()));
    const keys = [];
    for (let d = new Date(start); d <= end; d = addDays(d, 1)) keys.push(todayKey(d));

    const values = keys.map((k) => (days[k] && days[k].watched) || 0);
    const peak = Math.max(...values, 1);

    keys.forEach((key, i) => {
      const cell = document.createElement('span');
      const v = values[i];
      const level = v < 60 ? 0 : Math.min(4, Math.ceil((v / peak) * 4));
      cell.className = `heat-cell level-${level}`;
      cell.title = `${parseDayKey(key).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}: ${v >= 60 ? formatDuration(v) : 'nothing watched'}`;
      grid.appendChild(cell);
    });

    const { current, longest } = streaks();
    const dayWord = (n) => `${n} day${n === 1 ? '' : 's'}`;
    $('streak-text').textContent = current
      ? `${dayWord(current)} in a row now, longest ${dayWord(longest)}`
      : `Longest run ${dayWord(longest)}`;
  }

  // ─── Categories ─────────────────────────────────────────────────

  function autoCategory(id) {
    return GENRE_TO_CATEGORY[genres[id]] || '';
  }

  // A category picked by hand always wins over the automatic one.
  function categoryOf(id) {
    return categories[id] || autoCategory(id) || UNSORTED;
  }

  // ─── Auto-sort ──────────────────────────────────────────────────
  // For each channel without a known genre, open one of its watched videos
  // and read the category YouTube assigned to it.

  function sampleVideoId(channelId) {
    const keys = Object.keys(days).sort().reverse();
    for (const key of keys) {
      const ch = days[key].channels && days[key].channels[channelId];
      if (!ch) continue;
      const id = Object.keys(channelVideos(ch))[0];
      if (id) return id;
    }
    return '';
  }

  async function fetchGenre(videoId) {
    const res = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, { credentials: 'omit' });
    if (!res.ok) return '';
    const html = await res.text();
    const match = html.match(/"category":"([^"]+)"/) || html.match(/itemprop="genre" content="([^"]+)"/);
    return match ? match[1].replace(/\\u0026/g, '&').replace(/&amp;/g, '&') : '';
  }

  async function autoSort() {
    if (autoSortRunning || !genresLoaded) return;
    const todo = Object.keys(sumDays(Object.keys(days)).channels).filter((id) => !(id in genres));
    if (!todo.length) return;
    autoSortRunning = true;
    try {
      // A few at a time, so a long history doesn't fire hundreds of requests at once.
      for (let i = 0; i < todo.length; i += 4) {
        await Promise.all(todo.slice(i, i + 4).map(async (id) => {
          const videoId = sampleVideoId(id);
          try {
            genres[id] = videoId ? await fetchGenre(videoId) : '';
          } catch (_) {
            // Offline or blocked: try again next time the page opens.
          }
        }));
        chrome.storage.local.set({ [GENRE_KEY]: genres }, () => void chrome.runtime.lastError);
        renderCategoryBars();
        if (!$('category-list').contains(document.activeElement)) renderCategoryEditor();
      }
    } finally {
      autoSortRunning = false;
    }
  }

  function renderCategoryBars() {
    const list = $('category-bars');
    list.replaceChildren();
    const range = sumDays(rangeKeys);
    const totals = {};
    Object.values(range.channels).forEach((ch) => {
      const cat = categoryOf(ch.id);
      totals[cat] = (totals[cat] || 0) + ch.watched;
    });
    const rows = Object.entries(totals).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    if (!rows.length) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'No watch time in this range.';
      list.appendChild(empty);
      return;
    }
    const max = rows[0][1];
    rows.forEach(([name, seconds]) => {
      const row = document.createElement('div');
      row.className = 'hbar-row';
      const meta = document.createElement('div');
      meta.className = 'hbar-meta';
      const label = document.createElement('span');
      label.className = 'name';
      label.textContent = name;
      const time = document.createElement('span');
      time.className = 'time';
      time.textContent = formatDuration(seconds);
      meta.append(label, time);
      const track = document.createElement('div');
      track.className = 'hbar-track';
      const fill = document.createElement('div');
      fill.className = name === UNSORTED ? 'hbar-fill is-unsorted' : 'hbar-fill';
      fill.style.width = `${Math.max(2, (seconds / max) * 100)}%`;
      track.appendChild(fill);
      row.append(meta, track);
      list.appendChild(row);
    });
  }

  function renderCategoryEditor() {
    const list = $('category-list');
    list.replaceChildren();
    const all = sumDays(Object.keys(days));
    const channels = Object.values(all.channels)
      .filter((c) => c.watched > 0)
      .sort((a, b) => b.watched - a.watched)
      .slice(0, 60);

    channels.forEach((ch) => {
      const row = document.createElement('label');
      row.className = 'category-row';
      const name = document.createElement('span');
      name.className = 'category-channel';
      name.append(makeAvatar(ch.name, ch.avatar));
      const text = document.createElement('span');
      text.textContent = ch.name;
      name.appendChild(text);

      const select = document.createElement('select');
      select.setAttribute('aria-label', `Category for ${ch.name}`);
      const auto = autoCategory(ch.id);
      [UNSORTED, ...CATEGORIES].forEach((cat) => {
        const option = document.createElement('option');
        option.value = cat === UNSORTED ? '' : cat;
        option.textContent = cat === UNSORTED ? (auto ? `Auto: ${auto}` : UNSORTED) : cat;
        select.appendChild(option);
      });
      select.value = categories[ch.id] || '';
      select.addEventListener('change', () => {
        if (select.value) categories[ch.id] = select.value;
        else delete categories[ch.id];
        chrome.storage.sync.set({ [CATEGORY_KEY]: categories }, () => void chrome.runtime.lastError);
        renderCategoryBars();
      });

      row.append(name, select);
      list.appendChild(row);
    });
  }

  // ─── Search history ─────────────────────────────────────────────

  function searchHistory(query) {
    const results = $('search-results');
    const empty = $('search-empty');
    results.replaceChildren();
    const q = query.trim().toLowerCase();
    if (!q) {
      empty.hidden = true;
      return;
    }

    const found = new Map();
    Object.keys(days).sort().reverse().forEach((key) => {
      Object.values(days[key].channels || {}).forEach((ch) => {
        Object.entries(channelVideos(ch)).forEach(([id, info]) => {
          const title = (info && info.title) || '';
          const channelName = ch.name || '';
          if (!title.toLowerCase().includes(q) && !channelName.toLowerCase().includes(q)) return;
          if (!found.has(id)) found.set(id, { id, title: title || id, channelName, lastKey: key, watched: 0 });
          found.get(id).watched += (info && info.watched) || 0;
        });
      });
    });

    const rows = [...found.values()].slice(0, 50);
    empty.hidden = rows.length > 0;
    empty.textContent = `No videos match "${query.trim()}".`;

    rows.forEach((video) => {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = `https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}`;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.className = 'result-title';
      link.textContent = video.title;
      const meta = document.createElement('span');
      meta.className = 'result-meta';
      const when = parseDayKey(video.lastKey).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      meta.textContent = `${video.channelName}, ${when}${video.watched >= 1 ? `, watched ${formatDuration(video.watched)}` : ''}`;
      item.append(link, meta);
      results.appendChild(item);
    });
  }

  // ─── Wiring ─────────────────────────────────────────────────────

  function renderAll() {
    renderSummary();
    renderHeatmap();
    renderCategoryBars();
    // Don't rebuild the list under someone picking a category.
    if (!$('category-list').contains(document.activeElement)) renderCategoryEditor();
    searchHistory($('history-search').value);
    autoSort();
  }

  document.addEventListener('tubetune:render', (event) => {
    days = event.detail.days || {};
    rangeKeys = event.detail.keys || [];
    renderAll();
  });

  document.addEventListener('DOMContentLoaded', () => {
    let timer;
    $('history-search').addEventListener('input', (e) => {
      clearTimeout(timer);
      timer = setTimeout(() => searchHistory(e.target.value), 150);
    });
  });

  chrome.storage.local.get({ [GENRE_KEY]: {} }, (data) => {
    if (!chrome.runtime.lastError) genres = data[GENRE_KEY] || {};
    genresLoaded = true;
    renderCategoryBars();
    autoSort();
  });

  chrome.storage.sync.get({ [CATEGORY_KEY]: {} }, (data) => {
    if (chrome.runtime.lastError) return;
    categories = data[CATEGORY_KEY] || {};
    renderCategoryBars();
    renderCategoryEditor();
  });
})();
