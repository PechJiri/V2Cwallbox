'use strict';

const { Device } = require('homey');
const { v2cAPI } = require('./api');
const FlowCardManager = require('./FlowCardManager');
const PowerCalculator = require('../../lib/power_calculator');
const DataValidator = require('../../lib/DataValidator');
const Logger = require('../../lib/Logger');
const EnergyManager = require('../../lib/EnergyManager');
const CONSTANTS = require('../../lib/constants');
const { validateWallboxIP } = require('../../lib/ip_validator');

class MyDevice extends Device {
    _isProcessing = false;
    dataFetchInterval = null;
    _currentInterval = CONSTANTS.INTERVALS.DISCONNECTED;
    _consecutivePollErrors = 0;
    // Interní cache V2C stavu ('0'/'1'/'2'). Už není exponováno jako Homey capability
    // (nahrazeno systémovou evcharger_charging_state). Potřeba pro polling interval
    // a pro runtime handlery deprekovaných flow karet.
    _lastChargeState = CONSTANTS.CHARGE_STATES.DISCONNECTED;

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

            // Úklid orphaned capabilities z neúspěšných migrací v pre-release buildech
            await this._cleanupOrphanedCapabilities();

            // Diagnostika - loguje aktuální capabilities na zařízení
            this.logger.debug('Aktuální capabilities na zařízení po úklidu', {
                caps: this.getCapabilities()
            });
    
            // Inicializace proměnných pro cache
            this.lastResponse = null;
            this.lastResponseTime = null;
    
            // Inicializace FlowCardManageru
            this.logger.debug('Inicializace FlowCardManageru');
            this.flowCardManager = new FlowCardManager(this.homey, this);
            this.flowCardManager.setLogger(this.logger);
            await this.flowCardManager.initialize();
    
            this.powerCalculator = PowerCalculator;

            this.energyManager = new EnergyManager(this, this.logger);
            await this.energyManager.initialize();
    
            this.dataValidator = new DataValidator(this.logger);
    
            // Kontrola a validace IP adresy — povolujeme jen privátní rozsahy
            const ip = this.getSetting('v2c_ip');
            if (!ip) {
                this.logger.error('IP adresa není nastavena');
                await this.setCapabilityValue('measure_connection_error', true);
                return this.setUnavailable('IP adresa není nastavena');
            }

            const ipCheck = validateWallboxIP(ip);
            if (!ipCheck.valid) {
                this.logger.error('Neplatná IP adresa v settings', { ip, reason: ipCheck.reason });
                await this.setCapabilityValue('measure_connection_error', true);
                return this.setUnavailable('Invalid IP — only private network addresses allowed');
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
    
            // Registrace listeneru pro změnu A
            this.registerSetIntensityListener()

            // Registrace listeneru pro Homey SDK evcharger_charging
            // (nahrazuje bývalou measure_paused; Homey Energy tab, Flow karty, Insights)
            this.registerEvChargerChargingListener();

            // Registrace listeneru pro systémovou capability locked
            this.registerLockedListener();

            // Spuštění intervalu pro aktualizaci dat
            this.startDataFetchInterval();
    
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

    async _cleanupOrphanedCapabilities() {
        // Pokud některý z předchozích pre-release buildů přidal capability, kterou jsme pak
        // odstranili z manifestu, zůstává na zařízení a může rozbít UI v mobilní appce.
        // Projdeme aktuální capabilities na zařízení a odstraníme ty, které nejsou očekávané.
        const expected = new Set([
            ...CONSTANTS.DEVICE_CAPABILITIES,
            'measure_connection_error'
        ]);

        const currentCaps = this.getCapabilities();
        for (const cap of currentCaps) {
            if (expected.has(cap)) continue;

            this.logger.debug(`Odebírám orphaned capability: ${cap}`);
            try {
                await this.removeCapability(cap);
            } catch (error) {
                this.logger.warn(`Nepodařilo se odebrat capability ${cap}`, {
                    error: error.message
                });
            }
        }
    }

    async initializeCapabilities() {
        const failed = [];
        for (const capability of CONSTANTS.DEVICE_CAPABILITIES) {
            if (this.hasCapability(capability)) continue;

            this.logger.debug(`Přidávání capability: ${capability}`);
            try {
                await this.addCapability(capability);
            } catch (error) {
                // Některé capabilities nemusí být dostupné na starším firmware.
                // Nechceme, aby selhala celá inicializace - zalogujeme a pokračujeme.
                failed.push({ capability, error: error.message });
                this.logger.warn(`Capability ${capability} se nepodařilo přidat, pokračuji`, {
                    error: error.message
                });
            }
        }

        this.logger.debug('Inicializace capabilities dokončena', {
            totalCapabilities: CONSTANTS.DEVICE_CAPABILITIES.length,
            failedCount: failed.length,
            failed
        });
    }

    registerSetIntensityListener() {
        this.registerCapabilityListener('set_intensity', async (value) => {
            const intensity = parseInt(value, 10);

            // Validace
            if (intensity < 6 || intensity > 32) {
                throw new Error('Intensity musí být mezi 6 a 32 A');
            }

            // API volání
            await this.v2cApi.setParameter('Intensity', intensity);

            return true;
        });
    }

    registerEvChargerChargingListener() {
        // Homey SDK systémová capability — mapuje na V2C Paused flag (invertovaně):
        // true  = uživatel chce nabíjet   → Paused = 0
        // false = uživatel pauzuje        → Paused = 1
        this.registerCapabilityListener('evcharger_charging', async (value) => {
            try {
                this.logger.debug('Změna evcharger_charging', { novýStav: value });
                await this.v2cApi.setParameter('Paused', value ? '0' : '1');
                return true;
            } catch (error) {
                this.logger.error('Selhalo nastavení evcharger_charging', error);
                throw new Error('Selhalo nastavení stavu nabíjení');
            }
        });
    }

    registerLockedListener() {
        this.registerCapabilityListener('locked', async (value) => {
            try {
                this.logger.debug('Změna locked', { novýStav: value });
                await this.v2cApi.setLocked(value ? '1' : '0');
                return true;
            } catch (error) {
                this.logger.error('Selhalo nastavení locked', error);
                throw new Error('Selhalo nastavení stavu zámku');
            }
        });
    }

    startDataFetchInterval() {
        if (this.dataFetchInterval) {
            this.homey.clearInterval(this.dataFetchInterval);
        }

        this.dataFetchInterval = this.homey.setInterval(async () => {
            // Pokud již probíhá zpracování, přeskočíme
            if (this._isProcessing) return;
            
            // Zjistíme jaký interval by měl být
            const requiredInterval = this._getRequiredInterval();
            
            // Pokud se liší od aktuálního, nastavíme nový pro příští běh
            if (requiredInterval !== this._currentInterval) {
                this.logger.debug('Interval změněn podle stavu nabíjení', {
                    starýInterval: `${this._currentInterval / 1000}s`,
                    novýInterval: `${requiredInterval / 1000}s`,
                    stav: this._lastChargeState,
                    změna: `${this._currentInterval / 1000}s -> ${requiredInterval / 1000}s`
                });
                
                this._currentInterval = requiredInterval;
                // Restartujeme interval s novou hodnotou
                this.startDataFetchInterval();
                return; // Ukončíme současný běh
            }
            
            // Běžné zpracování dat
            this._isProcessing = true;
            try {
                await this.getProductionData();
            } finally {
                this._isProcessing = false;
            }
        }, this._currentInterval);
    }

    _getRequiredInterval() {
        const chargeState = this._lastChargeState;

        let baseInterval;
        switch(chargeState) {
            case CONSTANTS.CHARGE_STATES.CHARGING: // '2'
                baseInterval = CONSTANTS.INTERVALS.CHARGING;
                break;
            case CONSTANTS.CHARGE_STATES.CONNECTED: // '1'
                baseInterval = CONSTANTS.INTERVALS.CONNECTED;
                break;
            case CONSTANTS.CHARGE_STATES.DISCONNECTED: // '0'
            default:
                baseInterval = CONSTANTS.INTERVALS.DISCONNECTED;
        }

        // Exponential backoff při po sobě jdoucích chybách.
        // 5s → 15s → 45s → 135s → 300s (cap). Reset při první úspěšné odpovědi.
        if (this._consecutivePollErrors === 0) {
            return baseInterval;
        }
        const backoff = baseInterval * Math.pow(
            CONSTANTS.INTERVALS.BACKOFF_MULTIPLIER,
            this._consecutivePollErrors
        );
        return Math.min(backoff, CONSTANTS.INTERVALS.BACKOFF_MAX);
    }
    
    async getProductionData() {
        try {
            const now = Date.now();
            if (this.lastResponse && this.lastResponseTime && (now - this.lastResponseTime < CONSTANTS.API.TIMEOUT)) {
                this.logger.debug('Použita cache data');
                return this.dataValidator.validateAndProcessData(this.lastResponse);
            }
    
            await this.energyManager.resetMonthlyAndYearlyDataIfNeeded();
    
            try {
                const baseSession = await this.v2cApi.getData();
                const deviceData = this.dataValidator.validateAndProcessData(baseSession);
                if (!deviceData) {
                    throw new Error('Data z API jsou neplatná.');
                }
    
                // Úspěšný fetch — reset error counteru a backoffu
                if (this._consecutivePollErrors > 0) {
                    this.logger.debug('Polling error counter reset', {
                        předchozí: this._consecutivePollErrors
                    });
                    this._consecutivePollErrors = 0;
                }

                this.lastResponse = baseSession;
                this.lastResponseTime = now;

                const previousState = await this.getStoreValue('previousChargeState') || CONSTANTS.CHARGE_STATES.DISCONNECTED;
                const currentState = deviceData.chargeState;
                const chargeEnergy = await this.energyManager.processEnergyData(deviceData, previousState, currentState);
    
                await this.updateCapabilities(deviceData, currentState, chargeEnergy);
                await this.handleStateChanges(currentState, previousState, deviceData);
    
                const hadError = await this.getCapabilityValue('measure_connection_error');
                if (hadError) {
                    await this.setCapabilityValue('measure_connection_error', false);
                    await this.flowCardManager.triggerConnectionStateChanged('ok');
                }
    
                this._lastSuccessfulUpdate = now;
    
                if (!this.getAvailable()) {
                    await this.setAvailable();
                }
            } catch (error) {
                // Increment error counteru pro exponential backoff pollingu
                this._consecutivePollErrors++;

                if (error.message === 'API_MAX_ERRORS_EXCEEDED') {
                    const hadError = await this.getCapabilityValue('measure_connection_error');
                    if (!hadError) {
                        this.logger.error('API není dostupné po více pokusech', {
                            errorCount: this.v2cApi.getErrorCount(),
                            maxErrors: this.v2cApi._maxConsecutiveErrors,
                            pollBackoffCount: this._consecutivePollErrors
                        });

                        await this.setCapabilityValue('measure_connection_error', true);
                        await this.flowCardManager.triggerConnectionStateChanged('error');
                    }
                } else {
                    this.logger.debug('Dočasná chyba API', {
                        error: error.message,
                        errorCount: this.v2cApi.getErrorCount(),
                        pollBackoffCount: this._consecutivePollErrors,
                        isInErrorState: this.v2cApi.isInErrorState()
                    });

                    if (this.lastResponse) {
                        this.logger.debug('Použita poslední známá data kvůli chybě API');
                    }
                }
            }
        } catch (error) {
            this.logger.error('Kritická chyba při zpracování dat', error);
        }
    }

    async updateCapabilities(deviceData, currentState, chargeEnergy) {
        try {
            // Aktualizace interní proměnné — využívá se v _getRequiredInterval
            // a v FlowCardManager pro deprekované condition karty (car-connected, car-is-charging)
            this._lastChargeState = currentState;

            // Lifetime energie pro Homey Energy tab (monotónní, nikdy neklesá při odpojení)
            const lifetimeEnergy = this.energyManager.getLifetimeEnergy();

            // Pomocník — setCapabilityValue jen pokud capability existuje (kvůli postupné migraci)
            const safeSet = (cap, val) => this.hasCapability(cap)
                ? this.setCapabilityValue(cap, val)
                : Promise.resolve();

            await Promise.all([
                this.setCapabilityValue('measure_charge_power', deviceData.chargePower),
                this.setCapabilityValue('measure_power', deviceData.chargePower),
                this.setCapabilityValue('measure_voltage_installation', deviceData.voltageInstallation),
                this.setCapabilityValue('measure_slave_error', deviceData.slaveError),
                this.setCapabilityValue('measure_charge_time', Math.floor(deviceData.chargeTime / 60)),
                this.setCapabilityValue('locked', deviceData.locked),
                this.setCapabilityValue('measure_intensity', deviceData.intensity),
                this.setCapabilityValue('measure_dynamic', deviceData.dynamic),
                this.setCapabilityValue('measure_charge_energy', chargeEnergy),
                this.setCapabilityValue('meter_power', lifetimeEnergy),
                // evcharger_charging = user intent (inverzní k V2C Paused flagu); nahrazuje bývalé measure_paused
                safeSet('evcharger_charging', !deviceData.paused),
                safeSet('evcharger_charging_state', this._mapEvChargerState(currentState, deviceData.paused)),
                this.setCapabilityValue('measure_house_power', deviceData.housePower),
                this.setCapabilityValue('measure_fv_power', deviceData.fvPower),
                this.setCapabilityValue('measure_battery_power', deviceData.batteryPower),
                this.setCapabilityValue('min_intensity', deviceData.minIntensity),
                this.setCapabilityValue('max_intensity', deviceData.maxIntensity),
                this.setCapabilityValue('firmware_version', deviceData.firmwareVersion),
                this.setCapabilityValue('signal_status', deviceData.signalStatus),
                this.setCapabilityValue('timer_state', deviceData.timer_state || false),
                this.setCapabilityValue('set_intensity', deviceData.intensity.toString())
            ]);
    
            this.logger.debug('Capabilities byly úspěšně aktualizovány', { 
                deviceData, 
                chargeEnergy, 
                chargePower: deviceData.chargePower 
            });
    
        } catch (error) {
            this.logger.error('Chyba při aktualizaci capabilities', error);
            throw error;
        }
    }
    
    // Veřejné API pro FlowCardManager — interní V2C chargeState ('0'/'1'/'2')
    // již není exponován jako Homey capability, flow handlery ho čtou odtud
    getInternalChargeState() {
        return this._lastChargeState || CONSTANTS.CHARGE_STATES.DISCONNECTED;
    }

    _mapEvChargerState(chargeState, paused) {
        switch (chargeState) {
            case CONSTANTS.CHARGE_STATES.CHARGING:
                return CONSTANTS.EVCHARGER_STATES.PLUGGED_IN_CHARGING;
            case CONSTANTS.CHARGE_STATES.CONNECTED:
                return paused
                    ? CONSTANTS.EVCHARGER_STATES.PLUGGED_IN_PAUSED
                    : CONSTANTS.EVCHARGER_STATES.PLUGGED_IN;
            case CONSTANTS.CHARGE_STATES.DISCONNECTED:
            default:
                return CONSTANTS.EVCHARGER_STATES.PLUGGED_OUT;
        }
    }

    async resetMonthlyEnergy() {
        return await this.energyManager.resetMonthlyEnergy();
    }
    
    async resetYearlyEnergy() {
        return await this.energyManager.resetYearlyEnergy();
    }
    
    async setMonthlyEnergy(value) {
        return await this.energyManager.setMonthlyEnergy(value);
    }
    
    async setYearlyEnergy(value) {
        return await this.energyManager.setYearlyEnergy(value);
    }

    async handleStateChanges(currentState, previousState, deviceData) {
        await this.setStoreValue('previousChargeState', currentState);
    
        if (currentState !== previousState) {
            await this._handleStateChangeTriggers(currentState, previousState);
        }
    
        const previousSlaveError = await this.getStoreValue('previousSlaveError');
        if (deviceData.slaveError !== previousSlaveError) {
            await this.flowCardManager.triggerSlaveErrorChanged(deviceData.slaveError); 
            await this.setStoreValue('previousSlaveError', deviceData.slaveError);
        }
    }
    
    async _handleStateChangeTriggers(newState, oldState) {
        try {
            if (newState === CONSTANTS.CHARGE_STATES.CONNECTED && 
                oldState === CONSTANTS.CHARGE_STATES.DISCONNECTED) {
                await this.flowCardManager.triggerCarConnected();
            } else if (newState === CONSTANTS.CHARGE_STATES.DISCONNECTED && 
                      oldState === CONSTANTS.CHARGE_STATES.CONNECTED) {
                await this.flowCardManager.triggerCarDisconnected();  
            } else if (newState === CONSTANTS.CHARGE_STATES.CHARGING && 
                      (oldState === CONSTANTS.CHARGE_STATES.DISCONNECTED || 
                       oldState === CONSTANTS.CHARGE_STATES.CONNECTED)) {
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
            for (const key of changedKeys) {
                switch (key) {
                    case 'min_intensity':
                        if (newSettings.min_intensity < CONSTANTS.DEVICE.INTENSITY.MIN || 
                            newSettings.min_intensity > CONSTANTS.DEVICE.INTENSITY.MAX) {
                            throw new Error(`Intensity musí být mezi ${CONSTANTS.DEVICE.INTENSITY.MIN} a ${CONSTANTS.DEVICE.INTENSITY.MAX} A`);
                        }
                        await this.v2cApi.setMinIntensity(newSettings.min_intensity);
                        break;
                        
                    case 'max_intensity':
                        if (newSettings.max_intensity < CONSTANTS.DEVICE.INTENSITY.MIN || 
                            newSettings.max_intensity > CONSTANTS.DEVICE.INTENSITY.MAX) {
                            throw new Error(`Intensity musí být mezi ${CONSTANTS.DEVICE.INTENSITY.MIN} a ${CONSTANTS.DEVICE.INTENSITY.MAX} A`);
                        }
                        await this.v2cApi.setMaxIntensity(newSettings.max_intensity);
                        break;
                        
                    case 'dynamic_power_mode':
                        if (newSettings.dynamic_power_mode === CONSTANTS.DYNAMIC_POWER_MODES.DISABLED) {
                            await this.v2cApi.setDynamic('0');
                        } else {
                            await this.v2cApi.setDynamic('1');
                            await this.v2cApi.setDynamicPowerMode(newSettings.dynamic_power_mode);
                        }
                        break;
                        
                    case 'v2c_ip': {
                        const ipCheck = validateWallboxIP(newSettings.v2c_ip);
                        if (!ipCheck.valid) {
                            throw new Error(`Invalid IP address (${ipCheck.reason}) — only private network IPv4 addresses are allowed`);
                        }
                        this.v2cApi = new v2cAPI(this.homey, newSettings.v2c_ip);
                        break;
                    }
                        
                    case 'enable_logging':
                        this.logger.setEnabled(newSettings.enable_logging);
                        this.v2cApi.setLoggingEnabled(newSettings.enable_logging);
                        break;
                }
    
                this.homey.settings.set(key, newSettings[key]);
            }
    
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
        try {
            this.logger.log('Zařízení je odstraňováno - začátek cleanup procesu');
    
            if (this.dataFetchInterval) {
                this.homey.clearInterval(this.dataFetchInterval);
                this.dataFetchInterval = null;
            }
    
            this.removeAllListeners();
            
            if (this.flowCardManager) {
                await this.flowCardManager.destroy();
                this.flowCardManager = null;
            }
    
            if (this.v2cApi) {
                this.v2cApi = null;
            }

            if (this.energyManager) {
                this.energyManager = null;
            }
    
            if (this.lastResponse) {
                this.lastResponse = null;
            }
            if (this.lastResponseTime) {
                this.lastResponseTime = null;
            }
    
            if (this.dataValidator) {
                this.dataValidator = null;
            }
    
            await this.unsetStoreValue('previousChargeState');
            await this.unsetStoreValue('previousSlaveError');
            await this.unsetStoreValue('baseChargeEnergy');
            await this.unsetStoreValue('chargingStartEnergy');
            await this.unsetStoreValue('monthlyEnergyData');
            await this.unsetStoreValue('yearlyEnergyData');
            await this.unsetStoreValue('lifetimeEnergyData');
    
            if (this.logger) {
                this.logger.log('Zařízení bylo úspěšně odstraněno');
                await this.logger.clearHistory();
                this.logger = null;
            }
    
        } catch (error) {
            if (this.logger) {
                this.logger.error('Chyba při odstraňování zařízení', error);
            }
            this.logger = null;
            
            throw error;
        }
    }
}

module.exports = MyDevice;