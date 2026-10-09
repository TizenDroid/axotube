# AxoTube runtime architecture

AxoTube enhances the YouTube TV application inside TizenBrew. The browser
bundle must remain compatible with older Tizen / Cobalt runtimes (Chromium 47).
The Node service provides pairing, phone configuration, remote commands and
DIAL; the standalone application packages these alongside the browser bundle.

## Native YouTube commands

`mods/shared/nativeCommand.js` owns discovery and caching of the native
`window._yttv` command resolver. Casting, phone control, playback UI, and
picture-in-picture dispatch through this module. The resolver can appear late
or be replaced after navigation.

- Dispatch a command **once** when a callable resolver is present.
- A resolver returning `undefined` can mean success; never retry based on its
  return value.
- The readiness helper distinguishes an unavailable resolver from a command
  actually invoked. The phone command queue ACKs only after invocation.
- `mods/resolveCommand.js` supplies AxoTube's custom-command patch. This
  patch must remain idempotent when the native resolver is rediscovered.
- The separate native action-router discovery in
  `mods/ui/customCommandExecution.js` serves a different purpose.

## YouTube response transformations

`mods/shared/responsePipeline.js` installs the single `JSON.parse`
interception. `mods/features/adblock.js` supplies the ordered response
transformations, including `mods/ui/customGuideAction.js`'s guide filtering
policy. Individual feature transformations remain behind that single hook.

The original parser must retain its native argument forwarding, reviver,
receiver, thrown syntax errors, and primitive results. Filters only operate on
parsed response objects, and a failed filter must not stop later filters.
YouTube sometimes retains `JSON.parse` through `_yttv` module references;
those references must use the same interception.

`JSON.stringify` is also intercepted to add a playback-context flag only
during serialization; caller-owned objects must be restored afterwards.

## Player and media lifecycle

`mods/shared/playerLifecycle.js` tracks the current HTML5 player, video
element, and video identity using one shared low-frequency discovery loop and
navigation notifications. Playback speed, preferred quality, SponsorBlock and
auto frame rate subscribe to the identities they need.

Subscribers still own their own feature policy: quality negotiation, segment
skips, speed selection and Tizen frame-rate changes. A replacement player
must release listeners from its predecessor. Auto frame rate must never
resume a different, viewer-paused or newly navigated video after a delayed
frame-rate switch.

## TV and phone configuration

`config-schema.json` is the common definition of defaults, allowed values
and numeric ranges. `shared/configPolicy.js` validates settings for both
bundled browser and Node runtimes; their separate storage adapters share
these rules. Browser-side storage is in `mods/config.js`; the
on-device Node store and revision checks live in `service/service.js`.
The TV/phone synchronization client is `mods/features/webConfig.js`.

The Node store treats config revisions as compare-and-swap tokens:

- An accepted changed config advances the revision and is persisted before
  success is returned; an identical snapshot does not advance it.
- A stale revision is rejected with HTTP 409, rather than acknowledging a
  discarded overwrite.
- The TV preserves locally edited keys when it reloads a newer server
  revision, then attempts a new write with that revision.
- A phone page using the revision-aware request reloads settings on conflict.
  The plain-object `/api/config` request is retained for older clients.
- Pairing, loopback requests and DIAL are independent of these revision rules.

## Verification

`npm test` runs committed regression tests and browser/Node runtime fixtures.
Use `npm run build` to verify both browser and Node bundles, then
`npm run build:standalone` to produce the fresh standalone artifacts.
String-level regressions supplement, but do not replace, tests against
native command mocks, realistic YouTube responses, replaced video elements
and concurrent config writes.

Only a real Tizen TV can establish performance and compatibility with the
actual native `_yttv` runtime.
