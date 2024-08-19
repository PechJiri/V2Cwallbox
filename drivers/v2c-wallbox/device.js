'use strict';

const { Device } = require('homey');
const { v2cAPI } = require('./api');

class MyDevice extends Device {

    async onInit() {
        this.log('MyDevice has been initialized');

        await this.setSettings({
            name: this.homey.settings.get('name'),
            v2c_ip: this.homey.settings.get('v2c_ip'),
        });

        if (!this.hasCapability('measure_charge_state')) {
            await this.addCapability('measure_charge_state');
        }
        if (!this.hasCapability('measure_charge_power')) {
            await this.addCapability('measure_charge_power');
        }
        if (!this.hasCapability('measure_voltage_installation')) {
            await this.addCapability('measure_voltage_installation');
        }
        if (!this.hasCapability('measure_charge_energy')) {
            await this.addCapability('measure_charge_energy');
        }
        if (!this.hasCapability('measure_slave_error')) {
            await this.addCapability('measure_slave_error');
        }
        if (!this.hasCapability('measure_charge_time')) {
            await this.addCapability('measure_charge_time');
        }
        if (!this.hasCapability('measure_paused')) {
            await this.addCapability('measure_paused');
        }
        if (!this.hasCapability('measure_locked')) {
            await this.addCapability('measure_locked');
        }
        if (!this.hasCapability('measure_intensity')) {
            await this.addCapability('measure_intensity');
        }
        if (!this.hasCapability('measure_dynamic')) {
            await this.addCapability('measure_dynamic');
        }

        this.getProductionData();

        this.homey.setInterval(async () => {
            await this.getProductionData();
        }, 1000 * 5);
    }

    async getProductionData() {
        try {
            const ip = this.homey.settings.get('v2c_ip');
            const v2cApi = new v2cAPI(ip);

            const baseSession = await v2cApi.getData();
            const deviceData = await v2cApi.processData(baseSession);

            const chargeStateMap = {
                0: "0",  // EV not connected
                1: "1",  // EV connected
                2: "2"   // Charging
            };

            const slaveErrorMap = {
                0: "00",
                1: "01",
                2: "02",
                3: "03",
                4: "04",
                5: "05",
                6: "06",
                7: "07",
                8: "08",
                9: "09",
                10: "10"
            };

            const chargeStateValue = chargeStateMap[deviceData.chargeState] || "0";
            const slaveErrorValue = slaveErrorMap[deviceData.slaveError] || "00";

            await this.setCapabilityValue('measure_charge_state', chargeStateValue);
            await this.setCapabilityValue('measure_charge_power', deviceData.chargePower);
            await this.setCapabilityValue('measure_voltage_installation', deviceData.voltageInstallation);
            await this.setCapabilityValue('measure_charge_energy', deviceData.chargeEnergy);
            await this.setCapabilityValue('measure_slave_error', slaveErrorValue);

            // Convert charge time from seconds to minutes and set it
            const chargeTimeInMinutes = Math.floor(deviceData.chargeTime / 60);
            await this.setCapabilityValue('measure_charge_time', chargeTimeInMinutes);

            // Convert paused and locked values to boolean
            const pausedValue = Boolean(deviceData.paused);
            const lockedValue = Boolean(deviceData.locked);

            await this.setCapabilityValue('measure_paused', pausedValue);
            await this.setCapabilityValue('measure_locked', lockedValue);

            // Convert intensity to number
            const intensityValue = Number(deviceData.intensity);
            await this.setCapabilityValue('measure_intensity', intensityValue);

            // Convert dynamic to boolean (assuming 0 or 1 where 1 = true and 0 = false)
            const dynamicValue = Boolean(deviceData.dynamic);
            await this.setCapabilityValue('measure_dynamic', dynamicValue);

            if (!this.getAvailable()) {
                await this.setAvailable();
            }
        } catch (error) {
            this.error(`Unavailable (${error})`);
            this.setUnavailable(`Error retrieving data (${error})`);
        }
    }

    async onAdded() {
        this.log('MyDevice has been added');
    }

    async onSettings({ oldSettings, newSettings, changedKeys }) {
        this.log('MyDevice settings were changed');
        console.log(changedKeys);
        console.log(newSettings);

        for (const key of changedKeys) {
            this.homey.settings.set(key, newSettings[key]);
            console.log(`${key}: ${newSettings[key]}`);
        }
        this.getProductionData();
    }

    async onRenamed(name) {
        this.log('MyDevice was renamed');
    }

    async onDeleted() {
        this.log('MyDevice has been deleted');
    }

}

module.exports = MyDevice;