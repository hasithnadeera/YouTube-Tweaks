/**
 * YouTube Tweaks - Content Script
 * Injects a speed control bar above the Like/Dislike buttons on YouTube video pages.
 * Persists the selected speed across videos via chrome.storage.sync.
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
  const SCHEMA_VERSION = 2;             // v2 keys videos by id and splits seconds by quality
  const WRITE_ERROR_KEY = 'analytics_write_error';
  const MAX_VIDEOS_PER_CHANNEL_DAY = 200;
  const RETENTION_DAYS_DEFAULT = 180;   // 0 means keep forever
  let retentionDays = RETENTION_DAYS_DEFAULT;

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
  let studioAnalyticsShortcutEnabled = true;
  let sponsorStateReady = false;

  const STUDIO_ANALYTICS_BTN_ID = 'ysc-studio-analytics-btn';
  const CREATE_HIDDEN_ATTR = 'data-ysc-hidden-create';
  let currentSpeed = (() => {
    try {
      const saved = parseFloat(localStorage.getItem(STORAGE_KEY));
      return Number.isFinite(saved) && saved > 0 ? saved : 1;
    } catch (_) {
      return 1;
    }
  })();
  let lastNonDefaultSpeed = currentSpeed !== 1 ? currentSpeed : 2;

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

    if (settings.retention_days !== undefined) {
      const days = Number(settings.retention_days);
      retentionDays = Number.isFinite(days) && days >= 0 ? days : RETENTION_DAYS_DEFAULT;
    }

    if (settings.playback_speed !== undefined) {
      const speed = Number(settings.playback_speed);
      if (Number.isFinite(speed) && speed > 0) {
        currentSpeed = speed;
        const video = getVideo();
        if (video && video.playbackRate !== speed) video.playbackRate = speed;
        const bar = document.getElementById(CONTROLLER_ID);
        if (bar) updateActiveButton(bar, speed);
      }
    }

    if (settings.studio_analytics_shortcut !== undefined) {
      studioAnalyticsShortcutEnabled = settings.studio_analytics_shortcut;
      setAnalyticsShortcutClass(studioAnalyticsShortcutEnabled);
      if (studioAnalyticsShortcutEnabled) {
        replaceCreateWithAnalytics();
      } else {
        restoreCreateButton();
      }
    }
  }

  // Load initial settings (defaults mirrored in popup.js)
  const SETTING_DEFAULTS = {
    hide_shorts: true,
    speed_selector: true,
    hide_actions: true,
    center_player: true,
    skip_sponsors: true,
    studio_analytics_shortcut: true,
    retention_days: RETENTION_DAYS_DEFAULT,
    playback_speed: 1
  };

  // Nothing touches the page until the real settings land: running the init tail
  // against the hardcoded defaults injected the speed bar, replaced Create and
  // fired a SponsorBlock request even for users who had turned those off.
  chrome.storage.sync.get(null, (stored) => {
    if (chrome.runtime.lastError) {
      startExtension();
      return;
    }
    const settings = { ...SETTING_DEFAULTS, ...(stored || {}) };
    // Migrate an existing install's page-local speed once. Future changes use
    // sync storage as the source of truth and no longer need page localStorage.
    if (!stored || stored.playback_speed === undefined) {
      settings.playback_speed = currentSpeed;
      chrome.storage.sync.set({ playback_speed: currentSpeed }, () => {
        void chrome.runtime.lastError;
      });
    }
    applyToggles(settings);
    startExtension();
  });

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
    return currentSpeed;
  }

  function saveSpeed(speed) {
    currentSpeed = speed;
    if (speed !== 1) lastNonDefaultSpeed = speed;
    try {
      localStorage.setItem(STORAGE_KEY, String(speed)); // legacy fallback for existing installs
      chrome.storage.sync.set({ playback_speed: speed }, () => {
        void chrome.runtime.lastError;
      });
    } catch (_) {
      // Extension context invalidated, or storage blocked.
    }
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
    target.dataset.yscTitleStyled = '1';

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

    // injectController writes flex layout onto YouTube's own #title element;
    // leaving it behind kept the title restyled after the feature was toggled off.
    const target = findInsertionTarget();
    if (target && target.dataset.yscTitleStyled) {
      ['display', 'justify-content', 'align-items', 'gap'].forEach((prop) => {
        target.style.removeProperty(prop);
      });
      delete target.dataset.yscTitleStyled;
    }
  }

  // ─── Speed keyboard shortcuts ────────────────────────────────────

  function isTypingTarget(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  function setSpeed(speed) {
    applySpeed(speed);
    const bar = document.getElementById(CONTROLLER_ID);
    if (bar) updateActiveButton(bar, speed);
  }

  function stepSpeed(direction) {
    // Land on the nearest preset first, so stepping works even when the current
    // speed came from YouTube's own menu.
    let index = SPEEDS.indexOf(getSavedSpeed());
    if (index === -1) {
      index = 0;
      SPEEDS.forEach((value, i) => {
        if (Math.abs(value - getSavedSpeed()) < Math.abs(SPEEDS[index] - getSavedSpeed())) index = i;
      });
    }
    const next = Math.min(SPEEDS.length - 1, Math.max(0, index + direction));
    setSpeed(SPEEDS[next]);
  }

  document.addEventListener('keydown', (e) => {
    if (!started || !speedSelectorEnabled || !isOnVideoPage()) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTypingTarget(e.target) || isTypingTarget(document.activeElement)) return;

    if (e.key === ']') stepSpeed(1);
    else if (e.key === '[') stepSpeed(-1);
    else if (e.key === '\\') setSpeed(getSavedSpeed() === 1 ? lastNonDefaultSpeed : 1);
    else return;

    e.preventDefault();
    e.stopPropagation();
  }, true);

  // ─── Insights shortcut (replaces Create) ─────────────────────────

  function setAnalyticsShortcutClass(on) {
    if (document.body) document.body.classList.toggle('ysc-studio-analytics-shortcut', on);
  }

  function findMastheadButtons() {
    return (
      document.querySelector('ytd-masthead #buttons') ||
      document.querySelector('#masthead #buttons') ||
      document.querySelector('ytd-masthead #end #buttons') ||
      document.querySelector('ytd-masthead #end')
    );
  }

  function isCreateLabel(text) {
    const t = String(text || '').trim().toLowerCase();
    return t === 'create' || t.startsWith('create ') || t.includes('create a video');
  }

  // YouTube's own hooks for the create entry point, in preference order. These
  // are locale-independent, unlike the aria-label text.
  const CREATE_ICON_SELECTOR = [
    'ytd-topbar-menu-button-renderer[has-icon] yt-icon[icon*="create" i]',
    'yt-icon[icon*="create" i]',
    'yt-icon[icon*="video_call" i]',
    '[href^="/upload"]',
    '[href*="studio.youtube.com"]'
  ].join(', ');

  function findCreateControl() {
    const root = findMastheadButtons() || document.querySelector('ytd-masthead');
    if (!root) return null;

    const labeled = root.querySelectorAll(
      'button[aria-label], a[aria-label], yt-button-shape button, .yt-spec-button-shape-next'
    );
    for (const el of labeled) {
      const aria = (el.getAttribute('aria-label') || '').trim();
      if (/^create$/i.test(aria) || /^create\b/i.test(aria)) {
        return (
          el.closest('ytd-button-renderer, yt-button-shape, ytd-button-shape, button-view-model') ||
          el
        );
      }
    }

    const buttons = findMastheadButtons();
    if (!buttons) return null;
    for (const child of buttons.children) {
      if (child.id === STUDIO_ANALYTICS_BTN_ID) continue;
      if (child.tagName === 'YTD-TOPBAR-MENU-BUTTON-RENDERER') continue;
      if (child.querySelector('ytd-notification-topbar-button-renderer')) continue;
      if (child.querySelector('#avatar-btn, #button.dropdown-trigger')) continue;

      const text = (child.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (isCreateLabel(text) || text === '+ create') return child;
      if (child.querySelector(CREATE_ICON_SELECTOR)) return child;
    }
    return null;
  }

  function openWatchAnalytics(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    try {
      chrome.runtime.sendMessage({ type: 'OPEN_ANALYTICS' }, () => {
        void chrome.runtime.lastError;
      });
    } catch (_) {
      // Extension context invalidated.
    }
  }

  function buildWatchAnalyticsButton() {
    const a = document.createElement('a');
    a.id = STUDIO_ANALYTICS_BTN_ID;
    a.dataset.yscStyle = 'v4';
    a.className = 'ysc-studio-analytics-btn';
    a.href = chrome.runtime.getURL('analytics.html');
    a.title = 'Watch analytics';
    a.setAttribute('aria-label', 'Watch analytics');
    a.setAttribute('role', 'link');

    a.innerHTML =
      '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">' +
      '<path fill="currentColor" d="M3 3v18h18V3H3zm16 16H5V5h14v14zM7 15h2v2H7v-2zm0-4h2v2H7v-2zm0-4h2v2H7V7zm4 8h6v2h-6v-2zm0-4h6v2h-6v-2zm0-4h6v2h-6V7z"/>' +
      '</svg>' +
      '<span class="ysc-studio-analytics-label">Analytics</span>';

    a.addEventListener('click', openWatchAnalytics);
    return a;
  }

  function replaceCreateWithAnalytics() {
    if (!studioAnalyticsShortcutEnabled || !document.body) return;
    setAnalyticsShortcutClass(true);

    const create = findCreateControl();
    if (create) {
      create.setAttribute(CREATE_HIDDEN_ATTR, '1');
      // Also mark a parent chip if Create text lives deeper.
      const parentChip = create.parentElement;
      if (parentChip && parentChip !== findMastheadButtons()) {
        const parentText = (parentChip.textContent || '').replace(/\s+/g, ' ').trim();
        if (isCreateLabel(parentText) || parentText === '+ Create') {
          parentChip.setAttribute(CREATE_HIDDEN_ATTR, '1');
        }
      }
    }

    const existing = document.getElementById(STUDIO_ANALYTICS_BTN_ID);
    if (existing) return;

    const root = findMastheadButtons();
    if (!root) return;

    const btn = buildWatchAnalyticsButton();
    if (create && create.parentNode) {
      create.parentNode.insertBefore(btn, create);
    } else {
      root.insertBefore(btn, root.firstChild);
    }
  }

  function restoreCreateButton() {
    if (document.body) document.body.classList.remove('ysc-studio-analytics-shortcut');
    document.querySelectorAll(`[${CREATE_HIDDEN_ATTR}]`).forEach((el) => {
      el.removeAttribute(CREATE_HIDDEN_ATTR);
    });
    const btn = document.getElementById(STUDIO_ANALYTICS_BTN_ID);
    if (btn) btn.remove();
  }

  function analyticsShortcutSettled() {
    const btn = document.getElementById(STUDIO_ANALYTICS_BTN_ID);
    if (!btn || btn.dataset.yscStyle !== 'v4') return false;
    if (btn.closest(`[${CREATE_HIDDEN_ATTR}]`)) return false;
    const host = findMastheadButtons();
    return !!(host && host.contains(btn) && document.querySelector(`[${CREATE_HIDDEN_ATTR}]`));
  }

  // Keep re-applying: YouTube rebuilds the masthead often. Short-circuit the
  // expensive scan once our button and hidden Create control are settled.
  setInterval(() => {
    if (!started || !studioAnalyticsShortcutEnabled || analyticsShortcutSettled()) return;
    replaceCreateWithAnalytics();
  }, 1500);

  // ─── MutationObserver: watch for DOM changes (SPA navigation) ────

  let observerDebounceTimer = null;

  const observer = new MutationObserver(() => {
    clearTimeout(observerDebounceTimer);
    observerDebounceTimer = setTimeout(() => {
      if (!started) return;
      syncSponsorSegments();
      // Re-attach markers: YouTube rebuilds the progress bar on navigation and
      // on fullscreen transitions, taking our overlay with it.
      if (activeSegments.length && !document.getElementById(MARKER_BAR_ID)) {
        renderSegmentMarkers();
      }
      if (centerPlayerEnabled && isOnVideoPage()) fixCenterLayout();
      if (started && studioAnalyticsShortcutEnabled && !analyticsShortcutSettled()) {
        replaceCreateWithAnalytics();
      }
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
    if (!started) return;
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
      if (started && studioAnalyticsShortcutEnabled) replaceCreateWithAnalytics();
    }, 800);
  });

  // ─── Speed restore when a new video element is created ───────────

  // YouTube sometimes swaps the <video> element; restore speed on play
  document.addEventListener(
    'play',
    (event) => {
      // Ads and feed hover-previews fire `play` too; only the main video's
      // rate is ours to set.
      const video = getVideo();
      if (!started || !video || event.target !== video || isAdPlaying()) return;
      const savedSpeed = getSavedSpeed();
      if (video.playbackRate !== savedSpeed) {
        video.playbackRate = savedSpeed;
      }
    },
    true // capture phase so we catch it before YouTube's own handlers
  );

  // ─── Sponsor Skip: State ─────────────────────────────────────────

  let activeVideoId = null;          // video id the active segments belong to
  let activeRawSegments = [];        // untouched SponsorBlock payload for that id
  let activeSegments = [];           // [{ start, end, key }], sorted, non-overlapping
  const unskippedKeys = new Set();   // segment keys the viewer restored via Undo
  const countedSegmentKeys = new Set(); // segment keys already added to the tally
  const countedSegmentMeta = new Map(); // key -> { dayKey, videoId }, survives re-normalisation
  const segmentCache = new Map();    // videoId -> raw segments (insertion-ordered)
  const pendingFetches = new Map();  // videoId -> in-flight Promise (dedupe)
  let toastHideTimer = null;
  let markerResizeObserver = null;   // keeps marker height matched to the track
  sponsorStateReady = true;

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

    // Seeking back into a segment re-fires the skip. Tally each one once per
    // video, or a viewer scrubbing over an ad read inflates the numbers.
    if (!countedSegmentKeys.has(segment.key)) {
      countedSegmentKeys.add(segment.key);
      const meta = {
        dayKey: todayKey(),
        videoId: getCurrentVideoId()
      };
      countedSegmentMeta.set(segment.key, meta);
      recordSkip(segment.end - segment.start, 1, {
        categoryId: segment.category,
        channel: getChannelInfo(),
        dayKey: meta.dayKey,
        videoId: meta.videoId
      });
    }

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

  function getCurrentVideoTitle() {
    const el =
      document.querySelector('ytd-watch-metadata h1 yt-formatted-string') ||
      document.querySelector('ytd-watch-metadata #title h1') ||
      document.querySelector('h1.ytd-watch-metadata');
    return el ? (el.textContent || '').trim() : '';
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
      days[key] = { watched: 0, skipped: 0, skipCount: 0, channels: {}, byQuality: {} };
    }
    const day = days[key];
    if (!day.channels) day.channels = {};
    if (!day.byQuality) day.byQuality = {};
    return day;
  }

  function ensureDayChannel(day, channelId, channel) {
    if (!day.channels[channelId]) {
      day.channels[channelId] = {
        name: (channel && channel.name) || channelId,
        avatar: (channel && channel.avatar) || '',
        watched: 0,
        skipped: 0,
        skipCount: 0,
        videos: {},
        byQuality: {}
      };
    }
    const entry = day.channels[channelId];
    if (!entry.videos) entry.videos = {};
    if (!entry.byQuality) entry.byQuality = {};
    if (channel && channel.name) entry.name = channel.name;
    if (channel && channel.avatar) entry.avatar = channel.avatar;
    return entry;
  }

  /**
   * Per-video row inside a channel's day bucket. Returns null once the day is
   * full, so one autoplay binge cannot grow a single day without bound.
   */
  function touchVideo(entry, videoId, title) {
    if (!videoId) return null;
    if (!entry.videos) entry.videos = {};
    let video = entry.videos[videoId];
    if (!video) {
      if (Object.keys(entry.videos).length >= MAX_VIDEOS_PER_CHANNEL_DAY) return null;
      video = { title: '', watched: 0, skipped: 0 };
      entry.videos[videoId] = video;
    }
    if (title) video.title = title;
    return video;
  }

  function addQuality(target, quality) {
    if (!quality || typeof quality !== 'object') return;
    if (!target.byQuality) target.byQuality = {};
    Object.entries(quality).forEach(([key, value]) => {
      if (value > 0 && Number.isFinite(value)) {
        target.byQuality[key] = (target.byQuality[key] || 0) + value;
      }
    });
  }

  // ─── Analytics storage layer ─────────────────────────────────────
  // Every tally here is a read-modify-write of one big blob, so they all go
  // through a single promise chain. Without it a skip landing inside a pending
  // watch flush reads the same snapshot and the later `set` silently wins.

  let writeQueue = Promise.resolve();
  let storageFailureNotified = false;

  function storageGet(defaults) {
    return new Promise((resolve, reject) => {
      try {
        chrome.storage.local.get(defaults, (data) => {
          const err = chrome.runtime.lastError;
          if (err) reject(new Error(err.message));
          else resolve(data);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  function storageSet(obj) {
    return new Promise((resolve, reject) => {
      try {
        chrome.storage.local.set(obj, () => {
          const err = chrome.runtime.lastError;
          if (err) reject(new Error(err.message));
          else resolve();
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  function clonePlain(value) {
    if (!value || typeof value !== 'object') return {};
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_) {
      return {};
    }
  }

  function cloneStats(raw) {
    const stats = clonePlain(raw);
    return {
      seconds: Number.isFinite(stats.seconds) ? stats.seconds : 0,
      count: Number.isFinite(stats.count) ? stats.count : 0,
      byCategory: stats.byCategory && typeof stats.byCategory === 'object' ? stats.byCategory : {},
      byChannel: stats.byChannel && typeof stats.byChannel === 'object' ? stats.byChannel : {}
    };
  }

  function cloneAnalytics(raw) {
    const analytics = clonePlain(raw);
    const days = analytics.days && typeof analytics.days === 'object' && !Array.isArray(analytics.days)
      ? analytics.days
      : {};
    migrateDays(days);
    return { days, schemaVersion: SCHEMA_VERSION };
  }

  /** v1 kept a bare `videoIds` array; v2 keys videos by id so a title can hang off one. */
  function migrateDays(days) {
    Object.values(days).forEach((day) => {
      if (!day || typeof day !== 'object' || Array.isArray(day)) return;
      if (!day.channels || typeof day.channels !== 'object') day.channels = {};
      if (!day.byQuality || typeof day.byQuality !== 'object') day.byQuality = {};
      Object.values(day.channels).forEach((ch) => {
        if (!ch || typeof ch !== 'object' || Array.isArray(ch)) return;
        if (!ch.videos || typeof ch.videos !== 'object' || Array.isArray(ch.videos)) ch.videos = {};
        if (Array.isArray(ch.videoIds)) {
          ch.videoIds.forEach((id) => {
            if (id && !ch.videos[id]) ch.videos[id] = { title: '', watched: 0, skipped: 0 };
          });
          delete ch.videoIds;
        }
        if (!ch.byQuality || typeof ch.byQuality !== 'object') ch.byQuality = {};
      });
    });
  }

  /** Drop day buckets outside the retention window. ISO keys sort lexicographically. */
  function pruneDays(days, keepDays) {
    if (!keepDays || keepDays <= 0) return; // 0 means "keep forever"
    const cutoff = todayKey(new Date(Date.now() - (keepDays - 1) * 86400000));
    Object.keys(days).forEach((key) => {
      if (key < cutoff) delete days[key];
    });
  }

  /**
   * Serialised read-modify-write. `fn` mutates `{ stats, analytics }` in place on
   * a private copy; whatever it leaves behind is written back as one `set`.
   * Rejects on a failed write so the caller can roll its own numbers back - a
   * full quota used to fail silently and just stop recording.
   */
  function mutateAnalytics(fn) {
    const run = writeQueue.then(async () => {
      const data = await storageGet({
        [STATS_KEY]: EMPTY_STATS,
        [ANALYTICS_KEY]: EMPTY_ANALYTICS
      });
      const state = {
        stats: cloneStats(data[STATS_KEY]),
        analytics: cloneAnalytics(data[ANALYTICS_KEY])
      };
      fn(state);
      pruneDays(state.analytics.days, retentionDays);
      await storageSet({
        [STATS_KEY]: state.stats,
        [ANALYTICS_KEY]: state.analytics
      });
    });
    // The chain has to survive a failed link, or one quota error wedges every
    // later write behind a permanently rejected promise.
    writeQueue = run.catch(() => {});
    return run;
  }

  function reportStorageFailure(err) {
    const message = (err && err.message) || String(err);
    if (/context invalidated|Receiving end/i.test(message)) return; // extension reloaded
    console.warn('[YouTube Tweaks] analytics write failed:', message);
    if (storageFailureNotified) return;
    storageFailureNotified = true;
    storageSet({ [WRITE_ERROR_KEY]: { message, at: Date.now() } }).catch(() => {});
  }

  /**
   * Running total of what has been skipped. Lives in storage.local, not sync -
   * sync has a modest per-hour write quota and this ticks on every segment.
   * Also bumps the analytics day-bucket for range reports. `meta.dayKey` is the
   * day the skip actually happened on, so an Undo after midnight still credits
   * the right bucket.
   */
  function recordSkip(seconds, count, meta) {
    const dayKey = (meta && meta.dayKey) || todayKey();
    const videoId = (meta && meta.videoId) || getCurrentVideoId();
    const videoTitle = (meta && meta.videoTitle) || getCurrentVideoTitle();

    mutateAnalytics(({ stats, analytics }) => {
      if (meta && meta.categoryId) {
        bumpBucket(stats.byCategory, meta.categoryId, seconds, count);
      }
      if (meta && meta.channel && meta.channel.id) {
        const prev = stats.byChannel[meta.channel.id];
        const extra = { name: meta.channel.name || (prev && prev.name) || meta.channel.id };
        const avatar = meta.channel.avatar || (prev && prev.avatar);
        if (avatar) extra.avatar = avatar;
        bumpBucket(stats.byChannel, meta.channel.id, seconds, count, extra);
      }

      stats.seconds = Math.max(0, stats.seconds + seconds);
      stats.count = Math.max(0, stats.count + count);

      const day = ensureDay(analytics.days, dayKey);
      day.skipped = Math.max(0, (day.skipped || 0) + seconds);
      day.skipCount = Math.max(0, (day.skipCount || 0) + count);

      if (meta && meta.channel && meta.channel.id) {
        const ch = ensureDayChannel(day, meta.channel.id, meta.channel);
        ch.skipped = Math.max(0, (ch.skipped || 0) + seconds);
        ch.skipCount = Math.max(0, (ch.skipCount || 0) + count);
        const video = touchVideo(ch, videoId, videoTitle);
        if (video) video.skipped = Math.max(0, (video.skipped || 0) + seconds);
      }
    }).catch(reportStorageFailure);
  }

  // ─── Watch-time tracker ──────────────────────────────────────────
  // Accrues wall-clock seconds while the main video is playing, the tab is
  // visible, and YouTube is not showing an ad. Batched every WATCH_TICK_MS.
  // Seconds are also split by resolution so the data-usage estimate can be
  // re-derived later from a corrected bitrate table.

  let watchLastTs = 0;
  let watchPendingSeconds = 0;
  let watchPendingQuality = {};
  let watchPendingDayKey = null;
  const watchRetryBatches = [];
  let watchFlushTimer = null;

  const QUALITY_STEPS = [144, 240, 360, 480, 720, 1080, 1440, 2160];
  const PLAYER_QUALITY_HEIGHTS = {
    tiny: 144, small: 240, medium: 360, large: 480,
    hd720: 720, hd1080: 1080, hd1440: 1440, hd2160: 2160, highres: 2160
  };

  /**
   * The rung of the quality ladder currently being decoded. `videoHeight` is the
   * honest number - it follows YouTube's own mid-playback switches, which
   * getPlaybackQuality() reports late - so it is tried first.
   */
  function currentQualityKey() {
    const video = getVideo();
    let height = (video && video.videoHeight) || 0;
    if (!height) {
      const player = document.getElementById('movie_player');
      const label = player && typeof player.getPlaybackQuality === 'function'
        ? player.getPlaybackQuality()
        : '';
      height = PLAYER_QUALITY_HEIGHTS[label] || 0;
    }
    if (!height) return null;

    // Snap to the nearest rung: non-16:9 uploads report odd heights and the
    // bitrate table is keyed by rung.
    let closest = QUALITY_STEPS[0];
    for (const step of QUALITY_STEPS) {
      if (Math.abs(step - height) < Math.abs(closest - height)) closest = step;
    }
    return String(closest);
  }

  function shouldAccrueWatch() {
    if (document.visibilityState !== 'visible') return false;
    if (!isOnVideoPage() || isAdPlaying()) return false;
    const video = getVideo();
    return !!(video && !video.paused && !video.ended);
  }

  function flushWatchTime() {
    const batches = watchRetryBatches.splice(0);
    const seconds = watchPendingSeconds;
    const quality = watchPendingQuality;
    const dayKey = watchPendingDayKey || todayKey();
    const channel = getChannelInfo();
    const videoId = getCurrentVideoId();
    const title = getCurrentVideoTitle();

    watchPendingSeconds = 0;
    watchPendingQuality = {};
    watchPendingDayKey = null;

    if (seconds >= 0.5) {
      batches.push({ seconds, quality, dayKey, channel, videoId, title });
    }
    if (!batches.length) return;

    mutateAnalytics(({ analytics }) => {
      batches.forEach((batch) => {
        const day = ensureDay(analytics.days, batch.dayKey);
        day.watched = (day.watched || 0) + batch.seconds;
        addQuality(day, batch.quality);

        if (batch.channel && batch.channel.id) {
          const ch = ensureDayChannel(day, batch.channel.id, batch.channel);
          ch.watched = (ch.watched || 0) + batch.seconds;
          addQuality(ch, batch.quality);
          const video = touchVideo(ch, batch.videoId, batch.title);
          if (video) video.watched = (video.watched || 0) + batch.seconds;
        }
      });
    }).catch((err) => {
      // Roll the seconds back into retry batches rather than losing them.
      watchRetryBatches.unshift(...batches);
      reportStorageFailure(err);
      scheduleWatchFlush();
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
    if (!started) return;
    const now = Date.now();
    const accruing = shouldAccrueWatch();

    if (watchLastTs && accruing) {
      const delta = (now - watchLastTs) / 1000;
      // Ignore huge gaps (sleep / background throttling).
      if (delta > 0 && delta < 30) {
        const key = todayKey();
        // Flush before crossing midnight so the seconds land on the day they
        // were actually watched.
        if (watchPendingDayKey && watchPendingDayKey !== key) flushWatchTime();
        if (!watchPendingDayKey) watchPendingDayKey = key;

        watchPendingSeconds += delta;
        const quality = currentQualityKey();
        if (quality) {
          watchPendingQuality[quality] = (watchPendingQuality[quality] || 0) + delta;
        }
        scheduleWatchFlush();
      }
    }

    watchLastTs = accruing ? now : 0;
  }

  setInterval(tickWatchTime, 1000);
  function flushOnHide() {
    tickWatchTime();
    flushWatchTime();
    watchLastTs = 0;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') flushOnHide();
  });

  // visibilitychange alone loses the final tick when the tab is closed or
  // discarded; pagehide/freeze are the signals that actually fire there.
  window.addEventListener('pagehide', flushOnHide);
  document.addEventListener('freeze', flushOnHide);

  // Sample directly on pause/end/speed change instead of waiting for the 1Hz
  // poll, which used to over-count the partial second before a pause.
  ['pause', 'ended', 'ratechange'].forEach((type) => {
    document.addEventListener(type, () => tickWatchTime(), true);
  });

  function handleTimeUpdate(event) {
    if (!started || !skipSponsorsEnabled || !activeSegments.length) return;
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

  // An ad's durationchange used to re-normalize the real segments against the
  // AD's duration, and DURATION_TOLERANCE then threw every one of them away.
  document.addEventListener('durationchange', (event) => {
    if (!started || !activeVideoId || isAdPlaying()) return;
    if (event.target !== getVideo()) return;
    refreshActiveSegments();
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
      progressBar.dataset.yscPositioned = '1';
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

    const progressBar = document.querySelector('#movie_player .ytp-progress-bar');
    if (progressBar && progressBar.dataset.yscPositioned) {
      progressBar.style.removeProperty('position');
      delete progressBar.dataset.yscPositioned;
    }
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

    clearTimeout(toastHideTimer);
    toastHideTimer = setTimeout(hideSkipToast, TOAST_TIMEOUT_MS);
  }

  function hideCountdown() {
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

    // It was not really skipped after all - take it back out of the tally, but
    // only if it went in, and only out of the day it went in on.
    if (countedSegmentKeys.delete(segment.key)) {
      const counted = countedSegmentMeta.get(segment.key) || {};
      countedSegmentMeta.delete(segment.key);
      recordSkip(-(segment.end - segment.start), -1, {
        categoryId: segment.category,
        channel: getChannelInfo(),
        dayKey: counted.dayKey || todayKey(),
        videoId: counted.videoId
      });
    }

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
    if (!sponsorStateReady) return;
    activeVideoId = null;
    activeRawSegments = [];
    activeSegments = [];
    unskippedKeys.clear();
    countedSegmentKeys.clear();
    countedSegmentMeta.clear();
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
    if (!sponsorStateReady || !started) return;
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
    if (!started) return;
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

  let started = false;

  function startExtension() {
    if (!sponsorStateReady) {
      setTimeout(startExtension, 0);
      return;
    }
    if (started) return;
    started = true;

    tryInjectWithRetry();
    syncSponsorSegments();
    if (studioAnalyticsShortcutEnabled) {
      replaceCreateWithAnalytics();
      [500, 1500, 3000].forEach((ms) => setTimeout(replaceCreateWithAnalytics, ms));
    }
  }

  // Storage can be unreachable (invalidated context); don't leave the page
  // untouched forever if the settings read never comes back.
  setTimeout(startExtension, 2000);
})();
