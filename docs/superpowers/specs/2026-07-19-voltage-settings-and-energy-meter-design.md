# Voltage Settings and Energy Meter Design

## Goal

Move installation-voltage control from an unpublished Flow action into Advanced Settings and make the wallbox a standards-compliant Homey Energy consumer with a non-null, monotonic lifetime energy meter.

## Scope

- Remove the new `set_installation_voltage` Flow action from the compose manifest, runtime registration, generated manifest, tests, and documentation.
- Keep every previously released Flow card unchanged.
- Keep the existing local `voltage_type` Advanced Setting and add `installation_voltage` immediately below it.
- Replace the remaining custom `measure_power` definition with Homey's system capability and keep `meter_power` as a system capability.
- Preserve the existing monthly and yearly correction Flow card and extend its existing counter selector with a lifetime option.

## Installation voltage settings

`installation_voltage` is a dropdown with the values `220`, `230`, `240`, `380`, `400`, and `415`. Labels and the hint identify 220/230/240 V as line-to-neutral values and 380/400/415 V as line-to-line values. Its default is `230`.

When `installation_voltage` changes, the device:

1. validates the value against the shared allow-list;
2. writes the numeric value to V2C `VoltageInstallation` using one API request;
3. updates the local `voltage_type` to `line_to_neutral` for 220/230/240 V or `line_to_line` for 380/400/415 V;
4. invalidates the cached V2C response and performs a real refresh so `measure_voltage_installation` reflects the wallbox response without waiting for the cache window.

Changing `voltage_type` alone remains a local operation and sends no V2C request. This preserves manual correction for unusual installations while selecting a new nominal voltage always leaves the normal European combinations consistent.

If the V2C write or refresh fails, `onSettings` rejects the settings change with an error. The existing setting value and capability are not reported as successfully updated by the app.

## Homey Energy capabilities

Both `measure_power` and `meter_power` use Homey's system definitions. The custom files with either system ID are absent from `.homeycompose/capabilities`.

- `measure_power` contains the current positive charging power in watts.
- `meter_power` contains lifetime imported charging energy in kWh.
- The driver remains class `evcharger`, keeps `energy.evCharger: true`, and keeps `energy.meterPowerImportedCapability: "meter_power"`.
- The system `meter_power` UI and Insights remain enabled because Homey does not support hiding the system component without replacing it with a custom capability.
- After capability migration and EnergyManager initialization, `meter_power` is immediately set to the stored lifetime value or `0`; it is never intentionally left `null`.

## Disconnect-only energy settlement

V2C `ChargeEnergy` remains the current charging-session value. Monthly, yearly, and lifetime totals are updated only when a session changes from connected/charging to disconnected.

During a connected or charging session, the EnergyManager persists the highest valid `ChargeEnergy` observed for the active session. A pause does not settle the session and does not reset the pending value. On the first disconnected transition, the pending session energy is added exactly once to monthly, yearly, and lifetime totals, then the pending session state is cleared. Repeated disconnected polls add nothing.

The pending value is persisted in the device store so an app restart during a session does not lose the observation. Invalid, negative, non-finite, or excessive jumps continue to be ignored according to the existing maximum-delta guard.

This model intentionally favors avoiding double-accounting. It does not add energy continuously while charging, so Homey's kWh total changes after physical disconnection; live consumption remains available through `measure_power`.

## Counter correction

The existing `set_energy_counter` Flow action remains backward compatible. Its existing argument names and `monthly`/`yearly` IDs do not change. A new `lifetime` selector value is added. Setting lifetime updates the stored lifetime counter and the system `meter_power` capability together.

Monthly and yearly manual corrections continue to update their stores and capabilities. They do not rewrite lifetime automatically.

## Migration and compatibility

Existing paired devices receive the six phase sub-capabilities and the system energy capabilities through the existing guarded `addCapability()` migration. Capability IDs `measure_power` and `meter_power` do not change, so stored device values and Flow references are preserved while Homey begins using the system definitions.

Older V2C firmware that omits per-phase data continues to leave those read-only capabilities unset. The installation-voltage setting is only written after an explicit user change.

## Tests and verification

Tests must prove:

- the removed voltage Flow action is absent from manifest and runtime registration;
- all previously released Flow card IDs and definitions remain unchanged;
- each allowed installation voltage writes exactly one `VoltageInstallation` request, aligns the local voltage type, bypasses cache, and rejects unsupported values;
- phase telemetry remains read-only and optional;
- `measure_power` and `meter_power` have no custom definitions;
- `meter_power` initializes to a number;
- pause/resume does not settle or double-count a session;
- one disconnect settles exactly once, including across repeated disconnected polls and an EnergyManager restart;
- monthly, yearly, and lifetime correction paths update the expected stores and capabilities;
- the generated `app.json`, full test suite, publish validation, and `git diff --check` succeed.
