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
- A Homey zero-target change writes V2C `Paused=1` first and persists `homeyEnergyKnownIdlePause=true` only after the pause and capability update succeed. A failed store write rejects the operation and cannot create a later automatic resume. Manual Stop clears old provenance before issuing `Paused=1`; a Homey resume first applies the accepted target, then clears provenance before `Paused=0`; V2C manual resume clears provenance before its pause-flag write. This prevents a persisted Homey-idle marker from undoing a manual Stop after restart.
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

## FIX ROUND 1/5: target-aware public resume

### RED

Added tests for the public `setChargingPaused(false)` API and the actual Flow `set_paused` action, including successful target ordering, an Intensity failure, and zero/invalid/sub-minimum targets. The requested focused command was:

```text
node --test test/charger_control.test.js test/flow_contracts.test.js test/phase_mode_flow.test.js
```

Before the production fix, it reported **61 tests: 5 failed, 56 passed**. The five expected failures were the missing public Homey target write, missing propagation of its Intensity failure, accepting non-achievable Homey targets, and the corresponding two actual Flow-action cases (ordering and failure propagation). The V2C manual-resume preservation case passed.

### GREEN

The same focused command passed **61/61** after the fix. The complete suite also passed:

```text
node --test
# 84 passed, 0 failed
```

`git diff --check` passed. No live wallbox command or deployment was used.

### Fix

The shared public `ChargerControl.setChargingPaused(false)` path now checks current ownership. Under Homey ownership it requires a finite, positive target at or above the effective physical/configured/reported minimum; otherwise it rejects with `positive achievable Homey target required` without changing pause state or provenance. For an achievable target, it writes the calculated Intensity before `Paused=0`, so an Intensity error rejects without unpausing or clearing provenance. With V2C ownership it retains manual resume through the pause flag only, without writing Homey Intensity or changing strategy. Manual Stop at zero still clears Homey-idle provenance.

Implementation and tests are in commit `7726f26794563f28ce6325aca0416eab54bb2964` (`Apply Homey target before manual resume`).

## FIX ROUND 1/5 (continued): Flow hardware effects and achievable target options

### RED

Added actual Flow-action tests using separate selected and decoy devices for both `set_dynamic` branches, `set_dynamic_power_mode`, and the minimum/maximum intensity limits. The initial run was:

```text
node --test test/flow_contracts.test.js
# 15 tests: 7 failed, 8 passed
```

The expected failures showed that all four Flow actions skipped their V2C writes and state synchronization, and that device-write errors were swallowed. A separate configured-voltage test first showed that a 415 V line-to-line setup still advertised the fixed 230 V range. After voltage selection was added, a floor-current boundary test showed that rounding 24 A to 17,251 W still mapped to only 23 A. The final boundary RED command was:

```text
node --test --test-name-pattern='target_power options use the selected configured|Homey target just below configured' test/flow_contracts.test.js
# 2 tests: 1 failed, 1 passed; advertised max was 17,251 W, below the required 17,256 W integer step
```

### GREEN

The final focused command passed **69/69**:

```text
node --test test/charger_control.test.js test/flow_contracts.test.js test/phase_mode_flow.test.js
```

The full test suite passed **92/92**, and `git diff --check` passed:

```text
node --test
# 92 passed, 0 failed
```

### Fix

All four Flow actions now route the selected `args.device` through the queued public control methods. `setDynamicPowerMode` applies the V2C Dynamic/Mode write through shared ownership handling, then synchronizes the setting and `target_power_mode` capability. Intensity-limit changes write the V2C parameter first, then update the corresponding setting/capability and refresh target-power options. Failed device writes propagate without claiming the new local mode or limit.

Target-power options now use effective configured/reported min/max amps and the same selected live-or-configured voltage as Homey target control. Zero remains selectable. The whole-watt step is rounded up per amp so a max-current target remains achievable when current conversion floors: at 415 V line-to-line, 24 A is advertised at 17,256 W with a 719 W step, and the control path commands 24 A. The minimum exclusion is the ceiling of the effective minimum-current watts; 4,312 W stays paused while 4,313 W can reach the 6 A minimum. The pure Flow calculators and numeric V2C mode codes are unchanged. Options refresh at initialization and configuration changes, not during polling.

Implementation and tests are in commit `d217d9c` (`Route dynamic Flow controls through shared queue`). No wallbox command, deployment, or push was performed.
