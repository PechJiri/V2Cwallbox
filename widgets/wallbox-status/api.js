'use strict';

const fetch = require('node-fetch');

module.exports = {
    async getStatus({ homey }) {
        try {
            const driver = homey.drivers.getDriver('v2c-wallbox');
            const devices = await driver.getDevices();

            if (devices.length === 0) {
                throw new Error('No V2C Wallbox devices found');
            }

            const device = devices[0];
            const status = {
                chargeState: await device.getCapabilityValue('measure_charge_state'),
                chargePower: await device.getCapabilityValue('measure_charge_power'),
                chargeEnergy: await device.getCapabilityValue('measure_charge_energy')
            };

            return status;
        } catch (error) {
            console.error('Error in getStatus:', error);
            throw error;
        }
    }
};
