'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');

const FlowCardManager = require('../drivers/v2c-wallbox/FlowCardManager');
const DataValidator = require('../lib/DataValidator');
const CONSTANTS = require('../lib/constants');

function createFlowCardManagerHarness() {
    const listeners = new Map();
    const cards = new Map();
    const homey = {
        flow: {
            getDeviceTriggerCard: createCardGetter(cards, listeners),
            getConditionCard: createCardGetter(cards, listeners),
            getActionCard: createCardGetter(cards, listeners)
        }
    };

    return { homey, listeners };
}

function createCardGetter(cards, listeners) {
    return (id) => {
        if (!cards.has(id)) {
            cards.set(id, {
                listenerCount: () => listeners.has(id) ? 1 : 0,
                removeAllListeners: () => listeners.delete(id),
                registerRunListener: (listener) => listeners.set(id, listener),
                trigger: async () => true
            });
        }

        return cards.get(id);
    };
}

test('set_phase_mode flow action updates the device installation phase mode', async () => {
    const { homey, listeners } = createFlowCardManagerHarness();
    const calls = [];
    const device = {
        setInstallationPhaseMode: async (phaseMode) => {
            calls.push(phaseMode);
            return true;
        }
    };
    const manager = new FlowCardManager(homey, device);

    await manager.initialize();
    assert.equal(listeners.has('set_phase_mode'), true);

    const result = await listeners.get('set_phase_mode')({ phase_mode: '1' });

    assert.equal(result, true);
    assert.deepEqual(calls, ['1']);
});

test('set_phase_mode flow action restarts charging when switching phases during active charging', async () => {
    const { homey, listeners } = createFlowCardManagerHarness();
    const calls = [];
    const device = {
        getInternalChargeState: () => '2',
        getCapabilityValue: async (capabilityId) => {
            if (capabilityId === 'evcharger_charging') return true;
            return null;
        },
        v2cApi: {
            setParameter: async (parameter, value) => {
                calls.push(['setParameter', parameter, value]);
            }
        },
        setCapabilityValue: async (capabilityId, value) => {
            calls.push(['setCapabilityValue', capabilityId, value]);
        },
        setInstallationPhaseMode: async (phaseMode) => {
            calls.push(['setInstallationPhaseMode', phaseMode]);
            return true;
        }
    };
    const manager = new FlowCardManager(homey, device);

    await manager.initialize();

    const result = await listeners.get('set_phase_mode')({ phase_mode: '3' });

    assert.equal(result, true);
    assert.deepEqual(calls, [
        ['setParameter', 'Paused', '1'],
        ['setCapabilityValue', 'evcharger_charging', false],
        ['setInstallationPhaseMode', '3'],
        ['setParameter', 'Paused', '0'],
        ['setCapabilityValue', 'evcharger_charging', true]
    ]);
});

test('setInstallationPhaseMode stores the new phase and applies target power options', async () => {
    const MyDevice = loadDeviceWithHomeyStub();
    const calls = [];
    const device = Object.create(MyDevice.prototype);
    device.logger = {
        debug: () => {},
        warn: () => {},
        error: () => {}
    };
    device._settings = { phase_mode: '3' };
    device.getSettings = () => ({ ...device._settings });
    device.getSetting = (key) => device._settings[key];
    device.setSettings = async (settings) => {
        calls.push(['setSettings', settings]);
        Object.assign(device._settings, settings);
    };
    device.setCapabilityOptions = async (capabilityId, options) => {
        calls.push(['setCapabilityOptions', capabilityId, options]);
    };
    device.v2cApi = {
        setParameter: async (parameter, value) => {
            calls.push(['setParameter', parameter, value]);
        }
    };
    device.getProductionData = async () => {
        calls.push(['getProductionData']);
    };

    const result = await device.setInstallationPhaseMode('1');

    assert.equal(result, true);
    assert.deepEqual(calls[0], ['setSettings', { phase_mode: '1' }]);
    assert.deepEqual(calls[1], ['setParameter', 'ChargeMode', '0']);
    assert.equal(calls[2][0], 'setCapabilityOptions');
    assert.equal(calls[2][1], 'target_power');
    assert.equal(calls[2][2].max, 7360);
    assert.equal(calls[2][2].step, 230);
    assert.deepEqual(calls[3], ['getProductionData']);
});

test('phase_mode settings changes write the matching V2C ChargeMode', async () => {
    const MyDevice = loadDeviceWithHomeyStub();
    const calls = [];
    const device = Object.create(MyDevice.prototype);
    device.logger = {
        debug: () => {},
        warn: () => {},
        error: () => {}
    };
    device.homey = {
        settings: {
            set: (key, value) => calls.push(['homey.settings.set', key, value])
        }
    };
    device.getSetting = (key) => key === 'phase_mode' ? '1' : undefined;
    device.setCapabilityOptions = async (capabilityId, options) => {
        calls.push(['setCapabilityOptions', capabilityId, options]);
    };
    device.v2cApi = {
        setParameter: async (parameter, value) => {
            calls.push(['setParameter', parameter, value]);
        }
    };
    device.getProductionData = async () => {
        calls.push(['getProductionData']);
    };

    await device.onSettings({
        oldSettings: { phase_mode: '1' },
        newSettings: { phase_mode: '3' },
        changedKeys: ['phase_mode']
    });

    assert.deepEqual(calls[0], ['setParameter', 'ChargeMode', '1']);
    assert.equal(calls[1][0], 'setCapabilityOptions');
    assert.equal(calls[1][1], 'target_power');
    assert.equal(calls[1][2].max, 22080);
    assert.equal(calls[1][2].step, 690);
    assert.deepEqual(calls[2], ['homey.settings.set', 'phase_mode', '3']);
    assert.deepEqual(calls[3], ['getProductionData']);
});

test('set_led_brightness flow action writes display and logo brightness sequentially for both', async () => {
    const { homey, listeners } = createFlowCardManagerHarness();
    const calls = [];
    const device = {
        v2cApi: {
            setParameter: async (parameter, value) => {
                calls.push([parameter, value]);
            }
        }
    };
    const manager = new FlowCardManager(homey, device);

    await manager.initialize();
    assert.equal(listeners.has('set_led_brightness'), true);

    const result = await listeners.get('set_led_brightness')({
        led_target: 'both',
        brightness: 42
    });

    assert.equal(result, true);
    assert.deepEqual(calls, [
        ['LightLED', 42],
        ['LogoLED', 42]
    ]);
});

test('set_led_brightness flow action rejects brightness outside 0-100 percent', async () => {
    const { homey, listeners } = createFlowCardManagerHarness();
    const device = {
        v2cApi: {
            setParameter: async () => {}
        }
    };
    const manager = new FlowCardManager(homey, device);

    await manager.initialize();

    await assert.rejects(
        () => listeners.get('set_led_brightness')({
            led_target: 'logo',
            brightness: 101
        }),
        /brightness/
    );
});

test('setInstallationPhaseMode rejects unsupported phase modes', async () => {
    const MyDevice = loadDeviceWithHomeyStub();
    const device = Object.create(MyDevice.prototype);

    await assert.rejects(
        () => device.setInstallationPhaseMode('mixed'),
        /phase_mode/
    );
});

test('maps V2C per-phase current and voltage telemetry when available', () => {
    const validator = new DataValidator();

    const result = validator.validateAndProcessData({
        ChargeState: 2,
        ChargePower: 7100,
        ChargeEnergy: 12.3,
        Intensity: 16,
        FirmwareVersion: '2.5.0',
        VoltageInstallation: 230,
        SlaveError: 0,
        Paused: 0,
        Locked: 0,
        Dynamic: 0,
        DynamicPowerMode: 0,
        SignalStatus: 2,
        IntensityMeasure_L1: 15.9,
        IntensityMeasure_L2: 16.1,
        IntensityMeasure_L3: 16.0,
        VoltageMeasure_L1: 231.2,
        VoltageMeasure_L2: 229.8,
        VoltageMeasure_L3: 230.6
    });

    assert.equal(result.intensityL1, 15.9);
    assert.equal(result.intensityL2, 16.1);
    assert.equal(result.intensityL3, 16.0);
    assert.equal(result.voltageL1, 231.2);
    assert.equal(result.voltageL2, 229.8);
    assert.equal(result.voltageL3, 230.6);
});

test('keeps per-phase telemetry unset when an older V2C firmware does not report it', () => {
    const validator = new DataValidator();

    const result = validator.validateAndProcessData({
        ChargeState: 1,
        ChargePower: 0,
        ChargeEnergy: 0,
        Intensity: 6,
        FirmwareVersion: '2.4.0',
        VoltageInstallation: 230,
        SlaveError: 0,
        Paused: 0,
        Locked: 0,
        Dynamic: 0,
        DynamicPowerMode: 0,
        SignalStatus: 2
    });

    assert.equal(result.intensityL1, null);
    assert.equal(result.voltageL3, null);
});

test('set_installation_voltage flow action delegates a European installation voltage to the device', async () => {
    const { homey, listeners } = createFlowCardManagerHarness();
    const calls = [];
    const manager = new FlowCardManager(homey, {
        setInstallationVoltage: async (voltage) => {
            calls.push(voltage);
            return true;
        }
    });

    await manager.initialize();

    const result = await listeners.get('set_installation_voltage')({ voltage: 400 });

    assert.equal(result, true);
    assert.deepEqual(calls, [400]);
});

test('setInstallationVoltage writes a supported European nominal voltage and refreshes state', async () => {
    const MyDevice = loadDeviceWithHomeyStub();
    const calls = [];
    const device = Object.create(MyDevice.prototype);
    device.v2cApi = {
        setParameter: async (parameter, value) => calls.push([parameter, value])
    };
    device.getProductionData = async () => calls.push(['getProductionData']);
    device.logger = { debug: () => {} };

    const result = await device.setInstallationVoltage(400);

    assert.equal(result, true);
    assert.deepEqual(calls, [
        ['VoltageInstallation', 400],
        ['getProductionData']
    ]);

    await assert.rejects(() => device.setInstallationVoltage(300), /one of/);
    await assert.rejects(() => device.setInstallationVoltage(480.5), /integer/);
});

test('uses standard Homey phase metrics and the system meter_power capability for Energy', () => {
    const driverManifest = JSON.parse(fs.readFileSync(
        path.join(__dirname, '../drivers/v2c-wallbox/driver.compose.json'),
        'utf8'
    ));

    for (const capability of [
        'measure_current.l1', 'measure_current.l2', 'measure_current.l3',
        'measure_voltage.l1', 'measure_voltage.l2', 'measure_voltage.l3'
    ]) {
        assert.equal(CONSTANTS.DEVICE_CAPABILITIES.includes(capability), true);
        assert.equal(driverManifest.capabilities.includes(capability), true);
    }

    assert.equal(driverManifest.energy.evCharger, true);
    assert.equal(driverManifest.energy.meterPowerImportedCapability, 'meter_power');
    assert.equal(fs.existsSync(path.join(__dirname, '../.homeycompose/capabilities/meter_power.json')), false);
    assert.equal(driverManifest.capabilities.includes('evcharger_charging'), true);
    assert.equal(driverManifest.capabilities.includes('locked'), true);
});

test('set_installation_voltage flow only presents supported European nominal voltages', () => {
    const flowManifest = JSON.parse(fs.readFileSync(
        path.join(__dirname, '../drivers/v2c-wallbox/driver.flow.compose.json'),
        'utf8'
    ));
    const action = flowManifest.actions.find(({ id }) => id === 'set_installation_voltage');
    const voltage = action.args.find(({ name }) => name === 'voltage');

    assert.equal(voltage.type, 'dropdown');
    assert.deepEqual(voltage.values.map(({ id }) => id), ['220', '230', '240', '380', '400', '415']);
});

function loadDeviceWithHomeyStub() {
    const originalLoad = Module._load;
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === 'homey') {
            return { Device: class Device {} };
        }
        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        delete require.cache[require.resolve('../drivers/v2c-wallbox/device')];
        return require('../drivers/v2c-wallbox/device');
    } finally {
        Module._load = originalLoad;
    }
}
