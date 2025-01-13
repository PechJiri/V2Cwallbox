'use strict';

const CONSTANTS = require('./constants');

class DataValidator {
    constructor(logger = null) {
        this.logger = logger;
        this.loggingEnabled = false;
        this.schemaCache = new Map();
        
        // Cache pro často používané hodnoty
        this.requiredFieldsCache = {
            basic: ['ChargeState', 'ChargePower', 'FirmwareVersion'],
            input: ['ChargeState', 'ChargePower', 'ChargeEnergy', 'Intensity']
        };
        
        // Inicializace schématu při vytvoření instance
        this._initializeSchema();
    }

    _initializeSchema() {
        this.schemaCache.set('processedDataSchema', {
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
        });
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

    isValidInput(data) {
        if (!data?.constructor === Object) {
            this.logWarn('Input data is not an object');
            return false;
        }
        
        const fields = this.requiredFieldsCache.input;
        for (let i = 0; i < fields.length; i++) {
            if (!(fields[i] in data)) {
                this.logWarn('Missing required field', { field: fields[i] });
                return false;
            }
        }
        return true;
    }

    ensureRequiredFields(data) {
        const fields = this.requiredFieldsCache.basic;
        for (let i = 0; i < fields.length; i++) {
            if (!(fields[i] in data)) {
                this.logWarn('Missing required field', { field: fields[i] });
                return false;
            }
        }
        return true;
    }

    isValidProcessedData(data) {
        if (!data?.constructor === Object) {
            return false;
        }

        const schema = this.schemaCache.get('processedDataSchema');
        const entries = Object.entries(schema);
        
        for (let i = 0; i < entries.length; i++) {
            const [field, validator] = entries[i];
            if (field in data && !validator(data[field])) {
                return false;
            }
        }

        return true;
    }

    processData(rawData) {
        const result = {};
        
        // Základní hodnoty s přímou konverzí
        result.chargeState = this.processChargeState(rawData.ChargeState);
        result.chargePower = Number(rawData.ChargePower) || 0;
        result.chargeEnergy = Number(rawData.ChargeEnergy) || 0;
        result.intensity = Number(rawData.Intensity) || CONSTANTS.DEVICE.INTENSITY.MIN;
        result.chargeTime = Number(rawData.ChargeTime) || 0;
        
        // Boolean hodnoty
        result.paused = Boolean(rawData.Paused);
        result.measure_locked = Boolean(rawData.Locked);
        result.dynamic = Boolean(rawData.Dynamic);
        result.timer_state = Boolean(rawData.Timer);
        
        // Komplexnější validace
        result.voltageInstallation = this.validateNumericValue('VoltageInstallation', rawData.VoltageInstallation);
        result.slaveError = this.processSlaveError(rawData.SlaveError);
        result.housePower = this.validateNumericValue('HousePower', rawData.HousePower);
        result.fvPower = this.validateNumericValue('FVPower', rawData.FVPower);
        result.batteryPower = this.validateNumericValue('BatteryPower', rawData.BatteryPower);
        
        // Validace s limity
        result.minIntensity = this.validateNumericValue('MinIntensity', rawData.MinIntensity,
            CONSTANTS.DEVICE.INTENSITY.MIN, CONSTANTS.DEVICE.INTENSITY.MAX);
        result.maxIntensity = this.validateNumericValue('MaxIntensity', rawData.MaxIntensity,
            CONSTANTS.DEVICE.INTENSITY.MIN, CONSTANTS.DEVICE.INTENSITY.MAX);
            
        // String hodnoty
        result.firmwareVersion = this.validateStringValue('FirmwareVersion', rawData.FirmwareVersion);
        result.signalStatus = this.validateEnumValue('SignalStatus', rawData.SignalStatus,
            Object.values(CONSTANTS.SIGNAL_STATES));
        
        return result;
    }

    processChargeState(state) {
        return state === undefined || state === 4 ? CONSTANTS.CHARGE_STATES.DISCONNECTED : String(state);
    }

    processSlaveError(error) {
        return String(error ?? CONSTANTS.SLAVE_ERRORS.NO_ERROR).padStart(2, '0');
    }

    validateNumericValue(fieldName, value, min = null, max = null) {
        if (typeof value === 'number') {
            if (min !== null && value < min) return min;
            if (max !== null && value > max) return max;
            return value;
        }
        
        const processedValue = Number(value);
        if (isNaN(processedValue)) {
            return min || 0;
        }

        if (min !== null && processedValue < min) return min;
        if (max !== null && processedValue > max) return max;
        
        return processedValue;
    }

    validateBooleanValue(fieldName, value) {
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') return value === 1;
        if (typeof value === 'string') return value.toLowerCase() === 'true' || value === '1';
        return false;
    }

    validateStringValue(fieldName, value) {
        return typeof value === 'string' ? value : '';
    }

    validateEnumValue(fieldName, value, allowedValues) {
        const stringValue = String(value || '');
        return allowedValues.includes(stringValue) ? stringValue : allowedValues[0];
    }
}

module.exports = DataValidator;