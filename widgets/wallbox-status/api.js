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
            const status = {
                chargeState: await device.getCapabilityValue('measure_charge_state'),
                chargePower: await device.getCapabilityValue('measure_charge_power'),
                chargeEnergy: await device.getCapabilityValue('measure_charge_energy'),
                paused: await device.getCapabilityValue('measure_paused')
            };

            return status;
        } catch (error) {
            console.error('Error in getStatus:', error);
            throw error;
        }
    },

    async setPaused({ homey, body }) {
        try {
            console.log('setPaused called with body:', body);
            
            const driver = homey.drivers.getDriver('v2c-wallbox');
            const devices = await driver.getDevices();

            if (devices.length === 0) {
                throw new Error('No V2C Wallbox devices found');
            }

            const device = devices[0];
            
            // Volání API wallboxu
            console.log('Calling setParameter with Paused:', body.paused);
            await device.v2cApi.setParameter('Paused', body.paused ? '1' : '0');
            
            // Nastavení capability
            console.log('Setting capability measure_paused');
            await device.setCapabilityValue('measure_paused', body.paused);
            
            return { success: true };
        } catch (error) {
            console.error('Error in setPaused:', error);
            throw error;
        }
    }
};