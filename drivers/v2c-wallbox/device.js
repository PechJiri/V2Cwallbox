'use strict';

const { Device } = require('homey');
const { v2cAPI } = require('./api');

class MyDevice extends Device {

    async onInit() {
        this.log('MyDevice has been initialized');

        await this.setSettings({
            name: this.homey.settings.get('name'),
            v2c_ip: this.homey.settings.get('v2c_ip'),
            update_interval: this.homey.settings.get('update_interval') || 5,  // Výchozí hodnota je 5 sekund
        });

        this.registerCapabilities();
        this.setupFlowCards();

        this.updateInterval = this.homey.settings.get('update_interval') || 5;
        this.startDataFetchInterval(this.updateInterval);
    }

    registerCapabilities() {
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

        capabilities.forEach(async (capability) => {
            if (!this.hasCapability(capability)) {
                await this.addCapability(capability);
            }
        });
    }

    setupFlowCards() {
        this._powerBecomesGreaterThan = this.homey.flow.getDeviceTriggerCard('power-becomes-greater-than');
        this._powerBecomesLessThan = this.homey.flow.getDeviceTriggerCard('power-becomes-less-than');
        this._powerIsGreaterThan = this.homey.flow.getConditionCard('power-is-greater-than');
        this._powerIsLessThan = this.homey.flow.getConditionCard('power-is-less-than');
        this._carConnected = this.homey.flow.getDeviceTriggerCard('car-connected');
        this._carCharging = this.homey.flow.getDeviceTriggerCard('car-start-charging');
    }

    startDataFetchInterval(interval) {
        if (this.dataFetchInterval) {
            this.homey.clearInterval(this.dataFetchInterval);
        }

        this.dataFetchInterval = this.homey.setInterval(async () => {
            await this.getProductionData();
        }, 1000 * interval);  // Interval v sekundách
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

            // Trigger the relevant Flow cards if conditions are met
            if (deviceData.chargeState === 1) {
                this._carConnected.trigger(this, {}, {});
            }

            if (deviceData.chargeState === 2) {
                this._carCharging.trigger(this, {}, {});
            }

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
        console.log(changedKeys);
        console.log(newSettings);

        for (const key of changedKeys) {
            this.homey.settings.set(key, newSettings[key]);
            console.log(`${key}: ${newSettings[key]}`);
        }

        if (changedKeys.includes('update_interval')) {
            this.updateInterval = newSettings['update_interval'];
            this.startDataFetchInterval(this.updateInterval);
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