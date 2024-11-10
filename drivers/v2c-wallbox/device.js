'use strict';

const { Device } = require('homey');
const { v2cAPI } = require('./api');
const PowerCalculator = require('../../lib/power_calculator');

class MyDevice extends Device {
    /**
     * onInit je volána při inicializaci zařízení
     */
    async onInit() {
        this.log('MyDevice has been initialized');

        // Inicializace proměnných pro cache
        this.lastResponse = null;
        this.lastResponseTime = null;

        const ip = this.getSetting('v2c_ip');
        if (!ip) {
            this.error('IP address is not set.');
            return this.setUnavailable('IP address is not set.');
        }
        this.v2cApi = new v2cAPI(ip);

        // Nastavení základních hodnot
        const updateInterval = this.getSetting('update_interval') || 5;

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
            'car_connected',
            'measure_yearly_energy',
            'measure_monthly_energy'
        ];

        for (const capability of capabilities) {
            if (!this.hasCapability(capability)) {
                await this.addCapability(capability);
            }
        }

        this.registerCapabilityListener('measure_paused', async (value) => {
            try {
                this.log('measure_paused button pressed, setting state to:', value);
                
                // Zavolání API pro změnu stavu
                await this.v2cApi.setParameter('Paused', value ? '1' : '0');
                
                // Aktualizace hodnoty capability
                await this.setCapabilityValue('measure_paused', value);
                
                return true;
            } catch (error) {
                this.error('Failed to set paused state:', error);
                throw new Error('Failed to set paused state');
            }
        });

        // Registrace nové flow karty set_power
        this.setPowerAction = this.homey.flow.getActionCard('set_power');
        this.setPowerAction.registerRunListener(async (args, state) => {
            try {
                // Výpočet proudu
                const current = PowerCalculator.calculateCurrent(
                    args.power,
                    args.phase_mode, 
                    args.voltage,
                    args.voltage_type,
                    args.maxAmps
                );
                
                // Nastavení proudu přes API
                await this.v2cApi.setParameter('Intensity', current.toString());
                
                // Vrácení tokenu s vypočteným proudem
                return {
                    calculated_current: current
                };
                
            } catch (error) {
                this.error('Failed to set power:', error);
                throw error;
            }
        });

        this.setupFlowCards();
        this.startDataFetchInterval(this.homey.settings.get('update_interval') || 5);
    }

    setupFlowCards() {
        this.homey.flow.getDeviceTriggerCard('car-connected');
        this.homey.flow.getDeviceTriggerCard('car-start-charging');
        this.homey.flow.getDeviceTriggerCard('car-disconnected');
        this.homey.flow.getDeviceTriggerCard('slave_error_changed');

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
   
    async resetMonthlyAndYearlyDataIfNeeded() {
        const currentDate = new Date();
        const currentYear = currentDate.getFullYear();
        const currentMonth = currentDate.getMonth() + 1;
    
        // Reset monthly data
        let monthlyData = await this.getStoreValue('monthlyEnergyData') || { month: currentMonth, energy: 0 };
        if (monthlyData.month !== currentMonth) {
            monthlyData = { month: currentMonth, energy: 0 };
            await this.setStoreValue('monthlyEnergyData', monthlyData);
            await this.setCapabilityValue('measure_monthly_energy', 0);
        }
    
        // Reset yearly data
        let yearlyData = await this.getStoreValue('yearlyEnergyData') || { year: currentYear, energy: 0 };
        if (yearlyData.year !== currentYear) {
            yearlyData = { year: currentYear, energy: 0 };
            await this.setStoreValue('yearlyEnergyData', yearlyData);
            await this.setCapabilityValue('measure_yearly_energy', 0);
        }
    }
    
    async getProductionData() {
        try {
            const now = Date.now();
            if (this.lastResponse && this.lastResponseTime && (now - this.lastResponseTime < 1000)) {
                return this.processDeviceData(this.lastResponse);
            }
    
            await this.resetMonthlyAndYearlyDataIfNeeded();
    
            const baseSession = await this.v2cApi.getData();
            const deviceData = await this.v2cApi.processData(baseSession);
    
            this.lastResponse = baseSession;
            this.lastResponseTime = now;
    
            if (!deviceData) {
                throw new Error('No valid device data received');
            }
    
            const previousState = await this.getStoreValue('previousChargeState') || "0";
            const currentState = deviceData.chargeState;
    
            let chargeEnergy = 0;
            const storedBaseEnergy = await this.getStoreValue('baseChargeEnergy') || 0;
    
            switch(currentState) {
                case "2":
                    chargeEnergy = storedBaseEnergy + deviceData.chargeEnergy;
                    if (previousState !== "2") {
                        await this.setStoreValue('chargingStartEnergy', deviceData.chargeEnergy);
                    }
                    break;
                case "1":
                    if (previousState === "2") {
                        chargeEnergy = storedBaseEnergy + deviceData.chargeEnergy;
                        await this.setStoreValue('baseChargeEnergy', chargeEnergy);
                    } else {
                        chargeEnergy = storedBaseEnergy;
                    }
                    break;
                case "0":
                    await this.setStoreValue('baseChargeEnergy', 0);
                    await this.setStoreValue('chargingStartEnergy', 0);
                    break;
            }
    
            await Promise.all([
                this.setCapabilityValue('measure_charge_state', deviceData.chargeState),
                this.setCapabilityValue('measure_charge_power', deviceData.chargePower),
                this.setCapabilityValue('measure_voltage_installation', deviceData.voltageInstallation),
                this.setCapabilityValue('measure_slave_error', deviceData.slaveError),
                this.setCapabilityValue('measure_charge_time', Math.floor(deviceData.chargeTime / 60)),
                this.setCapabilityValue('measure_paused', deviceData.paused),
                this.setCapabilityValue('measure_locked', deviceData.measure_locked),
                this.setCapabilityValue('measure_intensity', deviceData.intensity),
                this.setCapabilityValue('measure_dynamic', deviceData.dynamic),
                this.setCapabilityValue('measure_charge_energy', chargeEnergy),
                this.setCapabilityValue('car_connected', ["1", "2"].includes(currentState))
            ]);
    
            if (currentState === "1" && previousState === "2") {
                await this.updateEnergyTotals(deviceData.chargeEnergy);
            }
    
            await this.setStoreValue('previousChargeState', currentState);
    
            if (!this.getAvailable()) {
                await this.setAvailable();
            }
    
            this._triggerFlowCards(currentState);
    
        } catch (error) {
            this.error(`Error in getProductionData: ${error.message}`);
            console.error('Full error:', error);
            this.setUnavailable(`Error retrieving data: ${error.message}`);
        }
    }
    
    async updateEnergyTotals(energyIncrement) {
        const currentDate = new Date();
        const currentYear = currentDate.getFullYear();
        const currentMonth = currentDate.getMonth() + 1;
    
        let monthlyData = await this.getStoreValue('monthlyEnergyData') || { month: currentMonth, energy: 0 };
        monthlyData.energy += energyIncrement;
        await this.setStoreValue('monthlyEnergyData', monthlyData);
        await this.setCapabilityValue('measure_monthly_energy', monthlyData.energy);
    
        let yearlyData = await this.getStoreValue('yearlyEnergyData') || { year: currentYear, energy: 0 };
        yearlyData.energy += energyIncrement;
        await this.setStoreValue('yearlyEnergyData', yearlyData);
        await this.setCapabilityValue('measure_yearly_energy', yearlyData.energy);
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
