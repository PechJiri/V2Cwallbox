'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const FlowCardManager = require('../drivers/v2c-wallbox/FlowCardManager');

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
