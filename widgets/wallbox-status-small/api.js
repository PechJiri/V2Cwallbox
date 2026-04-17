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
                evChargingState: device.hasCapability('evcharger_charging_state')
                    ? await device.getCapabilityValue('evcharger_charging_state')
                    : null,
                chargePower: await device.getCapabilityValue('measure_power')
                    || await device.getCapabilityValue('measure_charge_power')
                    || 0,
                sessionEnergy: device.hasCapability('ev_charging_session_energy')
                    ? (await device.getCapabilityValue('ev_charging_session_energy') || 0)
                    : (await device.getCapabilityValue('measure_charge_energy') || 0)
            };
        } catch (error) {
            console.error('Error in wallbox-status-small getStatus:', error);
            throw error;
        }
    }
};
