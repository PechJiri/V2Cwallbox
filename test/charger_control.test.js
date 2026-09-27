'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

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

function createDevice({ capabilities = {}, settings = {}, store = new Map(), failIntensity = false } = {}) {
    const MyDevice = loadDeviceWithHomeyStub();
    const device = Object.create(MyDevice.prototype);
    const calls = [];
    const listener = {};
    device.logger = { debug() {}, warn() {}, error() {} };
    device._capabilities = { target_power_mode: 'homey', target_power: 6000, evcharger_charging: true, ...capabilities };
    device._settings = {
        phase_mode: '3',
        voltage_type: 'line_to_neutral',
        installation_voltage: '230',
        min_intensity: 6,
        max_intensity: 32,
        ...settings
    };
    device.getCapabilityValue = (id) => device._capabilities[id];
    device.setCapabilityValue = async (id, value) => {
        calls.push(['capability', id, value]);
        device._capabilities[id] = value;
        return true;
    };
    device.hasCapability = () => true;
    device.getSetting = (id) => device._settings[id];
    device.getSettings = () => ({ ...device._settings });
    device.setSettings = async (values) => Object.assign(device._settings, values);
    device.getStoreValue = async (key) => store.get(key);
    device.setStoreValue = async (key, value) => {
        calls.push(['store', key, value]);
        store.set(key, value);
    };
    device.registerMultipleCapabilityListener = (capabilities, callback, delay) => {
        listener.capabilities = capabilities;
        listener.callback = callback;
        listener.delay = delay;
    };
    device.v2cApi = {
        setParameter: async (parameter, value) => {
            calls.push(['parameter', parameter, value]);
        },
        setIntensity: async (value) => {
            calls.push(['intensity', value]);
            if (failIntensity) throw new Error('Intensity write failed');
        },
        setDynamic: async (value) => calls.push(['dynamic', value]),
        setDynamicPowerMode: async (value) => calls.push(['dynamicPowerMode', value]),
        setMinIntensity: async (value) => calls.push(['minIntensity', value]),
        setMaxIntensity: async (value) => calls.push(['maxIntensity', value])
    };
    device.registerTargetPowerListeners();
    return { device, calls, listener, store };
}

test('manual Stop wins over a positive target in Homey’s combined batch', async () => {
    const { calls, listener } = createDevice();

    await listener.callback({
        target_power_mode: 'homey',
        target_power: 6000,
        evcharger_charging: false
    });

    assert.equal(calls.some((call) => call[0] === 'parameter' && call[1] === 'Paused' && call[2] === '0'), false);
    assert.equal(calls.some((call) => call[0] === 'parameter' && call[1] === 'Paused' && call[2] === '1'), true);
});

test('combined Homey Stop reaches Paused=1 when the unrelated target Intensity write would fail', async () => {
    const { calls, listener } = createDevice({ failIntensity: true });

    await listener.callback({ target_power: 6000, evcharger_charging: false }).catch(() => {});

    assert.equal(calls.some((call) => call[0] === 'parameter' && call[1] === 'Paused' && call[2] === '1'), true);
    assert.equal(calls.some((call) => call[0] === 'intensity'), false);
});

test('standalone Homey Stop reaches Paused=1 without writing the retained positive target', async () => {
    const { calls, listener } = createDevice({ failIntensity: true });

    await listener.callback({ evcharger_charging: false }).catch(() => {});

    assert.equal(calls.some((call) => call[0] === 'parameter' && call[1] === 'Paused' && call[2] === '1'), true);
    assert.equal(calls.some((call) => call[0] === 'intensity'), false);
    assert.equal(calls.some((call) => call[0] === 'store' && call[2] === false), true);
    assert.equal(calls.some((call) => call[0] === 'capability' && call[1] === 'evcharger_charging' && call[2] === false), true);
});

test('changing a positive target while manually paused keeps charging paused', async () => {
    const { calls, listener } = createDevice({
        capabilities: { evcharger_charging: false }
    });

    await listener.callback({ target_power: 6000 });

    assert.equal(calls.some((call) => call[0] === 'parameter' && call[1] === 'Paused' && call[2] === '0'), false);
    assert.equal(calls.some((call) => call[0] === 'intensity'), true);
});

test('standalone Homey Resume unpauses without rewriting the configured current', async () => {
    const { device, calls, listener } = createDevice({
        capabilities: { target_power: 0, measure_intensity: 8, evcharger_charging: false }
    });

    await listener.callback({ evcharger_charging: true });

    assert.deepEqual(calls.filter((call) => call[0] === 'parameter'), [['parameter', 'Paused', '0']]);
    assert.equal(calls.some((call) => call[0] === 'intensity'), false);
    assert.equal(calls.some((call) => call[0] === 'dynamic'), false);
    assert.equal(calls.some((call) => call[0] === 'store'), true);
    assert.equal(calls.some((call) => call[0] === 'capability' && call[1] === 'evcharger_charging' && call[2] === true), true);
    assert.equal(device.getCapabilityValue('target_power'), 0);
    assert.equal(device.getCapabilityValue('target_power_mode'), 'homey');
    assert.equal(device.getCapabilityValue('measure_intensity'), 8);
});

test('a positive Homey target batch writes Intensity before unpausing and stays paused on failure', async () => {
    const { calls, listener } = createDevice({
        capabilities: { evcharger_charging: false },
        failIntensity: true
    });

    await assert.rejects(() => listener.callback({ target_power: 6000, evcharger_charging: true }), /Intensity write failed/);
    assert.equal(calls.some((call) => call[0] === 'intensity' && call[1] === 8), true);
    assert.equal(calls.some((call) => call[0] === 'parameter' && call[1] === 'Paused' && call[2] === '0'), false);
});

test('Homey power-only changes do not write Intensity while a V2C strategy owns power', async () => {
    const { calls, listener } = createDevice({
        capabilities: { target_power_mode: 'v2c_timed_on' }
    });

    await listener.callback({ target_power: 6000 });

    assert.equal(calls.some((call) => call[0] === 'intensity'), false);
});

test('selecting either FV capability writes its official DynamicPowerMode without intensity or pause writes', async () => {
    for (const [targetPowerMode, dynamicPowerMode] of [
        ['v2c_fv_min', '2'],
        ['v2c_fv_exclusive', '3']
    ]) {
        const { calls, listener } = createDevice();

        await listener.callback({ target_power_mode: targetPowerMode });

        assert.deepEqual(calls.filter((call) => call[0] === 'dynamic' || call[0] === 'dynamicPowerMode'), [
            ['dynamic', '1'],
            ['dynamicPowerMode', dynamicPowerMode]
        ]);
        assert.equal(calls.some((call) => call[0] === 'intensity'), false);
        assert.equal(calls.some((call) => call[0] === 'parameter' && call[1] === 'Paused'), false);
    }
});

test('Homey Set target power batch disables V2C, applies Intensity, then resumes', async () => {
    const { calls, listener } = createDevice({
        capabilities: { evcharger_charging: false }
    });

    await listener.callback({
        target_power_mode: 'homey',
        target_power: 6000,
        evcharger_charging: true
    });

    assert.deepEqual(calls.filter((call) => ['dynamic', 'intensity', 'parameter'].includes(call[0])), [
        ['dynamic', '0'],
        ['intensity', 8],
        ['parameter', 'Paused', '0']
    ]);
});

test('device exposes queued control methods used by Flow and Homey listeners', () => {
    const { device } = createDevice();

    for (const name of [
        'setChargingPaused',
        'applyChargingChanges',
        'setDynamicPowerMode',
        'setIntensityLimit',
        'setChargingIntensity',
        'getChargingVoltage'
    ]) {
        assert.equal(typeof device[name], 'function', `${name} must be part of the device control contract`);
    }
});

test('control operations are serialized when separate Homey and Flow calls overlap', async () => {
    const { device, calls } = createDevice();
    let unblockDynamic;
    device.v2cApi.setDynamic = async (value) => {
        calls.push(['dynamic-start', value]);
        await new Promise((resolve) => { unblockDynamic = resolve; });
        calls.push(['dynamic-end', value]);
    };

    const modeChange = device.setDynamicPowerMode('4');
    const manualStop = device.setChargingPaused(true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(calls.filter((call) => call[0] === 'dynamic-start'), [['dynamic-start', '1']]);
    assert.equal(calls.some((call) => call[0] === 'parameter' && call[1] === 'Paused'), false);

    unblockDynamic();
    await Promise.all([modeChange, manualStop]);
    assert.deepEqual(calls.filter((call) => call[0] === 'dynamic-start' || call[0] === 'dynamic-end' || call[0] === 'dynamicPowerMode' || (call[0] === 'parameter' && call[1] === 'Paused')), [
        ['dynamic-start', '1'],
        ['dynamic-end', '1'],
        ['dynamicPowerMode', '4'],
        ['parameter', 'Paused', '1']
    ]);
});

test('manual pause preserves desired target, Homey ownership, and timer state', async () => {
    const { device, calls } = createDevice({
        capabilities: { target_power_mode: 'homey', target_power: 6000, timer_state: true },
        store: new Map()
    });
    assert.equal(typeof device.setChargingPaused, 'function');
    if (typeof device.setChargingPaused !== 'function') return;

    await device.setChargingPaused(true);

    assert.equal(device.getCapabilityValue('target_power_mode'), 'homey');
    assert.equal(device.getCapabilityValue('target_power'), 6000);
    assert.equal(device.getCapabilityValue('timer_state'), true);
    assert.deepEqual(calls.filter((call) => call[0] === 'parameter'), [['parameter', 'Paused', '1']]);
    assert.equal(calls.some((call) => call[0] === 'dynamic'), false);
});

test('public Homey Resume at zero W preserves the retained V2C current and target ownership', async () => {
    const { device, calls } = createDevice({
        capabilities: { target_power: 0, measure_intensity: 8, evcharger_charging: false }
    });

    await device.setChargingPaused(false);

    assert.deepEqual(calls.filter((call) => call[0] === 'parameter'), [['parameter', 'Paused', '0']]);
    assert.equal(calls.some((call) => call[0] === 'intensity'), false);
    assert.equal(device.getCapabilityValue('target_power'), 0);
    assert.equal(device.getCapabilityValue('target_power_mode'), 'homey');
    assert.equal(device.getCapabilityValue('measure_intensity'), 8);
});

test('manual Resume is temporary when Homey still owns an explicit zero target', async () => {
    const { device, calls, listener } = createDevice({
        capabilities: { target_power: 0, measure_intensity: 8, evcharger_charging: false }
    });

    await device.setChargingPaused(false);
    calls.length = 0;
    await listener.callback({ target_power_mode: 'homey', target_power: 0, evcharger_charging: false });

    assert.deepEqual(calls.filter((call) => call[0] === 'parameter'), [['parameter', 'Paused', '1']]);
    assert.equal(calls.some((call) => call[0] === 'intensity'), false);
    assert.equal(device.getCapabilityValue('target_power'), 0);
    assert.equal(device.getCapabilityValue('target_power_mode'), 'homey');
});

test('public V2C manual resume does not write Homey Intensity or change ownership', async () => {
    const { device, calls } = createDevice({
        capabilities: { target_power_mode: 'v2c_timed_on', target_power: 0, evcharger_charging: false }
    });

    await device.setChargingPaused(false);

    assert.equal(calls.some((call) => call[0] === 'intensity'), false);
    assert.deepEqual(calls.filter((call) => call[0] === 'parameter'), [['parameter', 'Paused', '0']]);
    assert.equal(device.getCapabilityValue('target_power_mode'), 'v2c_timed_on');
});

test('a zero Homey target is released on handback only when its idle pause provenance was persisted', async () => {
    const { device, calls, listener } = createDevice();
    assert.equal(typeof device.applyChargingChanges, 'function');
    if (typeof device.applyChargingChanges !== 'function') return;

    await listener.callback({ target_power_mode: 'homey', target_power: 0, evcharger_charging: false });
    calls.length = 0;
    await device.applyChargingChanges({ target_power_mode: 'v2c_timed_on' });

    assert.equal(calls.some((call) => call[0] === 'parameter' && call[1] === 'Paused' && call[2] === '0'), true);
    assert.equal(calls.some((call) => call[0] === 'intensity'), false);
});

test('a manual pause survives handback even after restarting the device object', async () => {
    const store = new Map();
    const first = createDevice({ store });
    assert.equal(typeof first.device.applyChargingChanges, 'function');
    assert.equal(typeof first.device.setChargingPaused, 'function');
    if (typeof first.device.applyChargingChanges !== 'function' || typeof first.device.setChargingPaused !== 'function') return;

    await first.listener.callback({ target_power_mode: 'homey', target_power: 0, evcharger_charging: false });
    await first.device.setChargingPaused(true);
    const restarted = createDevice({
        store,
        capabilities: { target_power_mode: 'homey', target_power: 0, evcharger_charging: false }
    });
    restarted.calls.length = 0;
    await restarted.device.applyChargingChanges({ target_power_mode: 'v2c_timed_on' });

    assert.equal(restarted.calls.some((call) => call[0] === 'parameter' && call[1] === 'Paused' && call[2] === '0'), false);
});

test('standalone manual Stop clears Homey-idle provenance even when the desired target is zero', async () => {
    const store = new Map();
    const first = createDevice({
        store,
        capabilities: { target_power: 0, evcharger_charging: false }
    });
    assert.equal(typeof first.device.applyChargingChanges, 'function');
    if (typeof first.device.applyChargingChanges !== 'function') return;

    await first.listener.callback({ target_power: 0, evcharger_charging: false });
    await first.listener.callback({ evcharger_charging: false });
    const restarted = createDevice({
        store,
        capabilities: { target_power: 0, evcharger_charging: false }
    });
    restarted.calls.length = 0;
    await restarted.device.applyChargingChanges({ target_power_mode: 'v2c_timed_on' });

    assert.equal(restarted.calls.some((call) => call[0] === 'parameter' && call[1] === 'Paused' && call[2] === '0'), false);
});

test('a failed Homey provenance write does not create an automatic handback resume', async () => {
    const { device, listener, calls } = createDevice();
    assert.equal(typeof device.applyChargingChanges, 'function');
    if (typeof device.applyChargingChanges !== 'function') return;
    device.setStoreValue = async () => { throw new Error('store failed'); };

    await assert.rejects(
        () => listener.callback({ target_power_mode: 'homey', target_power: 0, evcharger_charging: false }),
        /store failed/
    );
    assert.equal(calls.some((call) => call[0] === 'parameter' && call[1] === 'Paused' && call[2] === '1'), true);
    calls.length = 0;
    await device.applyChargingChanges({ target_power_mode: 'v2c_timed_on' });

    assert.equal(calls.some((call) => call[0] === 'parameter' && call[1] === 'Paused' && call[2] === '0'), false);
});

test('negative, non-finite, and sub-minimum powers never start unidirectional charging', async () => {
    for (const power of [-1000, Number.NaN, Number.POSITIVE_INFINITY, 100]) {
        const { calls, listener } = createDevice({
            capabilities: { evcharger_charging: true }
        });
        await listener.callback({ target_power: power });
        assert.equal(
            calls.some((call) => call[0] === 'parameter' && call[1] === 'Paused' && call[2] === '0'),
            false,
            `power ${power} must not resume charging`
        );
        assert.equal(
            calls.some((call) => call[0] === 'parameter' && call[1] === 'Paused' && call[2] === '1'),
            true,
            `power ${power} must stop an already-running unidirectional charger`
        );
    }
});

test('line-to-line current calculation falls back to configured installation voltage', async () => {
    const { device, calls } = createDevice({
        settings: { voltage_type: 'line_to_line', installation_voltage: '400' },
        capabilities: { measure_voltage_installation: null }
    });
    assert.equal(typeof device.getChargingVoltage, 'function');
    if (typeof device.getChargingVoltage !== 'function') return;

    assert.equal(device.getChargingVoltage(), 400);
    await device._applyTargetPower(6000);
    assert.equal(calls.some((call) => call[0] === 'intensity' && call[1] === 8), true);
});

test('charging voltage uses only a live or configured value matching voltage_type', () => {
    const liveLineToLine = createDevice({
        settings: { voltage_type: 'line_to_line', installation_voltage: '380' },
        capabilities: { measure_voltage_installation: 405 }
    });
    const mismatchedLiveAndConfigured = createDevice({
        settings: { voltage_type: 'line_to_line', installation_voltage: '230' },
        capabilities: { measure_voltage_installation: 230 }
    });
    const mismatchedLineToNeutral = createDevice({
        settings: { voltage_type: 'line_to_neutral', installation_voltage: '400' },
        capabilities: { measure_voltage_installation: 400 }
    });

    assert.equal(liveLineToLine.device.getChargingVoltage(), 405);
    assert.equal(mismatchedLiveAndConfigured.device.getChargingVoltage(), 400);
    assert.equal(mismatchedLineToNeutral.device.getChargingVoltage(), 230);
});

test('Homey desired target stays separate from measured Intensity during telemetry updates', async () => {
    const { device } = createDevice({ capabilities: { target_power: 6000 } });
    const writes = new Map();
    device.energyManager = { getLifetimeEnergy: () => 0 };
    device._lastChargeState = '2';
    device.setCapabilityValue = async (id, value) => writes.set(id, value);

    await device.updateCapabilities({
        chargePower: 0, voltageInstallation: 230, intensityL1: 0, intensityL2: 0, intensityL3: 0,
        voltageL1: 230, voltageL2: 230, voltageL3: 230, slaveError: 0, chargeTime: 0,
        locked: false, intensity: 8, dynamic: false, dynamicPowerMode: '0', paused: true,
        housePower: 0, fvPower: 0, batteryPower: 0, minIntensity: 6, maxIntensity: 32,
        firmwareVersion: 'test', signalStatus: 0, timer_state: false
    }, '2', 0);

    assert.equal(writes.get('target_power'), 6000);
});
