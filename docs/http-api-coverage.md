# V2C HTTP API Coverage

## Source

This matrix is based on the supplied V2C PDF:

`C:\Users\jirip\Downloads\V2C - Datamanager Modbus TCP & RTU - Disk Google.pdf`

PDF metadata visible in the document:

- title: `V2C - Datamanager Modbus TCP & RTU`;
- last review: `04/05/26`;
- realtime read endpoint: `http://<ip>/RealTimeData`;
- write endpoint: `http://<ip>/write/KeyWord=Value`;
- read endpoint: `http://<ip>/read/`.

## Coverage Matrix

| API keyword | Write enabled in PDF | Current app coverage | Notes |
| --- | --- | --- | --- |
| `ChargeState` | No | Read and mapped | Drives internal charge state, `evcharger_charging_state`, polling interval, and compatibility flow triggers. |
| `ChargePower` | No | Read and mapped | Exposed as `measure_charge_power` and `measure_power`. |
| `VoltageInstallation` | Yes | Read only | Exposed as `measure_voltage_installation`; used for W/A conversion. Writing it may be a calibration-style operation and needs device validation before exposing. |
| `ChargeEnergy` | No | Read and mapped | Used for session/month/year/lifetime energy accounting. |
| `ChargeMode` | Yes | Partially written | Written when local Homey `phase_mode` changes: `1` maps to `0` monophasic and `3` maps to `1` threephasic. `2` mixed is not exposed. |
| `SlaveError` | No | Read and mapped | Exposed as `measure_slave_error`; triggers `slave_error_changed`. |
| `ChargeTime` | No | Read and mapped | Exposed as `measure_charge_time` in minutes. |
| `HousePower` | No | Read and mapped | Exposed as `measure_house_power`. Requires V2C measuring clamps or supported integration. |
| `FVPower` | No | Read and mapped | Exposed as `measure_fv_power`. |
| `Paused` | Yes | Read and write | Exposed through `evcharger_charging`, flow cards, widget pause/resume, and direct V2C writes. |
| `Locked` | Yes | Read and write | Exposed through Homey's `locked` capability and compatibility flow action. |
| `Timer` | Yes | Read only in runtime | `api.js` has `setTimer()`, and `timer_state` is exposed, but there is no setting, capability listener, widget control, or flow action for changing it. |
| `Intensity` | Yes | Read and write | Exposed as `measure_intensity` and `set_intensity`; also written from `target_power`. |
| `Dynamic` | Yes | Read and write | Used when switching between Homey control and V2C dynamic modes. |
| `MinIntensity` | Yes | Read and write | Exposed as capability, setting, and flow action. |
| `MaxIntensity` | Yes | Read and write | Exposed as capability, setting, and flow action. |
| `PauseDynamic` | Yes | Not used | Candidate for pausing/resuming V2C dynamic modulation without necessarily pausing charging. Needs real-device semantics verification. |
| `LightLED` | Yes | Write via flow | Flow action can set display brightness from 0-100%. |
| `LogoLED` | Yes | Write via flow | Flow action can set logo brightness from 0-100%. |
| `DynamicPowerMode` | Yes | Read and write | Mapped to `target_power_mode`, settings, and flow action. |
| `ContractedPower` | Yes | Not used | Candidate for grid contract/current limit configuration in watts. Relevant to dynamic power management. |

The PDF response example also includes `ID`, `SSID`, `IP`, and `SignalStatus`. The current app uses `ID`/`IP` during pairing and exposes `SignalStatus`; `SSID` is not exposed.

The code also handles `FirmwareVersion` and `BatteryPower`, which are not clearly listed in the extracted PDF table but are present in the current implementation and/or V2C responses seen by the app.

## Candidate Future Features

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

### 5. Voltage Installation Write

The PDF marks `VoltageInstallation` as writable, while the app treats it as measured telemetry. Writing it may be a calibration/manual override feature rather than a normal control.

Recommendation: do not expose this until confirmed with V2C documentation or a real device test. If exposed, make it an advanced setting with strict limits and clear warning text.

### 6. Diagnostic Information

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
