'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const DataValidator = require('../lib/DataValidator');
const EnergyManager = require('../lib/EnergyManager');
const FlowCardManager = require('../drivers/v2c-wallbox/FlowCardManager');
const { v2cAPI } = require('../drivers/v2c-wallbox/api');
const CONSTANTS = require('../lib/constants');

function validPayload(overrides = {}) {
    return {
        ChargeState: 0,
        ChargePower: 0,
        ChargeEnergy: 0,
        Intensity: 6,
        Paused: 0,
        Locked: 0,
        Dynamic: 0,
        DynamicPowerMode: 5,
        Timer: 0,
        MinIntensity: 6,
        MaxIntensity: 32,
        ...overrides
    };
}

test('accepts a complete payload without optional FirmwareVersion', () => {
    const processed = new DataValidator().validateAndProcessData(validPayload());

    assert.ok(processed);
    assert.equal(processed.firmwareVersion, null);
});

test('keeps absent optional telemetry unknown instead of reporting zero or low signal', () => {
    const processed = new DataValidator().validateAndProcessData(validPayload({
        FirmwareVersion: '2.5.1'
    }));

    assert.ok(processed);
    assert.equal(processed.housePower, null);
    assert.equal(processed.fvPower, null);
    assert.equal(processed.batteryPower, null);
    assert.equal(processed.signalStatus, null);
});

test('parses the explicit boolean string false as false', () => {
    const processed = new DataValidator().validateAndProcessData(validPayload({
        FirmwareVersion: '2.5.1',
        Dynamic: 'false'
    }));

    assert.ok(processed);
    assert.equal(processed.dynamic, false);
});

test('rejects missing or nonfinite required charge telemetry', () => {
    const validator = new DataValidator();
    const invalidValues = [undefined, null, '', 'invalid', Number.NaN, Number.POSITIVE_INFINITY];

    for (const field of ['ChargePower', 'ChargeEnergy', 'Intensity']) {
        for (const value of invalidValues) {
            assert.equal(
                validator.validateAndProcessData(validPayload({
                    FirmwareVersion: '2.5.1',
                    [field]: value
                })),
                null,
                `${field}=${String(value)} must invalidate the snapshot`
            );
        }
    }
});

test('accepts finite 415 V and 23040 W telemetry for the supported installation', () => {
    const processed = new DataValidator().validateAndProcessData(validPayload({
        FirmwareVersion: '2.5.1',
        ChargeState: 2,
        ChargePower: 23040,
        Intensity: 32,
        VoltageInstallation: 415
    }));

    assert.ok(processed);
    assert.equal(processed.chargePower, 23040);
    assert.equal(processed.voltageInstallation, 415);
});

test('rejects unexpected boolean strings instead of converting them to true or false', () => {
    const validator = new DataValidator();

    for (const [field, value] of [
        ['Paused', 'yes'], ['Locked', '2'], ['Dynamic', 'unknown'], ['Timer', 'enabled']
    ]) {
        assert.equal(
            validator.validateAndProcessData(validPayload({
                FirmwareVersion: '2.5.1',
                [field]: value
            })),
            null,
            `${field}=${value} must invalidate the snapshot`
        );
    }
});

test('a missing Dynamic value is not silently treated as Homey ownership', () => {
    assert.equal(new DataValidator().validateAndProcessData(validPayload({
        FirmwareVersion: '2.5.1',
        Dynamic: undefined
    })), null);
});

test('preserves documented primary fault states and rejects undefined state 3', () => {
    const validator = new DataValidator();

    for (const state of [4, 5, 6]) {
        const processed = validator.validateAndProcessData(validPayload({
            FirmwareVersion: '2.5.1',
            ChargeState: state
        }));
        assert.ok(processed, `state ${state} is a documented primary fault`);
        assert.equal(processed.chargeState, String(state));
    }

    assert.equal(validator.validateAndProcessData(validPayload({
        FirmwareVersion: '2.5.1',
        ChargeState: 3
    })), null);
});

test('keeps phase readings null when absent and preserves actual zero values', () => {
    const validator = new DataValidator();
    const absent = validator.validateAndProcessData(validPayload({ FirmwareVersion: '2.5.1' }));
    const zero = validator.validateAndProcessData(validPayload({
        FirmwareVersion: '2.5.1',
        IntensityMeasure_L1: 0,
        VoltageMeasure_L1: 0
    }));

    assert.equal(absent.intensityL1, null);
    assert.equal(absent.voltageL1, null);
    assert.equal(zero.intensityL1, 0);
    assert.equal(zero.voltageL1, 0);
});

test('rejects HTTP 503 before reading a JSON body and counts an API failure', async () => {
    const api = new v2cAPI(createHomeyLoggerStub(), '10.0.0.20');
    let jsonCalls = 0;

    await replaceGlobalFetch(async () => ({
        ok: false,
        status: 503,
        json: async () => {
            jsonCalls++;
            return validPayload({ FirmwareVersion: '2.5.1' });
        }
    }), async () => {
        await assert.rejects(() => api.getData(), /503/);
    });

    assert.equal(jsonCalls, 0);
    assert.equal(api.getErrorCount(), 1);
});

test('malformed HTTP 200 data increments errors instead of resetting previous failures', async () => {
    const api = new v2cAPI(createHomeyLoggerStub(), '10.0.0.20');
    api._apiErrorCount = 2;

    await replaceGlobalFetch(async () => ({
        ok: true,
        status: 200,
        json: async () => validPayload({
            FirmwareVersion: '2.5.1',
            ChargeEnergy: Number.NaN
        })
    }), async () => {
        await assert.rejects(() => api.getData(), /invalid|snapshot|data/i);
    });

    assert.equal(api.getErrorCount(), 3);
});

test('session probes use the same serialized queue and 150 ms spacing as polls', async () => {
    const api = new v2cAPI(createHomeyLoggerStub(), '10.0.0.20');
    let inFlight = 0;
    let maximumInFlight = 0;
    const requestStarts = [];

    await replaceGlobalFetch(async () => {
        requestStarts.push(Date.now());
        inFlight++;
        maximumInFlight = Math.max(maximumInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 10));
        inFlight--;
        return {
            ok: true,
            status: 200,
            json: async () => validPayload({ FirmwareVersion: '2.5.1' })
        };
    }, async () => {
        await Promise.all([api.initializeSession(), api.getData()]);
    });

    assert.equal(maximumInFlight, 1);
    assert.ok(Math.abs(requestStarts[1] - requestStarts[0]) >= 140);
});

test('fault snapshots publish raw state and alarm without replacing the native EV state', async () => {
    const MyDevice = loadDeviceWithHomeyStub();
    const descriptions = [];

    for (const state of [4, 5, 6]) {
        const { device, values } = createDeviceHarness(MyDevice, {
            evcharger_charging_state: 'plugged_in_charging'
        });
        const deviceData = new DataValidator().validateAndProcessData(validPayload({
            FirmwareVersion: '2.5.1',
            ChargeState: state,
            ChargeEnergy: 1.25
        }));

        await device.updateCapabilities(deviceData, deviceData.chargeState, deviceData.chargeEnergy);

        assert.equal(values.get('measure_charge_state'), String(state));
        assert.equal(values.get('alarm_generic'), true);
        assert.equal(values.get('evcharger_charging_state'), 'plugged_in_charging');
        const descriptor = device.getFaultDescriptor();
        assert.equal(descriptor.state, state);
        assert.equal(typeof descriptor.description, 'string');
        assert.ok(descriptor.description.length > 0);
        descriptions.push(descriptor.description);
    }

    assert.equal(new Set(descriptions).size, 3);
});

test('SlaveError 05 stays an inverter diagnostic in Homey mode with a paused zero-power EV', async () => {
    const MyDevice = loadDeviceWithHomeyStub();
    const { device, values } = createDeviceHarness(MyDevice, {
        measure_connection_error: false,
        alarm_generic: false
    });
    const deviceData = new DataValidator().validateAndProcessData(validPayload({
        FirmwareVersion: '2.5.1',
        ChargeState: 2,
        ChargePower: 0,
        ChargeEnergy: 0.06,
        Paused: 1,
        Dynamic: 0,
        SlaveError: 5
    }));

    await device.updateCapabilities(deviceData, deviceData.chargeState, deviceData.chargeEnergy);

    assert.equal(values.get('target_power_mode'), CONSTANTS.TARGET_POWER_MODES.HOMEY);
    assert.equal(values.get('measure_slave_error'), '05');
    assert.equal(values.get('evcharger_charging'), false);
    assert.equal(values.get('measure_power'), 0);
    assert.equal(values.get('measure_connection_error'), false);
    assert.equal(values.get('alarm_generic'), false);
    assert.equal(device.getFaultDescriptor(), null);
});

test('SlaveError labels match the diagnostic enum and its title describes communication state', () => {
    const slaveErrorCapability = JSON.parse(fs.readFileSync(
        path.join(__dirname, '../.homeycompose/capabilities/measure_slave_error.json'),
        'utf8'
    ));

    assert.equal(slaveErrorCapability.title.en, 'Inverter communication state');
    assert.equal(slaveErrorCapability.title.cs, 'Stav komunikace s měničem');
    for (const { id, title } of slaveErrorCapability.values) {
        assert.equal(CONSTANTS.SLAVE_ERROR_DESCRIPTIONS[id], title.en, `SlaveError ${id}`);
    }
});

test('a first primary fault with stale energy cannot create a session settled by a later state 0', async () => {
    const values = new Map([['measure_charge_energy', 0]]);
    const store = new Map();
    const device = {
        getCapabilityValue: async (capability) => values.get(capability),
        setCapabilityValue: async (capability, value) => values.set(capability, value),
        getStoreValue: async (key) => store.get(key),
        setStoreValue: async (key, value) => store.set(key, value)
    };
    const energy = new EnergyManager(device, { debug: () => {}, error: () => {}, warn: () => {} });
    const deviceData = new DataValidator().validateAndProcessData(validPayload({
        FirmwareVersion: '2.5.1',
        ChargeState: 4,
        ChargeEnergy: 8
    }));

    await energy.processEnergyData(deviceData, '0', deviceData.chargeState);
    assert.equal(energy.pendingSessionEnergy, 0);
    assert.equal(store.has('energySettlementTransaction'), false);

    await energy.processEnergyData({ ...deviceData, chargeEnergy: 0 }, '4', '0');
    assert.equal(energy.pendingSessionEnergy, 0);
    assert.equal(store.has('energySettlementTransaction'), false);
});

test('declares only documented primary state IDs and migrates fault capabilities safely', async () => {
    const chargeStateCapability = JSON.parse(fs.readFileSync(
        path.join(__dirname, '../.homeycompose/capabilities/measure_charge_state.json'),
        'utf8'
    ));
    assert.deepEqual(chargeStateCapability.values.map(({ id }) => id), ['0', '1', '2', '4', '5', '6']);

    const driverCompose = JSON.parse(fs.readFileSync(
        path.join(__dirname, '../drivers/v2c-wallbox/driver.compose.json'),
        'utf8'
    ));
    assert.ok(driverCompose.capabilities.includes('measure_charge_state'));
    assert.ok(driverCompose.capabilities.includes('alarm_generic'));
    assert.ok(CONSTANTS.DEVICE_CAPABILITIES.includes('measure_charge_state'));
    assert.ok(CONSTANTS.DEVICE_CAPABILITIES.includes('alarm_generic'));

    const MyDevice = loadDeviceWithHomeyStub();
    const added = [];
    const written = [];
    const device = Object.create(MyDevice.prototype);
    device.logger = { debug: () => {}, warn: () => {} };
    device.hasCapability = (capability) => !['measure_charge_state', 'alarm_generic'].includes(capability);
    device.addCapability = async (capability) => added.push(capability);
    device.setCapabilityValue = async (...args) => written.push(args);

    await device.initializeCapabilities();

    assert.ok(added.includes('measure_charge_state'));
    assert.ok(added.includes('alarm_generic'));
    assert.deepEqual(written, []);
});

test('a missing live installation voltage becomes unknown and uses the configured nominal', async () => {
    const MyDevice = loadDeviceWithHomeyStub();
    const scenarios = [
        { voltage_type: 'line_to_neutral', installation_voltage: '240', prior: 230, expected: 240 },
        { voltage_type: 'line_to_line', installation_voltage: '415', prior: 400, expected: 415 }
    ];

    for (const scenario of scenarios) {
        const { device, values, settings } = createDeviceHarness(MyDevice, {
            measure_voltage_installation: scenario.prior
        });
        Object.assign(settings, scenario);
        const deviceData = new DataValidator().validateAndProcessData(validPayload({
            FirmwareVersion: '2.5.1',
            VoltageInstallation: 0
        }));

        await device.updateCapabilities(deviceData, deviceData.chargeState, deviceData.chargeEnergy);

        assert.equal(values.has('measure_voltage_installation'), false);
        assert.equal(device.getChargingVoltage(), scenario.expected);
    }
});

test('absent optional phase readings clear prior values instead of leaving stale measurements', async () => {
    const MyDevice = loadDeviceWithHomeyStub();
    const { device, values } = createDeviceHarness(MyDevice, {
        'measure_current.l1': 16,
        'measure_voltage.l1': 231
    });
    const deviceData = new DataValidator().validateAndProcessData(validPayload({ FirmwareVersion: '2.5.1' }));

    await device.updateCapabilities(deviceData, deviceData.chargeState, deviceData.chargeEnergy);

    assert.equal(values.has('measure_current.l1'), false);
    assert.equal(values.has('measure_voltage.l1'), false);
});

test('the existing slave-error Flow trigger exposes separate code and description tokens', async () => {
    const manifest = JSON.parse(fs.readFileSync(
        path.join(__dirname, '../drivers/v2c-wallbox/driver.flow.compose.json'),
        'utf8'
    ));
    const trigger = manifest.triggers.find(({ id }) => id === 'slave_error_changed');
    assert.ok(trigger);
    assert.deepEqual(trigger.tokens.map(({ name, type }) => [name, type]), [
        ['error_code', 'string'],
        ['error_description', 'string']
    ]);

    const calls = [];
    const manager = new FlowCardManager({}, { id: 'wallbox' });
    manager._flowCards.triggers.set('slave_error_changed', {
        trigger: async (...args) => calls.push(args)
    });

    await manager.triggerSlaveErrorChanged('05');

    assert.deepEqual(calls[0][1], {
        error_code: '05',
        error_description: 'Waiting communication'
    });
});

function createDeviceHarness(MyDevice, initialValues = {}) {
    const values = new Map(Object.entries({ target_power: 5000, ...initialValues }));
    const settings = { phase_mode: '3', voltage_type: 'line_to_neutral', installation_voltage: '230' };
    const device = Object.create(MyDevice.prototype);
    device.logger = { debug: () => {}, warn: () => {}, error: () => {} };
    device.energyManager = { getLifetimeEnergy: () => 0 };
    device.getSetting = (key) => settings[key];
    device.getCapabilityValue = (capability) => values.get(capability);
    device.hasCapability = () => true;
    device.setCapabilityValue = async (capability, value) => values.set(capability, value);
    device.unsetCapabilityValue = async (capability) => values.delete(capability);
    device._lastChargeState = CONSTANTS.CHARGE_STATES.DISCONNECTED;
    return { device, values, settings };
}

function loadDeviceWithHomeyStub() {
    const originalLoad = Module._load;
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === 'homey') return { Device: class Device {} };
        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        const devicePath = require.resolve('../drivers/v2c-wallbox/device');
        delete require.cache[devicePath];
        return require(devicePath);
    } finally {
        Module._load = originalLoad;
    }
}

function createHomeyLoggerStub() {
    return { log: () => {}, error: () => {} };
}

function replaceGlobalFetch(fetchImpl, run) {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    return Promise.resolve()
        .then(run)
        .finally(() => {
            globalThis.fetch = originalFetch;
        });
}
