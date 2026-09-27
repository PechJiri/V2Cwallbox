'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const widgetDir = path.join(__dirname, '../widgets/wallbox-status/public');
const html = fs.readFileSync(path.join(widgetDir, 'index.html'), 'utf8');
const inlineBootstrap = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .find(([, attributes, body]) => !/\bsrc\s*=/.test(attributes) && body.trim());
assert.ok(inlineBootstrap, 'the production page contains its Homey bootstrap');
assert.match(html, /src="\.\/widget-core\.js"/);
assert.match(html, /src="\.\/widget-controller\.js"/);

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function listen(listeners, type, listener, options) {
    const entries = listeners.get(type) || [];
    entries.push({ listener, once: Boolean(options && options.once) });
    listeners.set(type, entries);
}

function unlisten(listeners, type, listener) {
    const entries = listeners.get(type) || [];
    listeners.set(type, entries.filter((entry) => entry.listener !== listener));
}

async function dispatch(listeners, type, event = {}) {
    const entries = [...(listeners.get(type) || [])];
    for (const entry of entries) {
        await entry.listener(event);
        if (entry.once) unlisten(listeners, type, entry.listener);
    }
}

function makeViewFacade() {
    const state = { view: null, options: null };
    const factory = {
        create(_container, options) {
            const view = {
                model: null,
                history: [],
                feedback: null,
                busy: false,
                destroyed: false,
                render(model) {
                    this.model = model;
                    this.history.push(model);
                },
                setBusy(value) {
                    this.busy = Boolean(value);
                },
                message(key) {
                    this.feedback = key;
                },
                clearMessage() {
                    this.feedback = null;
                },
                click(action) {
                    if (this.busy) return;
                    const selectedAction = action || (this.feedback ? 'refresh' : this.model && this.model.action);
                    if (selectedAction && options.onAction) return options.onAction(selectedAction);
                },
                presentedAction() {
                    return this.feedback ? 'refresh' : this.model && this.model.action;
                },
                destroy() {
                    this.destroyed = true;
                }
            };
            state.view = view;
            state.options = options;
            return view;
        }
    };
    return { factory, state };
}

function runWidget(api, settings = { device_id: 'pairing-b', update_interval: '5' }) {
    const documentListeners = new Map();
    const windowListeners = new Map();
    const timers = new Map();
    const calls = [];
    let nextTimerId = 0;
    let readyCalls = 0;
    const viewHarness = makeViewFacade();
    const document = {
        hidden: false,
        getElementById(id) {
            return id === 'wallbox' ? { id } : null;
        },
        addEventListener(type, listener, options) {
            listen(documentListeners, type, listener, options);
        },
        removeEventListener(type, listener) {
            unlisten(documentListeners, type, listener);
        },
        dispatch(type, event) {
            return dispatch(documentListeners, type, event);
        }
    };
    const homey = {
        getSettings: () => settings,
        __: (key) => key,
        ready: () => { readyCalls += 1; },
        hapticFeedback() {},
        async api(method, apiPath, body) {
            calls.push({ method, path: apiPath, body });
            return api(method, apiPath, body, calls);
        }
    };
    const window = {
        Homey: homey,
        addEventListener(type, listener, options) {
            listen(windowListeners, type, listener, options);
        },
        removeEventListener(type, listener) {
            unlisten(windowListeners, type, listener);
        },
        dispatch(type, event) {
            return dispatch(windowListeners, type, event);
        }
    };
    const context = {
        window,
        document,
        V2CView: viewHarness.factory,
        console: { warn() {}, error() {}, log() {} },
        setTimeout(callback, delay) {
            const id = ++nextTimerId;
            timers.set(id, { callback, delay });
            return id;
        },
        clearTimeout(id) {
            timers.delete(id);
        }
    };
    const corePath = path.join(widgetDir, 'widget-core.js');
    const controllerPath = path.join(widgetDir, 'widget-controller.js');
    vm.runInNewContext(fs.readFileSync(corePath, 'utf8'), context, { filename: corePath });
    vm.runInNewContext(fs.readFileSync(controllerPath, 'utf8'), context, { filename: controllerPath });
    vm.runInNewContext(inlineBootstrap[2], context, { filename: path.join(widgetDir, 'index.html') });

    return {
        calls,
        document,
        homey,
        timers,
        view: viewHarness.state.view,
        readyCalls: () => readyCalls,
        firePoll() {
            const candidate = [...timers.entries()].find(([, timer]) => timer.delay === 5000);
            assert.ok(candidate, 'a normal poll is scheduled after a successful status read');
            timers.delete(candidate[0]);
            candidate[1].callback();
        }
    };
}

function makeStatus(overrides = {}) {
    const chargePower = Object.hasOwn(overrides, 'chargePower') ? overrides.chargePower : 0;
    return {
        connectionError: false,
        stale: false,
        lastUpdated: Date.now(),
        confirmed: true,
        targetPowerMode: 'homey',
        paused: false,
        chargeState: '1',
        evState: 'plugged_in',
        chargePower,
        physicalCharging: typeof chargePower === 'number' && chargePower > 0,
        chargeEnergy: 3.4,
        ...overrides
    };
}

async function flush() {
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    await Promise.resolve();
}

test('string and object autocomplete selections keep the exact pairing ID through POST and status paths', async () => {
    for (const [selection, expectedId, encodedId] of [
        ['pairing-b', 'pairing-b', 'pairing-b'],
        [{ id: 'pairing/with space', name: 'Trydan' }, 'pairing/with space', 'pairing%2Fwith%20space']
    ]) {
        const widget = runWidget(async (method, apiPath) => {
            if (method === 'POST') return { success: true };
            return apiPath.includes('force=true')
                ? makeStatus({ paused: true, chargePower: 0, physicalCharging: false })
                : makeStatus();
        }, { device_id: selection, update_interval: '5' });
        await flush();

        assert.equal(widget.view.model.state, 'ready');
        assert.equal(widget.calls[0].path, '/status?deviceId=' + encodedId);
        await widget.view.click();
        await flush();

        const postIndex = widget.calls.findIndex((call) => call.method === 'POST');
        const forcedIndex = widget.calls.findIndex((call) => call.method === 'GET' && call.path.includes('force=true'));
        assert.ok(postIndex > 0);
        assert.ok(forcedIndex > postIndex);
        assert.equal(widget.calls[postIndex].body.paused, true);
        assert.equal(widget.calls[postIndex].body.deviceId, expectedId);
        assert.equal(widget.view.model.state, 'paused');
    }
});

test('an invalid explicit selection renders selection guidance without calling the API', async () => {
    for (const deviceId of [0, '  ', { name: 'Trydan' }]) {
        const widget = runWidget(async () => {
            throw new Error('An invalid selection must not reach the API.');
        }, { device_id: deviceId, update_interval: '5' });
        await flush();

        assert.equal(widget.readyCalls(), 1);
        assert.equal(widget.calls.length, 0);
        assert.equal(widget.view.model.state, 'selection');
        assert.equal(widget.view.model.action, null);
    }

    const backendSelection = runWidget(async () => {
        throw new Error('Select a wallbox in this widget before using it.');
    }, { device_id: 'missing-pairing-key', update_interval: '5' });
    await flush();
    assert.equal(backendSelection.calls.length, 1);
    assert.equal(backendSelection.view.model.state, 'selection');
});

test('Resume sends the explicit enabled intent and a double click cannot send a second POST', async () => {
    const pendingPost = deferred();
    const widget = runWidget(async (method, apiPath) => {
        if (method === 'POST') return pendingPost.promise;
        if (apiPath.includes('force=true')) return makeStatus({ paused: false, chargePower: 0, physicalCharging: false });
        return makeStatus({ paused: true });
    });
    await flush();
    assert.equal(widget.view.model.state, 'paused');
    assert.equal(widget.view.model.action, 'resume');

    const firstClick = widget.view.click();
    const secondClick = widget.view.click();
    await flush();
    const posts = widget.calls.filter((call) => call.method === 'POST');
    assert.equal(widget.view.busy, true);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].body.paused, false);
    assert.equal(posts[0].body.deviceId, 'pairing-b');
    assert.equal(widget.calls.some((call) => call.method === 'GET' && call.path.includes('force=true')), false);
    assert.equal(secondClick, undefined);

    pendingPost.resolve({ success: true });
    await firstClick;
    await flush();
    const postIndex = widget.calls.findIndex((call) => call.method === 'POST');
    const forcedIndex = widget.calls.findIndex((call) => call.method === 'GET' && call.path.includes('force=true'));
    assert.ok(forcedIndex > postIndex, 'forced confirmation starts only after POST acknowledgement');
    assert.equal(widget.view.busy, false);
    assert.equal(widget.view.model.state, 'ready');
    assert.equal(widget.view.model.owner, 'homey');
});

test('a held normal poll does not block Pause or overwrite the forced readback', async () => {
    const oldPoll = deferred();
    const confirmation = deferred();
    let normalGets = 0;
    const widget = runWidget(async (method, apiPath) => {
        if (method === 'POST') return { success: true };
        if (apiPath.includes('force=true')) return confirmation.promise;
        normalGets += 1;
        if (normalGets === 1) return makeStatus({ chargePower: 1500 });
        return oldPoll.promise;
    });
    await flush();
    assert.equal(widget.view.model.power, 1.5);

    widget.firePoll();
    await flush();
    assert.equal(normalGets, 2);
    const pause = widget.view.click();
    await flush();
    const postIndex = widget.calls.findIndex((call) => call.method === 'POST');
    const forcedIndex = widget.calls.findIndex((call) => call.method === 'GET' && call.path.includes('force=true'));
    assert.ok(postIndex >= 0, 'Pause is sent without waiting for the old poll');
    assert.ok(forcedIndex > postIndex);

    oldPoll.resolve(makeStatus({ chargePower: 0, physicalCharging: false }));
    await flush();
    assert.equal(widget.view.model.power, 1.5, 'the older poll is ignored after the command begins');

    confirmation.resolve(makeStatus({ paused: true, chargePower: 0, physicalCharging: false }));
    await pause;
    assert.equal(widget.view.model.state, 'paused');
    assert.equal(widget.view.model.power, 0);
});

test('POST failure keeps the last sample and its feedback CTA only retries status', async () => {
    let forcedReads = 0;
    const widget = runWidget(async (method, apiPath) => {
        if (method === 'POST') throw new Error('write rejected');
        if (apiPath.includes('force=true')) forcedReads += 1;
        return makeStatus({ chargePower: 1500 });
    });
    await flush();

    await widget.view.click();
    assert.equal(widget.view.model.state, 'charging');
    assert.equal(widget.view.model.power, 1.5);
    assert.equal(widget.view.feedback, 'requestFailed');
    assert.equal(widget.view.presentedAction(), 'refresh');

    await widget.view.click();
    assert.equal(widget.calls.filter((call) => call.method === 'POST').length, 1);
    assert.equal(forcedReads, 1);
    assert.equal(widget.view.feedback, null);
    assert.equal(widget.view.model.state, 'charging');
});

test('a failed command readback becomes unconfirmed and retry never repeats the POST', async () => {
    let forcedReads = 0;
    const widget = runWidget(async (method, apiPath) => {
        if (method === 'POST') return { success: true };
        if (apiPath.includes('force=true')) {
            forcedReads += 1;
            if (forcedReads === 1) throw new Error('fresh read unavailable');
            return makeStatus({ paused: true, chargePower: 0, physicalCharging: false });
        }
        return makeStatus({
            chargeState: '2',
            evState: 'plugged_in_charging',
            chargePower: 0,
            physicalCharging: false,
            locked: true,
            timerActive: true,
            slaveError: '01'
        });
    });
    await flush();
    await widget.view.click();

    assert.equal(widget.view.model.state, 'stale');
    assert.equal(widget.view.model.paused, false);
    assert.equal(widget.view.model.physicalCharging, false);
    assert.equal(widget.view.model.power, 0);
    assert.equal(widget.view.model.locked, true);
    assert.equal(widget.view.model.timerActive, true);
    assert.equal(widget.view.model.owner, null);
    assert.equal(widget.view.feedback, 'awaiting');
    assert.equal(widget.view.presentedAction(), 'refresh');

    await widget.view.click();
    assert.equal(widget.calls.filter((call) => call.method === 'POST').length, 1);
    assert.equal(forcedReads, 2);
    assert.equal(widget.view.model.state, 'paused');
    assert.equal(widget.view.feedback, null);
});

test('offline recovery and visibility return each perform a fresh status read', async () => {
    let gets = 0;
    const widget = runWidget(async () => {
        gets += 1;
        if (gets === 1) throw new Error('initial offline');
        return makeStatus({ chargePower: 800 });
    });
    await flush();
    assert.equal(widget.view.model.state, 'offline');
    assert.equal(widget.view.model.power, null);

    await widget.view.click();
    assert.equal(gets, 2);
    assert.equal(widget.view.model.state, 'charging');
    assert.equal(widget.view.model.power, 0.8);

    widget.document.hidden = true;
    await widget.document.dispatch('visibilitychange');
    assert.equal(gets, 2, 'a hidden widget does not poll');
    widget.document.hidden = false;
    await widget.document.dispatch('visibilitychange');
    await flush();
    assert.equal(gets, 3, 'returning to view performs an immediate read');
});

test('a fresh primary fault outranks disconnected EV telemetry and exposes no Resume action', async () => {
    const widget = runWidget(async () => makeStatus({
        paused: false,
        chargeState: '0',
        evState: 'plugged_out',
        fault: { state: 4, description: 'System failure' },
        targetPowerMode: 'v2c_timed_on'
    }));
    await flush();

    assert.equal(widget.view.model.state, 'fault');
    assert.equal(widget.view.model.faultCode, '4');
    assert.equal(widget.view.model.owner, 'wallbox');
    assert.equal(widget.view.model.action, 'refresh');
    assert.notEqual(widget.view.model.action, 'resume');
});

test('unknown readings remain dashes and do not fall back to legacy chargeState', async () => {
    const widget = runWidget(async () => makeStatus({
        paused: null,
        chargeState: '2',
        evState: null,
        chargePower: null,
        physicalCharging: null,
        chargeEnergy: null
    }));
    await flush();

    assert.equal(widget.view.model.state, 'unknown');
    assert.equal(widget.view.model.presence, null);
    assert.equal(widget.view.model.power, null);
    assert.equal(widget.view.model.energy, null);
    assert.equal(widget.view.model.owner, null);
    assert.equal(widget.view.model.action, 'refresh');
});

test('a fresh payload with unknown EV state does not confirm its control owner', () => {
    const core = require('../widgets/wallbox-status/public/widget-core.js');
    const model = core.normalizeStatus({
        connectionError: false,
        stale: false,
        lastUpdated: 1_800_000_000_000,
        confirmed: true,
        targetPowerMode: 'homey',
        evState: null,
        chargeState: '2',
        paused: false,
        chargePower: 2400,
        physicalCharging: true,
        chargeEnergy: 4.2
    });

    assert.equal(model.state, 'unknown');
    assert.equal(model.power, 2.4);
    assert.equal(model.owner, null);
});
