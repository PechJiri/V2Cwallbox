'use strict';

const { Device } = require('homey');
const { v2cAPI } = require('./api');
const FlowCardManager = require('./FlowCardManager');
const PowerCalculator = require('../../lib/power_calculator');
const DataValidator = require('../../lib/DataValidator');
const Logger = require('../../lib/Logger');

class MyDevice extends Device {
    /**
     * onInit je volána při inicializaci zařízení
     */
    async onInit() {
        // Inicializace loggeru pro zařízení
        this.logger = new Logger(this.homey, `V2C-Device-${this.getName()}`);
        this.logger.setEnabled(this.getSetting('enable_logging') || false);
        this.logger.log('Inicializace V2C Wallbox zařízení');

        // Inicializace proměnných pro cache
        this.lastResponse = null;
        this.lastResponseTime = null;

        // Inicializace FlowCardManageru
        this.logger.debug('Inicializace FlowCardManageru');
        this.flowCardManager = new FlowCardManager(this.homey, this);
        this.flowCardManager.setLogger(this.logger);
        await this.flowCardManager.initialize();

        // Nastavení PowerCalculatoru jako property pro použití v manageru
        this.powerCalculator = PowerCalculator;

        this.dataValidator = new DataValidator(this.logger);

        // Kontrola IP adresy
        const ip = this.getSetting('v2c_ip');
        if (!ip) {
            this.logger.error('IP adresa není nastavena');
            return this.setUnavailable('IP adresa není nastavena');
        }

        // Inicializace API
        try {
            this.logger.debug('Inicializace V2C API', { ip });
            this.v2cApi = new v2cAPI(this.homey, ip);
            this.v2cApi.setLoggingEnabled(this.getSetting('enable_logging') || false);
        } catch (error) {
            this.logger.error('Chyba při inicializaci V2C API', error);
            return this.setUnavailable('Chyba při inicializaci API');
        }

        // Nastavení capabilities
        await this.initializeCapabilities();

        // Registrace listeneru pro tlačítko pause
        this.registerPauseListener();

        // Spuštění intervalu pro aktualizaci dat
        const updateInterval = this.getSetting('update_interval') || 5;
        this.startDataFetchInterval(updateInterval);
    }

    async initializeCapabilities() {
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
                this.logger.debug(`Přidávání capability: ${capability}`);
                await this.addCapability(capability);
            }
        }
    }

    registerPauseListener() {
        this.registerCapabilityListener('measure_paused', async (value) => {
            try {
                this.logger.debug('Změna stavu pause', { novýStav: value });
                await this.v2cApi.setParameter('Paused', value ? '1' : '0');
                await this.setCapabilityValue('measure_paused', value);
                return true;
            } catch (error) {
                this.logger.error('Selhalo nastavení stavu pause', error);
                throw new Error('Selhalo nastavení stavu pause');
            }
        });
    }

    startDataFetchInterval(interval) {
        this.logger.debug('Spouštění intervalu pro načítání dat', { interval });
        
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
    
        try {
            // Reset měsíčních dat
            let monthlyData = await this.getStoreValue('monthlyEnergyData') || { month: currentMonth, energy: 0 };
            if (monthlyData.month !== currentMonth) {
                this.logger.debug('Reset měsíčních dat', { 
                    starýMěsíc: monthlyData.month, 
                    novýMěsíc: currentMonth 
                });
                monthlyData = { month: currentMonth, energy: 0 };
                await this.setStoreValue('monthlyEnergyData', monthlyData);
                await this.setCapabilityValue('measure_monthly_energy', 0);
            }
    
            // Reset ročních dat
            let yearlyData = await this.getStoreValue('yearlyEnergyData') || { year: currentYear, energy: 0 };
            if (yearlyData.year !== currentYear) {
                this.logger.debug('Reset ročních dat', { 
                    starýRok: yearlyData.year, 
                    novýRok: currentYear 
                });
                yearlyData = { year: currentYear, energy: 0 };
                await this.setStoreValue('yearlyEnergyData', yearlyData);
                await this.setCapabilityValue('measure_yearly_energy', 0);
            }
        } catch (error) {
            this.logger.error('Chyba při resetu měsíčních/ročních dat', error);
        }
    }
    
    async getProductionData() {
        try {
            const now = Date.now();
            if (this.lastResponse && this.lastResponseTime && (now - this.lastResponseTime < 1000)) {
                this.logger.debug('Použita cache data');
                return this.processDeviceData(this.lastResponse);
            }
    
            await this.resetMonthlyAndYearlyDataIfNeeded();
    
            const baseSession = await this.v2cApi.getData();
    
            // Validace a zpracování dat pomocí DataValidator
            const deviceData = this.dataValidator.validateAndProcessData(baseSession);
            if (!deviceData) {
                throw new Error('Data z API jsou neplatná.');
            }
    
            this.lastResponse = baseSession;
            this.lastResponseTime = now;
    
            const previousState = await this.getStoreValue('previousChargeState') || "0";
            const currentState = deviceData.chargeState;
    
            const chargeEnergy = await this.processEnergyData(deviceData, previousState, currentState);
    
            await this.updateCapabilities(deviceData, currentState, chargeEnergy);
    
            await this.handleStateChanges(currentState, previousState, deviceData);
    
            if (!this.getAvailable()) {
                await this.setAvailable();
            }
        } catch (error) {
            this.logger.error('Chyba při získávání dat', error);
            this.setUnavailable(`Chyba při získávání dat: ${error.message}`);
        }
    }    

    async processEnergyData(deviceData, previousState, currentState) {
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

        this.logger.debug('Zpracování dat o energii', { 
            currentState, 
            previousState, 
            chargeEnergy 
        });

        return chargeEnergy;
    }

    async updateCapabilities(deviceData, currentState, chargeEnergy) {
        try {
            // Aktualizace všech relevantních schopností
            await Promise.all([
                this.setCapabilityValue('measure_charge_state', deviceData.chargeState), // Stav nabíjení
                this.setCapabilityValue('measure_charge_power', deviceData.chargePower), // Okamžitý výkon
                this.setCapabilityValue('measure_voltage_installation', deviceData.voltageInstallation), // Napětí
                this.setCapabilityValue('measure_slave_error', deviceData.slaveError), // Chyba slave
                this.setCapabilityValue('measure_charge_time', Math.floor(deviceData.chargeTime / 60)), // Čas nabíjení v minutách
                this.setCapabilityValue('measure_paused', deviceData.paused), // Stav pauzy
                this.setCapabilityValue('measure_locked', deviceData.measure_locked), // Zamčení zařízení
                this.setCapabilityValue('measure_intensity', deviceData.intensity), // Intenzita proudu (A)
                this.setCapabilityValue('measure_dynamic', deviceData.dynamic), // Dynamický režim
                this.setCapabilityValue('car_connected', ["1", "2"].includes(currentState)), // Připojení auta
                this.setCapabilityValue('measure_charge_energy', chargeEnergy) // Kumulativní energie (kWh)
            ]);
    
            // Logování aktualizovaných hodnot
            this.logger.debug('Capabilities byly úspěšně aktualizovány', { 
                deviceData, 
                chargeEnergy 
            });
        } catch (error) {
            // Zaznamenání chyby při aktualizaci
            this.logger.error('Chyba při aktualizaci capabilities', error);
            throw error;
        }
    }
    

    async handleStateChanges(currentState, previousState, deviceData) {
        // Uložení nového stavu
        await this.setStoreValue('previousChargeState', currentState);
    
        // Trigger flow karet podle stavu
        if (currentState !== previousState) {
            await this._handleStateChangeTriggers(currentState, previousState);
        }
    
        // Kontrola změny slave error
        const previousSlaveError = await this.getStoreValue('previousSlaveError');
        if (deviceData.slaveError !== previousSlaveError) {
            // Použijeme flowCardManager místo neexistující metody
            await this.flowCardManager.triggerSlaveErrorChanged(deviceData.slaveError); 
            await this.setStoreValue('previousSlaveError', deviceData.slaveError);
        }
    }
    
    // Přidáme metodu pro obsluhu state změn
    async _handleStateChangeTriggers(newState, oldState) {
        try {
            if (newState === "1" && oldState === "0") {
                await this.flowCardManager.triggerCarConnected();
            } else if (newState === "0" && oldState === "1") {
                await this.flowCardManager.triggerCarDisconnected();  
            } else if (newState === "2" && (oldState === "0" || oldState === "1")) {
                await this.flowCardManager.triggerCarStartCharging();
            }
        } catch (error) {
            this.logger.error('Chyba při spouštění flow triggeru', error);
        }
    }

    async onSettings({ oldSettings, newSettings, changedKeys }) {
        this.logger.debug('Změna nastavení zařízení', { 
            oldSettings, 
            newSettings, 
            changedKeys 
        });

        try {
            // Aktualizace nastavení v Homey
            changedKeys.forEach((key) => {
                this.homey.settings.set(key, newSettings[key]);
            });

            // Kontrola změny intervalu aktualizace
            if (changedKeys.includes('update_interval')) {
                this.startDataFetchInterval(newSettings['update_interval']);
            }

            // Kontrola změny IP adresy
            if (changedKeys.includes('v2c_ip')) {
                this.v2cApi = new v2cAPI(this.homey, newSettings['v2c_ip']);
            }

            // Kontrola změny logování
            if (changedKeys.includes('enable_logging')) {
                this.logger.setEnabled(newSettings['enable_logging']);
                this.v2cApi.setLoggingEnabled(newSettings['enable_logging']);
            }

            this.getProductionData();
        } catch (error) {
            this.logger.error('Chyba při ukládání nastavení', error);
            throw error;
        }
    }

    async onAdded() {
        this.logger.log('Nové zařízení bylo přidáno');
    }

    async onRenamed(name) {
        this.logger.log('Zařízení bylo přejmenováno', { novéJméno: name });
    }

    async onDeleted() {
        this.logger.log('Zařízení bylo smazáno');
        
        if (this.dataFetchInterval) {
            this.homey.clearInterval(this.dataFetchInterval);
        }
        
        if (this.flowCardManager) {
            this.flowCardManager.destroy();
        }

        // Vyčištění historie logů
        this.logger.clearHistory();
    }
}

module.exports = MyDevice;