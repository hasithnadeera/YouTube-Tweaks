/**
 * YouTube Tweaks - Content Script
 * Injects a speed control bar above the Like/Dislike buttons on YouTube video pages.
 * Persists the selected speed across videos via localStorage.
 */

(function () {
  'use strict';

  const STORAGE_KEY = 'yt_speed_controller_speed';
  const SPEEDS = [1, 1.25, 1.5, 2, 3];
  const CONTROLLER_ID = 'yt-speed-controller';

  const SPONSOR_API_BASE = 'https://sponsor.ajay.app/api/skipSegments';
  const TOAST_ID = 'ysc-sponsor-toast';
  const MARKER_BAR_ID = 'ysc-sponsor-bar';
  const TOAST_TIMEOUT_MS = 5000;
  const COUNTDOWN_LEAD_SECONDS = 3;  // warn this long before a segment starts
  // { seconds, count, byCategory, byChannel } in chrome.storage.local
  const STATS_KEY = 'skip_stats';
  const EMPTY_STATS = { seconds: 0, count: 0, byCategory: {}, byChannel: {} };
  // Date-bucketed watch + skip analytics: { days: { "YYYY-MM-DD": {...} } }
  const ANALYTICS_KEY = 'analytics';
  const EMPTY_ANALYTICS = { days: {} };
  const WATCH_TICK_MS = 5000;

  // ─── Sponsor Skip: Categories ────────────────────────────────────
  // Colours match SponsorBlock's own palette, so the scrubber markers read the
  // same way they do in the original extension. Only sponsor segments are
  // fetched and skipped - other categories are intentionally out of scope.

  const CATEGORIES = [
    { id: 'sponsor', label: 'Sponsor', color: '#00d400' }
  ];

  const CATEGORY_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));
  const enabledCategories = new Set(['sponsor']);
  const HASH_PREFIX_LENGTH = 4;   // SponsorBlock privacy endpoint accepts 4-32 hex chars
  const MERGE_GAP_SECONDS = 1;    // fold duplicate submissions, preserve real gaps
  const SKIP_TAIL_MARGIN = 0.15;  // don't micro-seek at the very end of a segment
  const END_OF_VIDEO_MARGIN = 1;  // an outro sponsor this close to the end ends the video
  const DURATION_TOLERANCE = 3;   // timings from a differently-cut upload are unusable
  const SEGMENT_CACHE_LIMIT = 50;

  // ─── Feature Toggles ─────────────────────────────────────────────

  let speedSelectorEnabled = true;
  let centerPlayerEnabled = true;
  let skipSponsorsEnabled = true;

  // ─── Center-Player Layout Fix ────────────────────────────────────
  // YouTube's layout engine writes a fixed 2-column width onto the watch
  // container. After we hide the suggestions sidebar that width is stale and
  // overflows the viewport (horizontal scrollbar). We override it directly.

  function fixCenterLayout() {
    if (!centerPlayerEnabled) return;

    // Clip horizontal overflow at the document root.
    document.documentElement.style.setProperty('overflow-x', 'hidden', 'important');

    const flexy = document.querySelector('ytd-watch-flexy');
    if (flexy) {
      // Remove YouTube's hard-coded width vars so the layout recomputes.
      flexy.style.setProperty('--ytd-watch-flexy-sidebar-width', '0px', 'important');
      flexy.style.setProperty('width', '100%', 'important');
      flexy.style.setProperty('max-width', '100%', 'important');
    }

    const columns = document.querySelector('ytd-watch-flexy #columns');
    if (columns) {
      columns.style.setProperty('width', '100%', 'important');
      columns.style.setProperty('max-width', '100%', 'important');
    }

    // Nudge YouTube to recalculate its own layout.
    window.dispatchEvent(new Event('resize'));
  }

  function clearCenterLayout() {
    document.documentElement.style.removeProperty('overflow-x');

    const flexy = document.querySelector('ytd-watch-flexy');
    if (flexy) {
      flexy.style.removeProperty('--ytd-watch-flexy-sidebar-width');
      flexy.style.removeProperty('width');
      flexy.style.removeProperty('max-width');
    }

    const columns = document.querySelector('ytd-watch-flexy #columns');
    if (columns) {
      columns.style.removeProperty('width');
      columns.style.removeProperty('max-width');
    }

    window.dispatchEvent(new Event('resize'));
  }

  function applyToggles(settings) {
    if (settings.hide_shorts !== undefined) document.body.classList.toggle('ysc-hide-shorts', settings.hide_shorts);
    if (settings.hide_actions !== undefined) document.body.classList.toggle('ysc-hide-actions', settings.hide_actions);
    if (settings.center_player !== undefined) {
      centerPlayerEnabled = settings.center_player;
      if (centerPlayerEnabled) {
        document.body.classList.add('ysc-center-player');
        fixCenterLayout();
      } else {
        document.body.classList.remove('ysc-center-player');
        clearCenterLayout();
      }
    }

    if (settings.speed_selector !== undefined) {
      speedSelectorEnabled = settings.speed_selector;
      if (speedSelectorEnabled) {
        injectController();
      } else {
        removeController();
      }
    }

    if (settings.skip_sponsors !== undefined) {
      skipSponsorsEnabled = settings.skip_sponsors;
      if (skipSponsorsEnabled) {
        syncSponsorSegments();
      } else {
        resetSponsorState();
      }
    }
  }

  // Load initial settings (defaults mirrored in popup.js)
  const SETTING_DEFAULTS = {
    hide_shorts: true,
    speed_selector: true,
    hide_actions: true,
    center_player: true,
    skip_sponsors: true
  };

  chrome.storage.sync.get(SETTING_DEFAULTS, applyToggles);

  // Listen for changes from popup
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') {
      const updates = {};
      for (const [key, { newValue }] of Object.entries(changes)) {
        updates[key] = newValue;
      }
      applyToggles(updates);
    }
  });

  // ─── Helpers ────────────────────────────────────────────────────

  function getSavedSpeed() {
    const saved = parseFloat(localStorage.getItem(STORAGE_KEY));
    return isNaN(saved) ? 1 : saved;
  }

  function saveSpeed(speed) {
    localStorage.setItem(STORAGE_KEY, String(speed));
  }

  function getVideo() {
    return document.querySelector('video.html5-main-video') || document.querySelector('video');
  }

  function applySpeed(speed) {
    const video = getVideo();
    if (video) {
      video.playbackRate = speed;
    }
    saveSpeed(speed);
  }

  // ─── UI Construction ─────────────────────────────────────────────

  function buildController() {
    const bar = document.createElement('div');
    bar.id = CONTROLLER_ID;

    const label = document.createElement('span');
    label.className = 'ysc-label';
    label.textContent = 'Speed';
    bar.appendChild(label);

    const currentSpeed = getSavedSpeed();

    SPEEDS.forEach((speed) => {
      const btn = document.createElement('button');
      btn.className = 'ysc-btn';
      btn.dataset.speed = speed;
      btn.textContent = speed === 1 ? '1×' : `${speed}×`;
      btn.title = `Set playback speed to ${speed}x`;
      btn.setAttribute('aria-label', `Playback speed ${speed}x`);

      if (speed === currentSpeed) {
        btn.classList.add('ysc-active');
      }

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const selectedSpeed = parseFloat(btn.dataset.speed);
        applySpeed(selectedSpeed);
        updateActiveButton(bar, selectedSpeed);
      });

      bar.appendChild(btn);
    });

    return bar;
  }

  function updateActiveButton(bar, speed) {
    bar.querySelectorAll('.ysc-btn').forEach((btn) => {
      btn.classList.toggle('ysc-active', parseFloat(btn.dataset.speed) === speed);
    });
  }

  // ─── Injection ───────────────────────────────────────────────────

  /**
   * Find the video title container (#title inside ytd-watch-metadata)
   */
  function findInsertionTarget() {
    return (
      document.querySelector('ytd-watch-metadata #title') ||
      document.querySelector('#info-contents .title')
    );
  }

  function isOnVideoPage() {
    return window.location.pathname === '/watch';
  }

  function injectController() {
    if (!isOnVideoPage() || !speedSelectorEnabled) return;
    if (document.getElementById(CONTROLLER_ID)) return; // already injected

    const target = findInsertionTarget();
    if (!target) return;

    // Make the title container a flexbox so our controller sits inline with the title text
    target.style.display = 'flex';
    target.style.justifyContent = 'space-between';
    target.style.alignItems = 'center';
    target.style.gap = '16px';

    const bar = buildController();

    // Append our controller right inside the title row
    target.appendChild(bar);

    // Apply saved speed to the video (handles SPA navigation)
    const savedSpeed = getSavedSpeed();
    applySpeed(savedSpeed);
  }

  function removeController() {
    const existing = document.getElementById(CONTROLLER_ID);
    if (existing) existing.remove();
  }

  // ─── MutationObserver: watch for DOM changes (SPA navigation) ────

  let observerDebounceTimer = null;

  const observer = new MutationObserver(() => {
    clearTimeout(observerDebounceTimer);
    observerDebounceTimer = setTimeout(() => {
      syncSponsorSegments();
      // Re-attach markers: YouTube rebuilds the progress bar on navigation and
      // on fullscreen transitions, taking our overlay with it.
      if (activeSegments.length && !document.getElementById(MARKER_BAR_ID)) {
        renderSegmentMarkers();
      }
      if (centerPlayerEnabled && isOnVideoPage()) fixCenterLayout();
      if (!isOnVideoPage() || !speedSelectorEnabled) {
        removeController();
        return;
      }
      injectController();
    }, 300);
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // ─── SPA Navigation via YouTube's custom event ───────────────────

  window.addEventListener('yt-navigate-finish', () => {
    // Deliberately outside the timeout below: a large share of sponsor segments
    // start at t=0, so the segments have to be in hand before playback begins.
    scheduleSponsorSync();
    removeSkipToast();
    removeSegmentMarkers();

    removeController(); // clear stale bar
    // After navigation YouTube re-renders the DOM; wait a beat
    setTimeout(() => {
      if (speedSelectorEnabled) injectController();
      if (centerPlayerEnabled && isOnVideoPage()) fixCenterLayout();
    }, 800);
  });

  // ─── Speed restore when a new video element is created ───────────

  // YouTube sometimes swaps the <video> element; restore speed on play
  document.addEventListener(
    'play',
    () => {
      const video = getVideo();
      if (video) {
        const savedSpeed = getSavedSpeed();
        if (video.playbackRate !== savedSpeed) {
          video.playbackRate = savedSpeed;
        }
      }
    },
    true // capture phase so we catch it before YouTube's own handlers
  );

  // ─── Sponsor Skip: State ─────────────────────────────────────────

  let activeVideoId = null;          // video id the active segments belong to
  let activeRawSegments = [];        // untouched SponsorBlock payload for that id
  let activeSegments = [];           // [{ start, end, key }], sorted, non-overlapping
  const unskippedKeys = new Set();   // segment keys the viewer restored via Undo
  const segmentCache = new Map();    // videoId -> raw segments (insertion-ordered)
  const pendingFetches = new Map();  // videoId -> in-flight Promise (dedupe)
  let toastHideTimer = null;
  let markerResizeObserver = null;   // keeps marker height matched to the track
  let countdownKey = null;           // segment key the countdown is currently on

  // ─── Sponsor Skip: Fetch & Cache ─────────────────────────────────
  // SponsorBlock's privacy endpoint: we send only the first 4 hex chars of
  // SHA-256(videoID) and match the real id locally, so the server never learns
  // which video is being watched. It answers with every video in that hash
  // bucket (~40 videos, ~12 KB).

  async function hashVideoId(videoId) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(videoId));
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, HASH_PREFIX_LENGTH);
  }

  /**
   * Raw sponsor segments for a video id, hitting the network at most once per
   * id. Resolves to [] for every "nothing to skip" outcome; only successful
   * lookups are cached, so a dropped connection retries later.
   */
  /** Enabled category ids, in a stable order so they can key the cache. */
  function enabledCategoryList() {
    return CATEGORIES.filter((c) => enabledCategories.has(c.id)).map((c) => c.id);
  }

  function fetchSegments(videoId) {
    const categories = enabledCategoryList();
    if (!categories.length) return Promise.resolve([]);

    // Asking only for the enabled categories keeps the response small - all
    // eight is roughly 4x the bytes of sponsor alone, and sponsor alone is the
    // default. The category set is part of the cache key so enabling one later
    // fetches afresh rather than serving a payload that never contained it.
    const cacheKey = `${videoId}|${categories.join(',')}`;
    if (segmentCache.has(cacheKey)) return Promise.resolve(segmentCache.get(cacheKey));
    if (pendingFetches.has(cacheKey)) return pendingFetches.get(cacheKey);

    const request = (async () => {
      const prefix = await hashVideoId(videoId);

      const params = new URLSearchParams();
      categories.forEach((id) => params.append('category', id));

      const response = await fetch(`${SPONSOR_API_BASE}/${prefix}?${params}`, {
        credentials: 'omit'
      });

      if (response.status === 404) return []; // nobody has submitted under this prefix
      if (!response.ok) throw new Error(`SponsorBlock responded ${response.status}`);

      // A 200 still does not mean our video is in the bucket.
      const bucket = await response.json();
      const entry = Array.isArray(bucket) && bucket.find((item) => item.videoID === videoId);
      return entry ? entry.segments : [];
    })()
      .then(
        (segments) => {
          cacheSegments(cacheKey, segments);
          return segments;
        },
        () => [] // offline / server hiccup: stay silent and do NOT cache
      )
      .finally(() => pendingFetches.delete(cacheKey));

    pendingFetches.set(cacheKey, request);
    return request;
  }

  function cacheSegments(cacheKey, segments) {
    segmentCache.set(cacheKey, segments);
    if (segmentCache.size > SEGMENT_CACHE_LIMIT) {
      segmentCache.delete(segmentCache.keys().next().value); // Map keeps insertion order
    }
  }

  /**
   * Keep only genuine, skippable sponsor ranges and fold the overlaps.
   * SponsorBlock hands back every submission, including downvoted ones and
   * several contributors' near-identical takes on the same ad read.
   */
  function normalizeSegments(rawSegments, duration) {
    const byCategory = new Map();

    for (const raw of rawSegments || []) {
      if (!enabledCategories.has(raw.category)) continue; // includes unknown categories
      if (raw.actionType !== 'skip') continue;         // 'mute' / 'poi' mean something else
      if (raw.locked !== 1 && raw.votes < 0) continue; // a VIP lock outranks the votes

      const [start, end] = raw.segment || [];
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      if (end <= start || start < 0) continue;

      // Timings belong to one specific cut of the video; a big mismatch means a
      // re-upload. videoDuration is 0 on older submissions - unknown, not wrong.
      if (raw.videoDuration > 0 && Number.isFinite(duration) && duration > 0 &&
          Math.abs(raw.videoDuration - duration) > DURATION_TOLERANCE) continue;

      if (!byCategory.has(raw.category)) byCategory.set(raw.category, []);
      byCategory.get(raw.category).push({ start, end });
    }

    const merged = [];

    // Merge only within a category. Folding a sponsor into an adjacent intro
    // would skip both under one label and mis-colour the scrubber.
    for (const [categoryId, segments] of byCategory) {
      const category = CATEGORY_BY_ID.get(categoryId);
      segments.sort((a, b) => a.start - b.start);

      const run = [];
      for (const segment of segments) {
        const last = run[run.length - 1];
        if (last && segment.start <= last.end + MERGE_GAP_SECONDS) {
          last.end = Math.max(last.end, segment.end);
        } else {
          run.push({ start: segment.start, end: segment.end });
        }
      }

      run.forEach((segment) => {
        segment.category = categoryId;
        segment.label = category.label;
        segment.color = category.color;
        // Deterministic identity, so an Undo survives re-normalization. The
        // category is part of it: two categories can cover the same range.
        segment.key = `${categoryId}:${segment.start.toFixed(2)}-${segment.end.toFixed(2)}`;
        merged.push(segment);
      });
    }

    merged.sort((a, b) => a.start - b.start);
    return merged;
  }

  // ─── Sponsor Skip: Skip Loop ─────────────────────────────────────
  // Driven by the media element's own `timeupdate` (~4x/second) - the only
  // honest clock here. It keeps firing in background tabs (rAF is frozen and
  // setTimeout is clamped to 1s there), it is already expressed in media time
  // so playbackRate needs no correction, and it re-fires by itself after a
  // seek, a pause/resume or a speed change.

  function isAdPlaying() {
    const player = document.getElementById('movie_player');
    return !!player && (player.classList.contains('ad-showing') ||
                        player.classList.contains('ad-interrupting'));
  }

  function findSegmentAt(time) {
    for (const segment of activeSegments) {
      if (time < segment.start) break;                      // sorted: nothing later matches
      if (time >= segment.end - SKIP_TAIL_MARGIN) continue; // effectively already past it
      if (unskippedKeys.has(segment.key)) continue;         // viewer wants to watch this one
      return segment;
    }
    return null;
  }

  /**
   * The next segment the viewer is heading into, but only once they are within
   * the countdown lead. Returns null the rest of the time.
   */
  function findUpcomingSegment(time) {
    for (const segment of activeSegments) {
      if (segment.start <= time) continue;          // behind us, or already inside
      if (unskippedKeys.has(segment.key)) continue; // viewer chose to keep this one
      return segment.start - time <= COUNTDOWN_LEAD_SECONDS ? segment : null;
    }
    return null;
  }

  function skipSegment(video, segment) {
    const duration = video.duration;
    const endsVideo = Number.isFinite(duration) && duration > 0 &&
                      segment.end >= duration - END_OF_VIDEO_MARGIN;

    // An outro sponsor runs to the last frame. Landing exactly on `duration`
    // fires `ended`, so the end screen, autoplay-next and playlists behave
    // just as if the video had played out.
    video.currentTime = endsVideo ? duration : segment.end;
    recordSkip(segment.end - segment.start, 1, {
      categoryId: segment.category,
      channel: getChannelInfo()
    });
    showSkipToast(segment);
  }

  /**
   * Channel id + display name + avatar from the watch-page owner block. Prefer a
   * UC id when the link is /channel/UC…; fall back to @handle so handle-only
   * channels still aggregate. Returns null when the owner chrome is not on
   * the page.
   */
  function getChannelInfo() {
    const link =
      document.querySelector('#owner #channel-name a') ||
      document.querySelector('ytd-video-owner-renderer ytd-channel-name a') ||
      document.querySelector('ytd-channel-name a');
    if (!link) return null;

    const name = (link.textContent || '').trim();
    if (!name) return null;

    const href = link.getAttribute('href') || '';
    const channelMatch = href.match(/\/channel\/(UC[\w-]+)/);
    const handleMatch = href.match(/\/@([\w.-]+)/);
    const id = (channelMatch && channelMatch[1]) ||
               (handleMatch && `@${handleMatch[1]}`) ||
               name;

    const img =
      document.querySelector('#owner #avatar img') ||
      document.querySelector('ytd-video-owner-renderer #avatar img') ||
      document.querySelector('ytd-video-owner-renderer img#img') ||
      document.querySelector('#channel-header-container img#img');
    let avatar = '';
    if (img) {
      avatar = (img.currentSrc || img.src || '').trim();
      if (!avatar && img.srcset) {
        const first = img.srcset.split(',')[0];
        avatar = (first && first.trim().split(/\s+/)[0]) || '';
      }
    }

    return { id, name, avatar };
  }

  function todayKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function bumpBucket(map, key, seconds, count, extra) {
    const prev = map[key] || { seconds: 0, count: 0 };
    const next = {
      seconds: Math.max(0, prev.seconds + seconds),
      count: Math.max(0, prev.count + count),
      ...extra
    };
    // Keep avatar/name even when undoing to zero if other fields remain;
    // drop the entry only when both tallies are gone.
    if (next.seconds === 0 && next.count === 0) {
      delete map[key];
    } else {
      map[key] = next;
    }
  }

  function ensureDay(days, key) {
    if (!days[key]) {
      days[key] = { watched: 0, skipped: 0, skipCount: 0, channels: {} };
    }
    return days[key];
  }

  function ensureDayChannel(day, channelId, channel) {
    if (!day.channels[channelId]) {
      day.channels[channelId] = {
        name: (channel && channel.name) || channelId,
        avatar: (channel && channel.avatar) || '',
        watched: 0,
        skipped: 0,
        skipCount: 0,
        videoIds: []
      };
    }
    const entry = day.channels[channelId];
    if (channel && channel.name) entry.name = channel.name;
    if (channel && channel.avatar) entry.avatar = channel.avatar;
    return entry;
  }

  function touchVideoId(entry, videoId) {
    if (!videoId) return;
    if (!Array.isArray(entry.videoIds)) entry.videoIds = [];
    if (!entry.videoIds.includes(videoId)) entry.videoIds.push(videoId);
  }

  /**
   * Running total of what has been skipped. Lives in storage.local, not sync -
   * sync has a modest per-hour write quota and this ticks on every segment.
   * Also bumps today's analytics day-bucket for range reports.
   */
  function recordSkip(seconds, count, meta) {
    chrome.storage.local.get(
      { [STATS_KEY]: EMPTY_STATS, [ANALYTICS_KEY]: EMPTY_ANALYTICS },
      (data) => {
        const prev = data[STATS_KEY] || EMPTY_STATS;
        const byCategory = { ...(prev.byCategory || {}) };
        const byChannel = { ...(prev.byChannel || {}) };

        if (meta && meta.categoryId) {
          bumpBucket(byCategory, meta.categoryId, seconds, count);
        }
        if (meta && meta.channel && meta.channel.id) {
          const extra = { name: meta.channel.name };
          if (meta.channel.avatar) extra.avatar = meta.channel.avatar;
          else if (byChannel[meta.channel.id] && byChannel[meta.channel.id].avatar) {
            extra.avatar = byChannel[meta.channel.id].avatar;
          }
          bumpBucket(byChannel, meta.channel.id, seconds, count, extra);
        }

        const analytics = data[ANALYTICS_KEY] || EMPTY_ANALYTICS;
        const days = { ...(analytics.days || {}) };
        const day = ensureDay(days, todayKey());
        day.skipped = Math.max(0, (day.skipped || 0) + seconds);
        day.skipCount = Math.max(0, (day.skipCount || 0) + count);
        day.channels = { ...(day.channels || {}) };

        if (meta && meta.channel && meta.channel.id) {
          const ch = ensureDayChannel(day, meta.channel.id, meta.channel);
          ch.skipped = Math.max(0, (ch.skipped || 0) + seconds);
          ch.skipCount = Math.max(0, (ch.skipCount || 0) + count);
          touchVideoId(ch, getCurrentVideoId());
        }

        chrome.storage.local.set({
          [STATS_KEY]: {
            seconds: Math.max(0, (prev.seconds || 0) + seconds),
            count: Math.max(0, (prev.count || 0) + count),
            byCategory,
            byChannel
          },
          [ANALYTICS_KEY]: { days }
        });
      }
    );
  }

  // ─── Watch-time tracker ──────────────────────────────────────────
  // Accrues wall-clock seconds while the main video is playing, the tab is
  // visible, and YouTube is not showing an ad. Batched every WATCH_TICK_MS.

  let watchLastTs = 0;
  let watchPendingSeconds = 0;
  let watchFlushTimer = null;

  function shouldAccrueWatch() {
    if (document.visibilityState !== 'visible') return false;
    if (!isOnVideoPage() || isAdPlaying()) return false;
    const video = getVideo();
    return !!(video && !video.paused && !video.ended);
  }

  function flushWatchTime() {
    const seconds = watchPendingSeconds;
    watchPendingSeconds = 0;
    if (seconds < 0.5) return;

    const channel = getChannelInfo();
    const videoId = getCurrentVideoId();

    chrome.storage.local.get({ [ANALYTICS_KEY]: EMPTY_ANALYTICS }, (data) => {
      const analytics = data[ANALYTICS_KEY] || EMPTY_ANALYTICS;
      const days = { ...(analytics.days || {}) };
      const day = ensureDay(days, todayKey());
      day.watched = (day.watched || 0) + seconds;
      day.channels = { ...(day.channels || {}) };

      if (channel && channel.id) {
        const ch = ensureDayChannel(day, channel.id, channel);
        ch.watched = (ch.watched || 0) + seconds;
        touchVideoId(ch, videoId);
      }

      chrome.storage.local.set({ [ANALYTICS_KEY]: { days } });
    });
  }

  function scheduleWatchFlush() {
    if (watchFlushTimer) return;
    watchFlushTimer = setTimeout(() => {
      watchFlushTimer = null;
      flushWatchTime();
    }, WATCH_TICK_MS);
  }

  function tickWatchTime() {
    const now = Date.now();
    if (watchLastTs && shouldAccrueWatch()) {
      const delta = (now - watchLastTs) / 1000;
      // Ignore huge gaps (sleep / background throttling).
      if (delta > 0 && delta < 30) {
        watchPendingSeconds += delta;
        scheduleWatchFlush();
      }
    }
    watchLastTs = shouldAccrueWatch() ? now : 0;
  }

  setInterval(tickWatchTime, 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') {
      tickWatchTime();
      flushWatchTime();
      watchLastTs = 0;
    }
  });

  function handleTimeUpdate(event) {
    if (!skipSponsorsEnabled || !activeSegments.length) return;
    if (!isOnVideoPage() || isAdPlaying()) return; // during an ad currentTime is the AD's clock

    const video = event.target;
    if (!(video instanceof HTMLMediaElement) || video !== getVideo()) return;

    const segment = findSegmentAt(video.currentTime);
    if (segment) {
      hideCountdown();
      skipSegment(video, segment);
      return;
    }

    updateCountdown(video.currentTime);
  }

  /**
   * Counted in media time off the same `timeupdate` tick as the skip itself, so
   * the number can never disagree with when the jump actually lands - it slows
   * with the video, freezes on pause and re-reckons after a seek for free.
   */
  function updateCountdown(time) {
    const upcoming = findUpcomingSegment(time);
    if (!upcoming) {
      hideCountdown();
      return;
    }

    const remaining = Math.min(COUNTDOWN_LEAD_SECONDS,
                               Math.max(1, Math.ceil(upcoming.start - time)));
    showCountdown(upcoming, remaining);
  }

  // `timeupdate` does not bubble, but capture-phase listeners still see it, so
  // this survives YouTube swapping the <video> element with no re-attach logic.
  document.addEventListener('timeupdate', handleTimeUpdate, true);

  document.addEventListener('durationchange', () => {
    if (activeVideoId) refreshActiveSegments();
  }, true);

  // ─── Sponsor Skip: Progress-Bar Markers ──────────────────────────
  // Paint the sponsor ranges onto YouTube's scrubber so you can see the ads
  // coming. Percentage-based, so it survives resize/theater/fullscreen with no
  // recalculation, and pointer-events:none keeps scrubbing untouched.

  function renderSegmentMarkers() {
    removeSegmentMarkers();

    const video = getVideo();
    const duration = video && video.duration;
    if (!skipSponsorsEnabled || !activeSegments.length) return;
    if (!Number.isFinite(duration) || duration <= 0) return; // live stream or not ready yet

    const progressBar = document.querySelector('#movie_player .ytp-progress-bar');
    if (!progressBar) return;

    // Our overlay is absolutely positioned, so the bar has to be a containing
    // block. YouTube normally positions it already; only intervene if it isn't,
    // since forcing `relative` onto an absolute element would move it.
    if (getComputedStyle(progressBar).position === 'static') {
      progressBar.style.position = 'relative';
    }

    const bar = document.createElement('div');
    bar.id = MARKER_BAR_ID;

    activeSegments.forEach((segment) => {
      const start = Math.max(0, Math.min(segment.start, duration));
      const end = Math.max(start, Math.min(segment.end, duration));

      const marker = document.createElement('div');
      marker.className = 'ysc-sponsor-marker';
      marker.style.background = segment.color;
      marker.title = segment.label;
      marker.style.left = `${(start / duration) * 100}%`;
      // Floor the width so a very short segment is still a visible sliver.
      marker.style.width = `${Math.max(((end - start) / duration) * 100, 0.15)}%`;
      bar.appendChild(marker);
    });

    progressBar.appendChild(bar);
    syncMarkerHeight();

    // The player fattens the bar on hover and on fullscreen; re-match then.
    const list = progressBar.querySelector('.ytp-progress-list');
    if (list && window.ResizeObserver) {
      markerResizeObserver = new ResizeObserver(syncMarkerHeight);
      markerResizeObserver.observe(list);
    }
  }

  /**
   * `.ytp-progress-bar` is a tall invisible hit area - the line you actually
   * see is the shorter `.ytp-progress-list` nested inside it. Match that, or
   * the markers tower over the scrubber.
   */
  function syncMarkerHeight() {
    const bar = document.getElementById(MARKER_BAR_ID);
    if (!bar) return;

    const list = document.querySelector('#movie_player .ytp-progress-list');
    const height = list ? list.getBoundingClientRect().height : 0;
    bar.style.height = height ? `${height}px` : '100%';
  }

  function removeSegmentMarkers() {
    if (markerResizeObserver) {
      markerResizeObserver.disconnect();
      markerResizeObserver = null;
    }
    const existing = document.getElementById(MARKER_BAR_ID);
    if (existing) existing.remove();
  }

  // ─── Sponsor Skip: Toast ─────────────────────────────────────────
  // Mounted inside #movie_player rather than the page body, so it rides along
  // into theater mode and fullscreen where the rest of the document is hidden.

  /**
   * One pill, two modes: it counts a sponsor down, then becomes the "skipped"
   * notice. Reused in place rather than rebuilt, so the countdown does not
   * re-run its entry animation on every one of the ~4 ticks per second.
   */
  function ensureToast(mode) {
    let toast = document.getElementById(TOAST_ID);
    if (toast && toast.dataset.mode === mode) return toast;

    const player = document.getElementById('movie_player');
    if (!player) return null;

    if (toast) toast.remove();

    toast = document.createElement('div');
    toast.id = TOAST_ID;
    toast.dataset.mode = mode;
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');

    const label = document.createElement('span');
    label.className = 'ysc-toast-text';
    toast.appendChild(label);

    const count = document.createElement('span');
    count.className = 'ysc-toast-count';
    toast.appendChild(count);

    const button = document.createElement('button');
    button.className = 'ysc-toast-btn';
    button.type = 'button';
    button.addEventListener('click', () => {
      if (typeof toast.onToastAction === 'function') toast.onToastAction();
    });
    toast.appendChild(button);

    // The player reads clicks as play/pause and keys as seek shortcuts.
    ['click', 'dblclick', 'pointerdown', 'mousedown', 'keydown'].forEach((type) => {
      toast.addEventListener(type, (e) => e.stopPropagation());
    });

    player.appendChild(toast);
    return toast;
  }

  function showCountdown(segment, seconds) {
    const toast = ensureToast('countdown');
    if (!toast) return;

    clearTimeout(toastHideTimer);
    toastHideTimer = null;
    toast.classList.remove('ysc-toast-out');

    const count = toast.querySelector('.ysc-toast-count');
    if (count.textContent !== String(seconds)) {
      count.textContent = seconds;
      count.classList.remove('ysc-count-tick');
      void count.offsetWidth; // reflow, so the pulse restarts on every number
      count.classList.add('ysc-count-tick');
    }
    count.hidden = false;
    count.style.color = segment.color; // matches this segment's scrubber marker

    // Name the action, not just the object - "Sponsor in 3" never said that a
    // skip was coming, which left the number anchored to nothing. What is being
    // skipped is carried by the green marker under the scrubber and by the
    // "Sponsor skipped" notice that follows.
    toast.querySelector('.ysc-toast-text').textContent = 'Skipping in';

    const button = toast.querySelector('.ysc-toast-btn');
    button.textContent = 'Keep';
    button.title = 'Play this sponsor segment instead of skipping it';
    button.setAttribute('aria-label', 'Keep this sponsor segment, do not skip');
    toast.onToastAction = () => keepSegment(segment);

    countdownKey = segment.key;
  }

  function showSkipToast(segment) {
    const toast = ensureToast('skipped');
    if (!toast) return;

    toast.classList.remove('ysc-toast-out');
    toast.querySelector('.ysc-toast-text').textContent = `${segment.label} skipped`;
    toast.querySelector('.ysc-toast-count').hidden = true;

    const button = toast.querySelector('.ysc-toast-btn');
    button.textContent = 'Undo';
    button.title = 'Jump back and play this sponsor segment';
    button.setAttribute('aria-label', 'Undo the skip and play this sponsor segment');
    toast.onToastAction = () => unskipSegment(segment);

    countdownKey = null;
    clearTimeout(toastHideTimer);
    toastHideTimer = setTimeout(hideSkipToast, TOAST_TIMEOUT_MS);
  }

  function hideCountdown() {
    countdownKey = null;
    const toast = document.getElementById(TOAST_ID);
    if (toast && toast.dataset.mode === 'countdown') toast.remove();
  }

  /** Viewer wants this ad read - blacklist it before the skip loop arrives. */
  function keepSegment(segment) {
    unskippedKeys.add(segment.key);
    hideCountdown();
  }

  function hideSkipToast() {
    const toast = document.getElementById(TOAST_ID);
    if (!toast) return;
    toast.classList.add('ysc-toast-out');
    setTimeout(() => {
      // Re-query: a second skip may have replaced this toast mid-fade.
      const current = document.getElementById(TOAST_ID);
      if (current && current.classList.contains('ysc-toast-out')) current.remove();
    }, 200);
  }

  function removeSkipToast() {
    clearTimeout(toastHideTimer);
    toastHideTimer = null;
    countdownKey = null;
    const toast = document.getElementById(TOAST_ID);
    if (toast) toast.remove();
  }

  /**
   * Put the viewer back at the top of the segment and blacklist it for the rest
   * of this video. The blacklist entry must land BEFORE the seek, or the next
   * timeupdate (<=250ms away) would immediately undo them.
   */
  function unskipSegment(segment) {
    unskippedKeys.add(segment.key);
    removeSkipToast();
    // It was not really skipped after all - take it back out of the tally.
    recordSkip(-(segment.end - segment.start), -1, {
      categoryId: segment.category,
      channel: getChannelInfo()
    });

    const video = getVideo();
    if (video) video.currentTime = segment.start;
  }

  // ─── Sponsor Skip: Lifecycle ─────────────────────────────────────

  /**
   * The video id currently being watched. location is authoritative;
   * ytd-watch-flexy is only a fallback because during navigation it can still
   * hold the previous video's id.
   */
  function getCurrentVideoId() {
    const path = window.location.pathname;

    const pathMatch = path.match(/^\/(?:shorts|embed|live)\/([\w-]{6,})/);
    if (pathMatch) return pathMatch[1];

    if (path !== '/watch') return null;

    const id = new URLSearchParams(window.location.search).get('v');
    if (id) return id;

    const flexy = document.querySelector('ytd-watch-flexy[video-id]');
    return (flexy && flexy.getAttribute('video-id')) || null;
  }

  function resetSponsorState() {
    activeVideoId = null;
    activeRawSegments = [];
    activeSegments = [];
    unskippedKeys.clear();
    removeSkipToast();
    removeSegmentMarkers();
  }

  /**
   * Re-derive activeSegments from the cached payload. Re-run once the media
   * element reports a duration, which normalizeSegments() needs but which is
   * usually still NaN when the fetch resolves.
   */
  function refreshActiveSegments() {
    const video = getVideo();
    activeSegments = normalizeSegments(activeRawSegments, video ? video.duration : NaN);
    renderSegmentMarkers();
  }

  /**
   * "The page may be showing a different video now." Cheap and idempotent, so
   * every navigation signal can call it freely.
   */
  function syncSponsorSegments() {
    if (!skipSponsorsEnabled || !isOnVideoPage()) {
      if (activeVideoId !== null) resetSponsorState();
      return;
    }

    const videoId = getCurrentVideoId();
    if (!videoId || videoId === activeVideoId) return;

    resetSponsorState();
    activeVideoId = videoId;

    fetchSegments(videoId).then((segments) => {
      if (activeVideoId !== videoId) return; // viewer moved on mid-flight
      activeRawSegments = segments;
      refreshActiveSegments();
    });
  }

  /**
   * yt-navigate-finish can fire before location.search reflects the new video,
   * so re-check for a beat. syncSponsorSegments() no-ops once it has caught up.
   */
  function scheduleSponsorSync() {
    [0, 100, 300, 600, 1200].forEach((delay) => setTimeout(syncSponsorSegments, delay));
  }

  // ─── Initial injection on script load ────────────────────────────
  // May need to wait for the actions element to appear
  function tryInjectWithRetry(attempts = 0) {
    if (document.getElementById(CONTROLLER_ID) || !speedSelectorEnabled) return;
    if (isOnVideoPage() && findInsertionTarget()) {
      injectController();
    } else if (attempts < 20) {
      setTimeout(() => tryInjectWithRetry(attempts + 1), 500);
    }
  }

  tryInjectWithRetry();
  syncSponsorSegments();
})();
