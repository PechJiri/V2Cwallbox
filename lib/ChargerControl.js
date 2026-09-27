'use strict';

const CONSTANTS = require('./constants');
const PowerCalculator = require('./power_calculator');

const HOMEY_IDLE_PAUSE_KEY = 'homeyEnergyKnownIdlePause';
const VALID_DYNAMIC_POWER_MODES = new Set(['0', '1', '2', '3', '4', '5']);

class ChargerControl {
    constructor(device) {
        this.device = device;
        this._queue = Promise.resolve();
    }

    _enqueue(operation) {
        const result = this._queue.then(operation);
        this._queue = result.catch(() => {});
        return result;
    }

    setChargingPaused(paused) {
        return this._enqueue(async () => {
            if (paused) {
                // Clear old Homey-idle ownership before a manual Stop can replace it. If storage
                // fails, do not send an action that could later be misidentified as Homey-owned.
                await this._setPauseProvenance(false);
                await this._writePaused(true);
                await this._updateChargingCapability(true);
                return true;
            }

            const mode = this.device.getCapabilityValue('target_power_mode')
                ?? CONSTANTS.TARGET_POWER_MODES.HOMEY;
            if (mode === CONSTANTS.TARGET_POWER_MODES.HOMEY) {
                const watts = Number(this.device.getCapabilityValue('target_power'));
                if (!Number.isFinite(watts) || watts <= 0 || !this._hasEnoughPower(watts)) {
                    throw new Error('positive achievable Homey target required');
                }

                // Every public Homey resume uses the accepted target and only releases Paused
                // after the current write succeeds. A failed validation or write leaves both
                // pause state and provenance untouched.
                await this._writeIntensity(this._calculateIntensity(watts));
                await this._setPauseProvenance(false);
                await this._writePaused(false);
                await this._updateChargingCapability(false);
                return true;
            }

            // Manual resume remains available when V2C owns power; it never changes ownership
            // or applies a stale Homey target.
            await this._setPauseProvenance(false);
            await this._writePaused(false);
            await this._updateChargingCapability(false);
            return true;
        });
    }

    setDynamicPowerMode(mode) {
        return this._enqueue(async () => {
            let normalized;
            let targetPowerMode;
            if (mode === CONSTANTS.DYNAMIC_POWER_MODES.DISABLED) {
                normalized = CONSTANTS.DYNAMIC_POWER_MODES.DISABLED;
                targetPowerMode = CONSTANTS.TARGET_POWER_MODES.HOMEY;
            } else {
                normalized = String(mode);
                if (!VALID_DYNAMIC_POWER_MODES.has(normalized)) {
                    throw new Error('dynamic_power_mode must be "disabled" or a V2C mode from "0" to "5"');
                }
                targetPowerMode = CONSTANTS.V2C_TO_TARGET_MODE[normalized];
            }

            // Apply the strategy through the same serialized ownership path used by Homey
            // capability changes. Only synchronize settings after every hardware write succeeds.
            await this._applyChargingChanges({ target_power_mode: targetPowerMode });
            await this.device.setSettings({ dynamic_power_mode: normalized });
            await this.device.setCapabilityValue('target_power_mode', targetPowerMode);
            return true;
        });
    }

    setIntensityLimit(kind, amps) {
        return this._enqueue(async () => {
            if (kind !== 'min' && kind !== 'max') {
                throw new Error('intensity limit kind must be "min" or "max"');
            }
            const value = Number(amps);
            if (!Number.isFinite(value) || value < CONSTANTS.DEVICE.INTENSITY.MIN || value > CONSTANTS.DEVICE.INTENSITY.MAX) {
                throw new Error(`Intensity musí být mezi ${CONSTANTS.DEVICE.INTENSITY.MIN} a ${CONSTANTS.DEVICE.INTENSITY.MAX} A`);
            }

            const configuredMin = Number(this.device.getSetting('min_intensity')) || CONSTANTS.DEVICE.INTENSITY.MIN;
            const configuredMax = Number(this.device.getSetting('max_intensity')) || CONSTANTS.DEVICE.INTENSITY.MAX;
            const reportedMin = Number(this.device.getCapabilityValue('min_intensity')) || CONSTANTS.DEVICE.INTENSITY.MIN;
            const reportedMax = Number(this.device.getCapabilityValue('max_intensity')) || CONSTANTS.DEVICE.INTENSITY.MAX;
            const minIntensity = Math.max(
                CONSTANTS.DEVICE.INTENSITY.MIN,
                kind === 'min' ? value : configuredMin,
                reportedMin
            );
            const maxIntensity = Math.min(
                CONSTANTS.DEVICE.INTENSITY.MAX,
                kind === 'max' ? value : configuredMax,
                reportedMax
            );
            if (minIntensity > maxIntensity) {
                throw new Error('Minimum intensity cannot exceed maximum intensity');
            }

            if (kind === 'min') {
                await this.device.v2cApi.setMinIntensity(value);
            } else {
                await this.device.v2cApi.setMaxIntensity(value);
            }

            const settingId = kind === 'min' ? 'min_intensity' : 'max_intensity';
            await this.device.setSettings({ [settingId]: value });
            await this.device.setCapabilityValue(settingId, value);
            await this.device._applyCapabilityOptionsForPhaseMode();
            return true;
        });
    }

    setChargingIntensity(amps) {
        return this._enqueue(async () => this._writeIntensity(amps));
    }

    applyChargingChanges(values = {}) {
        return this._enqueue(async () => this._applyChargingChanges(values));
    }

    async _applyChargingChanges(values) {
        const modeChanged = values.target_power_mode !== undefined;
        const powerChanged = values.target_power !== undefined;
        const chargingChanged = values.evcharger_charging !== undefined;
        const mode = values.target_power_mode
            ?? this.device.getCapabilityValue('target_power_mode')
            ?? CONSTANTS.TARGET_POWER_MODES.HOMEY;
        const power = values.target_power
            ?? this.device.getCapabilityValue('target_power')
            ?? 0;
        const charging = values.evcharger_charging
            ?? this.device.getCapabilityValue('evcharger_charging')
            ?? true;

        if (modeChanged) {
            await this._writeMode(mode);
        }

        const homeyOwnsPower = mode === CONSTANTS.TARGET_POWER_MODES.HOMEY;
        if (!homeyOwnsPower) {
            if (modeChanged) {
                // Discard the previous Homey request before the next V2C sample is published.
                await this.device.setCapabilityValue('target_power', 0);
            }

            if (chargingChanged) {
                await this._setPauseProvenance(false);
                await this._writePaused(!charging);
                await this._updateChargingCapability(!charging);
            } else if (modeChanged && await this._hasHomeyIdlePause()) {
                await this._writePaused(false);
                await this._setPauseProvenance(false);
                await this._updateChargingCapability(false);
            }
            return true;
        }

        const numericPower = Number(power);
        if (Number.isFinite(numericPower) && numericPower === 0) {
            // A changed zero target (including Homey's combined mode/power/charging batch) is
            // Homey-owned idle. A standalone charging capability change is manual intent.
            if (powerChanged || modeChanged) {
                await this._writePaused(true);
                await this._updateChargingCapability(true);
                await this._setPauseProvenance(true);
            } else if (chargingChanged) {
                await this._setPauseProvenance(false);
                await this._writePaused(true);
                await this._updateChargingCapability(true);
            }
            return true;
        }

        const validPositivePower = Number.isFinite(numericPower) && numericPower > 0;
        if (validPositivePower && chargingChanged && !charging) {
            await this._setPauseProvenance(false);
            await this._writePaused(true);
            await this._updateChargingCapability(true);
            return true;
        }

        const canStart = validPositivePower && this._hasEnoughPower(numericPower);

        if (!canStart) {
            if (chargingChanged && !charging) {
                await this._setPauseProvenance(false);
                await this._writePaused(true);
                await this._updateChargingCapability(true);
            } else if (powerChanged || chargingChanged) {
                // Invalid, negative, or sub-minimum desired power cannot start a charger.
                // If it was already running, pause it rather than over-requesting its minimum.
                await this._writePaused(true);
                await this._updateChargingCapability(true);
            }
            return true;
        }

        const intensity = this._calculateIntensity(numericPower);
        await this._writeIntensity(intensity);

        if (chargingChanged) {
            await this._setPauseProvenance(false);
            await this._writePaused(!charging);
            await this._updateChargingCapability(!charging);
        }

        return true;
    }

    async _writeMode(mode) {
        if (mode === CONSTANTS.TARGET_POWER_MODES.HOMEY) {
            await this.device.v2cApi.setDynamic('0');
            return;
        }

        const v2cMode = CONSTANTS.TARGET_MODE_TO_V2C[mode];
        if (!v2cMode) throw new Error(`Neznámý target_power_mode: ${mode}`);
        await this.device.v2cApi.setDynamic('1');
        await this.device.v2cApi.setDynamicPowerMode(v2cMode);
    }

    _hasEnoughPower(watts) {
        const phaseMode = this.device.getSetting('phase_mode') || '3';
        const voltageType = this.device.getSetting('voltage_type') || 'line_to_neutral';
        const voltage = this.device.getChargingVoltage();
        const phaseFactor = phaseMode === '1'
            ? 1
            : voltageType === 'line_to_line' ? Math.sqrt(3) : 3;
        const configuredMin = Number(this.device.getSetting('min_intensity')) || CONSTANTS.DEVICE.INTENSITY.MIN;
        const reportedMin = Number(this.device.getCapabilityValue('min_intensity')) || CONSTANTS.DEVICE.INTENSITY.MIN;
        const minIntensity = Math.max(CONSTANTS.DEVICE.INTENSITY.MIN, configuredMin, reportedMin);
        const configuredMax = Number(this.device.getSetting('max_intensity')) || CONSTANTS.DEVICE.INTENSITY.MAX;
        const reportedMax = Number(this.device.getCapabilityValue('max_intensity')) || CONSTANTS.DEVICE.INTENSITY.MAX;
        const maxIntensity = Math.min(CONSTANTS.DEVICE.INTENSITY.MAX, configuredMax, reportedMax);
        return Number.isFinite(watts) && Number.isFinite(voltage) && voltage > 0 &&
            minIntensity <= maxIntensity && watts >= minIntensity * phaseFactor * voltage;
    }

    _calculateIntensity(watts) {
        const phaseMode = this.device.getSetting('phase_mode') || '3';
        const voltageType = this.device.getSetting('voltage_type') || 'line_to_neutral';
        const voltage = this.device.getChargingVoltage();
        const configuredMax = Number(this.device.getSetting('max_intensity')) || CONSTANTS.DEVICE.INTENSITY.MAX;
        const reportedMax = Number(this.device.getCapabilityValue('max_intensity')) || CONSTANTS.DEVICE.INTENSITY.MAX;
        const configuredMin = Number(this.device.getSetting('min_intensity')) || CONSTANTS.DEVICE.INTENSITY.MIN;
        const reportedMin = Number(this.device.getCapabilityValue('min_intensity')) || CONSTANTS.DEVICE.INTENSITY.MIN;
        const maxIntensity = Math.min(CONSTANTS.DEVICE.INTENSITY.MAX, configuredMax, reportedMax);
        const minIntensity = Math.max(CONSTANTS.DEVICE.INTENSITY.MIN, configuredMin, reportedMin);
        return Math.max(minIntensity, PowerCalculator.calculateCurrent(
            watts,
            phaseMode,
            voltage,
            voltageType,
            maxIntensity,
            CONSTANTS.ROUNDING_TYPES.FLOOR
        ));
    }

    async _writeIntensity(amps) {
        const value = Number(amps);
        if (!Number.isFinite(value) || value < CONSTANTS.DEVICE.INTENSITY.MIN || value > CONSTANTS.DEVICE.INTENSITY.MAX) {
            throw new Error(`Intensity musí být mezi ${CONSTANTS.DEVICE.INTENSITY.MIN} a ${CONSTANTS.DEVICE.INTENSITY.MAX} A`);
        }
        await this.device.v2cApi.setIntensity(value);
        return true;
    }

    async _writePaused(paused) {
        await this.device.v2cApi.setParameter('Paused', paused ? '1' : '0');
    }

    async _updateChargingCapability(paused) {
        if (typeof this.device.setCapabilityValue === 'function') {
            await this.device.setCapabilityValue('evcharger_charging', !paused);
        }
    }

    async _hasHomeyIdlePause() {
        return (await this.device.getStoreValue(HOMEY_IDLE_PAUSE_KEY)) === true;
    }

    async _setPauseProvenance(homeyIdle) {
        if (typeof this.device.setStoreValue === 'function') {
            await this.device.setStoreValue(HOMEY_IDLE_PAUSE_KEY, homeyIdle === true);
        }
    }
}

module.exports = ChargerControl;
