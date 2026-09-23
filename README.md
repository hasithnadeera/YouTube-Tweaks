# TubeTune

A YouTube-only browser extension (Manifest V3).

## Features

- Playback speed selector with `[` / `]` shortcuts, remembered between videos.
- Centered player: hides suggestions and centers the video.
- Hide Shorts shelves and navigation entries.
- Hide Like/Share actions while keeping Save.
- SponsorBlock segment skipping with progress-bar markers.
- Local watch analytics (watch time, time saved, channels, top videos) with CSV/JSON export and import.

## Install

1. Open `chrome://extensions` (or `brave://extensions`) and enable Developer mode.
2. Choose **Load unpacked** and select this folder.

## Permissions and privacy

`storage` keeps settings and local analytics. Content scripts run only on `www.youtube.com`. SponsorBlock lookups send only a video-ID hash prefix; analytics never leave the browser.

## Development

- `npm run icons` regenerates the 16/32/48/128px PNG icons.
- `npm run check` validates the manifest, JavaScript syntax, page resources and icons.
