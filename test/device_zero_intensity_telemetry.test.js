'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const DataValidator = require('../lib/DataValidator');
const EnergyManager = require('../lib/EnergyManager');
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

function createPausedZeroSample() {
    return {
        ChargeState: 1,
        ChargePower: 0,
        ChargeEnergy: 12.5,
        ChargeTime: 187,
        Intensity: 0,
        Paused: 1,
        Locked: 0,
        Dynamic: 0,
        DynamicPowerMode: 5,
        Timer: 0,
        MinIntensity: 6,
        MaxIntensity: 32,
        IntensityMeasure_L1: 0,
        VoltageMeasure_L1: 230,
        VoltageInstallation: 230,
        HousePower: 720,
        FVPower: 260,
        BatteryPower: -85,
        FirmwareVersion: '2.5.1',
        SignalStatus: '0'
    };
}

function createPollingDevice(MyDevice, { enumIds, rawSample }) {
    const device = Object.create(MyDevice.prototype);
    const now = new Date();
    const values = new Map([
        ['target_power_mode', CONSTANTS.TARGET_POWER_MODES.HOMEY],
        ['target_power', 9000],
        ['evcharger_charging', true],
        ['evcharger_charging_state', 'plugged_in'],
        ['measure_connection_error', true],
        ['measure_charge_energy', 12],
        ['measure_monthly_energy', 7],
        ['measure_yearly_energy', 42],
        ['meter_power', 125],
        ['set_intensity', '21']
    ]);
    const stores = new Map([
        ['previousChargeState', CONSTANTS.CHARGE_STATES.CONNECTED],
        ['monthlyEnergyData', { month: now.getMonth() + 1, energy: 7 }],
        ['yearlyEnergyData', { year: now.getFullYear(), energy: 42 }]
    ]);
    const capabilityWrites = [];
    const hardwareWrites = [];
    const connectionChanges = [];
    let available = false;

    device.logger = { debug() {}, warn() {}, error() {} };
    device.dataValidator = new DataValidator(device.logger);
    device.energyManager = new EnergyManager(device, device.logger);
    device.energyManager.pendingSessionEnergy = 0;
    device.energyManager.lifetimeData = {
        energy: 125,
        since: '2025-01-01T00:00:00.000Z'
    };
    device.flowCardManager = {
        triggerConnectionStateChanged: async (state) => connectionChanges.push(state)
    };
    device.hasCapability = () => true;
    device.getSetting = (key) => ({ phase_mode: '3', voltage_type: 'line_to_neutral' })[key];
    device.getCapabilityValue = (capabilityId) => values.get(capabilityId);
    device.setCapabilityValue = async (capabilityId, value) => {
        if (capabilityId === 'set_intensity' && value !== null && !enumIds.has(String(value))) {
            throw new Error(`Invalid enum value for set_intensity: ${String(value)}`);
        }
        capabilityWrites.push([capabilityId, value]);
        values.set(capabilityId, value);
    };
    device.getStoreValue = async (key) => stores.get(key);
    device.setStoreValue = async (key, value) => stores.set(key, value);
    device.handleStateChanges = async () => {};
    device.getAvailable = () => available;
    device.setAvailable = async () => { available = true; };
    device.v2cApi = {
        getData: async () => rawSample,
        setParameter: async (...args) => hardwareWrites.push(args),
        getErrorCount: () => 0,
        isInErrorState: () => false
    };
    device._consecutivePollErrors = 2;

    return {
        device,
        values,
        capabilityWrites,
        hardwareWrites,
        connectionChanges,
        setRawSample: (sample) => { rawSample = sample; },
        isAvailable: () => available
    };
}

test('a paused zero-amp sample completes Homey publication and retains the selected intensity', async () => {
    const setIntensityCapability = JSON.parse(fs.readFileSync(
        path.join(__dirname, '../.homeycompose/capabilities/set_intensity.json'),
        'utf8'
    ));
    const enumIds = new Set(setIntensityCapability.values.map(({ id }) => id));
    const MyDevice = loadDeviceWithHomeyStub();
    const harness = createPollingDevice(MyDevice, {
        enumIds,
        rawSample: createPausedZeroSample()
    });
    const parsed = harness.device.dataValidator.validateAndProcessData(createPausedZeroSample());

    assert.ok(parsed, 'zero intensity is valid V2C telemetry for a paused connection');
    assert.equal(parsed.intensity, 0);

    await harness.device.getProductionData({ force: true, throwOnError: true });

    assert.equal(harness.values.get('measure_intensity'), 0, 'measured intensity must remain truthful');
    assert.equal(harness.values.get('set_intensity'), '21', 'zero telemetry must retain the last selectable control value');
    assert.equal(harness.capabilityWrites.some(([id]) => id === 'set_intensity'), false);
    assert.equal(harness.values.get('measure_charge_power'), 0);
    assert.equal(harness.values.get('measure_power'), 0);
    assert.equal(harness.values.get('measure_charge_energy'), 12.5);
    assert.equal(harness.values.get('meter_power'), 125);
    assert.equal(harness.values.get('target_power_mode'), CONSTANTS.TARGET_POWER_MODES.HOMEY);
    assert.equal(harness.values.get('target_power'), 9000, 'a paused measured zero must not overwrite the Homey target');
    assert.equal(harness.values.get('evcharger_charging'), false);
    assert.equal(harness.values.get('evcharger_charging_state'), 'plugged_in_paused');
    assert.equal(harness.values.get('measure_house_power'), 720);
    assert.equal(harness.values.get('measure_fv_power'), 260);
    assert.equal(harness.values.get('measure_battery_power'), -85);
    assert.equal(harness.values.get('measure_connection_error'), false);
    assert.equal(harness.device._lastChargeState, CONSTANTS.CHARGE_STATES.CONNECTED);
    assert.equal(harness.device._consecutivePollErrors, 0);
    assert.equal(harness.device._statusStale, false);
    assert.ok(Number.isFinite(harness.device._lastSuccessfulUpdate));
    assert.deepEqual(harness.connectionChanges, ['ok']);
    assert.equal(harness.isAvailable(), true);
    assert.deepEqual(harness.hardwareWrites, [], 'publishing telemetry must not write to the wallbox');

    harness.setRawSample({
        ...createPausedZeroSample(),
        ChargeState: 2,
        ChargePower: 12420,
        ChargeEnergy: 13,
        ChargeTime: 224,
        Intensity: 18,
        Paused: 0,
        IntensityMeasure_L1: 18
    });
    await harness.device.getProductionData({ force: true, throwOnError: true });

    assert.equal(harness.values.get('measure_intensity'), 18);
    assert.equal(harness.values.get('set_intensity'), '18', 'a later valid enum reading still updates the picker');
    assert.deepEqual(
        harness.capabilityWrites.filter(([id]) => id === 'set_intensity'),
        [['set_intensity', '18']]
    );
    assert.deepEqual(harness.hardwareWrites, []);
});

test('a paused zero-amp V2C dynamic sample keeps V2C strategy ownership and recovers poll freshness', async () => {
    const setIntensityCapability = JSON.parse(fs.readFileSync(
        path.join(__dirname, '../.homeycompose/capabilities/set_intensity.json'),
        'utf8'
    ));
    const enumIds = new Set(setIntensityCapability.values.map(({ id }) => id));
    const MyDevice = loadDeviceWithHomeyStub();
    const harness = createPollingDevice(MyDevice, {
        enumIds,
        rawSample: {
            ...createPausedZeroSample(),
            ChargeState: 2,
            ChargePower: 0,
            Paused: 1,
            Dynamic: 1,
            DynamicPowerMode: 4
        }
    });

    await harness.device.getProductionData({ force: true, throwOnError: true });

    assert.equal(harness.values.get('measure_intensity'), 0);
    assert.equal(harness.values.get('set_intensity'), '21');
    assert.equal(harness.capabilityWrites.some(([id]) => id === 'set_intensity'), false);
    assert.equal(harness.values.get('target_power_mode'), CONSTANTS.TARGET_POWER_MODES.V2C_GRID_FV);
    assert.equal(harness.values.get('target_power'), 0, 'V2C Dynamic mode retains ownership of the target');
    assert.equal(harness.values.get('measure_charge_state'), '2');
    assert.equal(harness.values.get('evcharger_charging'), false);
    assert.equal(harness.values.get('meter_power'), 125);
    assert.equal(harness.device._lastChargeState, CONSTANTS.CHARGE_STATES.CHARGING);
    assert.equal(harness.device._consecutivePollErrors, 0);
    assert.equal(harness.values.get('measure_connection_error'), false);
    const metadata = await harness.device.getStatusMetadata();
    assert.equal(metadata.stale, false);
    assert.equal(metadata.connectionError, false);
    assert.ok(Number.isFinite(metadata.lastUpdated));
    assert.deepEqual(harness.hardwareWrites, []);
});

test('poll readback maps official DynamicPowerMode codes 2 and 3 to their matching strategies', async () => {
    const setIntensityCapability = JSON.parse(fs.readFileSync(
        path.join(__dirname, '../.homeycompose/capabilities/set_intensity.json'),
        'utf8'
    ));
    const enumIds = new Set(setIntensityCapability.values.map(({ id }) => id));

    for (const [dynamicPowerMode, targetPowerMode] of [
        [2, 'v2c_fv_min'],
        [3, 'v2c_fv_exclusive']
    ]) {
        const MyDevice = loadDeviceWithHomeyStub();
        const harness = createPollingDevice(MyDevice, {
            enumIds,
            rawSample: {
                ...createPausedZeroSample(),
                Dynamic: 1,
                DynamicPowerMode: dynamicPowerMode
            }
        });

        await harness.device.getProductionData({ force: true, throwOnError: true });

        assert.equal(harness.values.get('target_power_mode'), targetPowerMode);
        assert.deepEqual(harness.hardwareWrites, []);
    }
});
