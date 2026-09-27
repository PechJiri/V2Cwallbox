'use strict';

// Keep the legacy charge-state field for widget clients that still classify '0'/'1'/'2'.
function deriveChargeState(evState) {
    if (evState === 'plugged_in_charging' || evState === 'plugged_in_discharging') return '2';
    if (evState === 'plugged_in' || evState === 'plugged_in_paused') return '1';
    return '0';
}

function hasOwn(object, property) {
    return object !== null && typeof object === 'object' &&
        Object.prototype.hasOwnProperty.call(object, property);
}

function validateSelectedId(selectedId) {
    if (selectedId === null) return;
    if (typeof selectedId !== 'string' || selectedId.trim() === '') {
        throw new Error('Invalid selected wallbox. Please select a wallbox again.');
    }
}

async function resolveDevice(homey, selectedId) {
    const driver = homey.drivers.getDriver('v2c-wallbox');

    if (selectedId !== null && selectedId !== undefined) {
        validateSelectedId(selectedId);
        let device;
        try {
            // The autocomplete setting stores the app-owned pairing key, which is the
            // documented input to Driver#getDevice().
            device = await driver.getDevice({ id: selectedId });
        } catch (error) {
            throw new Error('The selected wallbox is unavailable. Please select it again.');
        }

        if (!device || device.getData()?.id !== selectedId) {
            throw new Error('The selected wallbox could not be verified. Please select it again.');
        }
        return device;
    }

    const devices = await driver.getDevices();
    if (!Array.isArray(devices) || devices.length === 0) {
        throw new Error('No V2C Wallbox devices found');
    }
    if (devices.length > 1) {
        throw new Error('Select a wallbox in this widget before using it.');
    }
    return devices[0];
}

async function getCapability(device, capability) {
    if (typeof device.hasCapability === 'function' && !device.hasCapability(capability)) {
        return null;
    }
    if (typeof device.getCapabilityValue !== 'function') return null;
    return await device.getCapabilityValue(capability);
}

function isMeasuredPower(value) {
    if (value === null || value === undefined || value === '') return null;
    const watts = Number(value);
    return Number.isFinite(watts) ? watts > 0 : null;
}

async function readCapabilitiesSequentially(device) {
    return {
        chargingPermission: await getCapability(device, 'evcharger_charging'),
        evState: await getCapability(device, 'evcharger_charging_state'),
        chargePower: await getCapability(device, 'measure_charge_power'),
        chargeEnergy: await getCapability(device, 'measure_charge_energy'),
        capabilityConnectionError: await getCapability(device, 'measure_connection_error'),
        locked: await getCapability(device, 'locked'),
        timerActive: await getCapability(device, 'timer_state'),
        targetPowerMode: await getCapability(device, 'target_power_mode'),
        slaveError: await getCapability(device, 'measure_slave_error')
    };
}

async function readStatusMetadata(device) {
    let metadata = null;
    if (typeof device.getStatusMetadata === 'function') {
        try {
            metadata = await device.getStatusMetadata();
        } catch (error) {
            // Freshness metadata is additive. A temporary metadata failure must not hide
            // the established capability status, but it also cannot confirm a command.
            metadata = null;
        }
    }
    return metadata;
}

async function readFaultFallback(device) {
    if (typeof device.getFaultDescriptor !== 'function') return null;
    try {
        return await device.getFaultDescriptor();
    } catch (error) {
        return null;
    }
}

function createStatus(capabilities, metadata, fault) {
    const connectionError = typeof metadata?.connectionError === 'boolean'
        ? metadata.connectionError
        : Boolean(capabilities.capabilityConnectionError);
    const status = {
        chargeState: deriveChargeState(capabilities.evState),
        evState: capabilities.evState,
        chargePower: capabilities.chargePower,
        chargeEnergy: capabilities.chargeEnergy,
        paused: typeof capabilities.chargingPermission === 'boolean' ? !capabilities.chargingPermission : null,
        connectionError,
        physicalCharging: isMeasuredPower(capabilities.chargePower),
        locked: capabilities.locked,
        timerActive: capabilities.timerActive,
        targetPowerMode: capabilities.targetPowerMode,
        slaveError: capabilities.slaveError,
        fault
    };

    if (metadata && typeof metadata === 'object') {
        if (Object.prototype.hasOwnProperty.call(metadata, 'lastUpdated')) {
            status.lastUpdated = metadata.lastUpdated;
        }
        if (Object.prototype.hasOwnProperty.call(metadata, 'stale')) {
            status.stale = metadata.stale;
        }
    }

    return status;
}

function isFreshConfirmation(metadata) {
    return Boolean(
        metadata &&
        metadata.stale === false &&
        metadata.lastUpdated !== null && metadata.lastUpdated !== undefined &&
        metadata.connectionError === false
    );
}

async function readStatus(device, { forced = false } = {}) {
    const capabilities = await readCapabilitiesSequentially(device);
    const metadata = await readStatusMetadata(device);
    const fault = metadata && Object.prototype.hasOwnProperty.call(metadata, 'fault')
        ? metadata.fault
        : await readFaultFallback(device);
    const status = createStatus(capabilities, metadata, fault);

    if (forced) status.confirmed = isFreshConfirmation(metadata);
    return status;
}

async function refreshForConfirmation(device) {
    if (typeof device.getProductionData !== 'function') {
        throw new Error('A fresh wallbox status is not available.');
    }
    await device.getProductionData({ force: true, throwOnError: true });
}

module.exports = {
    async getStatus({ homey, query } = {}) {
        const statusQuery = query && typeof query === 'object' ? query : {};
        const selectedId = hasOwn(statusQuery, 'deviceId') ? statusQuery.deviceId : null;
        validateSelectedId(selectedId);

        const forceValue = hasOwn(statusQuery, 'force') ? statusQuery.force : undefined;
        if (forceValue !== undefined && forceValue !== 'true' && forceValue !== 'false') {
            throw new Error('Invalid status refresh request.');
        }

        const device = await resolveDevice(homey, selectedId);
        const forced = forceValue === 'true';
        if (forced) await refreshForConfirmation(device);
        return await readStatus(device, { forced });
    },

    async setPaused({ homey, body } = {}) {
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
            throw new Error('A pause command body is required.');
        }
        if (typeof body.paused !== 'boolean') {
            throw new Error('The paused value must be an explicit boolean.');
        }
        if (!hasOwn(body, 'deviceId') || body.deviceId === undefined) {
            throw new Error('The selected wallbox is required.');
        }
        validateSelectedId(body.deviceId);

        const device = await resolveDevice(homey, body.deviceId);
        if (typeof device.setChargingPaused !== 'function') {
            throw new Error('This wallbox does not support pause commands.');
        }
        await device.setChargingPaused(body.paused);
        return { success: true };
    }
};
