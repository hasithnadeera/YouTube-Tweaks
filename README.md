# YouTube Tweaks 🚀

A lightweight Chrome extension (Manifest V3) with playback speed controls,
SponsorBlock skips, UI cleanups, and local watch analytics.

## Features

- Preset speeds (`1×`–`3×`) with SPA-aware injection, plus `[` / `]` to step and `\` to toggle
- Automatic sponsor skipping (SponsorBlock)
- Hide Shorts / hide actions / center player
- **Studio Analytics shortcut** — replaces the masthead Create button
- **Local analytics** — watch time, skips, per-video history and an estimated
  data-usage figure, stored in `chrome.storage.local`
- **Export / import** — CSV for spreadsheets, JSON for a full backup and restore
- **Retention** — keep 30 / 90 / 180 days or forever; old day buckets are pruned
  on write so the store stays inside the extension storage quota

### Data usage estimate

Watch seconds are bucketed by the resolution actually being decoded, then costed
against a per-rung bitrate table (144p ≈ 40 MB/h up to 2160p ≈ 5 GB/h). It is an
estimate, not a measurement — expect roughly ±20%, and more drift on audio-only or
heavily buffered playback. Days recorded before v2.3.0 have no resolution data and
show `—` rather than a made-up number.

## Install the extension

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select this repository folder
5. Navigate to any YouTube video.

## File Structure

```
├── manifest.json      # Extension manifest (MV3)
├── background.js      # Local reset and analytics-page handlers
├── content.js         # YouTube page tweaks and analytics collection
├── analytics.*        # Full analytics dashboard
├── popup.*            # Overview and settings
├── styles.css         # YouTube page styling
└── icons/
```

## Privacy note

Watch and skip analytics stay on this browser profile only. They are not uploaded
anywhere — export is a manual, local file download. The only network request the
extension makes is to SponsorBlock's privacy endpoint, which receives the first four
hex characters of the video id's SHA-256 hash, never the video id itself.
