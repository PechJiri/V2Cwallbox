'use strict';

module.exports = {
    async getStatus({ homey }) {
        try {
            const driver = homey.drivers.getDriver('v2c-wallbox');
            const devices = await driver.getDevices();

            if (devices.length === 0) {
                throw new Error('No V2C Wallbox devices found');
            }

            const device = devices[0];
            return {
                chargeState: await device.getCapabilityValue('measure_charge_state'),
                evChargingState: device.hasCapability('evcharger_charging_state')
                    ? await device.getCapabilityValue('evcharger_charging_state')
                    : null,
                chargePower: await device.getCapabilityValue('measure_charge_power'),
                chargeEnergy: device.hasCapability('ev_charging_session_energy')
                    ? (await device.getCapabilityValue('ev_charging_session_energy') || 0)
                    : (await device.getCapabilityValue('measure_charge_energy') || 0),
                paused: await device.getCapabilityValue('measure_paused')
            };
        } catch (error) {
            console.error('Error in getStatus:', error);
            throw error;
        }
    },

    async setPaused({ homey, body }) {
        try {
            const driver = homey.drivers.getDriver('v2c-wallbox');
            const devices = await driver.getDevices();

            if (devices.length === 0) {
                throw new Error('No V2C Wallbox devices found');
            }

            const device = devices[0];

            // Preferovat jednotnou cestu přes capability listener (onoff = !paused),
            // která synchronizuje onoff + measure_paused + API voláním jen na 1 místě.
            if (device.hasCapability('onoff')) {
                await device.triggerCapabilityListener('onoff', !body.paused);
            } else {
                await device.v2cApi.setParameter('Paused', body.paused ? '1' : '0');
                await device.setCapabilityValue('measure_paused', body.paused);
            }

            return { success: true };
        } catch (error) {
            console.error('Error in setPaused:', error);
            throw error;
        }
    }
};