'use strict';

class DataValidator {
    // Konstanty pro často používané hodnoty
    static get CHARGE_STATES() {
        return ['0', '1', '2'];
    }

    static get SIGNAL_STATES() {
        return ['1', '2', '3'];
    }

    static get INTENSITY_LIMITS() {
        return {
            MIN: 6,
            MAX: 32
        };
    }

    constructor(logger = null) {
        this.logger = logger;
        this.loggingEnabled = false;
    }

    // Pomocné metody pro logování
    logDebug(message, data = {}) {
        if (this.loggingEnabled && this.logger) {
            this.logger.debug(message, data);
        }
    }

    logWarn(message, data = {}) {
        if (this.logger) {
            this.logger.warn(message, data);
        }
    }

    logError(message, error, data = {}) {
        if (this.logger) {
            this.logger.error(message, error, data);
        }
    }

    setLoggingEnabled(enabled) {
        this.loggingEnabled = enabled;
        this.logDebug(`DataValidator logging ${enabled ? 'enabled' : 'disabled'}`);
    }

    /**
     * Validuje a zpracovává surová data z V2C Wallboxu
     * @param {Object} rawData - Surová data z API
     * @returns {Object|null} - Zpracovaná data nebo null při nevalidních datech
     */
    validateAndProcessData(rawData) {
        try {
            if (!this.isValidInput(rawData)) {
                this.logWarn('Neplatná vstupní data', { rawData });
                return null;
            }

            if (!this.ensureRequiredFields(rawData)) {
                return null;
            }

            const processedData = {
                chargeState: this.processChargeState(rawData.ChargeState),
                chargePower: this.validateNumericValue('ChargePower', rawData.ChargePower),
                voltageInstallation: this.validateNumericValue('VoltageInstallation', rawData.VoltageInstallation),
                chargeEnergy: this.validateNumericValue('ChargeEnergy', rawData.ChargeEnergy),
                slaveError: this.processSlaveError(rawData.SlaveError),
                chargeTime: this.validateNumericValue('ChargeTime', rawData.ChargeTime),
                intensity: this.validateNumericValue('Intensity', rawData.Intensity),
                paused: this.validateBooleanValue('Paused', rawData.Paused),
                measure_locked: this.validateBooleanValue('Locked', rawData.Locked),
                dynamic: this.validateBooleanValue('Dynamic', rawData.Dynamic),
                housePower: this.validateNumericValue('HousePower', rawData.HousePower),
                fvPower: this.validateNumericValue('FVPower', rawData.FVPower),
                batteryPower: this.validateNumericValue('BatteryPower', rawData.BatteryPower),
                minIntensity: this.validateNumericValue('MinIntensity', rawData.MinIntensity, DataValidator.INTENSITY_LIMITS.MIN, DataValidator.INTENSITY_LIMITS.MAX),
                maxIntensity: this.validateNumericValue('MaxIntensity', rawData.MaxIntensity, DataValidator.INTENSITY_LIMITS.MIN, DataValidator.INTENSITY_LIMITS.MAX),
                firmwareVersion: this.validateStringValue('FirmwareVersion', rawData.FirmwareVersion),
                signalStatus: this.validateEnumValue('SignalStatus', rawData.SignalStatus, DataValidator.SIGNAL_STATES),
                timer_state: this.validateBooleanValue('Timer', rawData.Timer)
            };

            if (!this.isValidProcessedData(processedData)) {
                this.logWarn('Neplatná zpracovaná data', { processedData });
                return null;
            }

            this.logDebug('Data úspěšně validována a zpracována', { processedData });
            return processedData;

        } catch (error) {
            this.logError('Chyba při validaci dat', error, { rawData });
            throw error;
        }
    }

    /**
     * Kontrola přítomnosti všech povinných polí
     */
    ensureRequiredFields(data) {
        const requiredFields = [
            'ChargeState',
            'ChargePower',
            'FirmwareVersion'
        ];

        const missingFields = requiredFields.filter(field => !(field in data));
        if (missingFields.length > 0) {
            this.logWarn('Chybějící povinná pole', { missingFields });
            return false;
        }
        return true;
    }

    /**
     * Validuje vstupní data
     */
    isValidInput(data) {
        if (!data || typeof data !== 'object') {
            this.logWarn('Vstupní data nejsou objekt');
            return false;
        }
    
        // Kontrola přítomnosti povinných polí
        const requiredFields = [
            'ChargeState',
            'ChargePower',
            'ChargeEnergy',
            'Intensity'
        ];
    
        const missingFields = requiredFields.filter(field => !(field in data));
        
        if (missingFields.length > 0) {
            this.logWarn('Chybějící povinná pole', { missingFields });
            return false;
        }
    
        return true;
    }

    /**
     * Validuje výstupní zpracovaná data
     */
    isValidProcessedData(data) {
        if (!data || typeof data !== 'object') {
            this.logWarn('Zpracovaná data nejsou objekt');
            return false;
        }
    
        // Minimální sada povinných polí pro funkčnost
        const requiredValidations = {
            chargeState: value => typeof value === 'string' && ['0', '1', '2'].includes(value),
            chargePower: value => typeof value === 'number' && !isNaN(value),
            intensity: value => typeof value === 'number' && !isNaN(value)
        };
    
        // Rozšířená sada validací pro nepovinná pole
        const optionalValidations = {
            voltageInstallation: value => typeof value === 'number' && !isNaN(value),
            slaveError: value => typeof value === 'string' && value.length === 2,
            paused: value => typeof value === 'boolean',
            measure_locked: value => typeof value === 'boolean',
            dynamic: value => typeof value === 'boolean',
            housePower: value => !value || (typeof value === 'number' && !isNaN(value)),
            fvPower: value => !value || (typeof value === 'number' && !isNaN(value)),
            batteryPower: value => !value || (typeof value === 'number' && !isNaN(value)),
            minIntensity: value => !value || (typeof value === 'number' && value >= 6 && value <= 32),
            maxIntensity: value => !value || (typeof value === 'number' && value >= 6 && value <= 32),
            firmwareVersion: value => typeof value === 'string',
            signalStatus: value => typeof value === 'string' && ['1', '2', '3'].includes(value),
            timer_state: value => typeof value === 'boolean'
        };
    
        // Kontrola povinných polí
        const requiredValid = Object.entries(requiredValidations).every(([key, validator]) => {
            const isValid = validator(data[key]);
            if (!isValid) {
                this.logDebug(`Neplatná povinná hodnota pro ${key}`, { value: data[key] });
            }
            return isValid;
        });
    
        if (!requiredValid) return false;
    
        // Kontrola nepovinných polí (pouze pokud existují)
        const optionalValid = Object.entries(optionalValidations).every(([key, validator]) => {
            if (key in data) {
                const isValid = validator(data[key]);
                if (!isValid) {
                    this.logDebug(`Neplatná nepovinná hodnota pro ${key}`, { value: data[key] });
                }
                return isValid;
            }
            return true;
        });
    
        return optionalValid;
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
    validateNumericValue(fieldName, value, min = null, max = null) {
        // Předdefinované rozsahy pro specifická pole
        const ranges = {
            'MinIntensity': { min: DataValidator.INTENSITY_LIMITS.MIN, max: DataValidator.INTENSITY_LIMITS.MAX },
            'MaxIntensity': { min: DataValidator.INTENSITY_LIMITS.MIN, max: DataValidator.INTENSITY_LIMITS.MAX }
        };

        // Použití předdefinovaných rozsahů, pokud existují
        if (ranges[fieldName]) {
            min = min ?? ranges[fieldName].min;
            max = max ?? ranges[fieldName].max;
        }

        const processedValue = Number(value);
        if (isNaN(processedValue)) {
            this.logDebug(`Neplatná numerická hodnota pro ${fieldName}`, { value });
            return min || 0;
        }

        if (min !== null && processedValue < min) {
            this.logDebug(`Hodnota pod minimem pro ${fieldName}`, { value, min });
            return min;
        }
        if (max !== null && processedValue > max) {
            this.logDebug(`Hodnota nad maximem pro ${fieldName}`, { value, max });
            return max;
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
            return value === 1; // Explicitně převedeme 0/1 na false/true
        }
        if (typeof value === 'string') {
            return value.toLowerCase() === 'true' || value === '1';
        }
        this.logDebug(`Neplatná boolean hodnota pro ${fieldName}`, { value });
        return false; // Vrátíme default hodnotu
    }

    /**
     * Validuje string hodnotu
     */
    validateStringValue(fieldName, value) {
        if (typeof value !== 'string') {
            this.logDebug(`Neplatná string hodnota pro ${fieldName}`, { value });
            return '';
        }
        return value;
    }

    /**
     * Validuje enum hodnotu
     */
    validateEnumValue(fieldName, value, allowedValues) {
        const stringValue = String(value || '');
        if (!allowedValues.includes(stringValue)) {
            this.logDebug(`Neplatná enum hodnota pro ${fieldName}`, { 
                value, 
                povolené: allowedValues 
            });
            return allowedValues[0];
        }
        return stringValue;
    }
}

module.exports = DataValidator;