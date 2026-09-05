# FlowPlay 3.0

The combined successor to YouTube Tweaks and Brave Powerhouse. This YouTube-Tweaks repository is the final project. FlowPlay has one manifest, one toolbar button and one service worker, with a new teal play-and-scroll icon.

## Features

- YouTube playback speed controls, keyboard shortcuts, centered player, Hide Shorts and action cleanup.
- SponsorBlock skipping, local watch analytics, retention controls and analytics export/import.
- Website scrollbars with configurable dimensions/colors, idle auto-hide (850ms), and Minimal, Comfortable and High Contrast presets.
- Text selection, form accents, keyboard focus rings and motion controls.
- Optional click-through dimmer that hides in fullscreen, plus conservative Focus Mode with an Exit focus button.
- Global website preferences and exact-hostname overrides, applied live.

The popup links YouTube controls, website controls and the full website settings page. Website polish has its own master switch; YouTube features retain their individual switches.

## Upgrade or install

1. Open brave://extensions. If YouTube Tweaks is already loaded from this folder, reload its card. It becomes FlowPlay and keeps its existing extension identity, YouTube settings and local analytics. Do not remove and reinstall it to upgrade.
2. For a new installation, enable Developer mode, choose Load unpacked and select this YouTube-Tweaks folder.
3. If you customized Brave Powerhouse, reload that extension first, open its Advanced settings, and use Export website settings. Import the file in FlowPlay's All web settings → Transfer website settings.
4. Disable the separate Brave Powerhouse extension to avoid duplicate webpage styling.
5. Refresh existing webpages. Brave may ask you to accept the expanded website access.

Separate extension identities cannot automatically read each other's storage. Powerhouse preferences start at defaults until imported. The former brave-powerhouse directory is retained as a legacy migration backup; it is no longer the final project.

## Permissions and privacy

storage retains settings and local analytics. activeTab lets the website-controls popup identify the active hostname. The content script runs on top-level HTTP/HTTPS pages, so Brave shows an all-sites access warning. YouTube-specific code still runs only on www.youtube.com.

SponsorBlock and YouTube image hosts keep their original host permissions. SponsorBlock lookup uses a video hash prefix. Watch analytics remain local, and website polish makes no network requests. No remote executable code or third-party runtime dependencies are added.

Protected browser pages, browser chrome, DRM, iframe content and shadow-DOM styling are outside the extension's scope. Focus Mode leaves landmarks containing main content, dialogs, forms or media visible. Auto-hide makes the scrollbar transparent without changing the page width.

## Development

Run npm run icons to regenerate 16/32/48/128px PNGs, and npm run check to validate the manifest, JavaScript, page resources, icons and tests.

content.js and styles.css contain YouTube behavior; content/ and shared/ contain webpage polish. popup.* provides YouTube controls, web/ provides website controls, options/ provides full website settings, and analytics.* remains the watch dashboard.

## Manual browser verification

- Verify YouTube playback, speed keys, centered mode, SponsorBlock and analytics with the standalone Powerhouse disabled.
- Check scrollbar idle hiding and hover in centered mode and on a long non-YouTube page.
- Toggle website features and exact-hostname overrides; reload to confirm persistence.
- Verify fullscreen dimmer removal, Focus Mode media/form preservation, and Exit focus.
- Export Powerhouse preferences, import into FlowPlay, and confirm YouTube analytics remain intact.

Automated checks do not substitute for these live Brave checks.
