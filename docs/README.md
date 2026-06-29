# V2C Wallbox App Documentation

This folder documents how the Homey app is wired, how the V2C device integration works, and which parts of the local HTTP API are currently used.

## Documents

- [Architecture](architecture.md) - runtime structure, driver/device lifecycle, polling, validation, and widget integration.
- [Homey Energy and Flows](homey-energy-and-flows.md) - how the app maps V2C data into Homey Energy capabilities and Flow cards.
- [HTTP API Coverage](http-api-coverage.md) - coverage matrix for the V2C local HTTP API from the supplied PDF and candidate future work.

## Primary Sources

- V2C local HTTP API PDF: `C:\Users\jirip\Downloads\V2C - Datamanager Modbus TCP & RTU - Disk Google.pdf`
- Homey SDK reference: <https://apps-sdk-v3.developer.homey.app/>
- Homey app documentation: <https://apps.developer.homey.app/>

## Current Implementation Entry Points

- App entry point: `app.js`
- Driver pairing and repair: `drivers/v2c-wallbox/driver.js`
- Device runtime: `drivers/v2c-wallbox/device.js`
- V2C HTTP client: `drivers/v2c-wallbox/api.js`
- Flow registration: `drivers/v2c-wallbox/FlowCardManager.js`
- Runtime constants: `lib/constants.js`
- Data normalization: `lib/DataValidator.js`
- Energy counters: `lib/EnergyManager.js`
- Widget API: `widgets/wallbox-status/api.js`
