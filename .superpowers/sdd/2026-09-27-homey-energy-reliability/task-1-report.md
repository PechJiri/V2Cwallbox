# Task 1 report: shared control and Homey ownership

## Outcome

Implemented the shared serialized control path, Homey/V2C ownership handling, and per-device Flow routing in commit `9cae6fda5e2c0cc279228e03686e9832c60b1c6e` (`Serialize V2C charging control`). No wallbox hardware command, deployment, or push was performed.

## TDD evidence

The first implementation test run was:

```text
node --test test/charger_control.test.js test/flow_contracts.test.js
```

It reported **20 tests: 18 failed, 2 passed**. Expected red cases exposed the positive-target/Stop conflict, pause loss during target changes, Intensity/unpause ordering, the missing shared-control methods and handback provenance, negative power starting, telemetry replacing the desired Homey target, incorrect `args.device` routing, the `args.power` threshold mismatch, and duplicate Flow listener registration. The two passing cases established existing behavior to preserve: V2C power-only writes were ignored, and the independent calculator helpers performed no device I/O.

After implementation and phase fixture updates, the full suite was run with:

```text
node --test
```

Result: **78 passed, 0 failed**. `git diff --check` also passed before the implementation commit.

## Interfaces and behavior

- Added `lib/ChargerControl.js`. Each device gets a controller whose Promise queue serializes `setChargingPaused(paused)`, `applyChargingChanges(values)`, `setDynamicPowerMode(mode)`, `setIntensityLimit(kind, amps)`, and `setChargingIntensity(amps)`. The device exposes these as public async methods; callers do not access queue state.
- A Homey zero-target change writes V2C `Paused=1` first and persists `homeyEnergyKnownIdlePause=true` only after the pause and capability update succeed. A failed store write rejects the operation and cannot create a later automatic resume. Manual pause/resume clears old provenance before issuing the manual V2C command, so a persisted Homey-idle marker cannot undo a manual Stop after restart.
- Handback to a V2C strategy discards the Homey target. It resumes only when the persisted marker is exactly `true` and no explicit manual charging change is in the handback batch. Missing, false, or unrecognized provenance leaves the charger paused. Standalone `evcharger_charging=false` remains manual intent when the current target is zero; Homey’s changed zero-target batch is treated as Homey idle.
- In Homey mode, a positive desired target writes Intensity without changing the existing pause state. Explicit resume applies the accepted desired target first and sends `Paused=0` only after Intensity succeeds. A simultaneous explicit Stop takes precedence over positive power. Negative, non-finite, and sub-minimum values cannot start the unidirectional charger; requests below the effective minimum pause it instead of forcing a higher current.
- Target current calculations use the minimum of the configured, reported, and physical maximum current, and the maximum of the configured, reported, and physical minimum. `getChargingVoltage()` accepts live installation voltage only when it matches `voltage_type`, then uses a matching configured installation voltage, with 230 V line-to-neutral and 400 V line-to-line fallbacks.
- Polling preserves the accepted `target_power` while Homey owns the target. In V2C mode it continues to publish the calculated device target. Existing 500 ms multi-capability batching and zero-inclusive, configuration-driven capability options remain in place.
- Flow listeners are registered once per Homey flow manager and use `args.device` for device actions, triggers, and conditions. Power threshold cards read the manifest argument `args.power`. `set_power` still calculates only from its explicit arguments and writes the resulting Intensity to its selected device; both calculator cards remain input-only. LogoLED's 0–100 range and sequential `both` writes remain unchanged.

## Decisions and uncertainties

- Homey’s cached Energy documentation says `target_power` is a desired watt value, that the system action supplies a combined target/mode/charging change, and that a multiple-capability listener can debounce the batch for 500 ms. The implementation follows that contract and keeps measured Intensity out of Homey’s desired target while Homey owns power.
- A batch containing a changed zero target is classified as Homey idle, including Homey’s documented `evcharger_charging=false` companion value. A standalone change to `evcharger_charging` is manual intent. This distinguishes Homey idle from a manual Stop while preserving Stop precedence when positive power and `false` arrive together.
- DynamicPowerMode numeric mappings, including codes `2` and `3`, were not changed because the firmware-specific discrepancy remains unverified. No hardware behavior is claimed.
- Tests verify behavior using the existing V2C/Homey test doubles; they do not verify a live charger or Homey runtime integration.
