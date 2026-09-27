'use strict';

const CONSTANTS = require('./constants');

class DataValidator {
    constructor(logger = null) {
        this.logger = logger;
        this.loggingEnabled = false;
        this.schemaCache = new Map();
        
        // Cache pro často používané hodnoty
        this.requiredFieldsCache = {
            basic: ['ChargeState', 'ChargePower', 'ChargeEnergy', 'Intensity'],
            input: ['ChargeState', 'ChargePower', 'ChargeEnergy', 'Intensity']
        };
        
        // Inicializace schématu při vytvoření instance
        this._initializeSchema();
    }

    _initializeSchema() {
        this.schemaCache.set('processedDataSchema', {
            chargeState: value => typeof value === 'string' && Object.values(CONSTANTS.CHARGE_STATES).includes(value),
            chargePower: value => Number.isFinite(value),
            chargeEnergy: value => Number.isFinite(value),
            intensity: value => Number.isFinite(value),
            voltageInstallation: value => value === null || Number.isFinite(value),
            slaveError: value => value === null || Object.values(CONSTANTS.SLAVE_ERRORS).includes(value),
            paused: value => value === null || typeof value === 'boolean',
            locked: value => value === null || typeof value === 'boolean',
            dynamic: value => typeof value === 'boolean',
            dynamicPowerMode: value => value === null || (typeof value === 'string' && ['0','1','2','3','4','5'].includes(value)),
            housePower: value => value === null || Number.isFinite(value),
            fvPower: value => value === null || Number.isFinite(value),
            batteryPower: value => value === null || Number.isFinite(value),
            minIntensity: value => typeof value === 'number' && 
                value >= CONSTANTS.DEVICE.INTENSITY.MIN && 
                value <= CONSTANTS.DEVICE.INTENSITY.MAX,
            maxIntensity: value => typeof value === 'number' && 
                value >= CONSTANTS.DEVICE.INTENSITY.MIN && 
                value <= CONSTANTS.DEVICE.INTENSITY.MAX,
            firmwareVersion: value => value === null || typeof value === 'string',
            signalStatus: value => value === null || (typeof value === 'string' && Object.values(CONSTANTS.SIGNAL_STATES).includes(value)),
            timer_state: value => value === null || typeof value === 'boolean',
            intensityL1: value => value === null || Number.isFinite(value),
            intensityL2: value => value === null || Number.isFinite(value),
            intensityL3: value => value === null || Number.isFinite(value),
            voltageL1: value => value === null || Number.isFinite(value),
            voltageL2: value => value === null || Number.isFinite(value),
            voltageL3: value => value === null || Number.isFinite(value)
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

            if (processedData.dynamic && processedData.dynamicPowerMode === null) {
                this.logWarn('Missing DynamicPowerMode while V2C dynamic control is active');
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
        // Pozn.: původně `!data?.constructor === Object` bylo vždy false kvůli
        // operátorové prioritě (! má přednost před ===) — validace neprobíhala.
        if (typeof data !== 'object' || data === null) {
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
        if (typeof data !== 'object' || data === null) {
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
        result.chargePower = this.validateRequiredNumericValue(rawData.ChargePower);
        result.chargeEnergy = this.validateRequiredNumericValue(rawData.ChargeEnergy);
        result.intensity = this.validateRequiredNumericValue(rawData.Intensity);
        result.chargeTime = Number(rawData.ChargeTime) || 0;
        
        // Boolean hodnoty
        result.paused = this.validateBooleanValue('Paused', rawData.Paused);
        result.locked = this.validateBooleanValue('Locked', rawData.Locked);
        result.dynamic = this.validateBooleanValue('Dynamic', rawData.Dynamic);
        // V2C vrací DynamicPowerMode jako number 0-5; normalizujeme na string pro konzistenci
        // s konfiguračními hodnotami v driver.settings.compose.json a konstantami.
        result.dynamicPowerMode = rawData.DynamicPowerMode != null
            ? String(rawData.DynamicPowerMode)
            : null;
        result.timer_state = this.validateBooleanValue('Timer', rawData.Timer);
        
        // Komplexnější validace
        result.voltageInstallation = this.validateInstallationVoltage(rawData.VoltageInstallation);
        result.slaveError = this.processSlaveError(rawData.SlaveError);
        result.housePower = this.validateOptionalNumericValue(rawData.HousePower);
        result.fvPower = this.validateOptionalNumericValue(rawData.FVPower);
        result.batteryPower = this.validateOptionalNumericValue(rawData.BatteryPower);
        // Per-phase telemetry is available on recent V2C firmware only. Preserve the
        // absence of these fields instead of reporting an invented 0 on older units.
        result.intensityL1 = this.validateOptionalNumericValue(rawData.IntensityMeasure_L1);
        result.intensityL2 = this.validateOptionalNumericValue(rawData.IntensityMeasure_L2);
        result.intensityL3 = this.validateOptionalNumericValue(rawData.IntensityMeasure_L3);
        result.voltageL1 = this.validateOptionalNumericValue(rawData.VoltageMeasure_L1);
        result.voltageL2 = this.validateOptionalNumericValue(rawData.VoltageMeasure_L2);
        result.voltageL3 = this.validateOptionalNumericValue(rawData.VoltageMeasure_L3);
        
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
        if (state === undefined || state === null || state === '') {
            return null;
        }

        const normalized = String(state);
        return Object.values(CONSTANTS.CHARGE_STATES).includes(normalized) ? normalized : null;
    }

    processSlaveError(error) {
        if (error === undefined || error === null || error === '') {
            return null;
        }

        const numericError = this.validateRequiredNumericValue(error);
        if (!Number.isInteger(numericError) || numericError < 0 || numericError > 10) {
            return null;
        }

        return String(numericError).padStart(2, '0');
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

    validateOptionalNumericValue(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }

        if (typeof value !== 'number' && typeof value !== 'string') {
            return null;
        }

        const processedValue = Number(value);
        return Number.isFinite(processedValue) ? processedValue : null;
    }

    validateRequiredNumericValue(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }

        if (typeof value !== 'number' && typeof value !== 'string') {
            return null;
        }

        const processedValue = Number(value);
        return Number.isFinite(processedValue) ? processedValue : null;
    }

    validateInstallationVoltage(value) {
        const voltage = this.validateOptionalNumericValue(value);
        return voltage !== null && voltage > 0 ? voltage : null;
    }

    validateBooleanValue(fieldName, value) {
        if (value === undefined || value === null) return null;
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') {
            if (value === 1) return true;
            if (value === 0) return false;
            return undefined;
        }
        if (typeof value === 'string') {
            if (value === 'true' || value === '1') return true;
            if (value === 'false' || value === '0') return false;
        }
        return undefined;
    }

    validateStringValue(fieldName, value) {
        return typeof value === 'string' ? value : null;
    }

    validateEnumValue(fieldName, value, allowedValues) {
        if (value === undefined || value === null || value === '') {
            return null;
        }

        const stringValue = String(value);
        return allowedValues.includes(stringValue) ? stringValue : null;
    }
}

module.exports = DataValidator;
