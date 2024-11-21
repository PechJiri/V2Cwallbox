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
    }

    setLoggingEnabled(enabled) {
        this.logger.setEnabled(enabled);
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
            this.logger.debug('Načítání dat', { url });

            const response = await fetch(url);
            const data = await response.json();
            this.logger.debug('Odpověď z getData', { data });

            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }

            return data;
        } catch (error) {
            this.logger.error('Selhalo načtení dat', error, { ip: this.ip });
            throw error;
        }
    }

    processData(data) {
        try {
            this.logger.debug('Zpracování surových dat', { rawData: data });
            
            // Použití validátoru pro zpracování dat
            const processedData = this.validator.validateAndProcessData(data);
            
            if (!processedData) {
                this.logger.warn("Nebyla nalezena platná data zařízení");
                return null;
            }

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

    async setPaused(paused) {
        return this.setParameter('Paused', paused);
    }

    async setLocked(locked) {
        return this.setParameter('Locked', locked);
    }

    async setIntensity(intensity) {
        return this.setParameter('Intensity', intensity);
    }

    async setDynamic(dynamic) {
        return this.setParameter('Dynamic', dynamic);
    }

    async setMinIntensity(minIntensity) {
        return this.setParameter('MinIntensity', minIntensity);
    }

    async setMaxIntensity(maxIntensity) {
        return this.setParameter('MaxIntensity', maxIntensity);
    }

    async setDynamicPowerMode(dynamicPowerMode) {
        this.logger.debug('Nastavení DynamicPowerMode', { hodnota: dynamicPowerMode });
        return this.setParameter('DynamicPowerMode', dynamicPowerMode);
    }
}

module.exports = { v2cAPI };