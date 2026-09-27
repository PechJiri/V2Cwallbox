'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const widgetApi = require('../widgets/wallbox-status/api');
const core = require('../widgets/wallbox-status/public/widget-core.js');
const controllerModule = require('../widgets/wallbox-status/public/widget-controller.js');
const ChargerControl = require('../lib/ChargerControl');
const fixtures = require('./widget_scene_fixtures.json');

const capabilityForRaw = {
    evcharger_charging: (raw) => typeof raw.paused === 'boolean' ? !raw.paused : null,
    evcharger_charging_state: (raw) => raw.evState,
    measure_charge_power: (raw) => raw.chargePower,
    measure_charge_energy: (raw) => raw.chargeEnergy,
    measure_connection_error: (raw) => raw.connectionError,
    locked: (raw) => raw.locked,
    timer_state: (raw) => raw.timerActive,
    target_power_mode: (raw) => raw.targetPowerMode,
    measure_intensity: (raw) => raw.intensity,
    measure_slave_error: (raw) => raw.slaveError,
    target_power: (_raw, options) => options.targetPower
};

function makeDevice(pairingId, initialRaw, options = {}) {
    const raw = { ...initialRaw };
    const reads = [];
    const commands = [];
    const controlWrites = [];
    const store = new Map();
    const device = {
        reads,
        commands,
        controlWrites,
        raw,
        getData: () => ({ id: pairingId }),
        hasCapability: (id) => Object.hasOwn(capabilityForRaw, id),
        getCapabilityValue: (id) => capabilityForRaw[id]?.(raw, options),
        getProductionData: async (requestOptions) => {
            reads.push(requestOptions);
        },
        getStatusMetadata: async () => ({
            lastUpdated: raw.lastUpdated,
            stale: raw.stale,
            connectionError: raw.connectionError,
            fault: raw.fault
        })
    };

    if (options.realChargerControl) {
        device.getSetting = (id) => ({
            phase_mode: '3',
            voltage_type: 'line_to_neutral',
            min_intensity: 6,
            max_intensity: 32
        })[id];
        device.getChargingVoltage = () => 230;
        device.setCapabilityValue = async (id, value) => {
            controlWrites.push(['capability', id, value]);
            if (id === 'evcharger_charging') raw.paused = !value;
        };
        device.getStoreValue = async (id) => store.get(id);
        device.setStoreValue = async (id, value) => {
            controlWrites.push(['store', id, value]);
            store.set(id, value);
        };
        device.v2cApi = {
            setParameter: async (...args) => controlWrites.push(['parameter', ...args]),
            setIntensity: async (...args) => controlWrites.push(['intensity', ...args]),
            setDynamic: async (...args) => controlWrites.push(['dynamic', ...args]),
            setDynamicPowerMode: async (...args) => controlWrites.push(['dynamicPowerMode', ...args])
        };
        device.setChargingPaused = async (paused) => {
            if (!device.chargerControl) device.chargerControl = new ChargerControl(device);
            return device.chargerControl.setChargingPaused(paused);
        };
    } else {
        device.setChargingPaused = async (paused) => {
            commands.push(paused);
            raw.paused = paused;
        };
    }

    return device;
}

function makeBackend(devices) {
    const lookups = [];
    const byPairingId = new Map(devices.map((device) => [device.getData().id, device]));
    return {
        lookups,
        drivers: {
            getDriver(id) {
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

function makeView() {
    return {
        last: null,
        states: [],
        messages: [],
        render(model) {
            this.last = model;
            this.states.push(model.state);
        },
        setBusy(value) {
            this.busy = value;
        },
        message(value) {
            this.messages.push(value);
        },
        clearMessage() {}
    };
}

function makeWidget(devices, deviceId) {
    const backend = makeBackend(devices);
    const view = makeView();
    const requests = [];
    const responses = [];
    const homey = {
        async api(method, path, body) {
            requests.push({ method, path, body });
            const url = new URL(path, 'http://homey-widget.local');
            let result;
            if (method === 'GET' && url.pathname === '/status') {
                result = await widgetApi.getStatus({
                    homey: backend,
                    query: Object.fromEntries(url.searchParams.entries())
                });
            } else if (method === 'POST' && url.pathname === '/paused') {
                result = await widgetApi.setPaused({ homey: backend, body });
            } else {
                throw new Error(`Unexpected widget API request: ${method} ${path}`);
            }
            responses.push({ method, path, result });
            return result;
        },
        hapticFeedback() {}
    };
    const controller = controllerModule.create(homey, view, { deviceId, intervalMs: 60000 });
    return { backend, controller, requests, responses, view };
}

test('the real API routes the selected second wallbox through Resume and fresh zero-power readback', async () => {
    const first = makeDevice('pairing-a', fixtures.ready);
    const second = makeDevice('pairing-b', fixtures.paused);
    const widget = makeWidget([first, second], 'pairing-b');

    try {
        await widget.controller.refresh();
        assert.equal(widget.view.last.state, 'paused');
        await widget.controller.act('resume');

        assert.deepEqual(first.commands, []);
        assert.deepEqual(second.commands, [false]);
        assert.deepEqual(widget.backend.lookups, [
            { id: 'pairing-b' },
            { id: 'pairing-b' },
            { id: 'pairing-b' }
        ]);
        assert.deepEqual(widget.requests.map(({ method }) => method), ['GET', 'POST', 'GET']);
        assert.equal(widget.requests[1].path, '/paused');
        assert.deepEqual(widget.requests[1].body, { paused: false, deviceId: 'pairing-b' });
        assert.match(widget.requests[2].path, /deviceId=pairing-b/);
        assert.match(widget.requests[2].path, /force=true/);
        assert.deepEqual(second.reads, [{ force: true, throwOnError: true }]);
        assert.equal(widget.responses.at(-1).result.confirmed, true);
        assert.equal(widget.view.last.state, 'ready');
        assert.equal(widget.view.last.power, 0);
        assert.equal(widget.view.last.owner, 'homey');
        assert.deepEqual(widget.view.messages, []);
    } finally {
        widget.controller.destroy();
    }
});

test('old EV telemetry cannot hide a real primary fault, while inverter diagnostics stay separate', async () => {
    for (const state of [4, 5, 6]) {
        const device = makeDevice(`fault-${state}`, {
            ...fixtures.charging,
            evState: 'plugged_in_charging',
            fault: { state, description: `Primary fault ${state}` }
        });
        const status = await widgetApi.getStatus({
            homey: makeBackend([device]),
            query: { deviceId: `fault-${state}` }
        });
        const model = core.normalizeStatus(status);

        assert.equal(status.chargeState, '2', 'the legacy field retains the older charging enum');
        assert.equal(model.state, 'fault');
        assert.equal(model.faultCode, String(state));
        assert.notEqual(model.action, 'resume');
        assert.throws(() => core.commandFor('resume', model), /unavailable/);
    }

    const inverterOnly = makeDevice('inverter-only', {
        ...fixtures.charging,
        slaveError: '04',
        fault: null
    });
    const status = await widgetApi.getStatus({
        homey: makeBackend([inverterOnly]),
        query: { deviceId: 'inverter-only' }
    });
    assert.equal(status.slaveError, '04');
    assert.equal(status.fault, null);
    assert.equal(core.normalizeStatus(status).state, 'charging');
});

test('lossy legacy chargeState cannot make explicit null or discharging EV telemetry healthy', async () => {
    for (const evState of [null, 'plugged_in_discharging']) {
        const pairingId = evState === null ? 'null-ev-state' : 'discharging-ev-state';
        const device = makeDevice(pairingId, {
            ...fixtures.charging,
            evState,
            chargePower: 7400,
            targetPowerMode: 'homey'
        });
        const status = await widgetApi.getStatus({
            homey: makeBackend([device]),
            query: { deviceId: pairingId }
        });
        const model = core.normalizeStatus(status);

        assert.equal(status.chargeState, evState === null ? '0' : '2');
        assert.equal(status.physicalCharging, true, 'physicalCharging is derived from measured watts');
        assert.equal(model.state, 'unknown');
        assert.equal(model.action, 'refresh');
        assert.equal(model.owner, null, 'unknown payloads cannot claim a current owner');
    }

    const invalidPower = makeDevice('invalid-power', {
        ...fixtures.charging,
        chargePower: 'not-a-reading'
    });
    const invalidStatus = await widgetApi.getStatus({
        homey: makeBackend([invalidPower]),
        query: { deviceId: 'invalid-power' }
    });
    assert.equal(invalidStatus.chargePower, 'not-a-reading');
    assert.equal(invalidStatus.physicalCharging, null);
    assert.equal(core.normalizeStatus(invalidStatus).state, 'unknown');
});

test('Stop ACK with positive measured power remains unconfirmed by the real controller', async () => {
    const device = makeDevice('stop-positive-power', fixtures.charging);
    const widget = makeWidget([device], 'stop-positive-power');

    try {
        await widget.controller.refresh();
        assert.equal(widget.view.last.state, 'charging');
        await widget.controller.act('pause');

        assert.deepEqual(device.commands, [true]);
        assert.equal(widget.responses.at(-1).result.confirmed, true);
        assert.equal(widget.responses.at(-1).result.paused, true);
        assert.equal(widget.responses.at(-1).result.chargePower, 7400);
        assert.equal(widget.view.last.state, 'paused');
        assert.ok(widget.view.messages.includes('awaiting'));
        assert.deepEqual(device.reads, [{ force: true, throwOnError: true }]);
    } finally {
        widget.controller.destroy();
    }
});

test('explicit unknown selection cannot write; legacy fallback requires exactly one device', async () => {
    const selectedDevice = makeDevice('pairing-a', fixtures.paused);
    const invalid = makeWidget([selectedDevice], 'deleted-wallbox');
    try {
        await invalid.controller.refresh();
        await invalid.controller.act('resume');
        assert.equal(invalid.view.last.state, 'selection');
        assert.deepEqual(selectedDevice.commands, []);
        assert.equal(invalid.requests.some(({ method }) => method === 'POST'), false);
    } finally {
        invalid.controller.destroy();
    }

    const singleDevice = makeDevice('single', fixtures.ready);
    const legacySingle = makeWidget([singleDevice], null);
    try {
        await legacySingle.controller.refresh();
        assert.equal(legacySingle.view.last.state, 'ready');
        assert.deepEqual(legacySingle.backend.lookups, []);
        assert.equal(legacySingle.requests[0].path, '/status');
    } finally {
        legacySingle.controller.destroy();
    }

    const legacyMany = makeWidget([
        makeDevice('first', fixtures.ready),
        makeDevice('second', fixtures.ready)
    ], null);
    try {
        await legacyMany.controller.refresh();
        assert.equal(legacyMany.view.last.state, 'selection');
        assert.deepEqual(legacyMany.backend.lookups, []);
        assert.equal(legacyMany.requests[0].path, '/status');
    } finally {
        legacyMany.controller.destroy();
    }
});

test('Homey zero target does not block selected-wallbox Resume or change target ownership', async () => {
    const device = makeDevice('zero-target-resume', { ...fixtures.paused, intensity: 16 }, {
        targetPower: 0,
        realChargerControl: true
    });
    const widget = makeWidget([device], 'zero-target-resume');

    try {
        await widget.controller.refresh();
        assert.equal(widget.view.last.state, 'paused');
        await widget.controller.act('resume');

        assert.deepEqual(widget.requests.map(({ method }) => method), ['GET', 'POST', 'GET']);
        assert.deepEqual(widget.requests[1].body, { paused: false, deviceId: 'zero-target-resume' });
        assert.match(widget.requests[2].path, /deviceId=zero-target-resume/);
        assert.match(widget.requests[2].path, /force=true/);
        assert.equal(device.raw.paused, false);
        assert.equal(device.raw.targetPowerMode, 'homey');
        assert.equal(device.getCapabilityValue('target_power'), 0);
        assert.equal(device.getCapabilityValue('measure_intensity'), 16);
        assert.equal(widget.view.last.state, 'ready');
        assert.equal(widget.view.last.owner, 'homey');
        assert.equal(widget.view.messages.includes('targetRequired'), false);
        assert.deepEqual(device.controlWrites.filter(([kind]) => ['intensity', 'dynamic', 'dynamicPowerMode'].includes(kind)), []);
        assert.deepEqual(device.controlWrites.filter(([kind]) => kind === 'parameter'), [['parameter', 'Paused', '0']]);
        assert.deepEqual(device.controlWrites.filter(([kind, id]) => kind === 'capability' && id === 'target_power'), []);
    } finally {
        widget.controller.destroy();
    }
});
