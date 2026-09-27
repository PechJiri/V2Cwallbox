# Homey energy reliability repair evidence

This audit consolidates automated checks and the limited local Homey verification for app version 2.0.5. Hardware observations and checks still awaiting the user are distinguished below. Private runtime snapshots remain outside the repository.

## Verified repairs

- Shared serialized charging control preserves explicit Stop, pause, target, and Homey/V2C ownership behavior; selected-device Flow actions use the shared controls. Task 1's final focused suite passed 69/69 and its full-suite checkpoint passed 92/92.
- The status widget uses the paired wallbox picker and confirms commands from fresh status. Its focused API/frontend suite passed 18/18 after the unknown-reading fix; the preceding full-suite checkpoint passed 108/108.
- Telemetry validation, API failures, and primary ChargeState faults are handled separately from inverter `SlaveError` diagnostics. The focused telemetry suite passed 20/20. The reported 129/129 full-suite run preceded the final diagnostic-label assertion, which passed in the focused suite.
- Polling freshness and fault retention passed 5/5 lifecycle tests; the related telemetry/polling review fix passed 26/26.
- Disconnect settlement can include one valid final sample only for an already observed session. The focused energy suite passed 24/24, including repeated-disconnect protection; its full-suite checkpoint passed 137/137.
- This release fixes `target_power` option refresh after voltage changes. Its regression exercises actual calculated options while settings and voltage telemetry remain old: RED observed missing options in both cases; GREEN passed 3/3, including a same-family 230→240 V change.

## Release checks and limits

Task 6's checkpoint was `node --test` (140/140). The subsequent whole-branch review found one regression introduced by the new unified control: a positive target could cause an unrelated failed Intensity write to prevent an explicit native Stop. Commit `7fba5fe` handles that Stop before, and without, the Intensity write. The focused control suite passed 23/23 and the final full suite passed 142/142. Build and publish-level validation then passed sequentially: `HOMEY_SKIP_STARTUP_NOTIFIERS=1 homey app build` (exit 0) and `HOMEY_SKIP_STARTUP_NOTIFIERS=1 homey app validate --level publish` (exit 0). `git diff --check` passed. The fresh scoped review found the issue addressed and no new Critical/Important breakage.

The released 2.0.4 app already supported standalone Stop. The original combined Stop plus a changed positive target could override Stop; that is distinct from the later regression caught and repaired in this branch. This audit does not describe the latter as an original app or Homey SDK defect.

## Local Homey verification

- Installed the verified build in place using `homey app install --skip-build`, without `--clean`. The installed version is 2.0.5, enabled, not crashed, and the paired wallbox remains available. The built control, device and widget sources match the reviewed sources.
- Before/after reads preserved the Homey device identity and pairing data, `evcharger` class, `energyObj.evCharger=true`, imported-energy capability `meter_power`, and the published monthly, yearly and cumulative counters. Homey ownership, accepted target and phase configuration were preserved. This is a smoke check of exposed values, not direct inspection of the SDK device store or an exhaustive Homey Energy automation test.
- Firmware 2.5.1 was read from the real wallbox. The raw primary state is exposed independently of the inverter diagnostic. Widget metadata is present on Homey.
- Native capability requests from the CLI were accepted but did not confirm physical Start during the observation window. A later physical Start at approximately 4.1 kW was explicitly confirmed by the user as their manual **quick action on the wallbox card**. It is evidence for that native UI path, not for the CLI commands or widget button. The latest subsequent read showed the wallbox paused with zero measured power; no further coordinator control writes were issued.
- After the coordinator requested a rendered widget Start/Stop check, the user reported that the widget works. This is user-reported manual verification; individual clicks, timings and repeated cycles were not independently recorded. Existing widget selections may need the wallbox selected again. Automated widget API/frontend and forced-read integration tests also passed. No physical fault injection, inverter-mode switch, Logo or Timer test is claimed.

Homey Store publication and tags were not performed. `validate --level publish` validates the package; it does not publish it.

Deferred from 2.0.5: Timer controls and other new Flow features, broad repair/lifecycle changes, energy reset/year/persistence redesign, and any remapping of DynamicPowerMode codes 2 or 3. Those mode labels remain unresolved; saved numeric choices are unchanged.

## Recorded implementation decisions

1. Shared charging control was implemented before the widget so both use the same ownership-aware path. If this sequencing choice were wrong, delivery order would change, without changing the approved behavior.
2. DynamicPowerMode numeric mappings 2/3 were retained pending firmware-specific evidence. The cost is leaving the documented mode-label discrepancy unresolved.
3. The user's tested LogoLED percentage contract was retained. Other firmware variants may require conditional handling later.
4. Widget selection uses an app-owned autocomplete and documented driver lookup by pairing data ID, without a broad device-control permission. The cost is that an existing widget may require wallbox reselection, especially with multiple devices.
5. Homey whole-watt options round current steps upward while actual current remains floored and bounded. This avoids losing 1 A at the advertised maximum; a displayed watt maximum may exceed the mathematical nominal by a few watts without raising the current limit.
