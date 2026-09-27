# V2C HTTP API Coverage

## Source

This matrix is based on the supplied V2C DataManager Modbus TCP & RTU documentation and the published [V2C HTTP API spreadsheet](https://docs.google.com/spreadsheets/u/1/d/e/2PACX-1vQGA_7Z4YaSMZeHRTnAP6z_82dVPmM33NxJhvsDBEFn8LyWjX-RX_fkR7KCErqAE4aGFvPrUufooHoM/pubhtml#gid=1147522182).

The supplied PDF identifies these endpoints:

- title: `V2C - Datamanager Modbus TCP & RTU`;
- last review: `04/05/26`;
- realtime read endpoint: `http://<ip>/RealTimeData`;
- write endpoint: `http://<ip>/write/KeyWord=Value`;
- read endpoint: `http://<ip>/read/`.

## Coverage Matrix

| API keyword | Write enabled in PDF | Current app coverage | Notes |
| --- | --- | --- | --- |
| `ChargeState` | No | Read and mapped | Primary states are `0` waiting, `1` connected, `2` charging, `4` system/leakage fault, `5` CP/ground fault, and `6` ventilation required. States `4`–`6` publish the existing alarm capability and widget fault descriptor. |
| `ChargePower` | No | Read and mapped | Exposed as `measure_charge_power` and Homey's system `measure_power` capability. The positive value is used as live EV charging consumption. |
| `VoltageInstallation` | Yes | Read and write | Exposed as `measure_voltage_installation` and configured in Advanced Settings. A nominal-voltage change aligns local `voltage_type`, invalidates cached response data, and refreshes telemetry. The Homey target-power options use the submitted voltage configuration during that refresh. There is no voltage Flow action. |
| `ChargeEnergy` | No | Read and mapped | Exposed as current-session energy. The highest valid observed session reading is persisted; one valid first-disconnect reading may supplement that pending session before settlement. Repeated disconnected polls cannot add the session again or create a session that was never observed. |
| `ChargeMode` | Yes | Partially written | Written when local Homey `phase_mode` changes: `1` maps to `0` monophasic and `3` maps to `1` threephasic. `2` mixed is not exposed. |
| `SlaveError` | No | Read and mapped | Exposed as `measure_slave_error`; triggers `slave_error_changed`. It is an inverter communication diagnostic, separate from the primary `ChargeState` fault and Homey network-offline status. |
| `ChargeTime` | No | Read and mapped | Exposed as `measure_charge_time` in minutes. |
| `HousePower` | No | Read and mapped | Exposed as `measure_house_power`. Requires V2C measuring clamps or supported integration. |
| `FVPower` | No | Read and mapped | Exposed as `measure_fv_power`. |
| `Paused` | Yes | Read and write | Exposed through `evcharger_charging`, flow cards, widget pause/resume, and direct V2C writes. |
| `Locked` | Yes | Read and write | Exposed through Homey's `locked` capability and compatibility flow action. |
| `Timer` | Yes | Read only in runtime | `timer_state` is a read-only indicator; there is no setting, capability listener, widget control, or Flow action for changing it. No Timer control is added in 2.0.4. |
| `Intensity` | Yes | Read and write | Exposed as `measure_intensity` and `set_intensity`; also written from `target_power`. |
| `Dynamic` | Yes | Read and write | Used when switching between Homey control and V2C dynamic modes. |
| `MinIntensity` | Yes | Read and write | Exposed as capability, setting, and flow action. |
| `MaxIntensity` | Yes | Read and write | Exposed as capability, setting, and flow action. |
| `PauseDynamic` | Yes | Not used | Candidate for pausing/resuming V2C dynamic modulation without necessarily pausing charging. Needs real-device semantics verification. |
| `LightLED` | Yes | Write via flow | Flow action can set display brightness from 0-100%. |
| `LogoLED` | Yes | Write via flow | Firmware 2.5.1 exposes logo on/off, distinct from display brightness. The existing shared display/logo Flow card is retained. |
| `DynamicPowerMode` | Yes | Read and write | Mapped to `target_power_mode`, settings, and flow action. |
| `ContractedPower` | Yes | Not used | Candidate for grid contract/current limit configuration in watts. Relevant to dynamic power management. |
| `IntensityMeasure_L1`–`L3` | No | Read and mapped | Exposed as read-only `measure_current.l1`–`l3` with distinct Current L1/L2/L3 titles when recent firmware provides the values. |
| `VoltageMeasure_L1`–`L3` | No | Read and mapped | Exposed as read-only `measure_voltage.l1`–`l3` with distinct Voltage L1/L2/L3 titles when recent firmware provides the values. |

The published HTTP table reviewed on 14 July 2026 defines code `2` as minimum power and code `3` as exclusive. Runtime mappings and numeric option labels follow that contract. Saved numeric settings and Flow values are not migrated; users should review FV selections chosen using the former reversed labels. Deprecated code `1` remains supported for compatibility, although firmware 2.5.1 returned code `4` after it was requested in the live test.

The PDF response example also includes `ID`, `SSID`, `IP`, and `SignalStatus`. The current app uses `ID`/`IP` during pairing and exposes `SignalStatus`; `SSID` is not exposed.

The code also handles `FirmwareVersion` and `BatteryPower`, which are not clearly listed in the extracted PDF table but are present in the current implementation and/or V2C responses seen by the app.

## Energy Accounting Notes

The driver remains an `evcharger` and declares both `energy.evCharger = true` and `energy.meterPowerImportedCapability = "meter_power"`. `measure_power` and `meter_power` use Homey's system capability definitions. The lifetime meter is visible in Homey's device UI and Insights, and initialization writes its stored numeric value or `0`.

Disconnect settlement uses a persisted high-water mark and an idempotent transaction with validated baselines and absolute monthly, yearly, and lifetime targets. One valid first-disconnect sample can supplement positive pending session energy; later disconnected polls do not resurrect or settle it again. Partial storage or capability failures leave the transaction available for retry without adding the session twice. Pending energy is cleared only after all targets succeed; malformed transactions fail closed. Users can correct monthly, yearly, both-period, or lifetime energy through the existing serialized `set_energy_counter` Flow action; monthly and yearly corrections do not automatically change lifetime energy.

## Candidate Future Features (deferred from 2.0.4)

### 1. Mixed Charge Mode Control

The app now writes fixed V2C `ChargeMode` values when the local Homey phase count changes. The remaining gap is `ChargeMode=2` (`mixed`).

Possible future surface:

- action card: "Set V2C charge mode" with monophasic, threephasic, mixed;
- optional setting: "V2C charge mode";
- optional capability if Homey has a suitable generic enum surface.

This must stay distinct from `phase_mode`, because `phase_mode` controls Homey's W/A conversion and cannot represent mixed calculations.

### 2. Timer Control

The app already reads `Timer` and `api.js` already contains `setTimer()`. The missing pieces are user-facing surfaces:

- flow action: enable/disable V2C timers;
- optional condition: timers are enabled;
- optional widget indicator/control;
- optional capability listener if `timer_state` should become writable.

This is low implementation risk because most of the HTTP plumbing already exists.

### 3. Dynamic Modulation Pause

`PauseDynamic` appears to pause dynamic control modulation while leaving the charger state separate from `Paused`. This could be useful when the user wants to temporarily stop V2C's automatic modulation without fully switching to Homey control.

Before implementation, validate on hardware:

- whether `PauseDynamic=1` still allows charging;
- how it interacts with `Dynamic=0/1`;
- whether it is reset by V2C firmware after mode changes.

### 4. Contracted Power

`ContractedPower` is writable in watts. This is potentially important for users with a fixed grid contract or main breaker limit.

Possible surfaces:

- setting for contracted power;
- flow action to set contracted power dynamically;
- diagnostics showing current configured value.

This should be handled carefully because a wrong value can affect dynamic charging behavior. Use conservative validation, clear labels, and avoid silently changing it as part of unrelated flows.

### 5. Diagnostic Information

The app could expose or log more read-only diagnostics from the response:

- `SSID` for troubleshooting the wallbox network;
- response `IP` when it differs from configured IP;
- raw `Dynamic`, `DynamicPowerMode`, `ChargeMode`, and `PauseDynamic` in debug logs.

These are low-risk if read-only, but avoid adding user-visible capabilities unless Homey users will act on the values.

## Implementation Notes For Future Work

- All new writes should use `v2cAPI.setParameter()` or a small wrapper method in `api.js`.
- Any setting changed programmatically with `device.setSettings()` must explicitly run side effects because Homey does not call `onSettings()` for programmatic setting changes.
- New flow actions should be registered in `FlowCardManager.js` and declared in `drivers/v2c-wallbox/driver.flow.compose.json`; the generated `app.json` must be kept in sync.
- For risky writes (`ContractedPower`, `VoltageInstallation`, `ChargeMode`), add tests before runtime changes and validate on a real wallbox before release.
