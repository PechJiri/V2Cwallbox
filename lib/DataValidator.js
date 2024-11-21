'use strict';

class DataValidator {
    constructor(logger = null) {
        this.logger = logger;
    }

    /**
     * Validuje a zpracovává surová data z V2C Wallboxu
     * @param {Object} rawData - Surová data z API
     * @returns {Object|null} - Zpracovaná data nebo null při nevalidních datech
     */
    validateAndProcessData(rawData) {
        try {
            // Kontrola, zda máme platná vstupní data
            if (!this.isValidInput(rawData)) {
                if (this.logger) {
                    this.logger.warn('Neplatná vstupní data', { rawData });
                }
                return null;
            }

            // Zpracování charge state
            const chargeState = this.processChargeState(rawData.ChargeState);

            // Validace a zpracování numerických hodnot
            const processedData = {
                chargeState,
                chargePower: this.validateNumericValue('ChargePower', rawData.ChargePower),
                voltageInstallation: this.validateNumericValue('VoltageInstallation', rawData.VoltageInstallation),
                chargeEnergy: this.validateNumericValue('ChargeEnergy', rawData.ChargeEnergy),
                slaveError: this.processSlaveError(rawData.SlaveError),
                chargeTime: this.validateNumericValue('ChargeTime', rawData.ChargeTime),
                intensity: this.validateNumericValue('Intensity', rawData.Intensity),
                // Boolean hodnoty
                paused: this.validateBooleanValue('Paused', rawData.Paused),
                measure_locked: this.validateBooleanValue('Locked', rawData.Locked),
                dynamic: this.validateBooleanValue('Dynamic', rawData.Dynamic)
            };

            // Finální validace zpracovaných dat
            if (!this.isValidProcessedData(processedData)) {
                if (this.logger) {
                    this.logger.warn('Neplatná zpracovaná data', { processedData });
                }
                return null;
            }

            if (this.logger) {
                this.logger.debug('Data úspěšně validována a zpracována', { processedData });
            }

            return processedData;

        } catch (error) {
            if (this.logger) {
                this.logger.error('Chyba při validaci dat', error, { rawData });
            }
            throw error;
        }
    }

    /**
     * Validuje vstupní data
     */
    isValidInput(data) {
        if (!data || typeof data !== 'object') {
            return false;
        }

        // Kontrola přítomnosti povinných polí
        const requiredFields = ['ChargeState', 'VoltageInstallation', 'ChargePower'];
        return requiredFields.every(field => field in data);
    }

    /**
     * Validuje výstupní zpracovaná data
     */
    isValidProcessedData(data) {
        if (!data || typeof data !== 'object') {
            return false;
        }

        // Kontrola přítomnosti a typu všech povinných polí
        const validations = {
            chargeState: value => typeof value === 'string' && ['0', '1', '2'].includes(value),
            chargePower: value => typeof value === 'number' && !isNaN(value),
            voltageInstallation: value => typeof value === 'number' && !isNaN(value),
            slaveError: value => typeof value === 'string' && value.length === 2,
            paused: value => typeof value === 'boolean',
            measure_locked: value => typeof value === 'boolean',
            intensity: value => typeof value === 'number' && !isNaN(value)
        };

        return Object.entries(validations).every(([key, validator]) => {
            const isValid = validator(data[key]);
            if (!isValid && this.logger) {
                this.logger.debug(`Neplatná hodnota pro ${key}`, { value: data[key] });
            }
            return isValid;
        });
    }

    /**
     * Zpracovává stav nabíjení
     */
    processChargeState(state) {
        if (state === undefined || state === 4) {
            return '0';
        }
        return String(state);
    }

    /**
     * Zpracovává slave error
     */
    processSlaveError(error) {
        return String(error ?? 0).padStart(2, '0');
    }

    /**
     * Validuje numerickou hodnotu
     */
    validateNumericValue(fieldName, value) {
        const processedValue = Number(value);
        if (isNaN(processedValue)) {
            if (this.logger) {
                this.logger.debug(`Neplatná numerická hodnota pro ${fieldName}`, { value });
            }
            return 0;
        }
        return processedValue;
    }

    /**
     * Validuje boolean hodnotu
     */
    validateBooleanValue(fieldName, value) {
        if (typeof value === 'boolean') {
            return value;
        }
        if (typeof value === 'number') {
            return Boolean(value);
        }
        if (typeof value === 'string') {
            return value.toLowerCase() === 'true' || value === '1';
        }
        if (this.logger) {
            this.logger.debug(`Neplatná boolean hodnota pro ${fieldName}`, { value });
        }
        return false;
    }
}

module.exports = DataValidator;