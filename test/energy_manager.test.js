'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const EnergyManager = require('../lib/EnergyManager');
const CONSTANTS = require('../lib/constants');

function createHarness(initialStore = {}) {
    const store = new Map(Object.entries(initialStore));
    const capabilities = new Map([['measure_charge_energy', 0]]);
    const capabilityWrites = [];
    const logger = {
        debug: () => {},
        warn: () => {},
        error: () => {}
    };
    const device = {
        getStoreValue: async (key) => store.get(key),
        setStoreValue: async (key, value) => store.set(key, value),
        getCapabilityValue: async (key) => capabilities.get(key),
        setCapabilityValue: async (key, value) => {
            capabilities.set(key, value);
            capabilityWrites.push([key, value]);
        }
    };

    return { store, capabilities, capabilityWrites, device, logger };
}

async function createInitializedManager(harness) {
    const manager = new EnergyManager(harness.device, harness.logger);
    await manager.initialize();
    return manager;
}

async function processAndDisplay(manager, harness, chargeEnergy, previousState, currentState) {
    const displayedEnergy = await manager.processEnergyData(
        { chargeEnergy },
        previousState,
        currentState
    );
    harness.capabilities.set('measure_charge_energy', displayedEnergy);
    return displayedEnergy;
}

test('pause and resume retain the highest pending session energy without settlement', async () => {
    const harness = createHarness();
    const manager = await createInitializedManager(harness);

    assert.equal(await processAndDisplay(
        manager,
        harness,
        5,
        CONSTANTS.CHARGE_STATES.DISCONNECTED,
        CONSTANTS.CHARGE_STATES.CHARGING
    ), 5);
    assert.equal(await processAndDisplay(
        manager,
        harness,
        6,
        CONSTANTS.CHARGE_STATES.CHARGING,
        CONSTANTS.CHARGE_STATES.CONNECTED
    ), 6);
    assert.equal(await processAndDisplay(
        manager,
        harness,
        4,
        CONSTANTS.CHARGE_STATES.CONNECTED,
        CONSTANTS.CHARGE_STATES.CHARGING
    ), 4);
    assert.equal(harness.store.get('pendingSessionEnergy'), 6);
    assert.equal(await processAndDisplay(
        manager,
        harness,
        7,
        CONSTANTS.CHARGE_STATES.CHARGING,
        CONSTANTS.CHARGE_STATES.CHARGING
    ), 7);

    assert.equal(harness.store.get('pendingSessionEnergy'), 7);
    assert.equal(harness.store.get('monthlyEnergyData'), undefined);
    assert.equal(harness.store.get('yearlyEnergyData'), undefined);
    assert.equal(harness.store.get('lifetimeEnergyData').energy, 0);
});

test('first disconnect settles pending energy once and repeated disconnected polls add nothing', async () => {
    const harness = createHarness();
    const manager = await createInitializedManager(harness);

    await processAndDisplay(
        manager,
        harness,
        8,
        CONSTANTS.CHARGE_STATES.DISCONNECTED,
        CONSTANTS.CHARGE_STATES.CHARGING
    );

    assert.equal(await processAndDisplay(
        manager,
        harness,
        0,
        CONSTANTS.CHARGE_STATES.CHARGING,
        CONSTANTS.CHARGE_STATES.DISCONNECTED
    ), 0);
    assert.equal(harness.store.get('pendingSessionEnergy'), 0);
    assert.equal(harness.store.get('monthlyEnergyData').energy, 8);
    assert.equal(harness.store.get('yearlyEnergyData').energy, 8);
    assert.equal(harness.store.get('lifetimeEnergyData').energy, 8);
    assert.equal(harness.capabilities.get('meter_power'), 8);

    assert.equal(await processAndDisplay(
        manager,
        harness,
        0,
        CONSTANTS.CHARGE_STATES.DISCONNECTED,
        CONSTANTS.CHARGE_STATES.DISCONNECTED
    ), 0);
    assert.equal(harness.store.get('monthlyEnergyData').energy, 8);
    assert.equal(harness.store.get('yearlyEnergyData').energy, 8);
    assert.equal(harness.store.get('lifetimeEnergyData').energy, 8);
});

test('pending session energy survives restart and settles when first observed state is disconnected', async () => {
    const harness = createHarness();
    const firstManager = await createInitializedManager(harness);

    await processAndDisplay(
        firstManager,
        harness,
        4.5,
        CONSTANTS.CHARGE_STATES.DISCONNECTED,
        CONSTANTS.CHARGE_STATES.CHARGING
    );

    const restartedManager = await createInitializedManager(harness);
    assert.equal(await processAndDisplay(
        restartedManager,
        harness,
        0,
        CONSTANTS.CHARGE_STATES.DISCONNECTED,
        CONSTANTS.CHARGE_STATES.DISCONNECTED
    ), 0);
    assert.equal(harness.store.get('pendingSessionEnergy'), 0);
    assert.equal(harness.store.get('lifetimeEnergyData').energy, 4.5);
});

test('invalid negative and excessive session readings do not replace the displayed or pending value', async () => {
    const harness = createHarness();
    const manager = await createInitializedManager(harness);

    await processAndDisplay(
        manager,
        harness,
        5,
        CONSTANTS.CHARGE_STATES.DISCONNECTED,
        CONSTANTS.CHARGE_STATES.CHARGING
    );

    for (const invalidReading of [-1, Number.NaN, Number.POSITIVE_INFINITY, 106]) {
        assert.equal(await processAndDisplay(
            manager,
            harness,
            invalidReading,
            CONSTANTS.CHARGE_STATES.CHARGING,
            CONSTANTS.CHARGE_STATES.CONNECTED
        ), 5);
        assert.equal(harness.store.get('pendingSessionEnergy'), 5);
    }

    await processAndDisplay(
        manager,
        harness,
        0,
        CONSTANTS.CHARGE_STATES.CONNECTED,
        CONSTANTS.CHARGE_STATES.DISCONNECTED
    );
    assert.equal(harness.store.get('lifetimeEnergyData').energy, 5);
});

test('setLifetimeEnergy updates persistent lifetime data and meter_power together', async () => {
    const harness = createHarness({
        lifetimeEnergyData: {
            energy: 12,
            since: '2026-01-01T00:00:00.000Z'
        }
    });
    const manager = await createInitializedManager(harness);

    assert.equal(await manager.setLifetimeEnergy(42.5), true);
    assert.equal(harness.store.get('lifetimeEnergyData').energy, 42.5);
    assert.equal(harness.store.get('lifetimeEnergyData').since, '2026-01-01T00:00:00.000Z');
    assert.equal(harness.capabilities.get('meter_power'), 42.5);
});
