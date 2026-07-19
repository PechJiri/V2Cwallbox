# Voltage Settings and Energy Meter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unpublished installation-voltage Flow action with a safe Advanced Setting and expose standards-compliant Homey power and lifetime-energy capabilities with disconnect-only session settlement.

**Architecture:** Device settings own nominal-voltage writes and keep the local voltage representation consistent. `EnergyManager` persists the active session's highest energy reading and settles it once on disconnect into separately stored monthly, yearly, and lifetime totals.

**Tech Stack:** Homey Apps SDK v3, CommonJS JavaScript, Homey Compose JSON, Node.js built-in test runner.

## Global Constraints

- App compatibility remains `>=12.13.0`.
- Existing released Flow card IDs and argument schemas remain unchanged.
- V2C installation voltage accepts only `220`, `230`, `240`, `380`, `400`, or `415` V.
- Session energy is settled only on a transition to disconnected.
- `measure_power` and `meter_power` must use Homey system definitions.

---

### Task 1: Advanced installation-voltage setting

**Files:**
- Modify: `drivers/v2c-wallbox/driver.settings.compose.json`
- Modify: `drivers/v2c-wallbox/driver.flow.compose.json`
- Modify: `drivers/v2c-wallbox/FlowCardManager.js`
- Modify: `drivers/v2c-wallbox/device.js`
- Modify: `lib/constants.js`
- Test: `test/phase_mode_flow.test.js`

**Interfaces:**
- Consumes: `CONSTANTS.DEVICE.INSTALLATION_VOLTAGE.VALUES` and `v2cApi.setParameter(name, value)`.
- Produces: Advanced Setting `installation_voltage`; `setInstallationVoltage(voltage)` used only by `onSettings`.

- [ ] **Step 1: Write failing tests**

Add tests asserting the Flow action is absent, the setting has the six allowed values, `onSettings` writes one `VoltageInstallation` request, aligns `voltage_type`, clears response cache, and rejects `300`.

- [ ] **Step 2: Verify RED**

Run: `node --test test/phase_mode_flow.test.js`
Expected: FAIL because the Flow action still exists and the setting/onSettings behavior is absent.

- [ ] **Step 3: Implement the setting path**

Remove the `set_installation_voltage` compose action and runtime registration. Add the dropdown immediately after `voltage_type`. Route its `onSettings` case through:

```js
await this.setInstallationVoltage(newSettings.installation_voltage);
const voltageType = CONSTANTS.DEVICE.INSTALLATION_VOLTAGE.LINE_TO_LINE_VALUES.includes(
    Number(newSettings.installation_voltage)
) ? 'line_to_line' : 'line_to_neutral';
await this.setSettings({ voltage_type: voltageType });
this.lastResponse = null;
this.lastResponseTime = null;
await this.getProductionData();
```

Ensure the outer `onSettings` refresh does not perform a second read for this path.

- [ ] **Step 4: Verify GREEN**

Run: `node --test test/phase_mode_flow.test.js`
Expected: all voltage and existing phase/Flow tests pass.

---

### Task 2: System Homey energy capabilities

**Files:**
- Delete: `.homeycompose/capabilities/measure_power.json`
- Keep deleted: `.homeycompose/capabilities/meter_power.json`
- Modify: `drivers/v2c-wallbox/device.js`
- Test: `test/phase_mode_flow.test.js`

**Interfaces:**
- Consumes: Homey system `measure_power` and `meter_power` definitions.
- Produces: non-null initial `meter_power` and standard Homey Energy metadata.

- [ ] **Step 1: Write failing tests**

Assert neither custom capability file exists and EnergyManager initialization writes stored lifetime energy, or `0`, to `meter_power` once the capability exists.

- [ ] **Step 2: Verify RED**

Run: `node --test test/phase_mode_flow.test.js`
Expected: FAIL because custom `measure_power.json` exists and initialization does not set `meter_power`.

- [ ] **Step 3: Implement system capability migration**

Delete the custom `measure_power` definition. Initialize/migrate capabilities before initializing EnergyManager, then have EnergyManager initialize the capability with:

```js
await this.setCapabilityValue('meter_power', this.getLifetimeEnergy());
```

- [ ] **Step 4: Verify GREEN**

Run: `node --test test/phase_mode_flow.test.js`
Expected: capability tests pass and `meter_power` is numeric from initialization.

---

### Task 3: Disconnect-only energy accounting and correction

**Files:**
- Modify: `lib/EnergyManager.js`
- Modify: `drivers/v2c-wallbox/FlowCardManager.js`
- Modify: `drivers/v2c-wallbox/driver.flow.compose.json`
- Test: `test/energy_manager.test.js`
- Test: `test/phase_mode_flow.test.js`

**Interfaces:**
- Consumes: `processEnergyData(deviceData, previousState, currentState)`.
- Produces: persistent `pendingSessionEnergy`; `setLifetimeEnergy(value)`; `set_energy_counter` value `lifetime`.

- [ ] **Step 1: Write failing accounting tests**

Cover charging → connected pause → charging without settlement, charging/connected → disconnected with one settlement, repeated disconnect without a second settlement, restoration of pending energy after manager restart, and invalid/excessive energy rejection.

- [ ] **Step 2: Verify RED**

Run: `node --test test/energy_manager.test.js`
Expected: FAIL because the current state machine settles/resets around pauses and lacks a persistent pending peak.

- [ ] **Step 3: Implement pending-session settlement**

Persist the highest valid session reading while not disconnected. On the first disconnect transition, pass that value once to `updateEnergyStatistics()`, then persist `0`. Keep the displayed session capability at `0` while disconnected and otherwise at the current valid `ChargeEnergy`.

- [ ] **Step 4: Add lifetime correction RED/GREEN cycle**

Add a failing test for `setLifetimeEnergy(42.5)` updating `lifetimeEnergyData` and `meter_power`. Implement the method and add `lifetime` to the existing `set_energy_counter` dropdown/handler without changing existing argument names.

- [ ] **Step 5: Verify GREEN**

Run: `node --test test/energy_manager.test.js test/phase_mode_flow.test.js`
Expected: all accounting, correction, and legacy Flow tests pass.

---

### Task 4: Compose output, documentation, and verification

**Files:**
- Modify: `docs/homey-energy-and-flows.md`
- Modify: `docs/http-api-coverage.md`
- Regenerate: `app.json`

**Interfaces:**
- Consumes: final compose manifests and runtime behavior.
- Produces: publishable Homey app manifest and accurate documentation.

- [ ] **Step 1: Update documentation**

Describe the Advanced Setting, one-request voltage write, automatic local voltage-type alignment, visible system energy meter, and disconnect-only settlement. Remove references to the voltage Flow action.

- [ ] **Step 2: Regenerate and verify manifest**

Run: `homey app build`
Expected: generated `app.json` contains `installation_voltage`, no `set_installation_voltage`, and no custom `measure_power`/`meter_power` definitions.

- [ ] **Step 3: Run full verification**

Run: `node --test`
Expected: 0 failures.

Run: `homey app validate --level publish`
Expected: publish validation succeeds.

Run: `git diff --check`
Expected: no whitespace errors.

- [ ] **Step 4: Request independent code review**

Review the full diff against the approved design, fix all Critical and Important findings, then rerun Step 3.
