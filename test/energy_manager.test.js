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

test('concurrent disconnected polls claim and settle pending energy only once', async () => {
    const harness = createHarness({ pendingSessionEnergy: 8 });
    const manager = await createInitializedManager(harness);
    const originalUpdate = manager.updateEnergyStatistics.bind(manager);
    let updateCalls = 0;
    manager.updateEnergyStatistics = async (energy) => {
        updateCalls += 1;
        await new Promise((resolve) => setImmediate(resolve));
        return await originalUpdate(energy);
    };

    await Promise.all([
        manager.processEnergyData(
            { chargeEnergy: 0 },
            CONSTANTS.CHARGE_STATES.CONNECTED,
            CONSTANTS.CHARGE_STATES.DISCONNECTED
        ),
        manager.processEnergyData(
            { chargeEnergy: 0 },
            CONSTANTS.CHARGE_STATES.CONNECTED,
            CONSTANTS.CHARGE_STATES.DISCONNECTED
        )
    ]);

    assert.equal(updateCalls, 1);
    assert.equal(harness.store.get('pendingSessionEnergy'), 0);
    assert.equal(harness.store.get('lifetimeEnergyData').energy, 8);
});

test('failed settlement after statistics write leaves pending claimed and cannot add twice', async () => {
    const harness = createHarness({ pendingSessionEnergy: 8 });
    const manager = await createInitializedManager(harness);
    const originalUpdate = manager.updateEnergyStatistics.bind(manager);
    let updateCalls = 0;
    manager.updateEnergyStatistics = async (energy) => {
        updateCalls += 1;
        await originalUpdate(energy);
        throw new Error('simulated failure after statistics write');
    };

    await assert.rejects(
        () => manager.processEnergyData(
            { chargeEnergy: 0 },
            CONSTANTS.CHARGE_STATES.CONNECTED,
            CONSTANTS.CHARGE_STATES.DISCONNECTED
        ),
        /simulated failure/
    );
    assert.equal(harness.store.get('pendingSessionEnergy'), 0);
    assert.equal(harness.store.get('lifetimeEnergyData').energy, 8);

    assert.equal(await manager.processEnergyData(
        { chargeEnergy: 0 },
        CONSTANTS.CHARGE_STATES.DISCONNECTED,
        CONSTANTS.CHARGE_STATES.DISCONNECTED
    ), 0);
    assert.equal(updateCalls, 1);
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

test('initialize repairs corrupt or excessive pending energy without settling it', async () => {
    for (const invalidPending of [
        -1,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        CONSTANTS.DEVICE.MAX_ENERGY_DELTA + 0.1
    ]) {
        const harness = createHarness({ pendingSessionEnergy: invalidPending });
        const manager = await createInitializedManager(harness);

        assert.equal(harness.store.get('pendingSessionEnergy'), 0);
        assert.equal(await manager.processEnergyData(
            { chargeEnergy: 0 },
            CONSTANTS.CHARGE_STATES.CONNECTED,
            CONSTANTS.CHARGE_STATES.DISCONNECTED
        ), 0);
        assert.equal(harness.store.get('lifetimeEnergyData').energy, 0);
    }
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

test('setLifetimeEnergy rejects non-finite and negative values without changing state', async () => {
    for (const invalidValue of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
        const harness = createHarness({
            lifetimeEnergyData: {
                energy: 12,
                since: '2026-01-01T00:00:00.000Z'
            }
        });
        const manager = await createInitializedManager(harness);
        const writesBefore = harness.capabilityWrites.length;

        assert.equal(await manager.setLifetimeEnergy(invalidValue), false);
        assert.equal(harness.store.get('lifetimeEnergyData').energy, 12);
        assert.equal(harness.capabilities.get('meter_power'), 12);
        assert.equal(harness.capabilityWrites.length, writesBefore);
    }
});
