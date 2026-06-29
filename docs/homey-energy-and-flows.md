# Homey Energy and Flows

## Homey Energy Integration

The driver class is `evcharger` and the driver declares `energy.evCharger = true`.

The app uses Homey's EV charger capabilities as the primary integration surface:

- `target_power_mode` selects whether Homey controls charging power or whether V2C dynamic modes are active.
- `target_power` is the requested charging power in watts when Homey controls charging.
- `evcharger_charging` is the user's charge/pause intent. In V2C terms it maps inversely to the `Paused` parameter.
- `evcharger_charging_state` represents physical EV state derived from V2C `ChargeState` and `Paused`.

When Homey controls charging, `device.js` converts `target_power` watts to V2C `Intensity` amps using:

- `phase_mode` setting (`1` or `3`);
- `voltage_type` setting (`line_to_neutral` or `line_to_line`);
- live `measure_voltage_installation`;
- the lower of configured and reported max intensity.

The app also narrows Homey's `target_power` capability options based on `phase_mode`, so Homey presents more realistic min/max/step values for one-phase and three-phase installations.

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
- manually correct monthly/yearly Homey energy counters.

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
