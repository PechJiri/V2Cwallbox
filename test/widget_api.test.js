'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const widgetApi = require('../widgets/wallbox-status/api');

function makeDevice(id, capabilities = {}) {
    const calls = [];
    const device = {
        calls,
        getData: () => ({ id }),
        hasCapability: (capability) => Object.prototype.hasOwnProperty.call(capabilities, capability),
        getCapabilityValue: async (capability) => capabilities[capability],
        setChargingPaused: async (paused) => calls.push(['setChargingPaused', paused]),
        getProductionData: async (options) => calls.push(['getProductionData', options]),
        getStatusMetadata: async () => ({
            lastUpdated: 1000,
            stale: false,
            connectionError: false,
            fault: null
        })
    };
    return device;
}

function makeHomey(devices) {
    const lookups = [];
    const byPairingId = new Map(devices.map((device) => [device.getData().id, device]));
    return {
        lookups,
        drivers: {
            getDriver: (id) => {
                assert.equal(id, 'v2c-wallbox');
                return {
                    getDevices: async () => devices,
                    getDevice: async (data) => {
                        lookups.push(data);
                        const device = byPairingId.get(data?.id);
                        if (!device) throw new Error('Device not found');
                        return device;
                    }
                };
            }
        }
    };
}

test('an explicit pairing key selects the exact second wallbox for status and command', async () => {
    const first = makeDevice('pairing-a', {
        evcharger_charging: true,
        evcharger_charging_state: 'plugged_in',
        measure_charge_power: 0,
        measure_charge_energy: 2,
        measure_connection_error: false
    });
    const second = makeDevice('pairing-b', {
        evcharger_charging: false,
        evcharger_charging_state: 'plugged_in_charging',
        measure_charge_power: 0,
        measure_charge_energy: 7.5,
        measure_connection_error: false,
        locked: true,
        timer_state: true,
        target_power_mode: 'homey',
        measure_slave_error: '01'
    });
    const homey = makeHomey([first, second]);

    const status = await widgetApi.getStatus({ homey, query: { deviceId: 'pairing-b' } });
    const command = await widgetApi.setPaused({
        homey,
        body: { paused: false, deviceId: 'pairing-b' }
    });

    assert.equal(status.paused, true);
    assert.equal(status.chargeEnergy, 7.5);
    assert.equal(status.evState, 'plugged_in_charging');
    assert.equal(status.physicalCharging, false, 'raw EV state cannot substitute for measured power');
    assert.equal(status.locked, true);
    assert.equal(status.timerActive, true);
    assert.equal(status.targetPowerMode, 'homey');
    assert.equal(status.slaveError, '01');
    assert.equal(status.fault, null, 'an inverter communication diagnostic is not a primary wallbox fault');
    assert.equal(status.lastUpdated, 1000);
    assert.equal(status.stale, false);
    assert.deepEqual(command, { success: true });
    assert.deepEqual(homey.lookups, [{ id: 'pairing-b' }, { id: 'pairing-b' }]);
    assert.deepEqual(first.calls, []);
    assert.deepEqual(second.calls, [['setChargingPaused', false]]);
});

test('an explicit unknown selection errors instead of falling back to the first wallbox', async () => {
    const first = makeDevice('pairing-a', {
        evcharger_charging: true,
        evcharger_charging_state: 'plugged_in',
        measure_charge_power: 0,
        measure_charge_energy: 1,
        measure_connection_error: false
    });
    const second = makeDevice('pairing-b');
    const homey = makeHomey([first, second]);

    await assert.rejects(
        () => widgetApi.getStatus({ homey, query: { deviceId: 'deleted-wallbox' } }),
        /selected wallbox|device not found/i
    );
    await assert.rejects(
        () => widgetApi.setPaused({
            homey,
            body: { paused: true, deviceId: 'deleted-wallbox' }
        }),
        /selected wallbox|device not found/i
    );
    assert.deepEqual(first.calls, []);
});

test('a legacy no-selection widget resolves only when exactly one wallbox is paired', async () => {
    const only = makeDevice('only-wallbox', {
        evcharger_charging: true,
        evcharger_charging_state: 'plugged_in',
        measure_charge_power: 0,
        measure_charge_energy: 0,
        measure_connection_error: false
    });
    const oneDeviceHomey = makeHomey([only]);

    assert.equal((await widgetApi.getStatus({ homey: oneDeviceHomey, query: {} })).chargeEnergy, 0);

    const manyDeviceHomey = makeHomey([only, makeDevice('another-wallbox')]);
    await assert.rejects(
        () => widgetApi.getStatus({ homey: manyDeviceHomey, query: {} }),
        /select a wallbox|reselect/i
    );
});

test('malformed pause commands are rejected before any wallbox write', async () => {
    const device = makeDevice('only-wallbox');
    const homey = makeHomey([device]);
    const invalidBodies = [
        {},
        { paused: 'false', deviceId: 'only-wallbox' },
        { paused: false },
        { paused: true, deviceId: '' }
    ];

    for (const body of invalidBodies) {
        await assert.rejects(() => widgetApi.setPaused({ homey, body }), /paused|device|wallbox/i);
    }
    assert.deepEqual(device.calls, []);
});

test('pause command delegates intent without directly changing lock, timer, or strategy', async () => {
    const device = makeDevice('only-wallbox');
    const homey = makeHomey([device]);

    assert.deepEqual(await widgetApi.setPaused({
        homey,
        body: { paused: true, deviceId: 'only-wallbox' }
    }), { success: true });

    assert.deepEqual(device.calls, [['setChargingPaused', true]]);
    assert.equal(device.calls.some(([kind]) => kind === 'parameter'), false);
    assert.equal(device.calls.some(([kind]) => kind === 'capability'), false);
});

test('forced status refresh asks the device for fresh production data and reports confirmation metadata', async () => {
    const device = makeDevice('only-wallbox', {
        evcharger_charging: false,
        evcharger_charging_state: 'plugged_in_charging',
        measure_charge_power: 0,
        measure_charge_energy: 4,
        measure_connection_error: false,
        locked: false,
        timer_state: false,
        target_power_mode: 'homey',
        measure_slave_error: '00'
    });

    const status = await widgetApi.getStatus({
        homey: makeHomey([device]),
        query: { deviceId: 'only-wallbox', force: 'true' }
    });

    assert.deepEqual(device.calls, [['getProductionData', { force: true, throwOnError: true }]]);
    assert.equal(status.confirmed, true);
    assert.equal(status.physicalCharging, false);
});

test('the primary wallbox fault descriptor comes from the public device accessor', async () => {
    const device = makeDevice('only-wallbox', {
        evcharger_charging: true,
        evcharger_charging_state: 'plugged_out',
        measure_charge_power: 0,
        measure_charge_energy: 0,
        measure_connection_error: false,
        measure_slave_error: '01'
    });
    device.getStatusMetadata = async () => ({
        lastUpdated: 1000,
        stale: false,
        connectionError: false,
        fault: { state: 4, description: 'System failure' }
    });

    const status = await widgetApi.getStatus({ homey: makeHomey([device]), query: {} });
    assert.deepEqual(status.fault, { state: 4, description: 'System failure' });
    assert.equal(status.connectionError, false, 'a wallbox fault is separate from transport connection state');
});

test('baseline devices without the Task 4 metadata accessor do not receive invented freshness', async () => {
    const device = makeDevice('only-wallbox', {
        evcharger_charging: true,
        evcharger_charging_state: 'plugged_in',
        measure_charge_power: 0,
        measure_charge_energy: 0,
        measure_connection_error: false
    });
    delete device.getStatusMetadata;
    delete device.getFaultDescriptor;

    const status = await widgetApi.getStatus({
        homey: makeHomey([device]),
        query: { deviceId: 'only-wallbox', force: 'true' }
    });

    assert.equal(status.confirmed, false);
    assert.equal(Object.hasOwn(status, 'lastUpdated'), false);
    assert.equal(Object.hasOwn(status, 'stale'), false);
});

test('missing permission and measured-power capabilities remain unknown', async () => {
    const device = makeDevice('only-wallbox', {
        evcharger_charging_state: 'plugged_in_charging',
        measure_charge_energy: 0,
        measure_connection_error: false
    });

    const status = await widgetApi.getStatus({ homey: makeHomey([device]), query: {} });

    assert.equal(status.paused, null);
    assert.equal(status.chargePower, null);
    assert.equal(status.physicalCharging, null);
});

test('widget autocomplete returns app pairing keys and the widget no longer uses Homey device-record IDs', async () => {
    const devices = [
        { getName: () => 'Garage', getData: () => ({ id: 'pairing-a' }) },
        { getName: () => 'Driveway', getData: () => ({ id: 'pairing-b' }) }
    ];
    let registeredSetting;
    let autocomplete;
    const originalLoad = Module._load;
    const appPath = path.resolve(__dirname, '../app.js');
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === 'homey') return { App: class App {} };
        return originalLoad.call(this, request, parent, isMain);
    };

    let MyApp;
    try {
        delete require.cache[appPath];
        MyApp = require(appPath);
    } finally {
        Module._load = originalLoad;
        delete require.cache[appPath];
    }

    const app = new MyApp();
    app.log = () => {};
    app.homey = {
        dashboards: {
            getWidget: (id) => {
                assert.equal(id, 'wallbox-status');
                return {
                    registerSettingAutocompleteListener: (settingId, listener) => {
                        registeredSetting = settingId;
                        autocomplete = listener;
                    }
                };
            }
        },
        drivers: {
            getDriver: (id) => {
                assert.equal(id, 'v2c-wallbox');
                return { getDevices: async () => devices };
            }
        }
    };
    await app.onInit();

    assert.equal(registeredSetting, 'device_id');
    assert.deepEqual(await autocomplete('pairing-b'), [{ name: 'Driveway', id: 'pairing-b' }]);
    const compose = JSON.parse(fs.readFileSync(
        path.join(__dirname, '../widgets/wallbox-status/widget.compose.json'),
        'utf8'
    ));
    assert.equal(compose.devices, undefined);
    assert.equal(compose.settings[0].id, 'device_id');
    assert.equal(compose.settings[0].type, 'autocomplete');
});
