# Homey Energy and Flows

## Homey Energy Integration

The driver class is `evcharger` and the driver declares `energy.evCharger = true`.

The app uses Homey's EV charger capabilities as the primary integration surface:

- `target_power_mode` selects whether Homey controls charging power or whether V2C dynamic modes are active.
- `target_power` is the requested charging power in watts when Homey controls charging.
- `evcharger_charging` is the user's charge/pause intent. In V2C terms it maps inversely to the `Paused` parameter.
- `evcharger_charging_state` represents physical EV state derived from V2C `ChargeState` and `Paused`.

The driver also uses Homey's system energy capabilities:

- `measure_power` reports the current positive charging power in watts;
- `meter_power` reports the locally accumulated lifetime imported charging energy in kWh.

Both capabilities use Homey's built-in definitions; there are no custom `measure_power` or `meter_power` capability files. The driver declares `energy.meterPowerImportedCapability = "meter_power"`, which lets Homey use this lifetime meter in the Energy tab. The system `meter_power` component remains visible in the device UI and Insights because replacing it with a hidden custom capability would prevent Homey from treating it as the standard energy meter. On initialization, the app publishes the stored lifetime total or `0`, so the capability is not intentionally left `null`.

V2C `ChargeEnergy` is a current-session counter. While the car is connected or charging, the app persists the highest valid reading as `pendingSessionEnergy`. Pausing and resuming does not settle or clear that value. On the first transition to physically disconnected, the pending value is claimed, added once to the monthly, yearly, and lifetime totals, and the displayed session energy returns to `0`. Repeated disconnected polls do not add it again, and the persisted pending value survives an app restart during a session.

Settlement uses a persisted transaction containing validated monthly, yearly, and lifetime baselines plus absolute targets. A partial storage or capability failure leaves that transaction available for an idempotent retry during initialization or the next serialized energy operation. Replaying the same absolute targets cannot add the session twice; pending session energy and the transaction are cleared only after all target writes succeed. A malformed transaction fails closed and leaves both itself and pending energy untouched instead of applying or discarding unverifiable data. All counter corrections and period-rollover checks use the same serialization queue; the `both` correction updates monthly and yearly counters in one queued operation. Changing monthly or yearly totals does not rewrite lifetime energy.

## Home quick action

The driver exposes Homey's standard, writable `evcharger_charging` and `locked` capabilities. Their listeners write the matching V2C `Paused` and `Locked` parameters. Where the installed Homey UI/OS supports choosing a device quick action, the user can therefore select charging on/off or lock/unlock. The app does not declare a custom `uiQuickAction` or override Homey's selection.

When Homey controls charging, `device.js` converts `target_power` watts to V2C `Intensity` amps using:

- `phase_mode` setting (`1` or `3`);
- `voltage_type` setting (`line_to_neutral` or `line_to_line`);
- live `measure_voltage_installation`;
- the lower of configured and reported max intensity.

The app also narrows Homey's `target_power` capability options based on `phase_mode`, so Homey presents more realistic min/max/step values for one-phase and three-phase installations.

## Installation voltage setting

Advanced Settings contain two adjacent voltage controls:

- `voltage_type` is a local choice used by the watts-to-amps calculation and sends no request by itself;
- `installation_voltage` writes the wallbox's nominal `VoltageInstallation` value.

`installation_voltage` accepts only 220, 230, 240, 380, 400, or 415 V. One selection sends exactly one `VoltageInstallation` request, aligns the local `voltage_type` to line-to-neutral for 220/230/240 V or line-to-line for 380/400/415 V, clears the cached response, and refreshes telemetry so `measure_voltage_installation` can show the wallbox response. Installation voltage is intentionally not exposed as a Flow action.

On the first start after upgrading an already-paired device, the app seeds the new setting locally without writing to V2C. It keeps the existing `voltage_type` category and selects the closest supported nominal value from the last `measure_voltage_installation` reading. If no usable reading exists, it uses 230 V for line-to-neutral or 400 V for line-to-line. The migration is versioned and runs once. Only if the local settings migration fails does the app create a single English Timeline notification asking the user to verify Installation Voltage in Advanced Settings.

## V2C Dynamic Modes

When `target_power_mode` is not `homey`, the app treats V2C as the controller. It writes:

- `Dynamic=1`;
- `DynamicPowerMode=<0..5>`.

When `target_power_mode` is `homey`, the app writes `Dynamic=0` and applies `target_power` by writing V2C `Intensity`.

The current mode mapping is defined in `lib/constants.js`:

| Homey mode | V2C DynamicPowerMode |
| --- | --- |
| `v2c_timed_on` | `0` |
| `v2c_timed_off` | `1` |
| `v2c_fv_exclusive` | `2` |
| `v2c_fv_min` | `3` |
| `v2c_grid_fv` | `4` |
| `v2c_no_charge` | `5` |

## Custom Flow Cards

Flow card registration is centralized in `drivers/v2c-wallbox/FlowCardManager.js`.

Current action cards include:

- pause/resume charging;
- lock/unlock charger;
- set V2C intensity;
- set charging power in watts using a custom W/A calculation;
- calculate current from power with optional buffer;
- enable/disable V2C dynamic mode;
- set min/max dynamic intensity;
- set installation phase count for Homey Energy conversion;
- set display/logo LED brightness;
- set V2C dynamic power mode;
- manually correct monthly, yearly, both-period, or lifetime Homey energy counters.

Current condition cards include:

- power greater/less than a threshold;
- charging paused/not paused;
- connection error;
- calculated current comparison;
- deprecated compatibility conditions for old car-connected cards.

Current trigger cards include:

- deprecated compatibility triggers for car connected/disconnected/start charging;
- slave error changed;
- API connection state changed.

## Phase Count Versus V2C Charge Mode

The `phase_mode` setting and `set_phase_mode` flow action affect Homey's conversion between watts and amps. The app also synchronizes this fixed phase choice to V2C `ChargeMode`.

The V2C HTTP API also exposes `ChargeMode` with values:

- `0` - monophasic;
- `1` - threephasic;
- `2` - mixed.

When `phase_mode` changes, the app also writes the matching V2C `ChargeMode`:

- `phase_mode=1` writes `ChargeMode=0`;
- `phase_mode=3` writes `ChargeMode=1`.

When the `set_phase_mode` flow action runs while charging is active, it temporarily writes `Paused=1`, changes the phase mode, then writes `Paused=0` again. This restart sequence is needed because V2C accepts `ChargeMode` during an active session but does not apply the hardware phase change until charging restarts.

`ChargeMode=2` (`mixed`) is not currently exposed because Homey's local W/A conversion setting only supports fixed one-phase and three-phase calculations.
