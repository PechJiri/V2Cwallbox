'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

class FakeElement {
    constructor() {
        this.className = '';
        this.textContent = '';
        this.innerHTML = '';
        this.disabled = false;
        this.dataset = {};
        this.listeners = new Map();
        this.svg = new FakeElementChild();
        this.classList = {
            add: (name) => this._setClass(name, true),
            remove: (name) => this._setClass(name, false),
            contains: (name) => this.className.split(/\s+/).includes(name),
            toggle: (name, force) => {
                const shouldAdd = force === undefined ? !this.classList.contains(name) : Boolean(force);
                this._setClass(name, shouldAdd);
                return shouldAdd;
            }
        };
    }

    _setClass(name, shouldAdd) {
        const classes = new Set(this.className.split(/\s+/).filter(Boolean));
        if (shouldAdd) classes.add(name);
        else classes.delete(name);
        this.className = Array.from(classes).join(' ');
    }

    addEventListener(type, listener) {
        const listeners = this.listeners.get(type) || [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
    }

    setAttribute(name, value) {
        this[name] = value;
    }

    querySelector(selector) {
        return selector === 'svg' ? this.svg : null;
    }

    async dispatch(type, event = {}) {
        const listeners = this.listeners.get(type) || [];
        const results = [];
        for (const listener of listeners) results.push(await listener(event));
        return results;
    }
}

class FakeElementChild {
    constructor() {
        this.innerHTML = '';
    }
}

function makeStatus({
    paused = false,
    chargeState = '1',
    evState = 'plugged_in',
    chargePower = 0,
    chargeEnergy = 3.4,
    connectionError = false,
    physicalCharging = chargePower > 0,
    locked = false,
    timerActive = false,
    targetPowerMode = 'homey',
    fault = null,
    slaveError = '00',
    stale = false,
    confirmed = true
} = {}) {
    return {
        paused,
        chargeState,
        evState,
        chargePower,
        chargeEnergy,
        connectionError,
        physicalCharging,
        locked,
        timerActive,
        targetPowerMode,
        fault,
        slaveError,
        stale,
        confirmed
    };
}

async function flush() {
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    await Promise.resolve();
}

function runWidget(api, settings = { device_id: 'pairing-b', update_interval: '5' }) {
    const htmlPath = path.join(__dirname, '../widgets/wallbox-status/public/index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');
    const scriptMatch = html.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
    assert.ok(scriptMatch, 'widget script exists');

    const elementIds = [
        'container', 'stateText', 'deviceImage', 'powerValue', 'energyValue',
        'controlButton', 'controlButtonText', 'statusDetails', 'commandStatus'
    ];
    const elements = new Map(elementIds.map((id) => [id, new FakeElement()]));
    const documentListeners = new Map();
    const intervals = [];
    const document = {
        visibilityState: 'visible',
        getElementById: (id) => elements.get(id) || null,
        addEventListener: (type, listener) => {
            const listeners = documentListeners.get(type) || [];
            listeners.push(listener);
            documentListeners.set(type, listeners);
        },
        async dispatch(type, event = {}) {
            const listeners = documentListeners.get(type) || [];
            for (const listener of listeners) await listener(event);
        }
    };
    const homey = {
        calls: [],
        getSettings: () => ({ ...settings }),
        ready() {},
        hapticFeedback() {},
        async api(method, apiPath, body) {
            this.calls.push({ method, path: apiPath, body });
            return await api(method, apiPath, body, this.calls);
        }
    };
    const window = { Homey: homey };
    const context = {
        window,
        document,
        console: { warn() {}, error() {}, log() {} },
        setInterval: (callback, delay) => {
            intervals.push({ callback, delay });
            return intervals.length;
        },
        clearInterval() {},
        setTimeout: (callback) => {
            queueMicrotask(callback);
            return 1;
        },
        clearTimeout() {},
        encodeURIComponent,
        Promise,
        Number,
        String,
        Boolean,
        Math
    };
    vm.runInNewContext(scriptMatch[1], context, { filename: htmlPath });
    return { elements, document, homey, intervals };
}

test('Start sends the rendered explicit intent and remains idempotent across repeated Start actions', async () => {
    const pendingPosts = [];
    const calls = [];
    const widget = runWidget(async (method, apiPath, body) => {
        calls.push({ method, path: apiPath, body });
        if (method === 'POST') {
            const post = deferred();
            pendingPosts.push(post);
            return await post.promise;
        }
        if (apiPath.includes('force=true')) return makeStatus({ paused: true, confirmed: false });
        return makeStatus({ paused: calls.filter((call) => call.method === 'GET').length > 1 ? false : true });
    });
    await flush();

    const button = widget.elements.get('controlButton');
    assert.equal(widget.elements.get('controlButtonText').textContent, 'Resume');
    const firstClick = button.dispatch('click');
    await flush();
    assert.equal(button.disabled, true, 'the control stays disabled while the command is pending');
    assert.equal(pendingPosts.length, 1);
    assert.deepEqual(calls.filter((call) => call.method === 'POST').map((call) => call.body.paused), [false]);
    assert.equal(calls.find((call) => call.method === 'POST').body.deviceId, 'pairing-b');
    assert.match(widget.elements.get('commandStatus').textContent, /sending|pending/i);

    await button.dispatch('click');
    assert.equal(pendingPosts.length, 1, 'a second click cannot send a second in-flight command');
    pendingPosts[0].resolve({ success: true });
    await firstClick;
    await flush();

    assert.equal(button.disabled, false);
    const secondClick = button.dispatch('click');
    await flush();
    assert.equal(pendingPosts.length, 2);
    assert.deepEqual(calls.filter((call) => call.method === 'POST').map((call) => call.body.paused), [false, false]);
    pendingPosts[1].resolve({ success: true });
    await secondClick;
    await flush();
    assert.ok(calls.every((call) => !call.path.includes('deviceId=') || call.path.includes('deviceId=pairing-b')));
});

test('a pre-command poll cannot overwrite the forced read started after POST completion', async () => {
    const oldPoll = deferred();
    const confirmation = deferred();
    const calls = [];
    let normalGets = 0;
    const widget = runWidget(async (method, apiPath, body) => {
        calls.push({ method, path: apiPath, body });
        if (method === 'POST') return { success: true };
        if (apiPath.includes('force=true')) return await confirmation.promise;
        normalGets += 1;
        if (normalGets === 1) return makeStatus({ paused: true, chargePower: 1500 });
        if (normalGets === 2) return await oldPoll.promise;
        return makeStatus({ paused: true, chargePower: 0 });
    });
    await flush();
    widget.intervals[0].callback();
    await flush();
    assert.equal(normalGets, 2);

    const click = widget.elements.get('controlButton').dispatch('click');
    await flush();
    const postIndex = calls.findIndex((call) => call.method === 'POST');
    const forcedReadIndex = calls.findIndex((call) => call.method === 'GET' && call.path.includes('force=true'));
    assert.ok(postIndex >= 0);
    assert.ok(forcedReadIndex > postIndex, 'the confirming read starts after the command response');
    assert.equal(widget.elements.get('powerValue').textContent, '1.5');

    oldPoll.resolve(makeStatus({ paused: false, chargePower: 0 }));
    await flush();
    assert.equal(widget.elements.get('powerValue').textContent, '1.5', 'old data is ignored after a command starts');

    confirmation.resolve(makeStatus({ paused: false, chargePower: 2200, confirmed: true }));
    await click;
    await flush();
    assert.equal(widget.elements.get('powerValue').textContent, '2.2');
    assert.match(widget.elements.get('commandStatus').textContent, /confirmed/i);
});

test('a failed POST shows an error and keeps the last confirmed physical sample', async () => {
    const widget = runWidget(async (method) => {
        if (method === 'POST') throw new Error('write rejected');
        return makeStatus({ paused: true, chargePower: 1500 });
    });
    await flush();
    const button = widget.elements.get('controlButton');

    await button.dispatch('click');
    await flush();

    assert.equal(button.disabled, false);
    assert.equal(widget.elements.get('powerValue').textContent, '1.5');
    assert.match(widget.elements.get('commandStatus').textContent, /failed|error/i);
});

test('a successful command with unavailable confirmation stays visibly unconfirmed and separates permission from power', async () => {
    const widget = runWidget(async (method, apiPath) => {
        if (method === 'POST') return { success: true };
        if (apiPath.includes('force=true')) throw new Error('fresh read unavailable');
        return makeStatus({
            paused: true,
            chargeState: '2',
            evState: 'plugged_in_charging',
            chargePower: 0,
            locked: true,
            timerActive: true,
            slaveError: '01',
            confirmed: true
        });
    });
    await flush();

    await widget.elements.get('controlButton').dispatch('click');
    await flush();

    assert.equal(widget.elements.get('stateText').textContent, 'Paused');
    assert.equal(widget.elements.get('powerValue').textContent, '0.0');
    assert.match(widget.elements.get('statusDetails').textContent, /permission paused/i);
    assert.match(widget.elements.get('statusDetails').textContent, /ev reports charging/i);
    assert.match(widget.elements.get('statusDetails').textContent, /no measured power draw/i);
    assert.match(widget.elements.get('statusDetails').textContent, /locked/i);
    assert.match(widget.elements.get('statusDetails').textContent, /timer active/i);
    assert.doesNotMatch(widget.elements.get('statusDetails').textContent, /fault code/i);
    assert.match(widget.elements.get('commandStatus').textContent, /unconfirmed/i);
    assert.equal(widget.elements.get('controlButton').disabled, false);
});

test('initial load errors recover on retry and visibility return triggers an immediate refresh', async () => {
    let gets = 0;
    const widget = runWidget(async (method) => {
        if (method !== 'GET') return { success: true };
        gets += 1;
        if (gets === 1) throw new Error('initial offline');
        return makeStatus({ paused: false, chargePower: 800 });
    });
    await flush();
    assert.equal(widget.elements.get('stateText').textContent, 'Offline');

    widget.intervals[0].callback();
    await flush();
    assert.equal(gets, 2);
    assert.equal(widget.elements.get('powerValue').textContent, '0.8');

    widget.document.visibilityState = 'hidden';
    await widget.document.dispatch('visibilitychange');
    assert.equal(gets, 2);
    widget.document.visibilityState = 'visible';
    await widget.document.dispatch('visibilitychange');
    await flush();
    assert.equal(gets, 3);
});

test('selection guidance is visible when a legacy widget has multiple possible wallboxes', async () => {
    const widget = runWidget(async () => {
        throw new Error('Select a wallbox in this widget before using it.');
    }, { update_interval: '5' });
    await flush();

    assert.match(widget.elements.get('statusDetails').textContent, /select a wallbox in this widget/i);
});

test('a documented primary wallbox fault takes precedence over disconnected and power states', async () => {
    const widget = runWidget(async () => makeStatus({
        paused: false,
        chargeState: '0',
        evState: 'plugged_out',
        chargePower: 0,
        fault: { state: 4, description: 'System failure' },
        confirmed: true
    }));
    await flush();

    assert.equal(widget.elements.get('stateText').textContent, 'Fault');
    assert.match(widget.elements.get('statusDetails').textContent, /fault: system failure/i);
});

test('missing permission and power readings render unknown and hide the permission-based action', async () => {
    const widget = runWidget(async () => makeStatus({
        paused: null,
        chargeState: '2',
        evState: 'plugged_in_charging',
        chargePower: null,
        physicalCharging: null,
        confirmed: true
    }));
    await flush();

    assert.equal(widget.elements.get('powerValue').textContent, '—');
    assert.equal(widget.elements.get('stateText').textContent, 'Unknown');
    assert.match(widget.elements.get('statusDetails').textContent, /permission unknown/i);
    assert.match(widget.elements.get('statusDetails').textContent, /measured power unavailable/i);
    assert.equal(widget.elements.get('controlButton').classList.contains('visible'), false);
    await widget.elements.get('controlButton').dispatch('click');
    assert.equal(widget.homey.calls.some((call) => call.method === 'POST'), false);
});
