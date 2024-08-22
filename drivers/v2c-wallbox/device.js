'use strict';

const { Device } = require('homey');
const { v2cAPI } = require('./api');

class MyDevice extends Device {

    async onInit() {
        this.log('MyDevice has been initialized');

        // Initialize v2cAPI with the IP from settings
        const ip = this.homey.settings.get('v2c_ip');
        this.v2cApi = new v2cAPI(ip);

        // Set initial settings for the device
        await this.setSettings({
            name: this.homey.settings.get('name'),
            v2c_ip: ip,
            update_interval: this.homey.settings.get('update_interval') || 5,  // Default interval is 5 seconds
        });

        // Add capabilities to the device if they don't exist yet
        const capabilities = [
            'measure_charge_state',
            'measure_charge_power',
            'measure_voltage_installation',
            'measure_charge_energy',
            'measure_slave_error',
            'measure_charge_time',
            'measure_paused',
            'measure_locked',
            'measure_intensity',
            'measure_dynamic'
        ];

        for (const capability of capabilities) {
            if (!this.hasCapability(capability)) {
                await this.addCapability(capability);
            }
        }

        // Set up Flow cards
        this.setupFlowCards();

        // Start fetching data at regular intervals
        this.updateInterval = this.homey.settings.get('update_interval') || 5;
        this.startDataFetchInterval(this.updateInterval);
    }

    setupFlowCards() {
        // Register the Flow cards
        this._carConnected = this.homey.flow.getDeviceTriggerCard('car-connected');
        this._carCharging = this.homey.flow.getDeviceTriggerCard('car-start-charging');
        this._carDisconnected = this.homey.flow.getDeviceTriggerCard('car-disconnected');
    }

    startDataFetchInterval(interval) {
        // Clear any existing interval to avoid duplication
        if (this.dataFetchInterval) {
            this.homey.clearInterval(this.dataFetchInterval);
        }

        // Start a new interval to fetch data regularly
        this.dataFetchInterval = this.homey.setInterval(async () => {
            await this.getProductionData();
        }, 1000 * interval);  // Convert seconds to milliseconds
    }

    async getProductionData() {
        try {
            // Fetch data from the V2C API
            const baseSession = await this.v2cApi.getData();
            const deviceData = await this.v2cApi.processData(baseSession);

            // Map charge states and errors
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

            // Update the device's capability values
            await this.setCapabilityValue('measure_charge_state', chargeStateValue);
            await this.setCapabilityValue('measure_charge_power', deviceData.chargePower);
            await this.setCapabilityValue('measure_voltage_installation', deviceData.voltageInstallation);
            await this.setCapabilityValue('measure_charge_energy', deviceData.chargeEnergy);
            await this.setCapabilityValue('measure_slave_error', slaveErrorValue);

            // Convert charge time from seconds to minutes and set it
            const chargeTimeInMinutes = Math.floor(deviceData.chargeTime / 60);
            await this.setCapabilityValue('measure_charge_time', chargeTimeInMinutes);

            // Convert boolean values for paused and locked
            await this.setCapabilityValue('measure_paused', Boolean(deviceData.paused));
            await this.setCapabilityValue('measure_locked', Boolean(deviceData.measure_locked));

            // Convert intensity and dynamic values
            await this.setCapabilityValue('measure_intensity', Number(deviceData.intensity));
            await this.setCapabilityValue('measure_dynamic', Boolean(deviceData.dynamic));

            // Trigger Flow cards based on charge state
            if (deviceData.chargeState === 1) {
                this._carConnected.trigger(this, {}, {});
            }

            if (deviceData.chargeState === 2) {
                this._carCharging.trigger(this, {}, {});
            }

            if (deviceData.chargeState === 0) {
                this._carDisconnected.trigger(this, {}, {});
            }

            // Set the device to available if not already set
            if (!this.getAvailable()) {
                await this.setAvailable();
            }
        } catch (error) {
            this.error(`Unavailable (${error})`);
            this.setUnavailable(`Error retrieving data (${error})`);
        }
    }

    async onSettings({ oldSettings, newSettings, changedKeys }) {
        this.log('MyDevice settings were changed');

        // Update settings and restart the interval if necessary
        for (const key of changedKeys) {
            this.homey.settings.set(key, newSettings[key]);
        }

        if (changedKeys.includes('update_interval')) {
            this.updateInterval = newSettings['update_interval'];
            this.startDataFetchInterval(this.updateInterval);
        }

        if (changedKeys.includes('v2c_ip')) {
            this.v2cApi = new v2cAPI(newSettings['v2c_ip']);  // Update the IP in v2cAPI
        }

        this.getProductionData();
    }

    async onAdded() {
        this.log('MyDevice has been added');
    }

    async onRenamed(name) {
        this.log('MyDevice was renamed');
    }

    async onDeleted() {
        this.log('MyDevice has been deleted');
        if (this.dataFetchInterval) {
            this.homey.clearInterval(this.dataFetchInterval);
        }
    }
}

module.exports = MyDevice;