'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');
const DataValidator = require('../lib/DataValidator');
const widgetApi = require('../widgets/wallbox-status/api');

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

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function validPayload(overrides = {}) {
    return {
        ChargeState: 1,
        ChargePower: 0,
        ChargeEnergy: 0,
        Intensity: 6,
        Paused: 1,
        Locked: 0,
        Dynamic: 0,
        DynamicPowerMode: 5,
        Timer: 0,
        MinIntensity: 6,
        MaxIntensity: 32,
        ...overrides
    };
}

function makeRealDevice() {
    const MyDevice = loadDeviceWithHomeyStub();
    const device = new MyDevice();
    const reads = [];
    const writes = [];
    const capabilities = {
        target_power_mode: 'homey',
        target_power: 6000,
        evcharger_charging: true,
        evcharger_charging_state: 'plugged_in',
        measure_charge_power: 0,
        measure_charge_energy: 0,
        measure_connection_error: false,
        measure_voltage_installation: 230,
        measure_slave_error: '00',
        min_intensity: 6,
        max_intensity: 32
    };
    const store = new Map([['previousChargeState', '0']]);
    const settings = { phase_mode: '3', voltage_type: 'line_to_neutral', installation_voltage: '230' };

    device.logger = { debug() {}, warn() {}, error() {} };
    device.dataValidator = new DataValidator(device.logger);
    device.energyManager = {
        resetMonthlyAndYearlyDataIfNeeded: async () => {},
        processEnergyData: async (data) => data.chargeEnergy,
        getLifetimeEnergy: () => 0
    };
    device.flowCardManager = { triggerConnectionStateChanged: async () => {} };
    device.getCapabilityValue = (id) => capabilities[id];
    device.setCapabilityValue = async (id, value) => {
        if (device.failCapabilityId === id) {
            throw new Error(`${id} publication failed`);
        }
        capabilities[id] = value;
        return true;
    };
    device.hasCapability = () => true;
    device.getSetting = (id) => settings[id];
    device.getStoreValue = async (key) => store.get(key);
    device.setStoreValue = async (key, value) => store.set(key, value);
    device.handleStateChanges = async () => {};
    device.getAvailable = () => true;
    device.setAvailable = async () => {};
    device.getData = () => ({ id: 'only-wallbox' });
    device.v2cApi = {
        getData: () => {
            const request = deferred();
            reads.push(request);
            return request.promise;
        },
        setParameter: async (...args) => writes.push(args),
        getErrorCount: () => 1,
        isInErrorState: () => false
    };

    const homey = {
        drivers: {
            getDriver: (id) => {
                assert.equal(id, 'v2c-wallbox');
                return {
                    getDevice: async ({ id: selectedId }) => {
                        assert.equal(selectedId, 'only-wallbox');
                        return device;
                    },
                    getDevices: async () => [device]
                };
            }
        }
    };

    return { device, homey, reads, writes, capabilities };
}

async function nextTurn() {
    await new Promise((resolve) => setImmediate(resolve));
}

test('forced widget confirmation drains the pre-command poll after the widget POST', async () => {
    const { device, homey, reads, writes } = makeRealDevice();
    const preCommandPoll = device.getProductionData();
    let post;
    let confirmation;

    try {
        await nextTurn();
        assert.equal(reads.length, 1, 'the pre-command device poll should be held in getData');

        post = widgetApi.setPaused({
            homey,
            body: { paused: true, deviceId: 'only-wallbox' }
        });
        await nextTurn();
        assert.deepEqual(writes, [['Paused', '1']], 'the widget POST must reach the real device command method');

        confirmation = widgetApi.getStatus({
            homey,
            query: { deviceId: 'only-wallbox', force: 'true' }
        });
        await nextTurn();

        assert.equal(reads.length, 1, 'confirmation must drain a pre-command GET before starting its own GET');

        reads[0].resolve(validPayload({ ChargeEnergy: 3 }));
        await preCommandPoll;
        await post;
        await nextTurn();
        assert.equal(reads.length, 2, 'forced confirmation must start a new GET after the old poll drains');

        reads[1].resolve(validPayload({ ChargeEnergy: 17 }));
        const status = await confirmation;
        assert.equal(status.chargeEnergy, 17, 'confirmation must report the post-command sample');
        assert.equal(status.confirmed, true);
    } finally {
        for (const request of reads) request.resolve(validPayload());
        await Promise.allSettled([preCommandPoll, post, confirmation].filter(Boolean));
    }
});

test('manual Stop publishes after the pre-command poll so stale telemetry cannot restore charging', async () => {
    const { device, reads, writes, capabilities } = makeRealDevice();
    device._lastChargeState = '2';
    device._lastChargePaused = false;
    capabilities.evcharger_charging = true;
    capabilities.evcharger_charging_state = 'plugged_in_charging';
    const preCommandPoll = device.getProductionData();
    let stop;

    try {
        await nextTurn();
        assert.equal(reads.length, 1, 'the pre-command telemetry read should be held by the API fixture');

        stop = device.setChargingPaused(true);
        await nextTurn();
        assert.deepEqual(writes, [['Paused', '1']], 'Stop reaches the wallbox before waiting for publication');

        reads[0].resolve(validPayload({
            ChargeState: 2,
            ChargePower: 11040,
            Intensity: 16,
            Paused: 0
        }));
        await Promise.all([preCommandPoll, stop]);

        assert.equal(capabilities.evcharger_charging, false);
        assert.equal(capabilities.evcharger_charging_state, 'plugged_in_paused');
    } finally {
        for (const request of reads) request.resolve(validPayload());
        await Promise.allSettled([preCommandPoll, stop].filter(Boolean));
    }
});

test('manual Stop still applies when the captured pre-command telemetry poll fails', async () => {
    const { device, reads, writes, capabilities } = makeRealDevice();
    device._lastChargeState = '2';
    capabilities.evcharger_charging = true;
    capabilities.evcharger_charging_state = 'plugged_in_charging';
    const preCommandPoll = device.getProductionData({ throwOnError: true });
    let stop;
    let stopSettled = false;

    try {
        await nextTurn();
        assert.equal(reads.length, 1, 'the pre-command telemetry read should be held by the API fixture');

        stop = device.setChargingPaused(true);
        stop.then(() => { stopSettled = true; }, () => { stopSettled = true; });
        await nextTurn();
        assert.deepEqual(writes, [['Paused', '1']], 'Stop reaches the wallbox before draining telemetry');
        assert.equal(stopSettled, false, 'Homey publication waits for the older poll to settle');

        reads[0].resolve(validPayload({ ChargeState: 3, Paused: 0 }));
        await assert.rejects(preCommandPoll, /invalid/i);
        await stop;

        assert.equal(capabilities.evcharger_charging, false);
        assert.equal(capabilities.evcharger_charging_state, 'plugged_in_paused');
    } finally {
        for (const request of reads) request.resolve(validPayload());
        await Promise.allSettled([preCommandPoll, stop].filter(Boolean));
    }
});

test('ordinary reads coalesce and concurrent forced reads share one fresh request', async () => {
    const { device, reads } = makeRealDevice();
    const ordinaryA = device.getProductionData();
    const ordinaryB = device.getProductionData();
    const forcedA = device.getProductionData({ force: true, throwOnError: true });
    const forcedB = device.getProductionData({ force: true, throwOnError: true });

    try {
        await nextTurn();
        assert.equal(reads.length, 1, 'ordinary and forced callers should share the poll already in progress');

        reads[0].resolve(validPayload({ ChargeEnergy: 3 }));
        await Promise.all([ordinaryA, ordinaryB]);
        await nextTurn();
        assert.equal(reads.length, 2, 'forced callers should share one request after the old poll drains');

        reads[1].resolve(validPayload({ ChargeEnergy: 17 }));
        await Promise.all([forcedA, forcedB]);
        assert.equal(device.lastResponse.ChargeEnergy, 17);
    } finally {
        for (const request of reads) request.resolve(validPayload());
        await Promise.allSettled([ordinaryA, ordinaryB, forcedA, forcedB]);
    }
});

test('a five-second charging poll is not hidden by the request timeout cache window', async () => {
    const originalNow = Date.now;
    Date.now = () => 6000;
    const { device, reads } = makeRealDevice();
    device._lastChargeState = '2';
    device.lastResponse = validPayload({ ChargeEnergy: 3 });
    device.lastResponseTime = 1000;
    const poll = device.getProductionData();

    try {
        await nextTurn();
        assert.equal(device._getRequiredInterval(), 5000);
        assert.equal(reads.length, 1, 'the charging poll at five seconds must fetch a new sample');
        reads[0].resolve(validPayload({ ChargeEnergy: 9 }));
        await poll;
        assert.equal(device.lastResponse.ChargeEnergy, 9);
    } finally {
        Date.now = originalNow;
        for (const request of reads) request.resolve(validPayload());
        await Promise.allSettled([poll]);
    }
});

test('failed reads mark status stale without clearing a primary fault, then valid data restores it', async () => {
    const originalNow = Date.now;
    let clock = 1000;
    Date.now = () => clock++;
    const { device, reads, capabilities } = makeRealDevice();
    let faultSample;
    let failedRead;
    let recovery;

    try {
        const initialMetadata = await device.getStatusMetadata();
        assert.equal(initialMetadata.lastUpdated, null);
        assert.equal(initialMetadata.stale, true);
        assert.equal(initialMetadata.connectionError, false);
        assert.equal(initialMetadata.fault, null);

        faultSample = device.getProductionData();
        await nextTurn();
        reads[0].resolve(validPayload({ ChargeState: 4, ChargeEnergy: 4 }));
        await faultSample;
        const healthyFaultMetadata = await device.getStatusMetadata();
        assert.equal(healthyFaultMetadata.stale, false);
        assert.equal(healthyFaultMetadata.connectionError, false);
        assert.equal(healthyFaultMetadata.fault.state, 4);
        assert.equal(capabilities.alarm_generic, true);
        const faultUpdatedAt = healthyFaultMetadata.lastUpdated;

        failedRead = device.getProductionData({ force: true, throwOnError: true });
        await nextTurn();
        reads[1].reject(new Error('network unavailable'));
        await assert.rejects(failedRead, /network unavailable/);

        const failedMetadata = await device.getStatusMetadata();
        assert.equal(failedMetadata.lastUpdated, faultUpdatedAt, 'a failed read cannot advance sample time');
        assert.equal(failedMetadata.stale, true);
        assert.equal(failedMetadata.connectionError, true);
        assert.deepEqual(failedMetadata.fault, healthyFaultMetadata.fault);
        assert.equal(capabilities.alarm_generic, true);

        recovery = device.getProductionData({ force: true, throwOnError: true });
        await nextTurn();
        reads[2].resolve(validPayload({ ChargeState: 1, ChargeEnergy: 5 }));
        await recovery;

        const recoveredMetadata = await device.getStatusMetadata();
        assert.ok(recoveredMetadata.lastUpdated > faultUpdatedAt);
        assert.equal(recoveredMetadata.stale, false);
        assert.equal(recoveredMetadata.connectionError, false);
        assert.equal(recoveredMetadata.fault, null, 'a fresh healthy state clears the primary fault');
        assert.equal(capabilities.alarm_generic, false);
    } finally {
        Date.now = originalNow;
        for (const request of reads) request.resolve(validPayload());
        await Promise.allSettled([faultSample, failedRead, recovery].filter(Boolean));
    }
});

test('failed capability publication keeps the last committed primary fault', async () => {
    const originalNow = Date.now;
    let clock = 2000;
    Date.now = () => clock++;
    const { device, reads, capabilities } = makeRealDevice();
    let faultSample;
    let rejectedSample;

    try {
        faultSample = device.getProductionData();
        await nextTurn();
        reads[0].resolve(validPayload({ ChargeState: 4, ChargeEnergy: 4 }));
        await faultSample;
        const faultMetadata = await device.getStatusMetadata();

        device.failCapabilityId = 'measure_charge_energy';
        rejectedSample = device.getProductionData({ force: true, throwOnError: true });
        await nextTurn();
        reads[1].resolve(validPayload({ ChargeState: 1, ChargeEnergy: 5 }));
        await assert.rejects(rejectedSample, /measure_charge_energy publication failed/);

        const metadata = await device.getStatusMetadata();
        assert.equal(metadata.lastUpdated, faultMetadata.lastUpdated);
        assert.equal(metadata.stale, true);
        assert.equal(metadata.connectionError, true);
        assert.deepEqual(metadata.fault, faultMetadata.fault);
        assert.equal(metadata.fault.state, 4);
        assert.equal(capabilities.alarm_generic, false, 'the alarm capability should use the candidate healthy state');
        assert.equal(device.lastResponse.ChargeState, 4, 'a partially published sample must not replace the last good response');
    } finally {
        Date.now = originalNow;
        device.failCapabilityId = null;
        for (const request of reads) request.resolve(validPayload());
        await Promise.allSettled([faultSample, rejectedSample].filter(Boolean));
    }
});

test('an invalid telemetry sample is rejected and cannot receive a healthy timestamp', async () => {
    const { device, reads } = makeRealDevice();
    const poll = device.getProductionData({ throwOnError: true });

    try {
        await nextTurn();
        reads[0].resolve(validPayload({ ChargeState: 3 }));
        await assert.rejects(poll, /neplatn|invalid/i);

        const metadata = await device.getStatusMetadata();
        assert.equal(device.lastResponse ?? null, null);
        assert.equal(metadata.lastUpdated, null);
        assert.equal(metadata.stale, true);
        assert.equal(metadata.connectionError, true);
        assert.equal(metadata.fault, null);
    } finally {
        for (const request of reads) request.resolve(validPayload());
        await Promise.allSettled([poll]);
    }
});
