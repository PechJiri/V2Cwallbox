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

function createSelectedControlDevice({ targetPower = 6000, failIntensity = false } = {}) {
    const MyDevice = loadDeviceWithHomeyStub();
    const device = Object.create(MyDevice.prototype);
    const calls = [];
    const capabilities = {
        target_power_mode: 'homey',
        target_power: targetPower,
        evcharger_charging: false,
        min_intensity: 6,
        max_intensity: 32,
        measure_voltage_installation: 230
    };
    const store = new Map();
    const settings = {
        phase_mode: '3',
        voltage_type: 'line_to_neutral',
        installation_voltage: '230',
        min_intensity: 6,
        max_intensity: 32
    };
    device.getCapabilityValue = (id) => capabilities[id];
    device.setCapabilityValue = async (id, value) => {
        calls.push(['capability', id, value]);
        capabilities[id] = value;
    };
    device.getSetting = (id) => settings[id];
    device.getSettings = () => ({ ...settings });
    device.setSettings = async (values) => Object.assign(settings, values);
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
    return { device, calls, capabilities };
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

test('Flow manual resume applies the selected Homey target current before Paused=0', async () => {
    const { homey, listeners } = createFlowHarness();
    const selected = createSelectedControlDevice();
    const manager = new FlowCardManager(homey, {});
    await manager.initialize();

    await listeners.get('set_paused')({ paused: '0', device: selected.device });

    const intensityIndex = selected.calls.findIndex((call) => call[0] === 'intensity');
    const resumeIndex = selected.calls.findIndex((call) => call[0] === 'parameter' && call[1] === 'Paused' && call[2] === '0');
    assert.ok(intensityIndex >= 0, 'Flow resume must apply the accepted Homey target');
    assert.ok(resumeIndex > intensityIndex, 'Flow must wait for Intensity before unpausing');
});

test('Flow manual resume propagates an Intensity failure without unpausing', async () => {
    const { homey, listeners } = createFlowHarness();
    const selected = createSelectedControlDevice({ failIntensity: true });
    const manager = new FlowCardManager(homey, {});
    await manager.initialize();

    await assert.rejects(
        () => listeners.get('set_paused')({ paused: '0', device: selected.device }),
        /Intensity write failed/
    );
    assert.equal(selected.calls.some((call) => call[0] === 'parameter' && call[1] === 'Paused' && call[2] === '0'), false);
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

test('dynamic and intensity-limit setting actions update args.device', async () => {
    const { homey, listeners } = createFlowHarness();
    const decoyWrites = [];
    const selectedWrites = [];
    const decoy = {
        getSettings: () => ({ dynamic_power_mode: 'disabled' }),
        setSettings: async (values) => decoyWrites.push(values)
    };
    const selected = {
        getSettings: () => ({ dynamic_power_mode: '4' }),
        setSettings: async (values) => selectedWrites.push(values)
    };
    const manager = new FlowCardManager(homey, decoy);
    await manager.initialize();

    await listeners.get('set_dynamic_power_mode')({ DynamicPowerMode: '5', device: selected });
    await listeners.get('set_min_intensity')({ MinIntensity: 8, device: selected });
    await listeners.get('set_max_intensity')({ MaxIntensity: 24, device: selected });

    assert.deepEqual(selectedWrites, [
        { dynamic_power_mode: '5' },
        { min_intensity: 8 },
        { max_intensity: 24 }
    ]);
    assert.deepEqual(decoyWrites, []);
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
