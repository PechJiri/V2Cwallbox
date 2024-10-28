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
            'measure_dynamic',
            'measure_yearly_energy',      // Přidáno: roční kumulativní energie
            'measure_monthly_energy'      // Přidáno: měsíční kumulativní energie
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
        this.homey.flow.getDeviceTriggerCard('slave_error_changed');  // Přidána nová karta

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
        this._registerActionCard('set_dynamic_power_mode', 'DynamicPowerMode');
    }

    _registerConditionFlowCards() {
        this._registerConditionCard('car-connected-condition', 'measure_charge_state', "1");
        this._registerConditionCard('car-is-charging', 'measure_charge_state', "2");
        this._registerPowerConditionCard('power-greater-than', '>');
        this._registerPowerConditionCard('power-less-than', '<');
        this._registerConditionCard('charging-is-paused', 'measure_paused', true);
        this._registerConditionCard('charging-is-not-paused', 'measure_paused', false);
    }

    _registerActionCard(cardId, setting) {
        this.homey.flow.getActionCard(cardId).registerRunListener(async (args, state) => {
            let value = args[setting.toLowerCase()];
            if (value === undefined) {
                value = args[setting];
            }

            if (value === undefined) {
                this.error(`Value for setting ${setting} is undefined. Cannot proceed.`);
                throw new Error(`Value for ${setting} is undefined`);
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
            await this.setCapabilityValue('measure_slave_error', slaveErrorMap[deviceData.slaveError] || "00");

            // Aktuální datum pro měsíční a roční sledování
            const currentYear = new Date().getFullYear();
            const currentMonth = new Date().getMonth() + 1; // Měsíc je indexován od 0

            // Aktualizace měsíční a roční energie při každém nabíjecím cyklu
            if (deviceData.chargeState === 2) { // Auto nabíjí
                // Kumulativní energie pro aktuální nabíjecí cyklus
                const previousEnergy = await this.getStoreValue('accumulatedChargeEnergy') || 0;
                const newAccumulatedEnergy = previousEnergy + deviceData.chargeEnergy;

                await this.setStoreValue('accumulatedChargeEnergy', newAccumulatedEnergy);
                await this.setCapabilityValue('measure_charge_energy', newAccumulatedEnergy);

                // Kumulace měsíční energie
                let storedMonthlyData = await this.getStoreValue('monthlyEnergyData') || { month: currentMonth, energy: 0 };
                if (storedMonthlyData.month !== currentMonth) {
                    // Pokud jsme v novém měsíci, resetujeme měsíční energii
                    storedMonthlyData = { month: currentMonth, energy: deviceData.chargeEnergy };
                } else {
                    // Jinak přičítáme energii k měsíční kumulaci
                    storedMonthlyData.energy += deviceData.chargeEnergy;
                }
                await this.setStoreValue('monthlyEnergyData', storedMonthlyData);
                await this.setCapabilityValue('measure_monthly_energy', storedMonthlyData.energy);

                // Kumulace roční energie
                let storedYearlyData = await this.getStoreValue('yearlyEnergyData') || { year: currentYear, energy: 0 };
                if (storedYearlyData.year !== currentYear) {
                    // Pokud jsme v novém roce, resetujeme roční energii
                    storedYearlyData = { year: currentYear, energy: deviceData.chargeEnergy };
                } else {
                    // Jinak přičítáme energii k roční kumulaci
                    storedYearlyData.energy += deviceData.chargeEnergy;
                }
                await this.setStoreValue('yearlyEnergyData', storedYearlyData);
                await this.setCapabilityValue('measure_yearly_energy', storedYearlyData.energy);
                
            } else if (deviceData.chargeState === 1) { // Auto připojené, ale pauznuto
                // Uchováme poslední známou kumulovanou hodnotu pro aktuální cyklus nabíjení
                const previousEnergy = await this.getStoreValue('accumulatedChargeEnergy') || 0;
                await this.setCapabilityValue('measure_charge_energy', previousEnergy);
            } else { // Auto odpojeno
                // Při odpojení vozidla resetujeme kumulativní energii pro aktuální cyklus
                await this.setStoreValue('accumulatedChargeEnergy', 0);
                await this.setCapabilityValue('measure_charge_energy', 0);
            }

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

    _triggerSlaveErrorChangedFlow(newError) {
        const slaveErrorMap = {
            "00": "No Error",
            "01": "Communication",
            "02": "Reading",
            "03": "Slave",
            "04": "Waiting WiFi",
            "05": "Waiting communication",
            "06": "Wrong IP",
            "07": "Slave not found",
            "08": "Wrong Slave",
            "09": "No response",
            "10": "Clamp not connected"
        };

        const errorDescription = slaveErrorMap[newError] || "Unknown Error";
        this.homey.flow.getDeviceTriggerCard('slave_error_changed').trigger(this, { error_description: errorDescription });
        this.log(`Triggered Slave Error Changed flow with error: ${errorDescription}`);
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
