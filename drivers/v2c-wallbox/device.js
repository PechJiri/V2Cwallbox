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
            const deviceData = await this.v2cApi.processData(baseSession);
    
            if (!deviceData) {
                throw new Error('No valid device data received');
            }
    
            console.log('Device data received:', deviceData);
    
            // Update basic capabilities
            await this.setCapabilityValue('measure_charge_state', deviceData.chargeState);
            await this.setCapabilityValue('measure_charge_power', deviceData.chargePower);
            await this.setCapabilityValue('measure_voltage_installation', deviceData.voltageInstallation);
            await this.setCapabilityValue('measure_slave_error', deviceData.slaveError);
            await this.setCapabilityValue('measure_charge_time', Math.floor(deviceData.chargeTime / 60));
            await this.setCapabilityValue('measure_paused', deviceData.paused);
            await this.setCapabilityValue('measure_locked', deviceData.measure_locked);
            await this.setCapabilityValue('measure_intensity', deviceData.intensity);
            await this.setCapabilityValue('measure_dynamic', deviceData.dynamic);
    
            // Get current date information
            const currentDate = new Date();
            const currentYear = currentDate.getFullYear();
            const currentMonth = currentDate.getMonth() + 1;
    
            // Get previous state to detect state changes
            const previousState = await this.getStoreValue('previousChargeState') || "0";
            const currentState = deviceData.chargeState;
            
            console.log('Previous state:', previousState, 'Current state:', currentState);
    
            // Handle charge energy based on state and state changes
            if (currentState === "2") { // Currently charging
                const storedBaseEnergy = await this.getStoreValue('baseChargeEnergy') || 0;
                
                if (previousState !== "2") {
                    // Just started charging - store current API value as starting point
                    console.log('Charging started. Current API energy:', deviceData.chargeEnergy);
                    await this.setStoreValue('chargingStartEnergy', deviceData.chargeEnergy);
                    await this.setCapabilityValue('measure_charge_energy', storedBaseEnergy + deviceData.chargeEnergy);
                } else {
                    // Continued charging - use current API value
                    console.log('Continuing to charge. Base energy:', storedBaseEnergy, 'Current API energy:', deviceData.chargeEnergy);
                    await this.setCapabilityValue('measure_charge_energy', storedBaseEnergy + deviceData.chargeEnergy);
                }
            } else if (currentState === "1" && previousState === "2") {
                // Just stopped charging - store the accumulated energy
                const storedBaseEnergy = await this.getStoreValue('baseChargeEnergy') || 0;
                const finalEnergy = storedBaseEnergy + deviceData.chargeEnergy;
                console.log('Charging paused. Storing accumulated energy:', finalEnergy);
                await this.setStoreValue('baseChargeEnergy', finalEnergy);
                await this.setCapabilityValue('measure_charge_energy', finalEnergy);
            } else if (currentState === "1") {
                // Still connected but not charging - maintain last value
                const storedEnergy = await this.getStoreValue('baseChargeEnergy') || 0;
                console.log('Connected but not charging. Maintaining stored energy:', storedEnergy);
                await this.setCapabilityValue('measure_charge_energy', storedEnergy);
            } else if (currentState === "0") {
                // Disconnected - reset everything
                console.log('Car disconnected, resetting all energy values');
                await this.setStoreValue('baseChargeEnergy', 0);
                await this.setStoreValue('chargingStartEnergy', 0);
                await this.setCapabilityValue('measure_charge_energy', 0);
            }
    
            // Handle monthly and yearly energy totals
            if (currentState === "1" && previousState === "2") {
                // Only update monthly/yearly totals when charging stops
                const energyIncrement = deviceData.chargeEnergy;
                
                // Monthly energy
                let monthlyData = await this.getStoreValue('monthlyEnergyData') || { month: currentMonth, energy: 0 };
                if (monthlyData.month !== currentMonth) {
                    monthlyData = { month: currentMonth, energy: energyIncrement };
                } else {
                    monthlyData.energy += energyIncrement;
                }
                await this.setStoreValue('monthlyEnergyData', monthlyData);
                await this.setCapabilityValue('measure_monthly_energy', monthlyData.energy);
    
                // Yearly energy
                let yearlyData = await this.getStoreValue('yearlyEnergyData') || { year: currentYear, energy: 0 };
                if (yearlyData.year !== currentYear) {
                    yearlyData = { year: currentYear, energy: energyIncrement };
                } else {
                    yearlyData.energy += energyIncrement;
                }
                await this.setStoreValue('yearlyEnergyData', yearlyData);
                await this.setCapabilityValue('measure_yearly_energy', yearlyData.energy);
            }
    
            // Store current state for next comparison
            await this.setStoreValue('previousChargeState', currentState);
    
            // Update device availability
            if (!this.getAvailable()) {
                await this.setAvailable();
            }
    
            // Trigger flow cards
            this._triggerFlowCards(currentState);
    
        } catch (error) {
            this.error(`Error in getProductionData: ${error.message}`);
            console.error('Full error:', error);
            this.setUnavailable(`Error retrieving data: ${error.message}`);
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
