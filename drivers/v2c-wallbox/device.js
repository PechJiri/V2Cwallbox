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
        try {
            // Inicializace loggeru pro zařízení
            this.logger = new Logger(this.homey, `V2C-Device-${this.getName()}`);
            this.logger.setEnabled(this.getSetting('enable_logging') || false);
            this.logger.log('Inicializace V2C Wallbox zařízení');
    
            // Kontrola a inicializace capability measure_connection_error
            if (!this.hasCapability('measure_connection_error')) {
                this.logger.debug('Přidávám capability measure_connection_error');
                await this.addCapability('measure_connection_error');
            }
            await this.setCapabilityValue('measure_connection_error', false);
            this._lastSuccessfulUpdate = Date.now();
    
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
                await this.setCapabilityValue('measure_connection_error', true);
                return this.setUnavailable('IP adresa není nastavena');
            }
    
            // Inicializace API
            try {
                this.logger.debug('Inicializace V2C API', { ip });
                this.v2cApi = new v2cAPI(this.homey, ip);
                this.v2cApi.setLoggingEnabled(this.getSetting('enable_logging') || false);
            } catch (error) {
                this.logger.error('Chyba při inicializaci V2C API', error);
                await this.setCapabilityValue('measure_connection_error', true);
                return this.setUnavailable('Chyba při inicializaci API');
            }
    
            // Nastavení capabilities
            await this.initializeCapabilities();
    
            // Registrace listeneru pro tlačítko pause
            this.registerPauseListener();
    
            // Spuštění intervalu pro aktualizaci dat
            const updateInterval = this.getSetting('update_interval') || 5;
            this.startDataFetchInterval(updateInterval);
    
            // Inicializační načtení dat pro ověření připojení
            try {
                await this.getProductionData();
            } catch (error) {
                this.logger.warn('Počáteční načtení dat selhalo, ale pokračuji v inicializaci', error);
                await this.setCapabilityValue('measure_connection_error', true);
            }
    
            this.logger.debug('Inicializace zařízení dokončena');
        } catch (error) {
            this.logger.error('Kritická chyba při inicializaci zařízení', error);
            await this.setCapabilityValue('measure_connection_error', true);
            throw error;
        }
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
            'measure_monthly_energy',
            'measure_house_power',    // Spotřeba domu
            'measure_fv_power',       // Výkon FVE
            'measure_battery_power',  // Výkon baterie
            'min_intensity',          // Min proud (6-32A)
            'max_intensity',          // Max proud (6-32A)
            'firmware_version',       // Verze firmware
            'signal_status',          // Síla signálu (1-3)
            'timer_state'            // Stav časovače
        ];
    
        // Přidání chybějících capabilities
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
    
        // Initialize variables outside the try-catch block
        let monthlyData = { month: currentMonth, energy: 0 };
        let yearlyData = { year: currentYear, energy: 0 };
    
        try {
            // Reset monthly data
            const storedMonthlyData = await this.getStoreValue('monthlyEnergyData');
            if (storedMonthlyData) {
                monthlyData = storedMonthlyData;
            }
    
            if (monthlyData.month !== currentMonth) {
                this.logger.debug('Reset měsíčních dat', {
                    oldMonth: monthlyData.month,
                    newMonth: currentMonth,
                });
                monthlyData = { month: currentMonth, energy: 0 };
                await this.setStoreValue('monthlyEnergyData', monthlyData);
                await this.setCapabilityValue('measure_monthly_energy', 0);
            }
    
            // Reset yearly data
            const storedYearlyData = await this.getStoreValue('yearlyEnergyData');
            if (storedYearlyData) {
                yearlyData = storedYearlyData;
            }
    
            if (yearlyData.year !== currentYear) {
                this.logger.debug('Reset ročních dat', {
                    oldYear: yearlyData.year,
                    newYear: currentYear,
                });
                yearlyData = { year: currentYear, energy: 0 };
                await this.setStoreValue('yearlyEnergyData', yearlyData);
                await this.setCapabilityValue('measure_yearly_energy', 0);
            }
        } catch (error) {
            this.logger.error('Chyba při resetu měsíčních/ročních dat', error);
        }
    
        // Log outside the try-catch block for safety
        this.logger.debug('Aktuální statistiky před resetem', {
            monthly: monthlyData,
            yearly: yearlyData,
            currentMonth: currentMonth,
            currentYear: currentYear,
        });
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
    
            // Zpracování dat
            const previousState = await this.getStoreValue('previousChargeState') || "0";
            const currentState = deviceData.chargeState;
            const chargeEnergy = await this.processEnergyData(deviceData, previousState, currentState);
    
            // Aktualizace capabilities
            await this.updateCapabilities(deviceData, currentState, chargeEnergy);
            await this.handleStateChanges(currentState, previousState, deviceData);
    
            // Kontrola změny stavu komunikace
            const hadError = await this.getCapabilityValue('measure_connection_error');
            if (hadError) {
                // Byla chyba a teď je komunikace OK
                await this.setCapabilityValue('measure_connection_error', false);
                await this.flowCardManager.triggerConnectionStateChanged(false);
            }
    
            this._lastSuccessfulUpdate = now;
    
            if (!this.getAvailable()) {
                await this.setAvailable();
            }
        } catch (error) {
            this.logger.error('Chyba při získávání dat', error);
            
            // Kontrola změny stavu komunikace
            const hadError = await this.getCapabilityValue('measure_connection_error');
            if (!hadError) {
                // Nebyla chyba a teď nastala
                await this.setCapabilityValue('measure_connection_error', true);
                await this.flowCardManager.triggerConnectionStateChanged(true);
            }
    
            // Kontrola délky výpadku
            const errorDuration = now - (this._lastSuccessfulUpdate || 0);
            if (errorDuration > 5 * 60 * 1000) { // 5 minut
                this.setUnavailable(`Chyba při získávání dat: ${error.message}`);
            }
        }
    }   

    async processEnergyData(deviceData, previousState, currentState) {
        let chargeEnergy = 0;
        const storedBaseEnergy = await this.getStoreValue('baseChargeEnergy') || 0;
        let energyToAdd = 0;
    
        try {
            // Kontrola resetu měřiče
            const lastKnownEnergy = await this.getCapabilityValue('measure_charge_energy') || 0;
            const currentEnergy = deviceData.chargeEnergy;
    
            if (currentEnergy < lastKnownEnergy - 0.1) {
                this.logger.debug('Detekován reset měřiče energie', {
                    lastKnownEnergy,
                    currentEnergy
                });
                await this.updateEnergyStatistics(lastKnownEnergy);
                await this.setStoreValue('baseChargeEnergy', 0);
                chargeEnergy = currentEnergy;
                return chargeEnergy;
            }
    
            switch (currentState) {
                case "2": // Nabíjení
                    chargeEnergy = storedBaseEnergy + deviceData.chargeEnergy;
                    if (previousState !== "2") {
                        await this.setStoreValue('chargingStartEnergy', deviceData.chargeEnergy);
                    }
                    break;
    
                case "0": // Odpojeno
                    if (previousState === "2" || previousState === "1") {
                        const startEnergy = await this.getStoreValue('chargingStartEnergy') || 0;
                        energyToAdd = deviceData.chargeEnergy - startEnergy;
                        
                        if (energyToAdd > 0) {
                            await this.updateEnergyStatistics(energyToAdd);
                        }
                    }
    
                    // Reset hodnot pro novou relaci
                    await this.setStoreValue('baseChargeEnergy', 0);
                    await this.setStoreValue('chargingStartEnergy', 0);
                    chargeEnergy = 0;
                    break;
    
                case "1": // Připojeno, ale nenabíjí
                    if (previousState === "2") {
                        chargeEnergy = storedBaseEnergy + deviceData.chargeEnergy;
                        await this.setStoreValue('baseChargeEnergy', chargeEnergy);
                    } else {
                        chargeEnergy = storedBaseEnergy;
                    }
                    break;
    
                default:
                    chargeEnergy = storedBaseEnergy;
                    break;
            }
    
            return chargeEnergy;
    
        } catch (error) {
            this.logger.error('Chyba při zpracování dat o energii', error);
            throw error;
        }
    }
    
    /**
     * Aktualizuje měsíční a roční statistiky energie
     * Kontroluje potřebu resetu při změně měsíce/roku
     * @param {number} energyToAdd - Energie k přičtení v kWh
     */
    async updateEnergyStatistics(energyToAdd) {
        try {
            const currentDate = new Date();
            const currentMonth = currentDate.getMonth() + 1;
            const currentYear = currentDate.getFullYear();
    
            // Měsíční statistiky
            let monthlyData = await this.getStoreValue('monthlyEnergyData') || {
                month: currentMonth,
                energy: 0
            };
    
            // Reset při novém měsíci
            if (monthlyData.month !== currentMonth) {
                this.logger.debug('Reset měsíčních statistik', {
                    starýMěsíc: monthlyData.month,
                    novýMěsíc: currentMonth
                });
                monthlyData = {
                    month: currentMonth,
                    energy: 0
                };
            }
    
            // Roční statistiky
            let yearlyData = await this.getStoreValue('yearlyEnergyData') || {
                year: currentYear,
                energy: 0
            };
    
            // Reset při novém roce
            if (yearlyData.year !== currentYear) {
                this.logger.debug('Reset ročních statistik', {
                    starýRok: yearlyData.year,
                    novýRok: currentYear
                });
                yearlyData = {
                    year: currentYear,
                    energy: 0
                };
            }
    
            // Přičtení energie
            monthlyData.energy += energyToAdd;
            yearlyData.energy += energyToAdd;
    
            // Uložení všech hodnot
            await Promise.all([
                this.setStoreValue('monthlyEnergyData', monthlyData),
                this.setStoreValue('yearlyEnergyData', yearlyData),
                this.setCapabilityValue('measure_monthly_energy', monthlyData.energy),
                this.setCapabilityValue('measure_yearly_energy', yearlyData.energy)
            ]);
    
            this.logger.debug('Aktualizace energetických statistik', {
                přidanáEnergie: energyToAdd,
                měsíčníCelkem: monthlyData.energy,
                ročníCelkem: yearlyData.energy,
                měsíc: currentMonth,
                rok: currentYear
            });
    
        } catch (error) {
            this.logger.error('Chyba při aktualizaci statistik', error);
            throw error;
        }
    }   

    async updateCapabilities(deviceData, currentState, chargeEnergy) {
        try {

            const timerState = typeof deviceData.timer_state === 'boolean' 
            ? deviceData.timer_state 
            : Boolean(deviceData.timer_state);

            // Aktualizace všech capabilities
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
                this.setCapabilityValue('car_connected', ["1", "2"].includes(currentState)),
                this.setCapabilityValue('measure_charge_energy', chargeEnergy),
                this.setCapabilityValue('measure_house_power', deviceData.housePower),
                this.setCapabilityValue('measure_fv_power', deviceData.fvPower),
                this.setCapabilityValue('measure_battery_power', deviceData.batteryPower),
                this.setCapabilityValue('min_intensity', deviceData.minIntensity),
                this.setCapabilityValue('max_intensity', deviceData.maxIntensity),
                this.setCapabilityValue('firmware_version', deviceData.firmwareVersion),
                this.setCapabilityValue('signal_status', deviceData.signalStatus),
                this.setCapabilityValue('timer_state', deviceData.timer_state || false)
            ]);
    
            this.logger.debug('Capabilities byly úspěšně aktualizovány', { 
                deviceData, 
                chargeEnergy 
            });
        } catch (error) {
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
            // Pro každou změněnou hodnotu
            for (const key of changedKeys) {
                switch (key) {
                    // Nová nastavení
                    case 'min_intensity':
                        await this.v2cApi.setMinIntensity(newSettings.min_intensity);
                        break;
                        
                    case 'max_intensity':
                        await this.v2cApi.setMaxIntensity(newSettings.max_intensity);
                        break;
                        
                    case 'dynamic_power_mode':
                        if (newSettings.dynamic_power_mode === 'disabled') {
                            // Vypneme dynamický mód
                            await this.v2cApi.setDynamic('0');
                        } else {
                            // Zapneme dynamický mód a nastavíme požadovaný režim
                            await this.v2cApi.setDynamic('1');
                            await this.v2cApi.setDynamicPowerMode(newSettings.dynamic_power_mode);
                        }
                        break;
    
                    // Původní nastavení
                    case 'update_interval':
                        this.startDataFetchInterval(newSettings.update_interval);
                        break;
                        
                    case 'v2c_ip':
                        this.v2cApi = new v2cAPI(this.homey, newSettings.v2c_ip);
                        break;
                        
                    case 'enable_logging':
                        this.logger.setEnabled(newSettings.enable_logging);
                        this.v2cApi.setLoggingEnabled(newSettings.enable_logging);
                        break;
                }
    
                // Aktualizace nastavení v Homey
                this.homey.settings.set(key, newSettings[key]);
            }
    
            // Aktualizace dat ze zařízení
            await this.getProductionData();
    
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