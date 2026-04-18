'use strict';

// Mapování ze systémové capability evcharger_charging_state zpět na původní '0'/'1'/'2'
// které widget frontend používá ke klasifikaci (STATE constants v index.html).
// Po odstranění custom measure_charge_state potřebujeme tuto kompatibilitní vrstvu.
function deriveChargeState(evState) {
    if (evState === 'plugged_in_charging' || evState === 'plugged_in_discharging') return '2';
    if (evState === 'plugged_in' || evState === 'plugged_in_paused') return '1';
    return '0'; // plugged_out nebo null
}

async function resolveDevice(homey, deviceId) {
    const driver = homey.drivers.getDriver('v2c-wallbox');
    const devices = await driver.getDevices();

    if (devices.length === 0) {
        throw new Error('No V2C Wallbox devices found');
    }

    if (deviceId) {
        const match = devices.find(d => {
            const data = d.getData();
            return data && data.id === deviceId;
        });
        if (match) return match;
    }

    // Fallback — první dostupné zařízení (zachování kompatibility starých widget instancí bez settings)
    return devices[0];
}

module.exports = {
    async getStatus({ homey, query }) {
        try {
            const device = await resolveDevice(homey, query?.deviceId);

            // evcharger_charging je invertem bývalého measure_paused.
            // Widget frontend pracuje s `paused` bool, tak to zachováváme v response.
            const charging = device.hasCapability('evcharger_charging')
                ? await device.getCapabilityValue('evcharger_charging')
                : true;

            // Widget frontend klasifikuje stav přes '0'/'1'/'2'. Derivujeme ze systémové
            // evcharger_charging_state (měasure_charge_state už neexistuje).
            const evState = device.hasCapability('evcharger_charging_state')
                ? await device.getCapabilityValue('evcharger_charging_state')
                : null;

            return {
                chargeState: deriveChargeState(evState),
                chargePower: await device.getCapabilityValue('measure_charge_power'),
                chargeEnergy: await device.getCapabilityValue('measure_charge_energy'),
                paused: !charging,
                connectionError: device.hasCapability('measure_connection_error')
                    ? await device.getCapabilityValue('measure_connection_error')
                    : false
            };
        } catch (error) {
            console.error('Error in getStatus:', error);
            throw error;
        }
    },

    async setPaused({ homey, body }) {
        try {
            const device = await resolveDevice(homey, body?.deviceId);

            await device.v2cApi.setParameter('Paused', body.paused ? '1' : '0');
            await device.setCapabilityValue('evcharger_charging', !body.paused);

            return { success: true };
        } catch (error) {
            console.error('Error in setPaused:', error);
            throw error;
        }
    }
};
