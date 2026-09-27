# Supplied scene widget integration — 27 September 2026

The approved design handoff 1.1 (`V2C-Trydan-Homey-design-handoff-PR3.zip`) is integrated above PR #3 head `caebc609d787f0e66dcdc6045c3e19ab93e693fe`, on `codex/widget-scene-integration`. PR #3 contains the 2.0.5 functional repairs; this integration preserves those repairs. It is prepared as a dependent draft PR, with no automatic merge or deployment.

## What changes

The former inline widget is replaced with the supplied scene renderer, core and controller, using the four final local WebP assets and final light/dark picker PNGs. Height stays 180 CSS pixels. Homey owns the outside frame. The SVG cable geometry, light/dark layout, metrics and action slot are preserved. The small Homey / Wallbox / — indicator reports the power-control owner; it does not switch modes.

The bootstrap reads the existing autocomplete `device_id` setting as a string or object with an `id`. It sends fixed Pause/Resume intent directly, then obtains a forced status read. A command acknowledgement is not treated as proof of charging. Unknown metrics remain unknown, Resume at zero watts stays Ready, primary faults 4/5/6 override an older native charging enum, and inverter diagnostics do not create an Offline state. Retry feedback only refreshes status.

One small core correction clears the owner to — when fresh data results in an unknown state (invalid EV presence, unknown pause permission or inconsistent power). The original handoff could show Homey next to an unknown EV state. A regression was observed failing before the correction and passing afterwards; real API-to-core tests cover it too. A known primary fault with fresh data can still display a known owner, as specified.

The user subsequently requested descriptive primary fault names instead of letter-only F/E/D labels. Visible English labels are System failure / leakage (4), CP error / ground fault (5), and Ventilation required (6). The fault pill wraps the full name when needed, with narrowly scoped spacing changes for faults. The normal-state scene and all control logic stay unchanged; the original technical description remains available in the tooltip.

English locale keys are merged into the existing namespace structure. At the user's explicit correction, the supplied Czech renderer dictionary and locale selection are removed. Czech translation keys are also removed from the widget manifest and six existing driver/capability Compose files; other languages stay intact. Homey's [supported language list](https://apps.developer.homey.app/the-basics/app/internationalization) does not include Czech (checked 27 September 2026). Existing API routes, autocomplete listener and manifest semantics remain intact; the current CLI accepts the existing `label` field.

## Preserved functional code

The integration does not change `app.js`, `widgets/wallbox-status/api.js`, driver/device JavaScript or `lib/ChargerControl.js`. Driver/capability Compose changes remove only Czech translation keys; their parsed objects remain equal after stripping those keys, including IDs, enums, settings, other translations and Energy/Flow configuration. `app.json` is regenerated through Homey CLI. Pause/Resume still passes through `device.setChargingPaused()` and shared serialized control. Target validation, power ownership, phase/voltage handling, final energy sampling and DynamicPowerMode mapping remain those of PR #3.

Reviewed SDK sources: [Homey widgets](https://apps.developer.homey.app/the-basics/widgets), [widget settings](https://apps.developer.homey.app/the-basics/widgets/settings), and [Homey Energy](https://apps.developer.homey.app/the-basics/devices/energy), accessed 27 September 2026. The integration uses the documented public asset location, global Homey API and `Homey.ready()` without a second height. Power-owner display is consistent with the Energy distinction between Homey and device power management.

## Verification

Two GPT-6 LUNA agents at MAX worked on disjoint production/test files. An independent LUNA MAX review follows the combined change. Tests use repository code and mocks; no electrical faults are induced.

- Pristine supplied bundle: `node --test tests/core.test.cjs tests/controller.test.cjs tests/pr3-contract.test.cjs` — 60/60 passed.
- Imported supplied tests plus real widget API integration: 66/66 passed, retaining all 60 supplied tests. The generic decimal-comma formatter case uses supported German instead of Czech, with the same assertion.
- Existing widget API tests: 10/10 passed.
- Full repository suite: `node --test` — 210/210 passed (208 top-level tests and two nested tests), zero failures/skips. This includes the imported 60 tests; results are not added twice.
- Production modules and scene test files: eight `node --check` checks passed. `git diff --check` passed.
- Independent review of `caebc609..7913118` and fault refinement `7913118..0d6cfa7`: no actionable findings; code/spec/visual checks approved. The later language cleanup receives a separate scoped review.
- `HOMEY_SKIP_STARTUP_NOTIFIERS=1 homey app build` — exit 0.
- `HOMEY_SKIP_STARTUP_NOTIFIERS=1 homey app validate --level publish` — exit 0; validation only.
- Node v22.21.0, Windows x64 runtime, Homey CLI 4.2.0. The repository has no configured lint command or linter; syntax checks and diff whitespace checks are used without claiming a lint run.

Browser QA uses installed Node Playwright with Chromium 151.0.7922.34. A local HTTP server hosts the actual repository public files and relative images; it has no connection to Homey or the wallbox. All 480 combinations passed: six widths (280, 320, 334, 360, 420, 560), ten normal/technical states, two themes, two languages and two owners. Checks cover 180px height, clipping/overlap, 44px action height, unknown owner, local assets, reduced motion and missing-image fallback.

After the fault-label refinement, the matrix and bootstrap checks were rerun. An additional 144 cases covered all three fault codes across those widths, themes, languages and owners. All 624 render cases passed; the full visible fault names had no ellipsis, clipping or overlap with metrics/action, and the height stayed 180px. These two-language counts describe the earlier handoff stage, before the user's request to remove Czech. The final English-only matrix passed 312/312 cases (240 base plus 72 fault-name cases), with the actual hosted bootstrap checks passing again. After language cleanup, full repository tests remained 210/210 and build/publish-level validation passed again.

The final language verification compared eight parsed JSON files against `0d6cfa7`: six driver/capability sources, widget manifest and generated `app.json`. All are exactly equal after recursively removing only `cs` keys. The source files remove 50 Czech entries (48 in the six driver/capability files and two in the widget); generated `app.json` reflects those same 50 removals. The production renderer has only an English fallback dictionary, no Czech locale file exists, and the production translation-key scan has no remaining `cs` entries.

The actual hosted bootstrap passed string/object device selection, invalid selection without a request, idempotent initialization, direct POST then forced GET, zero-watt Resume, target rejection, GET/POST failure recovery, feedback retry without repeated POST, delayed polling, doubleclick, faults and nullable telemetry. All four local WebPs loaded, with no external requests or JavaScript/console errors. The supplied animated HTML was also opened at 390px and exercised for owner/state changes, cable motion and simulated Pause.

The initial integration's SHA-256 matched the handoff for index, CSS, view, controller, all four WebPs and both picker PNGs. The final CSS/view differ for the user-requested descriptive fault labels, their wrapping and removal of Czech; core differs for the documented unknown-owner correction. The other runtime files and all artwork remain unchanged. Actual light/dark screenshots were compared with the supplied references: normal-state composition, image art, cable, owner, values/units and state/action placement match. Fault screenshots intentionally differ by the descriptive text and its wrapping. Windows text rendering differs from the packaged reference environment; pixel-identical screenshots are not claimed.

Local evidence is under `C:/Users/jirip/.codex/visualizations/2026/09/27/01a0e14e-813f-76c0-9198-f379ad37460a/widget-scene-qa/`: `browser-results.json`, `verify-scene.cjs`, `check-preview.cjs`, eight light/dark charging/paused/stale/fault PNGs, six additional fault4/5/6 PNGs and the supplied-preview mobile PNG. These QA fixtures and screenshots are outside production public assets.

## Remaining real Homey verification

No installation, physical Start/Stop test, Store publication or PR merge was performed. After a separate deployment instruction, verify the new widget in the actual Homey dashboard: saved wallbox selection, theme/layout, owner display, connected/charging/paused cycle, measured values and zero-target feedback. Homey WebView/CSP and the actual persisted setting shape are not proved by Chromium mocks. Simulate faults only in fixtures.
