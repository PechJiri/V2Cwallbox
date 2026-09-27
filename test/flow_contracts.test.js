'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');
const FlowCardManager = require('../drivers/v2c-wallbox/FlowCardManager');

function loadDeviceWithHomeyStub() {
    const originalLoad = Module._load;
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === 'homey') return { Device: class Device {} };
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        delete require.cache[require.resolve('../drivers/v2c-wallbox/device')];
        return require('../drivers/v2c-wallbox/device');
    } finally {
        Module._load = originalLoad;
    }
}

function createSelectedControlDevice({
    targetPower = 6000,
    failIntensity = false,
    targetPowerMode = 'homey',
    dynamicPowerMode = 'disabled',
    minIntensity = 6,
    maxIntensity = 32,
    reportedMinIntensity = minIntensity,
    reportedMaxIntensity = maxIntensity,
    voltageType = 'line_to_neutral',
    installationVoltage = '230',
    measureVoltage = 230
} = {}) {
    const MyDevice = loadDeviceWithHomeyStub();
    const device = Object.create(MyDevice.prototype);
    const calls = [];
    const capabilities = {
        target_power_mode: targetPowerMode,
        target_power: targetPower,
        evcharger_charging: false,
        min_intensity: reportedMinIntensity,
        max_intensity: reportedMaxIntensity,
        measure_voltage_installation: measureVoltage
    };
    const store = new Map();
    const settings = {
        phase_mode: '3',
        voltage_type: voltageType,
        installation_voltage: installationVoltage,
        dynamic_power_mode: dynamicPowerMode,
        min_intensity: minIntensity,
        max_intensity: maxIntensity
    };
    const capabilityOptions = [];
    device.getCapabilityValue = (id) => capabilities[id];
    device.setCapabilityValue = async (id, value) => {
        calls.push(['capability', id, value]);
        capabilities[id] = value;
    };
    device.getSetting = (id) => settings[id];
    device.getSettings = () => ({ ...settings });
    device.setSettings = async (values) => Object.assign(settings, values);
    device.setCapabilityOptions = async (id, options) => {
        capabilityOptions.push([id, options]);
        calls.push(['capabilityOptions', id, options]);
    };
    device.logger = { debug: () => {}, warn: () => {} };
    device.getStoreValue = async (key) => store.get(key);
    device.setStoreValue = async (key, value) => {
        calls.push(['store', key, value]);
        store.set(key, value);
    };
    device.v2cApi = {
        setParameter: async (parameter, value) => calls.push(['parameter', parameter, value]),
        setIntensity: async (value) => {
            calls.push(['intensity', value]);
            if (failIntensity) throw new Error('Intensity write failed');
        },
        setDynamic: async (value) => calls.push(['dynamic', value]),
        setDynamicPowerMode: async (value) => calls.push(['dynamicPowerMode', value]),
        setMinIntensity: async (value) => calls.push(['minIntensity', value]),
        setMaxIntensity: async (value) => calls.push(['maxIntensity', value])
    };
    return { device, calls, capabilities, settings, capabilityOptions };
}

function createFlowHarness() {
    const cards = new Map();
    const listeners = new Map();
    const registrations = new Map();
    const getter = (id) => {
        if (!cards.has(id)) {
            cards.set(id, {
                listenerCount: () => listeners.has(id) ? 1 : 0,
                removeAllListeners: () => listeners.delete(id),
                registerRunListener: (listener) => {
                    registrations.set(id, (registrations.get(id) || 0) + 1);
                    listeners.set(id, listener);
                },
                trigger: async () => true
            });
        }
        return cards.get(id);
    };
    return {
        homey: { flow: { getDeviceTriggerCard: getter, getConditionCard: getter, getActionCard: getter } },
        listeners,
        registrations
    };
}

test('Flow pause action routes through the selected args.device control API', async () => {
    const { homey, listeners } = createFlowHarness();
    const calls = [];
    const decoy = {
        v2cApi: { setParameter: async (...args) => calls.push(['decoy-api', ...args]) },
        setCapabilityValue: async (...args) => calls.push(['decoy-capability', ...args])
    };
    const selected = { setChargingPaused: async (paused) => calls.push(['selected', paused]) };
    const manager = new FlowCardManager(homey, decoy);
    await manager.initialize();

    await listeners.get('set_paused')({ paused: '1', device: selected });

    assert.deepEqual(calls, [['selected', true]]);
});

test('Flow manual Resume restores retained current with a zero Homey target', async () => {
    const { homey, listeners } = createFlowHarness();
    const selected = createSelectedControlDevice({ targetPower: 0 });
    selected.capabilities.measure_intensity = 16;
    const manager = new FlowCardManager(homey, {});
    await manager.initialize();

    await listeners.get('set_paused')({ paused: '0', device: selected.device });

    assert.deepEqual(selected.calls.filter((call) => call[0] === 'parameter'), [['parameter', 'Paused', '0']]);
    assert.equal(selected.calls.some((call) => call[0] === 'intensity'), false);
    assert.equal(selected.capabilities.target_power, 0);
    assert.equal(selected.capabilities.target_power_mode, 'homey');
    assert.equal(selected.capabilities.measure_intensity, 16);
    assert.equal(selected.capabilities.evcharger_charging, true);
});

test('Flow manual Resume propagates a Paused write failure without reporting charging', async () => {
    const { homey, listeners } = createFlowHarness();
    const selected = createSelectedControlDevice();
    selected.device.v2cApi.setParameter = async (parameter, value) => {
        selected.calls.push(['parameter', parameter, value]);
        if (parameter === 'Paused' && value === '0') throw new Error('Resume parameter write failed');
    };
    const manager = new FlowCardManager(homey, {});
    await manager.initialize();

    await assert.rejects(
        () => listeners.get('set_paused')({ paused: '0', device: selected.device }),
        /Resume parameter write failed/
    );
    assert.equal(selected.calls.some((call) => call[0] === 'parameter' && call[1] === 'Paused' && call[2] === '0'), true);
    assert.equal(selected.calls.some((call) => call[0] === 'intensity'), false);
    assert.equal(selected.calls.some((call) => call[0] === 'capability' && call[1] === 'evcharger_charging' && call[2] === true), false);
    assert.equal(selected.capabilities.evcharger_charging, false);
});

test('power threshold conditions use the Flow power argument and selected device', async () => {
    const { homey, listeners } = createFlowHarness();
    let selectedPower = 2000;
    const decoy = { getCapabilityValue: async () => 1000 };
    const selected = { getCapabilityValue: async () => selectedPower };
    const manager = new FlowCardManager(homey, decoy);
    await manager.initialize();

    assert.equal(await listeners.get('power-greater-than')({ power: 1500, device: selected }), true);
    selectedPower = 1000;
    assert.equal(await listeners.get('power-less-than')({ power: 1500, device: selected }), true);
});

test('set_power keeps explicit calculator inputs and writes Intensity on args.device', async () => {
    const { homey, listeners } = createFlowHarness();
    const calls = [];
    const decoy = { v2cApi: { setParameter: async (...args) => calls.push(['decoy', ...args]) } };
    const selected = { setChargingIntensity: async (amps) => calls.push(['selected', amps]) };
    const manager = new FlowCardManager(homey, decoy);
    await manager.initialize();

    const result = await listeners.get('set_power')({
        power: 6000,
        phase_mode: '1',
        voltage: 230,
        voltage_type: 'line_to_neutral',
        maxAmps: 32,
        rounding: 'floor',
        device: selected
    });

    assert.deepEqual(result, { calculated_current: 26 });
    assert.deepEqual(calls, [['selected', 26]]);
});

test('Flow set_dynamic applies the selected V2C strategy and hands ownership back', async () => {
    const { homey, listeners } = createFlowHarness();
    const selected = createSelectedControlDevice({ targetPower: 0 });
    const decoy = createSelectedControlDevice({ targetPower: 0 });
    const manager = new FlowCardManager(homey, decoy.device);
    await manager.initialize();

    await listeners.get('set_dynamic')({ dynamic: '1', device: selected.device });

    assert.deepEqual(selected.calls.filter((call) => call[0] === 'dynamic' || call[0] === 'dynamicPowerMode'), [
        ['dynamic', '1'],
        ['dynamicPowerMode', '0']
    ]);
    assert.equal(selected.settings.dynamic_power_mode, '0');
    assert.equal(selected.capabilities.target_power_mode, 'v2c_timed_on');
    assert.equal(selected.capabilities.target_power, 0);
    assert.deepEqual(decoy.calls, []);
});

test('Flow set_dynamic disables V2C and restores Homey ownership on args.device', async () => {
    const { homey, listeners } = createFlowHarness();
    const selected = createSelectedControlDevice({
        targetPower: 0,
        targetPowerMode: 'v2c_grid_fv',
        dynamicPowerMode: '4'
    });
    const decoy = createSelectedControlDevice({ targetPower: 0 });
    const manager = new FlowCardManager(homey, decoy.device);
    await manager.initialize();

    await listeners.get('set_dynamic')({ dynamic: '0', device: selected.device });

    assert.deepEqual(selected.calls.filter((call) => call[0] === 'dynamic'), [['dynamic', '0']]);
    assert.equal(selected.settings.dynamic_power_mode, 'disabled');
    assert.equal(selected.capabilities.target_power_mode, 'homey');
    assert.deepEqual(decoy.calls, []);
});

test('Flow set_dynamic_power_mode applies and synchronizes the selected V2C mode', async () => {
    const { homey, listeners } = createFlowHarness();
    const selected = createSelectedControlDevice({ targetPower: 0 });
    const decoy = createSelectedControlDevice({ targetPower: 0 });
    const manager = new FlowCardManager(homey, decoy.device);
    await manager.initialize();

    await listeners.get('set_dynamic_power_mode')({ DynamicPowerMode: '3', device: selected.device });

    assert.deepEqual(selected.calls.filter((call) => call[0] === 'dynamic' || call[0] === 'dynamicPowerMode'), [
        ['dynamic', '1'],
        ['dynamicPowerMode', '3']
    ]);
    assert.equal(selected.settings.dynamic_power_mode, '3');
    assert.equal(selected.capabilities.target_power_mode, 'v2c_fv_min');
    assert.deepEqual(decoy.calls, []);
});

test('Flow min-intensity limit applies V2C and uses the effective bounds in target_power options', async () => {
    const { homey, listeners } = createFlowHarness();
    const selected = createSelectedControlDevice({
        targetPower: 0,
        maxIntensity: 32,
        reportedMaxIntensity: 28
    });
    const decoy = createSelectedControlDevice({ targetPower: 0 });
    const manager = new FlowCardManager(homey, decoy.device);
    await manager.initialize();

    await listeners.get('set_min_intensity')({ MinIntensity: 8, device: selected.device });

    assert.deepEqual(selected.calls.filter((call) => call[0] === 'minIntensity'), [['minIntensity', 8]]);
    assert.equal(selected.settings.min_intensity, 8);
    assert.equal(selected.capabilities.min_intensity, 8);
    assert.deepEqual(selected.capabilityOptions, [['target_power', {
        min: 0, max: 19320, step: 690, excludeMin: 0, excludeMax: 5520, decimals: 0
    }]]);
    assert.deepEqual(decoy.calls, []);
});

test('Flow max-intensity limit applies V2C and uses the effective bounds in target_power options', async () => {
    const { homey, listeners } = createFlowHarness();
    const selected = createSelectedControlDevice({
        targetPower: 0,
        minIntensity: 8,
        reportedMinIntensity: 10
    });
    const decoy = createSelectedControlDevice({ targetPower: 0 });
    const manager = new FlowCardManager(homey, decoy.device);
    await manager.initialize();

    await listeners.get('set_max_intensity')({ MaxIntensity: 24, device: selected.device });

    assert.deepEqual(selected.calls.filter((call) => call[0] === 'maxIntensity'), [['maxIntensity', 24]]);
    assert.equal(selected.settings.max_intensity, 24);
    assert.equal(selected.capabilities.max_intensity, 24);
    assert.deepEqual(selected.capabilityOptions, [['target_power', {
        min: 0, max: 16560, step: 690, excludeMin: 0, excludeMax: 6900, decimals: 0
    }]]);
    assert.deepEqual(decoy.calls, []);
});

test('target_power options use the selected configured line-to-line installation voltage', async () => {
    const { homey, listeners } = createFlowHarness();
    const selected = createSelectedControlDevice({
        targetPower: 0,
        voltageType: 'line_to_line',
        installationVoltage: '415',
        measureVoltage: 0
    });
    const manager = new FlowCardManager(homey, {});
    await manager.initialize();

    await listeners.get('set_max_intensity')({ MaxIntensity: 24, device: selected.device });

    assert.deepEqual(selected.capabilityOptions, [['target_power', {
        min: 0, max: 17256, step: 719, excludeMin: 0, excludeMax: 4313, decimals: 0
    }]]);

    await selected.device.applyChargingChanges({ target_power: 17256 });
    assert.deepEqual(selected.calls.filter((call) => call[0] === 'intensity'), [['intensity', 24]]);
});

test('Homey target just below configured minimum watts leaves charging paused', async () => {
    const selected = createSelectedControlDevice({
        targetPower: 0,
        voltageType: 'line_to_line',
        installationVoltage: '415',
        measureVoltage: 0
    });

    await selected.device.applyChargingChanges({ target_power: 4312 });

    assert.equal(selected.calls.some((call) => call[0] === 'intensity'), false);
    assert.deepEqual(selected.calls.filter((call) => call[0] === 'parameter' && call[1] === 'Paused'), [
        ['parameter', 'Paused', '1']
    ]);
});

test('Flow dynamic mode write failure propagates without claiming new ownership', async () => {
    const { homey, listeners } = createFlowHarness();
    const selected = createSelectedControlDevice({ targetPower: 0 });
    const manager = new FlowCardManager(homey, {});
    await manager.initialize();
    selected.device.v2cApi.setDynamicPowerMode = async (value) => {
        selected.calls.push(['dynamicPowerMode', value]);
        throw new Error('DynamicPowerMode write failed');
    };

    await assert.rejects(
        () => listeners.get('set_dynamic_power_mode')({ DynamicPowerMode: '5', device: selected.device }),
        /DynamicPowerMode write failed/
    );
    assert.equal(selected.settings.dynamic_power_mode, 'disabled');
    assert.equal(selected.capabilities.target_power_mode, 'homey');
});

test('Flow intensity-limit write failure leaves settings, capability, and options unchanged', async () => {
    const { homey, listeners } = createFlowHarness();
    const selected = createSelectedControlDevice({ targetPower: 0 });
    const manager = new FlowCardManager(homey, {});
    await manager.initialize();
    selected.device.v2cApi.setMaxIntensity = async (value) => {
        selected.calls.push(['maxIntensity', value]);
        throw new Error('MaxIntensity write failed');
    };

    await assert.rejects(
        () => listeners.get('set_max_intensity')({ MaxIntensity: 24, device: selected.device }),
        /MaxIntensity write failed/
    );
    assert.equal(selected.settings.max_intensity, 32);
    assert.equal(selected.capabilities.max_intensity, 32);
    assert.deepEqual(selected.capabilityOptions, []);
});

test('phase change pause, setting, and resume all use args.device', async () => {
    const { homey, listeners } = createFlowHarness();
    const calls = [];
    const decoy = {
        getInternalChargeState: () => '0',
        setInstallationPhaseMode: async () => calls.push(['decoy-phase'])
    };
    const selected = {
        getInternalChargeState: () => '2',
        getCapabilityValue: async () => true,
        setChargingPaused: async (paused) => calls.push(['selected-pause', paused]),
        setInstallationPhaseMode: async (phase) => calls.push(['selected-phase', phase])
    };
    const manager = new FlowCardManager(homey, decoy);
    await manager.initialize();

    await listeners.get('set_phase_mode')({ phase_mode: '1', device: selected });

    assert.deepEqual(calls, [
        ['selected-pause', true],
        ['selected-phase', '1'],
        ['selected-pause', false]
    ]);
});

test('independent Flow calculators use only explicit inputs and perform no device IO', async () => {
    const { homey, listeners } = createFlowHarness();
    const failForIo = () => { throw new Error('calculator touched the device'); };
    const manager = new FlowCardManager(homey, {
        getCapabilityValue: failForIo,
        v2cApi: { setParameter: failForIo }
    });
    await manager.initialize();
    const selected = { getCapabilityValue: failForIo, v2cApi: { setParameter: failForIo } };

    assert.deepEqual(await listeners.get('calculate_power_with_buffer')({
        power: 2300,
        buffer_power: 0,
        phase_mode: '1',
        voltage: 230,
        voltage_type: 'line_to_neutral',
        maxAmps: 32,
        rounding: 'floor',
        device: selected
    }), { calculated_current: 10 });
    assert.equal(await listeners.get('compare_calculated_current')({
        current_input: '12', current: '10', operator: 'greater', device: selected
    }), true);
});

test('two devices share one Flow listener registration without binding the first device', async () => {
    const { homey, listeners, registrations } = createFlowHarness();
    const first = { setChargingPaused: async () => {} };
    const second = { setChargingPaused: async () => {} };

    await new FlowCardManager(homey, first).initialize();
    await new FlowCardManager(homey, second).initialize();
    await listeners.get('set_paused')({ paused: '1', device: second });

    assert.equal(registrations.get('set_paused'), 1);
});
