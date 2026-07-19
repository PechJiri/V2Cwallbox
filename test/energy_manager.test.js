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

function createSettlementTransaction({
    sessionEnergy = 8,
    monthlyEnergy = 10,
    yearlyEnergy = 11,
    lifetimeEnergy = 18
} = {}) {
    const now = new Date();
    return {
        version: 2,
        sessionEnergy,
        createdAt: now.toISOString(),
        baselines: {
            monthlyData: {
                month: now.getMonth() + 1,
                energy: monthlyEnergy - sessionEnergy
            },
            yearlyData: {
                year: now.getFullYear(),
                energy: yearlyEnergy - sessionEnergy
            },
            lifetimeData: {
                energy: lifetimeEnergy - sessionEnergy,
                since: '2026-01-01T00:00:00.000Z'
            }
        },
        targets: {
            monthlyData: {
                month: now.getMonth() + 1,
                energy: monthlyEnergy
            },
            yearlyData: {
                year: now.getFullYear(),
                energy: yearlyEnergy
            },
            lifetimeData: {
                energy: lifetimeEnergy,
                since: '2026-01-01T00:00:00.000Z'
            }
        }
    };
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

test('serializes connected pending writes before a concurrent disconnect claim', async () => {
    const harness = createHarness();
    const manager = await createInitializedManager(harness);
    const originalSetStoreValue = harness.device.setStoreValue;
    let releasePendingWrite;
    let pendingWriteStarted;
    const pendingWriteGate = new Promise((resolve) => {
        releasePendingWrite = resolve;
    });
    const pendingWriteEntered = new Promise((resolve) => {
        pendingWriteStarted = resolve;
    });
    harness.device.setStoreValue = async (key, value) => {
        if (key === 'pendingSessionEnergy' && value === 8) {
            pendingWriteStarted();
            await pendingWriteGate;
        }
        return await originalSetStoreValue(key, value);
    };

    const connected = manager.processEnergyData(
        { chargeEnergy: 8 },
        CONSTANTS.CHARGE_STATES.DISCONNECTED,
        CONSTANTS.CHARGE_STATES.CONNECTED
    );
    await pendingWriteEntered;
    const disconnected = manager.processEnergyData(
        { chargeEnergy: 0 },
        CONSTANTS.CHARGE_STATES.CONNECTED,
        CONSTANTS.CHARGE_STATES.DISCONNECTED
    );

    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(harness.store.get('lifetimeEnergyData').energy, 0);
    releasePendingWrite();
    await Promise.all([connected, disconnected]);

    assert.equal(harness.store.get('pendingSessionEnergy'), 0);
    assert.equal(harness.store.get('lifetimeEnergyData').energy, 8);

    const restartedManager = await createInitializedManager(harness);
    await restartedManager.processEnergyData(
        { chargeEnergy: 0 },
        CONSTANTS.CHARGE_STATES.DISCONNECTED,
        CONSTANTS.CHARGE_STATES.DISCONNECTED
    );
    assert.equal(harness.store.get('lifetimeEnergyData').energy, 8);
});

test('connected transition waits for an in-flight disconnect claim', async () => {
    const harness = createHarness({ pendingSessionEnergy: 8 });
    const manager = await createInitializedManager(harness);
    const originalSetStoreValue = harness.device.setStoreValue;
    let releaseClaim;
    let claimStarted;
    const claimGate = new Promise((resolve) => {
        releaseClaim = resolve;
    });
    const claimEntered = new Promise((resolve) => {
        claimStarted = resolve;
    });
    let delayClaim = true;
    harness.device.setStoreValue = async (key, value) => {
        if (delayClaim && key === 'pendingSessionEnergy' && value === 0) {
            claimStarted();
            await claimGate;
            delayClaim = false;
        }
        return await originalSetStoreValue(key, value);
    };

    const disconnected = manager.processEnergyData(
        { chargeEnergy: 0 },
        CONSTANTS.CHARGE_STATES.CONNECTED,
        CONSTANTS.CHARGE_STATES.DISCONNECTED
    );
    await claimEntered;
    let connectedCompleted = false;
    const connected = manager.processEnergyData(
        { chargeEnergy: 0 },
        CONSTANTS.CHARGE_STATES.DISCONNECTED,
        CONSTANTS.CHARGE_STATES.CONNECTED
    ).then((result) => {
        connectedCompleted = true;
        return result;
    });

    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(connectedCompleted, false);
    releaseClaim();
    assert.deepEqual(await Promise.all([disconnected, connected]), [0, 0]);
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

test('failed pending clear preserves transaction and in-memory pending for idempotent retry', async () => {
    const harness = createHarness({ pendingSessionEnergy: 8 });
    const manager = await createInitializedManager(harness);
    const originalSetStoreValue = harness.device.setStoreValue;
    let rejectFirstClaim = true;
    harness.device.setStoreValue = async (key, value) => {
        if (rejectFirstClaim && key === 'pendingSessionEnergy' && value === 0) {
            rejectFirstClaim = false;
            throw new Error('simulated claim failure');
        }
        return await originalSetStoreValue(key, value);
    };

    await assert.rejects(
        () => manager.processEnergyData(
            { chargeEnergy: 0 },
            CONSTANTS.CHARGE_STATES.CONNECTED,
            CONSTANTS.CHARGE_STATES.DISCONNECTED
        ),
        /claim failure/
    );
    assert.equal(manager.pendingSessionEnergy, 8);
    assert.equal(harness.store.get('pendingSessionEnergy'), 8);
    assert.equal(harness.store.get('lifetimeEnergyData').energy, 8);
    assert.equal(harness.store.get('energySettlementTransaction').targets.lifetimeData.energy, 8);

    assert.equal(await manager.processEnergyData(
        { chargeEnergy: 0 },
        CONSTANTS.CHARGE_STATES.CONNECTED,
        CONSTANTS.CHARGE_STATES.DISCONNECTED
    ), 0);
    assert.equal(harness.store.get('pendingSessionEnergy'), 0);
    assert.equal(harness.store.get('lifetimeEnergyData').energy, 8);
    assert.equal(harness.store.get('energySettlementTransaction'), null);
});

test('partial settlement write persists absolute targets and restart replays exactly once', async () => {
    const now = new Date();
    const harness = createHarness({
        pendingSessionEnergy: 8,
        monthlyEnergyData: { month: now.getMonth() + 1, energy: 2 },
        yearlyEnergyData: { year: now.getFullYear(), energy: 3 },
        lifetimeEnergyData: { energy: 10, since: '2026-01-01T00:00:00.000Z' }
    });
    const manager = await createInitializedManager(harness);
    const originalSetStoreValue = harness.device.setStoreValue;
    const storeWrites = [];
    let failYearlyOnce = true;
    harness.device.setStoreValue = async (key, value) => {
        storeWrites.push(key);
        if (failYearlyOnce && key === 'yearlyEnergyData') {
            failYearlyOnce = false;
            throw new Error('simulated partial settlement failure');
        }
        return await originalSetStoreValue(key, value);
    };

    await assert.rejects(
        () => manager.processEnergyData(
            { chargeEnergy: 0 },
            CONSTANTS.CHARGE_STATES.CONNECTED,
            CONSTANTS.CHARGE_STATES.DISCONNECTED
        ),
        /partial settlement/
    );

    const transaction = harness.store.get('energySettlementTransaction');
    assert.equal(storeWrites.indexOf('energySettlementTransaction') < storeWrites.indexOf('monthlyEnergyData'), true);
    assert.equal(transaction.targets.monthlyData.energy, 10);
    assert.equal(transaction.targets.yearlyData.energy, 11);
    assert.equal(transaction.targets.lifetimeData.energy, 18);
    assert.equal(harness.store.get('pendingSessionEnergy'), 8);

    harness.device.setStoreValue = originalSetStoreValue;
    await createInitializedManager(harness);

    assert.equal(harness.store.get('monthlyEnergyData').energy, 10);
    assert.equal(harness.store.get('yearlyEnergyData').energy, 11);
    assert.equal(harness.store.get('lifetimeEnergyData').energy, 18);
    assert.equal(harness.capabilities.get('measure_monthly_energy'), 10);
    assert.equal(harness.capabilities.get('measure_yearly_energy'), 11);
    assert.equal(harness.capabilities.get('meter_power'), 18);
    assert.equal(harness.store.get('pendingSessionEnergy'), 0);
    assert.equal(harness.store.get('energySettlementTransaction'), null);
});

test('restart replays applied absolute targets when pending was not yet cleared without double counting', async () => {
    const transaction = createSettlementTransaction();
    const harness = createHarness({
        pendingSessionEnergy: 8,
        energySettlementTransaction: transaction,
        monthlyEnergyData: transaction.targets.monthlyData,
        yearlyEnergyData: transaction.targets.yearlyData,
        lifetimeEnergyData: transaction.targets.lifetimeData
    });

    await createInitializedManager(harness);

    assert.equal(harness.store.get('monthlyEnergyData').energy, 10);
    assert.equal(harness.store.get('yearlyEnergyData').energy, 11);
    assert.equal(harness.store.get('lifetimeEnergyData').energy, 18);
    assert.equal(harness.store.get('pendingSessionEnergy'), 0);
    assert.equal(harness.store.get('energySettlementTransaction'), null);
    assert.equal(harness.capabilities.get('meter_power'), 18);
});

test('initialize fails closed on malformed transaction and preserves pending energy', async () => {
    const now = new Date();
    const malformedTransaction = createSettlementTransaction({
        lifetimeEnergy: Number.POSITIVE_INFINITY
    });
    const harness = createHarness({
        pendingSessionEnergy: -1,
        energySettlementTransaction: malformedTransaction,
        monthlyEnergyData: { month: now.getMonth() + 1, energy: 2 },
        yearlyEnergyData: { year: now.getFullYear(), energy: 3 },
        lifetimeEnergyData: { energy: 10, since: '2026-01-01T00:00:00.000Z' }
    });

    await assert.rejects(
        () => createInitializedManager(harness),
        /settlement transakce/
    );

    assert.equal(harness.store.get('monthlyEnergyData').energy, 2);
    assert.equal(harness.store.get('yearlyEnergyData').energy, 3);
    assert.equal(harness.store.get('lifetimeEnergyData').energy, 10);
    assert.equal(harness.store.get('pendingSessionEnergy'), -1);
    assert.deepEqual(harness.store.get('energySettlementTransaction'), malformedTransaction);
});

test('rejects structurally corrupt absolute targets without changing transaction or pending', async () => {
    const transaction = createSettlementTransaction();
    transaction.targets.monthlyData.energy = 999;
    const harness = createHarness({
        pendingSessionEnergy: 8,
        energySettlementTransaction: transaction,
        monthlyEnergyData: transaction.baselines.monthlyData,
        yearlyEnergyData: transaction.baselines.yearlyData,
        lifetimeEnergyData: transaction.baselines.lifetimeData
    });

    await assert.rejects(
        () => createInitializedManager(harness),
        /settlement transakce/
    );

    assert.equal(harness.store.get('pendingSessionEnergy'), 8);
    assert.deepEqual(harness.store.get('energySettlementTransaction'), transaction);
    assert.equal(harness.store.get('monthlyEnergyData').energy, 2);
    assert.equal(harness.store.get('yearlyEnergyData').energy, 3);
    assert.equal(harness.store.get('lifetimeEnergyData').energy, 10);
});

test('settlement transaction sanitizes corrupt existing period totals before persisting targets', async () => {
    const now = new Date();
    const harness = createHarness({
        pendingSessionEnergy: 8,
        monthlyEnergyData: { month: now.getMonth() + 1, energy: Number.NaN },
        yearlyEnergyData: { year: now.getFullYear(), energy: -1 },
        lifetimeEnergyData: { energy: 10, since: '2026-01-01T00:00:00.000Z' }
    });
    const manager = await createInitializedManager(harness);

    await manager.processEnergyData(
        { chargeEnergy: 0 },
        CONSTANTS.CHARGE_STATES.CONNECTED,
        CONSTANTS.CHARGE_STATES.DISCONNECTED
    );

    assert.equal(harness.store.get('monthlyEnergyData').energy, 8);
    assert.equal(harness.store.get('yearlyEnergyData').energy, 8);
    assert.equal(harness.store.get('lifetimeEnergyData').energy, 18);
    assert.equal(harness.store.get('energySettlementTransaction'), null);
});

test('lifetime correction resumes a failed settlement before applying the correction', async () => {
    const now = new Date();
    const harness = createHarness({
        pendingSessionEnergy: 8,
        monthlyEnergyData: { month: now.getMonth() + 1, energy: 2 },
        yearlyEnergyData: { year: now.getFullYear(), energy: 3 },
        lifetimeEnergyData: { energy: 10, since: '2026-01-01T00:00:00.000Z' }
    });
    const manager = await createInitializedManager(harness);
    const originalSetStoreValue = harness.device.setStoreValue;
    let failYearlyOnce = true;
    harness.device.setStoreValue = async (key, value) => {
        if (failYearlyOnce && key === 'yearlyEnergyData') {
            failYearlyOnce = false;
            throw new Error('simulated settlement failure before correction');
        }
        return await originalSetStoreValue(key, value);
    };

    await assert.rejects(() => manager.processEnergyData(
        { chargeEnergy: 0 },
        CONSTANTS.CHARGE_STATES.CONNECTED,
        CONSTANTS.CHARGE_STATES.DISCONNECTED
    ));

    assert.equal(await manager.setLifetimeEnergy(100), true);
    assert.equal(harness.store.get('monthlyEnergyData').energy, 10);
    assert.equal(harness.store.get('yearlyEnergyData').energy, 11);
    assert.equal(harness.store.get('lifetimeEnergyData').energy, 100);
    assert.equal(harness.capabilities.get('meter_power'), 100);
    assert.equal(harness.store.get('pendingSessionEnergy'), 0);
    assert.equal(harness.store.get('energySettlementTransaction'), null);
});

test('monthly correction resumes a failed settlement before applying the correction', async () => {
    const now = new Date();
    const harness = createHarness({
        pendingSessionEnergy: 8,
        monthlyEnergyData: { month: now.getMonth() + 1, energy: 2 },
        yearlyEnergyData: { year: now.getFullYear(), energy: 3 },
        lifetimeEnergyData: { energy: 10, since: '2026-01-01T00:00:00.000Z' }
    });
    const manager = await createInitializedManager(harness);
    const originalSetStoreValue = harness.device.setStoreValue;
    let failYearlyOnce = true;
    harness.device.setStoreValue = async (key, value) => {
        if (failYearlyOnce && key === 'yearlyEnergyData') {
            failYearlyOnce = false;
            throw new Error('simulated settlement failure before monthly correction');
        }
        return await originalSetStoreValue(key, value);
    };

    await assert.rejects(() => manager.processEnergyData(
        { chargeEnergy: 0 },
        CONSTANTS.CHARGE_STATES.CONNECTED,
        CONSTANTS.CHARGE_STATES.DISCONNECTED
    ));

    assert.equal(await manager.setMonthlyEnergy(50), true);
    assert.equal(harness.store.get('monthlyEnergyData').energy, 50);
    assert.equal(harness.store.get('yearlyEnergyData').energy, 11);
    assert.equal(harness.store.get('lifetimeEnergyData').energy, 18);
    assert.equal(harness.store.get('pendingSessionEnergy'), 0);
    assert.equal(harness.store.get('energySettlementTransaction'), null);
});

test('setMonthlyAndYearlyEnergy applies both corrections inside one queued operation', async () => {
    const now = new Date();
    const harness = createHarness({
        pendingSessionEnergy: 8,
        monthlyEnergyData: { month: now.getMonth() + 1, energy: 2 },
        yearlyEnergyData: { year: now.getFullYear(), energy: 3 },
        lifetimeEnergyData: { energy: 10, since: '2026-01-01T00:00:00.000Z' }
    });
    const manager = await createInitializedManager(harness);

    assert.equal(await manager.setMonthlyAndYearlyEnergy(20), true);
    assert.equal(harness.store.get('monthlyEnergyData').energy, 20);
    assert.equal(harness.store.get('yearlyEnergyData').energy, 20);
    assert.equal(harness.store.get('lifetimeEnergyData').energy, 10);
    assert.equal(harness.store.get('pendingSessionEnergy'), 8);
});

test('period rollover check waits for an in-flight settlement transaction', async () => {
    const harness = createHarness({ pendingSessionEnergy: 8 });
    const manager = await createInitializedManager(harness);
    const originalSetStoreValue = harness.device.setStoreValue;
    let releaseTransaction;
    let transactionStarted;
    const transactionGate = new Promise((resolve) => { releaseTransaction = resolve; });
    const transactionEntered = new Promise((resolve) => { transactionStarted = resolve; });
    harness.device.setStoreValue = async (key, value) => {
        if (key === 'energySettlementTransaction' && value !== null) {
            transactionStarted();
            await transactionGate;
        }
        return await originalSetStoreValue(key, value);
    };

    const disconnect = manager.processEnergyData(
        { chargeEnergy: 0 },
        CONSTANTS.CHARGE_STATES.CONNECTED,
        CONSTANTS.CHARGE_STATES.DISCONNECTED
    );
    await transactionEntered;
    let rolloverCompleted = false;
    const rollover = manager.resetMonthlyAndYearlyDataIfNeeded().then(() => {
        rolloverCompleted = true;
    });

    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(rolloverCompleted, false);
    releaseTransaction();
    await Promise.all([disconnect, rollover]);
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

test('initialize repairs negative or non-finite pending energy without settling it', async () => {
    for (const invalidPending of [
        -1,
        Number.NaN,
        Number.POSITIVE_INFINITY
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

test('restart restores and settles a valid session total above the per-reading delta guard', async () => {
    const harness = createHarness({ pendingSessionEnergy: 120 });
    const manager = await createInitializedManager(harness);

    assert.equal(await manager.processEnergyData(
        { chargeEnergy: 0 },
        CONSTANTS.CHARGE_STATES.CONNECTED,
        CONSTANTS.CHARGE_STATES.DISCONNECTED
    ), 0);
    assert.equal(harness.store.get('pendingSessionEnergy'), 0);
    assert.equal(harness.store.get('monthlyEnergyData').energy, 120);
    assert.equal(harness.store.get('yearlyEnergyData').energy, 120);
    assert.equal(harness.store.get('lifetimeEnergyData').energy, 120);
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

test('lifetime correction invoked during disconnect settlement runs afterward without a lost update', async () => {
    const harness = createHarness({
        pendingSessionEnergy: 8,
        lifetimeEnergyData: {
            energy: 10,
            since: '2026-01-01T00:00:00.000Z'
        }
    });
    const manager = await createInitializedManager(harness);
    const originalSetStoreValue = harness.device.setStoreValue;
    let releaseClaim;
    let claimStarted;
    const claimGate = new Promise((resolve) => { releaseClaim = resolve; });
    const claimEntered = new Promise((resolve) => { claimStarted = resolve; });
    harness.device.setStoreValue = async (key, value) => {
        if (key === 'pendingSessionEnergy' && value === 0) {
            claimStarted();
            await claimGate;
        }
        return await originalSetStoreValue(key, value);
    };

    const disconnect = manager.processEnergyData(
        { chargeEnergy: 0 },
        CONSTANTS.CHARGE_STATES.CONNECTED,
        CONSTANTS.CHARGE_STATES.DISCONNECTED
    );
    await claimEntered;
    let correctionCompleted = false;
    const correction = manager.setLifetimeEnergy(100).then((result) => {
        correctionCompleted = true;
        return result;
    });

    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(correctionCompleted, false);
    releaseClaim();
    assert.deepEqual(await Promise.all([disconnect, correction]), [0, true]);
    assert.equal(harness.store.get('lifetimeEnergyData').energy, 100);
    assert.equal(harness.capabilities.get('meter_power'), 100);
});
