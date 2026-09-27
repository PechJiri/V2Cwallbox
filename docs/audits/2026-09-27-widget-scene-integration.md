# Supplied scene widget integration — 27 September 2026

The approved design handoff 1.1 (`V2C-Trydan-Homey-design-handoff-PR3.zip`) is integrated above PR #3 head `caebc609d787f0e66dcdc6045c3e19ab93e693fe`, on `codex/widget-scene-integration`. PR #3 contains the 2.0.5 functional repairs; this integration preserves those repairs. It is prepared as a dependent draft PR, with no automatic merge or deployment.

## What changes

The former inline widget is replaced with the supplied scene renderer, core and controller, using the four final local WebP assets and final light/dark picker PNGs. Height stays 180 CSS pixels. Homey owns the outside frame. The SVG cable geometry, light/dark layout, metrics and action slot are preserved. The small Homey / Wallbox / — indicator reports the power-control owner; it does not switch modes.

The bootstrap reads the existing autocomplete `device_id` setting as a string or object with an `id`. It sends fixed Pause/Resume intent directly, then obtains a forced status read. A command acknowledgement is not treated as proof of charging. Unknown metrics remain unknown, Resume at zero watts stays Ready, primary faults 4/5/6 override an older native charging enum, and inverter diagnostics do not create an Offline state. Retry feedback only refreshes status.

The only production deviation from the supplied runtime is a small core correction: fresh data resulting in an unknown state (invalid EV presence, unknown pause permission or inconsistent power) clears the owner to —. The original handoff could show Homey next to an unknown EV state. A regression was observed failing before the correction and passing afterwards; real API-to-core tests cover it too. A known primary fault with fresh data can still display a known owner, as specified.

English locale keys are merged into the existing namespace structure. The supplied renderer retains its Czech preview strings. No existing translations are replaced. Existing API routes, autocomplete listener and manifest semantics remain intact; the current CLI accepts the existing `label` field.

## Preserved functional code

The integration does not change `app.js`, `widgets/wallbox-status/api.js`, drivers, `lib/ChargerControl.js`, or Homey Compose device/Flow/Energy definitions. Pause/Resume still passes through `device.setChargingPaused()` and shared serialized control. Target validation, power ownership, phase/voltage handling, final energy sampling and DynamicPowerMode mapping remain those of PR #3.

Reviewed SDK sources: [Homey widgets](https://apps.developer.homey.app/the-basics/widgets), [widget settings](https://apps.developer.homey.app/the-basics/widgets/settings), and [Homey Energy](https://apps.developer.homey.app/the-basics/devices/energy), accessed 27 September 2026. The integration uses the documented public asset location, global Homey API and `Homey.ready()` without a second height. Power-owner display is consistent with the Energy distinction between Homey and device power management.

## Verification

Two GPT-6 LUNA agents at MAX worked on disjoint production/test files. An independent LUNA MAX review follows the combined change. Tests use repository code and mocks; no electrical faults are induced.

- Pristine supplied bundle: `node --test tests/core.test.cjs tests/controller.test.cjs tests/pr3-contract.test.cjs` — 60/60 passed.
- Imported supplied tests plus real widget API integration: 66/66 passed, retaining all 60 supplied tests.
- Existing widget API tests: 10/10 passed.
- Full repository suite: `node --test` — 210/210 passed (208 top-level tests and two nested tests), zero failures/skips. This includes the imported 60 tests; results are not added twice.
- Production modules and scene test files: eight `node --check` checks passed. `git diff --check` passed.
- Independent review: pending the combined immutable change package.
- `HOMEY_SKIP_STARTUP_NOTIFIERS=1 homey app build` — exit 0.
- `HOMEY_SKIP_STARTUP_NOTIFIERS=1 homey app validate --level publish` — exit 0; validation only.
- Node v22.21.0, Windows x64 runtime, Homey CLI 4.2.0. The repository has no configured lint command or linter; syntax checks and diff whitespace checks are used without claiming a lint run.

Browser QA uses installed Node Playwright with Chromium 151.0.7922.34. A local HTTP server hosts the actual repository public files and relative images; it has no connection to Homey or the wallbox. All 480 combinations passed: six widths (280, 320, 334, 360, 420, 560), ten normal/technical states, two themes, two languages and two owners. Checks cover 180px height, clipping/overlap, 44px action height, unknown owner, local assets, reduced motion and missing-image fallback.

The actual hosted bootstrap passed string/object device selection, invalid selection without a request, idempotent initialization, direct POST then forced GET, zero-watt Resume, target rejection, GET/POST failure recovery, feedback retry without repeated POST, delayed polling, doubleclick, faults and nullable telemetry. All four local WebPs loaded, with no external requests or JavaScript/console errors. The supplied animated HTML was also opened at 390px and exercised for owner/state changes, cable motion and simulated Pause.

Source SHA-256 matches the handoff for index, CSS, view, controller, all four WebPs and both picker PNGs. Actual light/dark screenshots were compared with the supplied charging and fault references: composition, image art, cable, owner, values/units and state/action placement match. Windows text rendering differs from the packaged reference environment; pixel-identical screenshots are not claimed.

Local evidence is under `C:/Users/jirip/.codex/visualizations/2026/09/27/01a0e14e-813f-76c0-9198-f379ad37460a/widget-scene-qa/`: `browser-results.json`, `verify-scene.cjs`, `check-preview.cjs`, eight light/dark charging/paused/stale/fault PNGs and the supplied-preview mobile PNG. These QA fixtures and screenshots are outside production public assets.

## Remaining real Homey verification

No installation, physical Start/Stop test, Store publication or PR merge was performed. After a separate deployment instruction, verify the new widget in the actual Homey dashboard: saved wallbox selection, theme/layout, owner display, connected/charging/paused cycle, measured values and zero-target feedback. Homey WebView/CSP and the actual persisted setting shape are not proved by Chromium mocks. Simulate faults only in fixtures.
