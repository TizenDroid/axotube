# axotube Runtime, Security, and Regression Hardening Design

## Goal
Fix every verified defect from the 2026-09-07 audit without removing or weakening existing user-facing features.

## Hard constraints
- Preserve AdBlock, SponsorBlock, DeArrow, HQ thumbnails, PiP, player controls, casting, phone control, themes, queueing, settings, and updater behaviour.
- Preserve existing defaults unless a defect requires a narrow correction.
- Prefer minimal, test-backed fixes over broad rewrites of YouTube TV internals.
- Keep compatibility with the existing Tizen/Cobalt target and build pipeline.
- Security hardening must preserve required loopback calls and DIAL/casting.
- Packaging must not silently reuse stale bundles.

## Runtime lifecycle
Add narrowly scoped readiness checks for capabilities that can appear after `_yttv` itself: callable `resolveCommand`, feature maps, player service mappings, and replaceable player/video DOM nodes. Fix one-shot initialization in user-agent spoofing, casting, PiP, preferred quality, speed control, auto-frame-rate, SponsorBlock, queueing, and feature toggles.

## Command/state correctness
- Decouple web-config sync, phone command polling, and now-playing publishing.
- Use queued command ids + acknowledgement rather than one overwriteable mailbox.
- Dispatch a command at most once even if the resolver returns `undefined`.
- Wait for an actual resolver rather than a merely non-empty `_yttv` object.
- Track queue position so duplicate video ids remain valid queue entries.

## Config integrity
Validate known keys against the existing defaults. Reject wrong-type writes. Normalize `launchToOnStartup` to one representation. Never clear all localStorage to recover from quota/corruption. Live config listeners must clean up timers and apply state safely.

## LAN/web-config security
Keep the service reachable from phones but require a persisted pairing token for LAN API access. Loopback TV requests remain automatic. DIAL stays reachable. Render web-config values safely rather than concatenating untrusted values into HTML.

## Standalone proxy security
Restrict `/cors-bypass/` to explicit Google/YouTube hosts already required by axotube. Reject arbitrary/private targets, credentials in URLs, non-http(s) schemes, and deceptive suffixes. Do not forward cookies/authorization to generic bypass targets. Apply YouTube-specific response rewriting only to trusted YouTube/Google targets.

## Feature-specific fixes
- UA spoofing: one apply/reload cycle, no infinite reload.
- Global JSON wrappers: fail open on unexpected response shapes.
- Reduced Motion: live toggle uses module-scope helper.
- AFR: reset when leaving playback and use current video node.
- SponsorBlock: initialize current video, handle seek-into-segment and pause/resume, react to live config.
- Custom player/PiP/quality/speed: retry actual capability/player discovery and reattach after replacement.
- HQ thumbnails/DeArrow: fan out concurrent probes and bound caches; accept DeArrow timestamp 0.
- Long Press/previews/hide-watched: respect feature toggle, avoid duplicate menu entries, target only watchable videos, parse browse ids robustly.
- Who's Watching/dimming: stop stale timers and intervals when disabled.
- Theme presets: one canonical mapping matching settings.
- Updater: semantic version comparison and missing-asset handling.

## Build/release
Restore committed regression tests and GitHub Actions. `npm test` must run committed tests. `build:standalone` and WGT packaging rebuild current source before packaging. Root/standalone metadata versions must match.

## Verification
Regression suite covers each deterministic bug. CI runs tests plus builds. Feature-preservation tests explicitly assert AdBlock remains enabled and still strips known ad response shapes; SponsorBlock/DeArrow/HQ functionality remains active under existing defaults.
