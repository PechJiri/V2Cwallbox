"use strict";

const CONSTANTS = require('./constants');

class DataValidator {
    constructor(logger = null) {
        this.logger = logger;
        this.loggingEnabled = false;
        this.schemaCache = new Map();
    }

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

    validateAndProcessData(rawData) {
        try {
            if (!this.isValidInput(rawData)) {
                this.logWarn('Invalid input data', { rawData });
                return null;
            }

            if (!this.ensureRequiredFields(rawData)) {
                return null;
            }

            const processedData = this.processData(rawData);

            if (!this.isValidProcessedData(processedData)) {
                this.logWarn('Invalid processed data', { processedData });
                return null;
            }

            this.logDebug('Data successfully validated and processed', { processedData });
            return processedData;

        } catch (error) {
            this.logError('Error validating data', error, { rawData });
            throw error;
        }
    }

    ensureRequiredFields(data) {
        const requiredFields = ['ChargeState', 'ChargePower', 'FirmwareVersion'];
        const missingFields = requiredFields.filter(field => !(field in data));
        if (missingFields.length > 0) {
            this.logWarn('Missing required fields', { missingFields });
            return false;
        }
        return true;
    }

    isValidInput(data) {
        if (!data || typeof data !== 'object') {
            this.logWarn('Input data is not an object');
            return false;
        }
        const requiredFields = ['ChargeState', 'ChargePower', 'ChargeEnergy', 'Intensity'];
        const missingFields = requiredFields.filter(field => !(field in data));

        if (missingFields.length > 0) {
            this.logWarn('Missing required fields', { missingFields });
            return false;
        }

        return true;
    }

    isValidProcessedData(data) {
        if (!data || typeof data !== 'object') {
            this.logWarn('Processed data is not an object');
            return false;
        }

        const schema = this.getSchema();

        for (const [field, validator] of Object.entries(schema)) {
            if (field in data && !validator(data[field])) {
                this.logDebug(`Invalid value for ${field}`, { value: data[field] });
                return false;
            }
        }

        return true;
    }

    getSchema() {
        if (!this.schemaCache.has('processedDataSchema')) {
            const schema = {
                chargeState: value => typeof value === 'string' && Object.values(CONSTANTS.CHARGE_STATES).includes(value),
                chargePower: value => typeof value === 'number' && !isNaN(value),
                intensity: value => typeof value === 'number' && !isNaN(value),
                voltageInstallation: value => typeof value === 'number' && !isNaN(value),
                slaveError: value => typeof value === 'string' && value.length === 2,
                paused: value => typeof value === 'boolean',
                measure_locked: value => typeof value === 'boolean',
                dynamic: value => typeof value === 'boolean',
                housePower: value => value === null || (typeof value === 'number' && !isNaN(value)),
                fvPower: value => value === null || (typeof value === 'number' && !isNaN(value)),
                batteryPower: value => value === null || (typeof value === 'number' && !isNaN(value)),
                minIntensity: value => typeof value === 'number' && 
                    value >= CONSTANTS.DEVICE.INTENSITY.MIN && 
                    value <= CONSTANTS.DEVICE.INTENSITY.MAX,
                maxIntensity: value => typeof value === 'number' && 
                    value >= CONSTANTS.DEVICE.INTENSITY.MIN && 
                    value <= CONSTANTS.DEVICE.INTENSITY.MAX,
                firmwareVersion: value => typeof value === 'string',
                signalStatus: value => typeof value === 'string' && Object.values(CONSTANTS.SIGNAL_STATES).includes(value),
                timer_state: value => typeof value === 'boolean'
            };
            this.schemaCache.set('processedDataSchema', schema);
        }
        return this.schemaCache.get('processedDataSchema');
    }

    processData(rawData) {
        return {
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
            minIntensity: this.validateNumericValue('MinIntensity', rawData.MinIntensity, 
                CONSTANTS.DEVICE.INTENSITY.MIN, CONSTANTS.DEVICE.INTENSITY.MAX),
            maxIntensity: this.validateNumericValue('MaxIntensity', rawData.MaxIntensity, 
                CONSTANTS.DEVICE.INTENSITY.MIN, CONSTANTS.DEVICE.INTENSITY.MAX),
            firmwareVersion: this.validateStringValue('FirmwareVersion', rawData.FirmwareVersion),
            signalStatus: this.validateEnumValue('SignalStatus', rawData.SignalStatus, 
                Object.values(CONSTANTS.SIGNAL_STATES)),
            timer_state: this.validateBooleanValue('Timer', rawData.Timer)
        };
    }

    processChargeState(state) {
        return state === undefined || state === 4 ? CONSTANTS.CHARGE_STATES.DISCONNECTED : String(state);
    }

    processSlaveError(error) {
        return String(error ?? CONSTANTS.SLAVE_ERRORS.NO_ERROR).padStart(2, '0');
    }

    validateNumericValue(fieldName, value, min = null, max = null) {
        const ranges = {
            MinIntensity: { 
                min: CONSTANTS.DEVICE.INTENSITY.MIN, 
                max: CONSTANTS.DEVICE.INTENSITY.MAX 
            },
            MaxIntensity: { 
                min: CONSTANTS.DEVICE.INTENSITY.MIN, 
                max: CONSTANTS.DEVICE.INTENSITY.MAX 
            }
        };

        if (ranges[fieldName]) {
            min = min ?? ranges[fieldName].min;
            max = max ?? ranges[fieldName].max;
        }

        const processedValue = Number(value);
        if (isNaN(processedValue)) {
            this.logDebug(`Invalid numeric value for ${fieldName}`, { value });
            return min || 0;
        }

        if (min !== null && processedValue < min) {
            this.logDebug(`Value below minimum for ${fieldName}`, { value, min });
            return min;
        }
        if (max !== null && processedValue > max) {
            this.logDebug(`Value above maximum for ${fieldName}`, { value, max });
            return max;
        }

        return processedValue;
    }

    validateBooleanValue(fieldName, value) {
        if (typeof value === 'boolean') {
            return value;
        }
        if (typeof value === 'number') {
            return value === 1;
        }
        if (typeof value === 'string') {
            return value.toLowerCase() === 'true' || value === '1';
        }
        this.logDebug(`Invalid boolean value for ${fieldName}`, { value });
        return false;
    }

    validateStringValue(fieldName, value) {
        if (typeof value !== 'string') {
            this.logDebug(`Invalid string value for ${fieldName}`, { value });
            return '';
        }
        return value;
    }

    validateEnumValue(fieldName, value, allowedValues) {
        const stringValue = String(value || '');
        if (!allowedValues.includes(stringValue)) {
            this.logDebug(`Invalid enum value for ${fieldName}`, {
                value,
                allowed: allowedValues
            });
            return allowedValues[0];
        }
        return stringValue;
    }
}

module.exports = DataValidator;