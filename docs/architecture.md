# Architecture

## Purpose

The app integrates a V2C Wallbox with Homey as a local LAN EV charger. It polls V2C realtime data, exposes charging and energy state through Homey capabilities, and sends control commands back to the wallbox through HTTP GET write endpoints.

## Runtime Structure

`app.js` is intentionally thin. The wallbox-specific behavior lives under `drivers/v2c-wallbox/`.

`driver.js` handles pairing and repair:

- pairing asks for a wallbox IP address;
- IP input is validated by `lib/ip_validator.js` to private IPv4 ranges;
- pairing calls `v2cAPI.getData()` and uses the V2C response to create the Homey device;
- repair lets the user update the stored IP address.

`device.js` is the main runtime object for each paired wallbox:

- creates the `v2cAPI` client for the stored IP address;
- initializes missing capabilities listed in `lib/constants.js`;
- initializes `FlowCardManager`;
- starts periodic polling;
- maps raw V2C fields into Homey capabilities;
- registers Homey Energy listeners for `target_power`, `target_power_mode`, and `evcharger_charging`;
- handles settings changes such as min/max intensity, dynamic power mode, phase count, voltage type, and IP address.

`api.js` is the local HTTP client:

- reads realtime data from `http://<ip>/RealTimeData`;
- writes parameters through `http://<ip>/write/<KeyWord>=<Value>`;
- serializes requests through an internal queue because the V2C firmware can fail when polling and writes happen concurrently;
- inserts a short delay after each request to reduce intermittent firmware 404 responses;
- tracks consecutive API errors for device availability handling.

`DataValidator.js` normalizes V2C response data into app-internal fields. It converts numeric/string/boolean values, pads `SlaveError`, normalizes `DynamicPowerMode` to strings, and validates expected ranges before the device updates capabilities.

`EnergyManager.js` maintains session/month/year/lifetime counters on top of V2C `ChargeEnergy`. `meter_power` is used as Homey's imported lifetime energy source.

## Polling Model

The device changes its polling interval based on the last known charge state:

- disconnected: 30 seconds;
- connected: 10 seconds;
- charging: 5 seconds.

When API errors accumulate, `device.js` applies exponential backoff up to 5 minutes. A successful poll resets the counter.

## Capabilities

The app exposes these main capability groups:

- Homey Energy control: `target_power`, `target_power_mode`, `evcharger_charging`, `evcharger_charging_state`;
- power and energy: `measure_charge_power`, `measure_power`, `meter_power`, `measure_charge_energy`, `measure_monthly_energy`, `measure_yearly_energy`;
- wallbox controls: `locked`, `set_intensity`, `min_intensity`, `max_intensity`;
- diagnostics and telemetry: `measure_voltage_installation`, `measure_slave_error`, `measure_connection_error`, `firmware_version`, `signal_status`;
- installation and ecosystem telemetry: `measure_house_power`, `measure_fv_power`, `measure_battery_power`, `timer_state`.

## Widget

The widget lives in `widgets/wallbox-status/`.

The widget backend reads capabilities from the selected wallbox and exposes a compact `/status` response. The frontend shows charge state, current power, session energy, and a pause/resume button. The widget still uses the old V2C state values `0`, `1`, and `2` internally, so `widgets/wallbox-status/api.js` derives them from Homey's `evcharger_charging_state`.

## Known Gotchas

Homey `Device#setSettings()` does not call `device.onSettings()` when settings are changed programmatically. Flow cards or repair handlers that call `setSettings()` must explicitly perform the same side effects that `onSettings()` would normally perform, such as updating the V2C API client, writing a V2C parameter, refreshing capability options, or polling data again.

The `phase_mode` setting is local to Homey and controls conversion between watts and amps for Homey Energy. The app synchronizes fixed one-phase and three-phase choices to V2C `ChargeMode`, but it is not a full V2C charge-mode surface because `mixed` is not represented in Homey's W/A conversion.
