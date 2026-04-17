'use strict';

const { Device } = require('homey');
const { v2cAPI } = require('./api');
const FlowCardManager = require('./FlowCardManager');
const PowerCalculator = require('../../lib/power_calculator');
const DataValidator = require('../../lib/DataValidator');
const Logger = require('../../lib/Logger');
const EnergyManager = require('../../lib/EnergyManager');
const CONSTANTS = require('../../lib/constants');

class MyDevice extends Device {
    _isProcessing = false;
    dataFetchInterval = null;
    _currentInterval = CONSTANTS.INTERVALS.DISCONNECTED;

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
    
            this.powerCalculator = PowerCalculator;

            this.energyManager = new EnergyManager(this, this.logger);
            await this.energyManager.initialize();
    
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

            // Registrace listeneru pro změnu A
            this.registerSetIntensityListener();

            // Standardní Homey listenery (onoff = negace pause, locked)
            this.registerOnoffListener();
            this.registerLockedListener();

            // Spuštění intervalu pro aktualizaci dat
            this.startDataFetchInterval();

            // Reakce na memwarn od Homey - šetrná reakce na tlak na paměť
            this._memwarnHandler = this._onMemWarn.bind(this);
            this.homey.on('memwarn', this._memwarnHandler);
    
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
        try {
            // Použití capabilities z konstant
            for (const capability of CONSTANTS.DEVICE_CAPABILITIES) {
                if (!this.hasCapability(capability)) {
                    this.logger.debug(`Přidávání capability: ${capability}`);
                    await this.addCapability(capability);
                }
            }
            
            this.logger.debug('Inicializace capabilities dokončena', {
                totalCapabilities: CONSTANTS.DEVICE_CAPABILITIES.length
            });
        } catch (error) {
            this.logger.error('Chyba při inicializaci capabilities', error);
            throw error;
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

    registerOnoffListener() {
        this.registerCapabilityListener('onoff', async (value) => {
            const paused = !value;
            await this.v2cApi.setParameter('Paused', paused ? '1' : '0');
            await this.setCapabilityValue('measure_paused', paused);
            return true;
        });
    }

    registerLockedListener() {
        this.registerCapabilityListener('locked', async (value) => {
            await this.v2cApi.setLocked(value ? '1' : '0');
            await this.setCapabilityValue('measure_locked', value);
            return true;
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
                    stav: this.getCapabilityValue('measure_charge_state'),
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
        const chargeState = this.getCapabilityValue('measure_charge_state');
        
        switch(chargeState) {
            case CONSTANTS.CHARGE_STATES.CHARGING: // '2'
                return CONSTANTS.INTERVALS.CHARGING;
            case CONSTANTS.CHARGE_STATES.CONNECTED: // '1'
                return CONSTANTS.INTERVALS.CONNECTED;
            case CONSTANTS.CHARGE_STATES.DISCONNECTED: // '0'
            default:
                return CONSTANTS.INTERVALS.DISCONNECTED;
        }
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
    
                this.lastResponse = baseSession;
                this.lastResponseTime = now;
    
                const previousState = await this.getStoreValue('previousChargeState') || CONSTANTS.CHARGE_STATES.DISCONNECTED;
                const currentState = deviceData.chargeState;

                // Zachyť poslední známou session energy PŘED tím, než ji
                // EnergyManager při plug-outu resetuje na 0 - potřebujeme ji
                // jako token pro trigger charging-session-ended.
                const previousSessionEnergy = this.hasCapability('ev_charging_session_energy')
                    ? (await this.getCapabilityValue('ev_charging_session_energy') || 0)
                    : 0;

                const chargeEnergy = await this.energyManager.processEnergyData(deviceData, previousState, currentState);

                await this.updateCapabilities(deviceData, currentState, chargeEnergy);
                await this.handleStateChanges(currentState, previousState, deviceData, previousSessionEnergy);
                await this._enforceMaxSessionEnergyLimit(chargeEnergy, currentState);
    
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
                if (error.message === 'API_BACKOFF_ACTIVE') {
                    // Backoff okno po předchozí chybě - tichý skip
                    return;
                }

                if (error.message === 'API_MAX_ERRORS_EXCEEDED') {
                    const hadError = await this.getCapabilityValue('measure_connection_error');
                    if (!hadError) {
                        this.logger.error('API není dostupné po více pokusech', {
                            errorCount: this.v2cApi.getErrorCount(),
                            maxErrors: this.v2cApi._maxConsecutiveErrors
                        });

                        await this.setCapabilityValue('measure_connection_error', true);
                        await this.flowCardManager.triggerConnectionStateChanged('error');
                    }

                } else {
                    this.logger.debug('Dočasná chyba API', {
                        error: error.message,
                        errorCount: this.v2cApi.getErrorCount(),
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
            const sessionDuration = await this._computeSessionDuration(currentState);

            await Promise.all([
                // Standardní Homey EV Charger capabilities
                this.setCapabilityValue('evcharger_charging_state', deviceData.evchargerChargingState),
                this.setCapabilityValue('evcharger_charging', deviceData.evchargerCharging),
                this.setCapabilityValue('ev_charging_session_energy', chargeEnergy),
                this.setCapabilityValue('ev_charging_session_duration', sessionDuration),
                this.setCapabilityValue('onoff', deviceData.onoff),
                this.setCapabilityValue('locked', deviceData.measure_locked),
                this.setCapabilityValue('alarm_generic', deviceData.alarmGeneric),
                // Původní (legacy) capabilities - zachovány kvůli existujícím flow
                this.setCapabilityValue('measure_charge_state', deviceData.chargeState),
                this.setCapabilityValue('measure_charge_power', deviceData.chargePower),
                this.setCapabilityValue('measure_power', deviceData.chargePower),
                this.setCapabilityValue('measure_voltage_installation', deviceData.voltageInstallation),
                this.setCapabilityValue('measure_slave_error', deviceData.slaveError),
                this.setCapabilityValue('measure_charge_time', Math.floor(deviceData.chargeTime / 60)),
                this.setCapabilityValue('measure_paused', deviceData.paused),
                this.setCapabilityValue('measure_locked', deviceData.measure_locked),
                this.setCapabilityValue('measure_intensity', deviceData.intensity),
                this.setCapabilityValue('measure_dynamic', deviceData.dynamic),
                this.setCapabilityValue('car_connected', [
                    CONSTANTS.CHARGE_STATES.CONNECTED,
                    CONSTANTS.CHARGE_STATES.CHARGING
                ].includes(currentState)),
                this.setCapabilityValue('measure_charge_energy', chargeEnergy),
                this.setCapabilityValue('meter_power', chargeEnergy),
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

    async handleStateChanges(currentState, previousState, deviceData, previousSessionEnergy = 0) {
        await this.setStoreValue('previousChargeState', currentState);

        if (currentState !== previousState) {
            await this._handleSessionBoundary(currentState, previousState, previousSessionEnergy);
            await this._handleStateChangeTriggers(currentState, previousState);
        }

        const previousSlaveError = await this.getStoreValue('previousSlaveError');
        if (deviceData.slaveError !== previousSlaveError) {
            await this.flowCardManager.triggerSlaveErrorChanged(deviceData.slaveError);
            await this.setStoreValue('previousSlaveError', deviceData.slaveError);
        }
    }

    async _handleSessionBoundary(currentState, previousState, previousSessionEnergy = 0) {
        const wasPlugged = previousState !== CONSTANTS.CHARGE_STATES.DISCONNECTED;
        const isPlugged = currentState !== CONSTANTS.CHARGE_STATES.DISCONNECTED;

        if (!wasPlugged && isPlugged) {
            await this.setStoreValue('sessionStartTime', Date.now());
            // Nová session - pryč s případným limitem z předchozí session
            await this.unsetStoreValue('maxSessionEnergyLimit');
            this.logger.debug('Zahájena nová nabíjecí session');
        } else if (wasPlugged && !isPlugged) {
            const startTime = await this.getStoreValue('sessionStartTime');
            const durationS = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
            try {
                await this.flowCardManager.triggerChargingSessionEnded(
                    previousSessionEnergy,
                    durationS,
                    'unplugged'
                );
            } catch (error) {
                this.logger.error('Chyba při vystřelení charging-session-ended', error);
            }
            await this.unsetStoreValue('sessionStartTime');
            await this.unsetStoreValue('maxSessionEnergyLimit');
            this.logger.debug('Nabíjecí session ukončena (auto odpojeno)', {
                sessionEnergy: previousSessionEnergy,
                durationS
            });
        }
    }

    async _enforceMaxSessionEnergyLimit(currentEnergy, currentState) {
        if (currentState === CONSTANTS.CHARGE_STATES.DISCONNECTED) return;

        const limit = await this.getStoreValue('maxSessionEnergyLimit');
        if (!limit || currentEnergy < limit) return;

        const alreadyPaused = await this.getCapabilityValue('measure_paused');
        if (alreadyPaused) {
            // Už pauznuté (pravděpodobně už jsme limit vynutili); jen cleanup
            await this.unsetStoreValue('maxSessionEnergyLimit');
            return;
        }

        try {
            await this.v2cApi.setParameter('Paused', '1');
            await this.setCapabilityValue('measure_paused', true);
            await this.setCapabilityValue('onoff', false);

            const startTime = await this.getStoreValue('sessionStartTime');
            const durationS = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
            await this.flowCardManager.triggerChargingSessionEnded(
                currentEnergy,
                durationS,
                'limit_reached'
            );
            await this.unsetStoreValue('maxSessionEnergyLimit');

            this.logger.log('Dosažen limit session energy - nabíjení pauzováno', {
                currentEnergy,
                limit
            });
        } catch (error) {
            this.logger.error('Chyba při vynucení limitu session energy', error);
        }
    }

    async _computeSessionDuration(currentState) {
        if (currentState === CONSTANTS.CHARGE_STATES.DISCONNECTED) {
            return 0;
        }
        let startTime = await this.getStoreValue('sessionStartTime');
        if (!startTime) {
            startTime = Date.now();
            await this.setStoreValue('sessionStartTime', startTime);
        }
        return Math.floor((Date.now() - startTime) / 1000);
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
                        
                    case 'v2c_ip':
                        this.v2cApi = new v2cAPI(this.homey, newSettings.v2c_ip);
                        break;
                        
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

    _onMemWarn(data) {
        try {
            if (this.logger) {
                this.logger.warn('memwarn event - uvolňuji cache', data || {});
            }
            this.lastResponse = null;
            this.lastResponseTime = null;
        } catch (_) { /* defenzivní - memwarn nesmí shodit app */ }
    }

    async onUninit() {
        try {
            if (this.dataFetchInterval) {
                this.homey.clearInterval(this.dataFetchInterval);
                this.dataFetchInterval = null;
            }
            if (this._memwarnHandler) {
                this.homey.removeListener('memwarn', this._memwarnHandler);
                this._memwarnHandler = null;
            }
            if (this.flowCardManager) {
                await this.flowCardManager.destroy();
                this.flowCardManager = null;
            }
            this.lastResponse = null;
            this.lastResponseTime = null;
            this.v2cApi = null;
            this.energyManager = null;
            this.dataValidator = null;
        } catch (error) {
            if (this.logger) {
                this.logger.error('Chyba v onUninit', error);
            }
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

            if (this._memwarnHandler) {
                this.homey.removeListener('memwarn', this._memwarnHandler);
                this._memwarnHandler = null;
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
            await this.unsetStoreValue('sessionStartTime');
            await this.unsetStoreValue('maxSessionEnergyLimit');

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