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

Residual tradeoff intentionally preserved: disconnect settlement durably clears pending energy before updating counters, favoring at-most-once accounting. A crash/failure after the claim and before all counter writes can lose that session energy; no transactional redesign was included in this scoped fix.
