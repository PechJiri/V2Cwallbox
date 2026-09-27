# Homey energy reliability repair evidence

This audit consolidates the verified work for app version 2.0.5. It records automated evidence only; it does not claim a Homey installation or wallbox hardware test.

## Verified repairs

- Shared serialized charging control preserves explicit Stop, pause, target, and Homey/V2C ownership behavior; selected-device Flow actions use the shared controls. Task 1's final focused suite passed 69/69 and its full-suite checkpoint passed 92/92.
- The status widget uses the paired wallbox picker and confirms commands from fresh status. Its focused API/frontend suite passed 18/18 after the unknown-reading fix; the preceding full-suite checkpoint passed 108/108.
- Telemetry validation, API failures, and primary ChargeState faults are handled separately from inverter `SlaveError` diagnostics. The focused telemetry suite passed 20/20. The reported 129/129 full-suite run preceded the final diagnostic-label assertion, which passed in the focused suite.
- Polling freshness and fault retention passed 5/5 lifecycle tests; the related telemetry/polling review fix passed 26/26.
- Disconnect settlement can include one valid final sample only for an already observed session. The focused energy suite passed 24/24, including repeated-disconnect protection; its full-suite checkpoint passed 137/137.
- This release fixes `target_power` option refresh after voltage changes. Its regression exercises actual calculated options while settings and voltage telemetry remain old: RED observed missing options in both cases; GREEN passed 3/3, including a same-family 230→240 V change.

## Release checks and limits

Final Task 6 checks passed sequentially: `node --test` (140/140); `HOMEY_SKIP_STARTUP_NOTIFIERS=1 homey app build` (exit 0); and `HOMEY_SKIP_STARTUP_NOTIFIERS=1 homey app validate --level publish` (exit 0). `git diff --check` passed. Homey Store publication and tags were not performed. No hardware behavior is claimed.

Deferred from 2.0.5: Timer controls and other new Flow features, broad repair/lifecycle changes, energy reset/year/persistence redesign, and any remapping of DynamicPowerMode codes 2 or 3. Those mode labels remain unresolved; saved numeric choices are unchanged.
