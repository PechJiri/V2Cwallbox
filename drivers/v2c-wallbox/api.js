'use strict';

const fetch = require('node-fetch');
const Logger = require('../../lib/Logger');
const DataValidator = require('../../lib/DataValidator');

class v2cAPI {
    constructor(homey, ip) {
        this.ip = ip;
        this.logger = new Logger(homey, 'V2C-API');
        this.logger.setEnabled(false);
        this.validator = new DataValidator(this.logger);
        this._apiErrorCount = 0;
        this._maxConsecutiveErrors = 20;
    }

    setLoggingEnabled(enabled) {
        this.logger.setEnabled(enabled);
        this.validator.setLoggingEnabled(enabled);
    }

    async initializeSession() {
        try {
            const url = `http://${this.ip}/RealTimeData`;
            this.logger.debug('Inicializace session', { url });

            const response = await fetch(url);
            const responseData = await response.json();
            this.logger.debug('Odpověď z inicializace session', { responseData });

            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }

            this.logger.log('Session úspěšně inicializována', { data: responseData });
            return true;
        } catch (error) {
            this.logger.error('Selhala inicializace session', error, { ip: this.ip });
            throw error;
        }
    }

    async getData() {
        try {
            const url = `http://${this.ip}/RealTimeData`;
            this.logger.debug('Načítání dat', { 
                url, 
                errorCount: this._apiErrorCount,
                maxErrors: this._maxConsecutiveErrors
            });
    
            const response = await fetch(url, { 
                timeout: 5000 
            });
            
            const data = await response.json();
            
            // Reset počítadla chyb při úspěšném volání
            if (this._apiErrorCount > 0) {
                this.logger.debug(`Reset počítadla chyb z ${this._apiErrorCount} na 0`);
                this._apiErrorCount = 0;
            }
            
            // Logování kompletní raw odpovědi z API
            this.logger.debug('Raw API Response:', data);
            return data;
            
        } catch (error) {
            // Zvýšení počítadla chyb
            this._apiErrorCount++;
            
            this.logger.debug(`API chyba #${this._apiErrorCount} z ${this._maxConsecutiveErrors}`, {
                error: error.message,
                stack: error.stack
            });
    
            // Pokud jsme přesáhli limit chyb
            if (this._apiErrorCount >= this._maxConsecutiveErrors) {
                this.logger.error('Překročen limit po sobě jdoucích chyb API', error, {
                    errorCount: this._apiErrorCount,
                    maxErrors: this._maxConsecutiveErrors
                });
                
                throw new Error('API_MAX_ERRORS_EXCEEDED');
            }
    
            // Původní chybová hláška
            this.logger.error('Selhalo načtení dat', error);
            throw new Error(`Načtení dat selhalo: ${error.message}`);
        }
    }

    getErrorCount() {
        return this._apiErrorCount;
    }
    
    resetErrorCount() {
        const oldCount = this._apiErrorCount;
        this._apiErrorCount = 0;
        if (oldCount > 0) {
            this.logger.debug(`Manuální reset počítadla chyb z ${oldCount} na 0`);
        }
    }
    
    isInErrorState() {
        return this._apiErrorCount >= this._maxConsecutiveErrors;
    }

    processData(data) {
        try {
            this.logger.debug('Zpracování surových dat', { rawData: data });
            
            const processedData = this.validator.validateAndProcessData(data);
            
            if (!processedData) {
                this.logger.warn("Nebyla nalezena platná data zařízení");
                return null;
            }

            this.logger.debug('Zpracovaná data:', processedData);
            return processedData;
            
        } catch (error) {
            this.logger.error('Selhalo zpracování dat', error);
            throw error;
        }
    }

    async setParameter(parameter, value) {
        try {
            const url = `http://${this.ip}/write/${parameter}=${value}`;
            this.logger.debug(`Nastavování parametru ${parameter}`, { 
                url, 
                hodnota: value 
            });

            const response = await fetch(url, { method: 'GET' });
            const responseData = await response.text();
            
            this.logger.debug(`Odpověď na nastavení ${parameter}`, { 
                odpověď: responseData 
            });

            if (!response.ok) {
                throw new Error(`Failed to set ${parameter}: ${response.statusText}`);
            }

            this.logger.log(`Parametr ${parameter} úspěšně nastaven`, {
                parametr: parameter,
                hodnota: value,
                odpověď: responseData
            });
            
            return responseData;
        } catch (error) {
            this.logger.error(`Chyba při nastavování parametru ${parameter}`, error, {
                parametr: parameter,
                hodnota: value
            });
            throw error;
        }
    }

    // Původní SET metody
    async setPaused(paused) {
        return this.setParameter('Paused', paused);
    }

    async setLocked(locked) {
        return this.setParameter('Locked', locked);
    }

    async setIntensity(intensity) {
        if (intensity < 6 || intensity > 32) {
            throw new Error('Intensity musí být mezi 6 a 32 A');
        }
        return this.setParameter('Intensity', intensity);
    }

    async setDynamic(dynamic) {
        return this.setParameter('Dynamic', dynamic);
    }

    async setDynamicPowerMode(dynamicPowerMode) {
        this.logger.debug('Nastavení DynamicPowerMode', { hodnota: dynamicPowerMode });
        return this.setParameter('DynamicPowerMode', dynamicPowerMode);
    }

    // Nové SET metody
    async setMinIntensity(minIntensity) {
        if (minIntensity < 6 || minIntensity > 32) {
            throw new Error('MinIntensity musí být mezi 6 a 32 A');
        }
        return this.setParameter('MinIntensity', minIntensity);
    }

    async setMaxIntensity(maxIntensity) {
        if (maxIntensity < 6 || maxIntensity > 32) {
            throw new Error('MaxIntensity musí být mezi 6 a 32 A');
        }
        return this.setParameter('MaxIntensity', maxIntensity);
    }

    async setTimer(enabled) {
        return this.setParameter('Timer', enabled ? '1' : '0');
    }

    // Nové GET metody pro individuální hodnoty
    async getHousePower() {
        const data = await this.getData();
        return data.HousePower || 0;
    }

    async getFVPower() {
        const data = await this.getData();
        return data.FVPower || 0;
    }

    async getBatteryPower() {
        const data = await this.getData();
        return data.BatteryPower || 0;
    }

    async getMinIntensity() {
        const data = await this.getData();
        return Math.max(6, Math.min(32, data.MinIntensity || 6));
    }

    async getMaxIntensity() {
        const data = await this.getData();
        return Math.max(6, Math.min(32, data.MaxIntensity || 32));
    }

    async getFirmwareVersion() {
        const data = await this.getData();
        return data.FirmwareVersion || '';
    }

    async getSignalStatus() {
        const data = await this.getData();
        return String(data.SignalStatus || '2');
    }

    async getTimer() {
        const data = await this.getData();
        return data.Timer === 1;
    }
}

module.exports = { v2cAPI };