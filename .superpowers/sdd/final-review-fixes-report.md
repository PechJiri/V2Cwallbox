# Final review fixes report

Implemented the scoped final-review findings with regression tests:

- Added an opt-in strict `getProductionData({ throwOnError: true })` path. Normal initial/scheduled polling still tolerates API failures, while `onSettings` now rejects if its final refresh fails.
- Pre-validates and installs a changed V2C IP client before processing any other changed setting, so `VoltageInstallation` is written exactly once to the new wallbox regardless of `changedKeys` order. The response cache is cleared before the strict refresh.
- Serialized `setLifetimeEnergy` on the same transition queue as disconnect settlement, using a non-queued private implementation. Added a deterministic race test proving invocation order is preserved.
- Repairs stored lifetime energy to zero unless it is finite and nonnegative; the getter and statistics fallback apply the same guard.
- Clamps the system `measure_power` import to nonnegative consumption while retaining raw V2C telemetry in `measure_charge_power`.

TDD evidence:

- RED: targeted suite failed on strict refresh, settings refresh options, IP/client ordering, lifetime correction race, negative stored lifetime, and negative system power.
- GREEN: `node --test test/phase_mode_flow.test.js test/energy_manager.test.js` passed 37/37.

Fresh verification:

- `node --test`: 37/37 passed.
- `homey app build`: passed; debug validation passed.
- `homey app validate --level publish`: passed.
- `git diff --check`: passed (only checkout line-ending warnings).

The at-most-once settlement tradeoff was outside the initial scoped fix and was subsequently addressed by the replay-safe settlement commits on this branch.

Follow-up settings fix:

- Limited strict refresh to saves containing `installation_voltage`. Local-only `voltage_type` and `enable_logging` saves retain tolerant polling behavior and therefore do not fail solely because the wallbox is offline.
- Mixed saves containing `installation_voltage` still perform one strict refresh after all changes and retain new-IP-first ordering.
- Added a RED/GREEN regression covering an offline combined local-only save and asserting exactly one tolerant refresh.
- Follow-up verification: `node --test` passed 48/48; Homey build and publish validation passed; `git diff --check` passed.
