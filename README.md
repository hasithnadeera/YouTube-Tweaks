# YouTube Tweaks 🚀

A lightweight Chrome extension (Manifest V3) that injects a sleek speed controller directly into the YouTube player UI — positioned **above the Like/Dislike buttons**, and provides several productivity-focused "tweaks".

## Features

- **Preset speeds**: `1×`, `1.25×`, `1.5×`, `2×`, `3×`
- **Active speed highlight** — the current speed glows YouTube-red
- **Persists across videos** — your chosen speed is remembered via `localStorage`
- **SPA-aware** — works with YouTube's client-side navigation (no page reloads needed)
- **Dark & Light mode** compatible

## Installation

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select this folder: `yt-speed-controller/`
5. Navigate to any YouTube video — the speed bar appears above Like/Dislike!

## File Structure

```
yt-speed-controller/
├── manifest.json   # Extension manifest (MV3)
├── content.js      # Injects UI + controls playback rate
├── styles.css      # Speed bar styling
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```
