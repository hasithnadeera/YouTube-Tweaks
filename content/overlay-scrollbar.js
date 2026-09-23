// Draws a draggable scrollbar thumb that floats over the page instead of
// taking layout width. The native page scrollbar is hidden in CSS.
(function startOverlayScrollbar() {
  'use strict';
  if (window.top !== window || document.getElementById('tubetune-overlay-thumb')) return;

  const MIN_THUMB = 32;
  const thumb = document.createElement('div');
  thumb.id = 'tubetune-overlay-thumb';
  thumb.hidden = true;
  let frame = 0;

  function scroller() {
    return document.scrollingElement || document.documentElement;
  }

  function update() {
    frame = 0;
    const el = scroller();
    const viewport = window.innerHeight;
    const total = el.scrollHeight;
    if (total <= viewport + 1) {
      thumb.hidden = true;
      return;
    }
    const height = Math.max(MIN_THUMB, (viewport / total) * viewport);
    const maxTop = viewport - height;
    const top = (el.scrollTop / (total - viewport)) * maxTop;
    thumb.hidden = false;
    thumb.style.height = `${height}px`;
    thumb.style.transform = `translateY(${top}px)`;
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(update);
  }

  thumb.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    const el = scroller();
    const startY = event.clientY;
    const startScroll = el.scrollTop;
    const viewport = window.innerHeight;
    const ratio = (el.scrollHeight - viewport) / (viewport - thumb.offsetHeight);
    thumb.setPointerCapture(event.pointerId);
    thumb.classList.add('tt-dragging');

    function move(e) {
      el.scrollTop = startScroll + (e.clientY - startY) * ratio;
    }
    function end() {
      thumb.classList.remove('tt-dragging');
      thumb.removeEventListener('pointermove', move);
      thumb.removeEventListener('pointerup', end);
      thumb.removeEventListener('pointercancel', end);
    }
    thumb.addEventListener('pointermove', move);
    thumb.addEventListener('pointerup', end);
    thumb.addEventListener('pointercancel', end);
  });

  function mount() {
    (document.body || document.documentElement).appendChild(thumb);
    update();
    new ResizeObserver(schedule).observe(document.documentElement);
    if (document.body) new ResizeObserver(schedule).observe(document.body);
  }

  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule, { passive: true });
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount, { once: true });
})();
