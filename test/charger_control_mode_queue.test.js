'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const ChargerControl = require('../lib/ChargerControl');

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

function holdFirstDynamicWrite(device, calls) {
    const started = deferred();
    const finish = deferred();
    let blockFirst = true;
    device.v2cApi.setDynamic = async (value) => {
        calls.push(['dynamic', value]);
        if (blockFirst) {
            blockFirst = false;
            started.resolve();
            await finish.promise;
        }
    };
    return { started: started.promise, finish: finish.resolve };
}

function createController() {
    const calls = [];
    const capabilities = {
        target_power_mode: 'homey',
        target_power: 6000,
        evcharger_charging: true
    };
    const store = new Map();
    const device = {
        v2cApi: {
            setDynamic: async (value) => calls.push(['dynamic', value]),
            setDynamicPowerMode: async (value) => calls.push(['dynamicPowerMode', value]),
            setParameter: async (parameter, value) => calls.push(['parameter', parameter, value])
        },
        getCapabilityValue: (id) => capabilities[id],
        setCapabilityValue: async (id, value) => {
            calls.push(['capability', id, value]);
            capabilities[id] = value;
        },
        getStoreValue: async (key) => store.get(key),
        setStoreValue: async (key, value) => store.set(key, value)
    };

    return { controller: new ChargerControl(device), device, calls, capabilities };
}

test('pending Homey mode-only updates keep the active write and only apply the newest queued mode', async () => {
    const { controller, device, calls } = createController();
    const activeDynamic = holdFirstDynamicWrite(device, calls);

    const activeMode = controller.applyChargingChanges({ target_power_mode: 'v2c_timed_on' });
    await activeDynamic.started;
    const obsoleteMode = controller.applyChargingChanges({ target_power_mode: 'v2c_timed_off' });
    const latestMode = controller.applyChargingChanges({ target_power_mode: 'v2c_grid_fv' });
    activeDynamic.finish();
    assert.deepEqual(await Promise.all([activeMode, obsoleteMode, latestMode]), [true, true, true]);

    assert.deepEqual(calls.filter((call) => call[0] === 'dynamic' || call[0] === 'dynamicPowerMode'), [
        ['dynamic', '1'],
        ['dynamicPowerMode', '0'],
        ['dynamic', '1'],
        ['dynamicPowerMode', '4']
    ]);
    assert.equal(calls.some((call) => call[0] === 'intensity'), false);
    assert.equal(calls.some((call) => call[0] === 'parameter' && call[1] === 'Paused' && call[2] === '0'), false);
});

test('a mixed Homey batch remains a barrier between queued mode-only updates', async () => {
    const { controller, device, calls } = createController();
    const activeDynamic = holdFirstDynamicWrite(device, calls);

    const activeMode = controller.applyChargingChanges({ target_power_mode: 'v2c_timed_on' });
    await activeDynamic.started;
    const modeBeforeBatch = controller.applyChargingChanges({ target_power_mode: 'v2c_timed_off' });
    const stopBatch = controller.applyChargingChanges({
        target_power_mode: 'homey',
        target_power: 6000,
        evcharger_charging: false
    });
    const modeAfterBatch = controller.applyChargingChanges({ target_power_mode: 'v2c_grid_fv' });
    activeDynamic.finish();
    await Promise.all([activeMode, modeBeforeBatch, stopBatch, modeAfterBatch]);

    assert.deepEqual(calls.filter((call) => call[0] === 'dynamic' || call[0] === 'dynamicPowerMode' ||
        (call[0] === 'parameter' && call[1] === 'Paused')), [
        ['dynamic', '1'],
        ['dynamicPowerMode', '0'],
        ['dynamic', '1'],
        ['dynamicPowerMode', '1'],
        ['dynamic', '0'],
        ['parameter', 'Paused', '1'],
        ['dynamic', '1'],
        ['dynamicPowerMode', '4']
    ]);
    assert.equal(calls.some((call) => call[0] === 'intensity'), false);
    assert.equal(calls.some((call) => call[0] === 'parameter' && call[1] === 'Paused' && call[2] === '0'), false);
});

test('a standalone Stop remains a barrier between queued mode-only updates', async () => {
    const { controller, device, calls } = createController();
    const activeDynamic = holdFirstDynamicWrite(device, calls);

    const activeMode = controller.applyChargingChanges({ target_power_mode: 'v2c_timed_on' });
    await activeDynamic.started;
    const modeBeforeStop = controller.applyChargingChanges({ target_power_mode: 'v2c_timed_off' });
    const stop = controller.setChargingPaused(true);
    const modeAfterStop = controller.applyChargingChanges({ target_power_mode: 'v2c_grid_fv' });
    activeDynamic.finish();
    await Promise.all([activeMode, modeBeforeStop, stop, modeAfterStop]);

    assert.deepEqual(calls.filter((call) => call[0] === 'dynamic' || call[0] === 'dynamicPowerMode' ||
        (call[0] === 'parameter' && call[1] === 'Paused')), [
        ['dynamic', '1'],
        ['dynamicPowerMode', '0'],
        ['dynamic', '1'],
        ['dynamicPowerMode', '1'],
        ['parameter', 'Paused', '1'],
        ['dynamic', '1'],
        ['dynamicPowerMode', '4']
    ]);
    assert.equal(calls.some((call) => call[0] === 'intensity'), false);
    assert.equal(calls.some((call) => call[0] === 'parameter' && call[1] === 'Paused' && call[2] === '0'), false);
});

test('a power-only callback remains a barrier before a queued Homey handback', async () => {
    const { controller, device, calls, capabilities } = createController();
    const activeDynamic = holdFirstDynamicWrite(device, calls);

    const activeMode = controller.applyChargingChanges({ target_power_mode: 'v2c_timed_on' });
    await activeDynamic.started;
    const v2cMode = controller.applyChargingChanges({ target_power_mode: 'v2c_timed_off' });
    capabilities.target_power_mode = 'v2c_timed_off';
    capabilities.target_power = 0;
    const zeroTarget = controller.applyChargingChanges({ target_power: 0 });
    capabilities.target_power_mode = 'homey';
    const homeyMode = controller.applyChargingChanges({ target_power_mode: 'homey' });
    activeDynamic.finish();
    await Promise.all([activeMode, v2cMode, zeroTarget, homeyMode]);

    assert.deepEqual(calls.filter((call) => call[0] === 'dynamic' || call[0] === 'dynamicPowerMode' ||
        (call[0] === 'parameter' && call[1] === 'Paused')), [
        ['dynamic', '1'],
        ['dynamicPowerMode', '0'],
        ['dynamic', '1'],
        ['dynamicPowerMode', '1'],
        ['parameter', 'Paused', '1'],
        ['dynamic', '0'],
        ['parameter', 'Paused', '1']
    ]);
    assert.equal(calls.some((call) => call[0] === 'intensity'), false);
    assert.equal(calls.some((call) => call[0] === 'parameter' && call[1] === 'Paused' && call[2] === '0'), false);
});
