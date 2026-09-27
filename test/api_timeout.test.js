'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { v2cAPI } = require('../drivers/v2c-wallbox/api');

function createHomeyStub() {
    const entries = [];
    return {
        entries,
        log: (entry) => entries.push(entry),
        error: (entry) => entries.push(entry)
    };
}

function namedError(name) {
    const error = new Error('The operation was aborted due to timeout');
    error.name = name;
    return error;
}

async function withFetch(fetchImpl, run) {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    try {
        return await run();
    } finally {
        globalThis.fetch = originalFetch;
    }
}

test('read timeout errors from Node and legacy aborts use the timeout path exactly once', async () => {
    for (const name of ['TimeoutError', 'AbortError']) {
        const api = new v2cAPI(createHomeyStub(), '10.0.0.20');

        await withFetch(async () => { throw namedError(name); }, async () => {
            await assert.rejects(() => api.getData(), /API timeout - device did not respond in time/);
        });

        assert.equal(api.getErrorCount(), 1, `${name} should increment the API error count once`);
        const timeoutEntries = api.logger.getHistory().filter(({ message }) => message.startsWith('API timeout #'));
        assert.equal(timeoutEntries.length, 1, `${name} should use the timeout diagnostic once`);
        assert.equal(timeoutEntries[0].errorName, name);
    }
});

test('a JSON body parse failure remains a data error, not a timeout', async () => {
    const api = new v2cAPI(createHomeyStub(), '10.0.0.20');

    await withFetch(async () => ({
        ok: true,
        status: 200,
        json: async () => { throw new SyntaxError('Malformed telemetry JSON'); }
    }), async () => {
        await assert.rejects(() => api.getData(), /Failed to load data: Malformed telemetry JSON/);
    });

    assert.equal(api.getErrorCount(), 1);
    assert.equal(api.logger.getHistory().some(({ message }) => message.startsWith('API timeout #')), false);
});

test('session initialization classifies timeouts while preserving the original error', async () => {
    for (const name of ['TimeoutError', 'AbortError']) {
        const api = new v2cAPI(createHomeyStub(), '10.0.0.20');
        const timeout = namedError(name);

        await withFetch(async () => { throw timeout; }, async () => {
            await assert.rejects(() => api.initializeSession(), (error) => error === timeout);
        });

        assert.match(
            api.logger.getHistory().findLast(({ type }) => type === 'error').message,
            /timeout/i
        );
        assert.equal(api.getErrorCount(), 0, 'session probes do not mutate the poll error counter');
    }
});

test('write timeouts are distinguished and leave the write outcome unconfirmed', async () => {
    for (const name of ['TimeoutError', 'AbortError']) {
        const api = new v2cAPI(createHomeyStub(), '10.0.0.20');
        const timeout = namedError(name);

        await withFetch(async () => { throw timeout; }, async () => {
            await assert.rejects(() => api.setParameter('Paused', '1'), (error) => error === timeout);
        });

        const errorLog = api.logger.getHistory().findLast(({ type }) => type === 'error');
        assert.match(errorLog.message, /timeout/i);
        assert.match(errorLog.message, /není potvrzen/i);
        assert.equal(api.getErrorCount(), 0, 'write failures do not mutate the poll error counter');
    }
});
