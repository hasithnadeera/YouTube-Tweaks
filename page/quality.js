// Runs in the page's own JavaScript world so it can use YouTube's player API,
// which content scripts cannot see. Picks the highest quality available
// whenever a video loads, unless the setting is turned off.
(function tubeTuneMaxQuality() {
  'use strict';

  function enabled() {
    return document.documentElement.dataset.ttMaxQuality !== 'false';
  }

  function applyBest() {
    if (!enabled()) return;
    const player = document.getElementById('movie_player');
    if (!player || typeof player.getAvailableQualityLevels !== 'function') return;
    const levels = player.getAvailableQualityLevels().filter((q) => q && q !== 'auto');
    if (!levels.length) return;
    const best = levels[0];
    if (player.getPlaybackQuality && player.getPlaybackQuality() === best) return;
    if (typeof player.setPlaybackQualityRange === 'function') player.setPlaybackQualityRange(best, best);
    if (typeof player.setPlaybackQuality === 'function') player.setPlaybackQuality(best);
  }

  // Quality levels appear a moment after the video starts loading.
  function applySoon() {
    [300, 1200, 3000].forEach((ms) => setTimeout(applyBest, ms));
  }

  document.addEventListener('yt-navigate-finish', applySoon);
  document.addEventListener('loadeddata', (e) => {
    if (e.target && e.target.tagName === 'VIDEO') applySoon();
  }, true);
  applySoon();
})();
