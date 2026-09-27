'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');
const CONSTANTS = require('../lib/constants');

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

function createControlDevice({
    chargeState = CONSTANTS.CHARGE_STATES.CONNECTED,
    nativeState = CONSTANTS.EVCHARGER_STATES.PLUGGED_IN,
    alarm = false,
    failPausedWrite = false,
    capabilities: overrides = {}
} = {}) {
    const MyDevice = loadDeviceWithHomeyStub();
    const device = Object.create(MyDevice.prototype);
    const calls = [];
    const capabilities = {
        target_power_mode: CONSTANTS.TARGET_POWER_MODES.HOMEY,
        target_power: 0,
        measure_intensity: 16,
        set_intensity: '16',
        evcharger_charging: true,
        evcharger_charging_state: nativeState,
        alarm_generic: alarm,
        ...overrides
    };
    const store = new Map();

    device._lastChargeState = chargeState;
    device._lastChargePaused = null;
    device._statusStale = false;
    device.getCapabilityValue = (id) => capabilities[id];
    device.setCapabilityValue = async (id, value) => {
        calls.push(['capability', id, value]);
        capabilities[id] = value;
        return true;
    };
    device.getStoreValue = async (key) => store.get(key);
    device.setStoreValue = async (key, value) => {
        calls.push(['store', key, value]);
        store.set(key, value);
    };
    device.v2cApi = {
        setParameter: async (parameter, value) => {
            calls.push(['parameter', parameter, value]);
            if (failPausedWrite && parameter === 'Paused') throw new Error('Paused write failed');
        },
        setIntensity: async (value) => calls.push(['intensity', value])
    };

    return { device, calls, capabilities };
}

test('native EV state honors Paused and zero measured power for connected CP states', () => {
    const MyDevice = loadDeviceWithHomeyStub();
    const device = Object.create(MyDevice.prototype);

    assert.equal(
        device._mapEvChargerState(CONSTANTS.CHARGE_STATES.CHARGING, true, 0),
        CONSTANTS.EVCHARGER_STATES.PLUGGED_IN_PAUSED
    );
    assert.equal(
        device._mapEvChargerState(CONSTANTS.CHARGE_STATES.CHARGING, false, 0),
        CONSTANTS.EVCHARGER_STATES.PLUGGED_IN,
        'permission without measured power is ready, not charging'
    );
    assert.equal(
        device._mapEvChargerState(CONSTANTS.CHARGE_STATES.CHARGING, false, 7400),
        CONSTANTS.EVCHARGER_STATES.PLUGGED_IN_CHARGING
    );
    assert.equal(
        device._mapEvChargerState(CONSTANTS.CHARGE_STATES.CONNECTED, false, 7400),
        CONSTANTS.EVCHARGER_STATES.PLUGGED_IN_CHARGING,
        'positive measured power confirms charging for either connected CP state'
    );
    assert.equal(
        device._mapEvChargerState(CONSTANTS.CHARGE_STATES.CHARGING, null, 0),
        null,
        'an unknown pause value cannot imply charging from CP2 alone'
    );
    assert.equal(
        device._mapEvChargerState(CONSTANTS.CHARGE_STATES.CONNECTED, true, 0),
        CONSTANTS.EVCHARGER_STATES.PLUGGED_IN_PAUSED
    );
    assert.equal(
        device._mapEvChargerState(CONSTANTS.CHARGE_STATES.DISCONNECTED, true, 0),
        CONSTANTS.EVCHARGER_STATES.PLUGGED_OUT
    );
    for (const faultState of [
        CONSTANTS.CHARGE_STATES.SYSTEM_FAILURE,
        CONSTANTS.CHARGE_STATES.CP_GROUND_FAILURE,
        CONSTANTS.CHARGE_STATES.VENTILATION_REQUIRED
    ]) {
        assert.equal(device._mapEvChargerState(faultState, true, 0), null);
    }
});

test('successful manual Stop confirms the native paused state for known CP1 and CP2', async () => {
    for (const chargeState of [CONSTANTS.CHARGE_STATES.CONNECTED, CONSTANTS.CHARGE_STATES.CHARGING]) {
        const { device, calls, capabilities } = createControlDevice({ chargeState });

        await device.setChargingPaused(true);

        assert.equal(capabilities.evcharger_charging, false);
        assert.equal(capabilities.evcharger_charging_state, CONSTANTS.EVCHARGER_STATES.PLUGGED_IN_PAUSED);
        const pausedWrite = calls.findIndex((call) => call[0] === 'parameter' && call[1] === 'Paused');
        const nativeStateWrite = calls.findIndex((call) =>
            call[0] === 'capability' && call[1] === 'evcharger_charging_state'
        );
        assert.ok(pausedWrite >= 0 && nativeStateWrite > pausedWrite, 'Homey state follows a successful wallbox write');
    }
});

test('unplugged, faulted, or alarmed devices do not get a synthetic native paused state', async () => {
    const cases = [
        { chargeState: CONSTANTS.CHARGE_STATES.DISCONNECTED, nativeState: CONSTANTS.EVCHARGER_STATES.PLUGGED_OUT },
        { chargeState: CONSTANTS.CHARGE_STATES.SYSTEM_FAILURE, nativeState: CONSTANTS.EVCHARGER_STATES.PLUGGED_IN, alarm: true },
        { chargeState: CONSTANTS.CHARGE_STATES.CONNECTED, nativeState: CONSTANTS.EVCHARGER_STATES.PLUGGED_IN, alarm: true }
    ];

    for (const options of cases) {
        const { device, calls, capabilities } = createControlDevice(options);
        await device.setChargingPaused(true);

        assert.equal(capabilities.evcharger_charging, false);
        assert.equal(capabilities.evcharger_charging_state, options.nativeState);
        assert.equal(calls.some((call) => call[0] === 'capability' && call[1] === 'evcharger_charging_state'), false);
    }
});

test('a failed Paused write leaves both Homey charging capabilities unchanged', async () => {
    const { device, calls, capabilities } = createControlDevice({
        chargeState: CONSTANTS.CHARGE_STATES.CHARGING,
        nativeState: CONSTANTS.EVCHARGER_STATES.PLUGGED_IN_CHARGING,
        failPausedWrite: true
    });

    await assert.rejects(() => device.setChargingPaused(true), /Paused write failed/);

    assert.equal(capabilities.evcharger_charging, true);
    assert.equal(capabilities.evcharger_charging_state, CONSTANTS.EVCHARGER_STATES.PLUGGED_IN_CHARGING);
    assert.equal(calls.some((call) => call[0] === 'capability'), false);
});

test('manual Resume clears a confirmed pause without claiming active charging or rewriting 16 A', async () => {
    const { device, calls, capabilities } = createControlDevice({
        chargeState: CONSTANTS.CHARGE_STATES.CHARGING,
        nativeState: CONSTANTS.EVCHARGER_STATES.PLUGGED_IN_PAUSED,
        capabilities: { evcharger_charging: false }
    });

    await device.setChargingPaused(false);

    assert.equal(capabilities.evcharger_charging, true);
    assert.equal(capabilities.evcharger_charging_state, CONSTANTS.EVCHARGER_STATES.PLUGGED_IN);
    assert.notEqual(capabilities.evcharger_charging_state, CONSTANTS.EVCHARGER_STATES.PLUGGED_IN_CHARGING);
    assert.equal(capabilities.target_power, 0);
    assert.equal(capabilities.measure_intensity, 16);
    assert.equal(capabilities.set_intensity, '16');
    assert.equal(calls.some((call) => call[0] === 'intensity'), false);
});

test('the charging poll slows only for a fresh CP2 telemetry pause and retains existing backoff', () => {
    const MyDevice = loadDeviceWithHomeyStub();
    const device = Object.create(MyDevice.prototype);
    const capabilities = {
        evcharger_charging_state: CONSTANTS.EVCHARGER_STATES.PLUGGED_IN_PAUSED,
        evcharger_charging: false
    };
    device.getCapabilityValue = (id) => capabilities[id];
    device._lastChargeState = CONSTANTS.CHARGE_STATES.CHARGING;
    device._lastChargePaused = true;
    device._statusStale = false;
    device._consecutivePollErrors = 0;

    assert.equal(device._getRequiredInterval(), CONSTANTS.INTERVALS.CONNECTED);

    device._lastChargePaused = false;
    assert.equal(device._getRequiredInterval(), CONSTANTS.INTERVALS.CHARGING, 'intent alone does not slow the poll');

    device._lastChargePaused = true;
    device._statusStale = true;
    assert.equal(device._getRequiredInterval(), CONSTANTS.INTERVALS.CHARGING, 'stale telemetry keeps the active cadence');

    device._statusStale = false;
    device._consecutivePollErrors = 1;
    assert.equal(
        device._getRequiredInterval(),
        CONSTANTS.INTERVALS.CHARGING * CONSTANTS.INTERVALS.BACKOFF_MULTIPLIER,
        'the existing charging error backoff is unchanged'
    );

    device._consecutivePollErrors = 0;
    device._lastChargeState = CONSTANTS.CHARGE_STATES.SYSTEM_FAILURE;
    assert.equal(device._getRequiredInterval(), CONSTANTS.INTERVALS.DISCONNECTED, 'fault polling keeps its existing interval');
});
