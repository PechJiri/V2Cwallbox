'use strict';

const { Device } = require('homey');
const { v2cAPI } = require('./api');

class MyDevice extends Device {

    async onInit() {
        this.log('MyDevice has been initialized');

        const ip = this.homey.settings.get('v2c_ip');
        if (!ip) {
            this.error('IP address is not set.');
            return this.setUnavailable('IP address is not set.');
        }
        this.v2cApi = new v2cAPI(ip);

        await this.setSettings({
            name: this.homey.settings.get('name'),
            v2c_ip: ip,
            update_interval: this.homey.settings.get('update_interval') || 5,
        });

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

        this.setupFlowCards();
        this.startDataFetchInterval(this.homey.settings.get('update_interval') || 5);
    }

    setupFlowCards() {
        this.homey.flow.getDeviceTriggerCard('car-connected');
        this.homey.flow.getDeviceTriggerCard('car-start-charging');
        this.homey.flow.getDeviceTriggerCard('car-disconnected');

        this._registerActionFlowCards();
        this._registerConditionFlowCards();
    }

    _registerActionFlowCards() {
        this._registerActionCard('set_paused', 'Paused');
        this._registerActionCard('set_locked', 'Locked');
        this._registerActionCard('set_intensity', 'Intensity');
        this._registerActionCard('set_dynamic', 'Dynamic');
        this._registerActionCard('set_min_intensity', 'MinIntensity');
        this._registerActionCard('set_max_intensity', 'MaxIntensity');
    }

    _registerConditionFlowCards() {
        this._registerConditionCard('car-connected-condition', 'measure_charge_state', "1");
        this._registerConditionCard('car-is-charging', 'measure_charge_state', "2");
        this._registerPowerConditionCard('power-greater-than', '>');
        this._registerPowerConditionCard('power-less-than', '<');
    }

    _registerActionCard(cardId, setting) {
        this.homey.flow.getActionCard(cardId).registerRunListener(async (args, state) => {
            // Zkontrolujeme obě možnosti: s malými písmeny a s velkými písmeny
            let value = args[setting.toLowerCase()];
            if (value === undefined) {
                value = args[setting];
            }

            console.log(`Attempting to set ${setting} with value: ${value}`);
            return this.v2cApi.setParameter(setting, value);
        });
    }

    _registerConditionCard(cardId, capability, expectedValue) {
        this.homey.flow.getConditionCard(cardId).registerRunListener(async (args, state) => {
            return await this.getCapabilityValue(capability) === expectedValue;
        });
    }

    _registerPowerConditionCard(cardId, operator) {
        this.homey.flow.getConditionCard(cardId).registerRunListener(async (args, state) => {
            const currentPower = await this.getCapabilityValue('measure_charge_power');
            return operator === '>' ? currentPower > args.power : currentPower < args.power;
        });
    }

    startDataFetchInterval(interval) {
        if (this.dataFetchInterval) {
            this.homey.clearInterval(this.dataFetchInterval);
        }

        this.dataFetchInterval = this.homey.setInterval(async () => {
            await this.getProductionData();
        }, 1000 * interval);
    }

    async getProductionData() {
        try {
            const baseSession = await this.v2cApi.getData();
            const deviceData = this.v2cApi.processData(baseSession);

            const chargeStateMap = { 0: "0", 1: "1", 2: "2" };
            const slaveErrorMap = {
                0: "00", 1: "01", 2: "02", 3: "03", 4: "04",
                5: "05", 6: "06", 7: "07", 8: "08", 9: "09", 10: "10"
            };

            await this.setCapabilityValue('measure_charge_state', chargeStateMap[deviceData.chargeState] || "0");
            await this.setCapabilityValue('measure_charge_power', deviceData.chargePower);
            await this.setCapabilityValue('measure_voltage_installation', deviceData.voltageInstallation);
            await this.setCapabilityValue('measure_charge_energy', deviceData.chargeEnergy);
            await this.setCapabilityValue('measure_slave_error', slaveErrorMap[deviceData.slaveError] || "00");

            await this.setCapabilityValue('measure_charge_time', Math.floor(deviceData.chargeTime / 60));
            await this.setCapabilityValue('measure_paused', Boolean(deviceData.paused));
            await this.setCapabilityValue('measure_locked', Boolean(deviceData.measure_locked));
            await this.setCapabilityValue('measure_intensity', Number(deviceData.intensity));
            await this.setCapabilityValue('measure_dynamic', Boolean(deviceData.dynamic));

            this._triggerFlowCards(deviceData.chargeState);

            if (!this.getAvailable()) {
                await this.setAvailable();
            }
        } catch (error) {
            this.error(`Unavailable (${error})`);
            this.setUnavailable(`Error retrieving data (${error})`);
        }
    }

    _triggerFlowCards(chargeState) {
        if (chargeState === 1) {
            this.homey.flow.getDeviceTriggerCard('car-connected').trigger(this, {}, {});
        }

        if (chargeState === 2) {
            this.homey.flow.getDeviceTriggerCard('car-start-charging').trigger(this, {}, {});
        }

        if (chargeState === 0) {
            this.homey.flow.getDeviceTriggerCard('car-disconnected').trigger(this, {}, {});
        }
    }

    async onSettings({ oldSettings, newSettings, changedKeys }) {
        this.log('MyDevice settings were changed');

        changedKeys.forEach((key) => {
            this.homey.settings.set(key, newSettings[key]);
        });

        if (changedKeys.includes('update_interval')) {
            this.startDataFetchInterval(newSettings['update_interval']);
        }

        if (changedKeys.includes('v2c_ip')) {
            this.v2cApi = new v2cAPI(newSettings['v2c_ip']);
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