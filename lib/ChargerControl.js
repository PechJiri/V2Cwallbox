'use strict';

const CONSTANTS = require('./constants');
const PowerCalculator = require('./power_calculator');

const HOMEY_IDLE_PAUSE_KEY = 'homeyEnergyKnownIdlePause';
const VALID_DYNAMIC_POWER_MODES = new Set(['0', '1', '2', '3', '4', '5']);

class ChargerControl {
    constructor(device) {
        this.device = device;
        this._queue = Promise.resolve();
        this._pendingHomeyModeRequest = null;
    }

    _enqueue(operation) {
        // Other queued work breaks mode-only adjacency; the mode path installs its ticket after enqueue.
        this._pendingHomeyModeRequest = null;
        const result = this._queue.then(operation);
        this._queue = result.catch(() => {});
        return result;
    }

    setChargingPaused(paused) {
        // Manual Pause/Resume only changes permission; the configured current is retained.
        return this._enqueue(() => paused
            ? this._pauseFromManualIntent()
            : this._resumeFromManualIntent());
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
                throw new Error(`Intensity must be between ${CONSTANTS.DEVICE.INTENSITY.MIN} and ${CONSTANTS.DEVICE.INTENSITY.MAX} A`);
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
        const modeOnly = values && Object.keys(values).length === 1 &&
            values.target_power_mode !== undefined;
        const mode = modeOnly ? values.target_power_mode : null;
        const knownMode = mode === CONSTANTS.TARGET_POWER_MODES.HOMEY ||
            Object.prototype.hasOwnProperty.call(CONSTANTS.TARGET_MODE_TO_V2C, mode);
        if (modeOnly && knownMode) {
            if (this._pendingHomeyModeRequest) {
                this._pendingHomeyModeRequest.superseded = true;
            }

            const request = { superseded: false };
            const result = this._enqueue(async () => {
                if (this._pendingHomeyModeRequest === request) {
                    this._pendingHomeyModeRequest = null;
                }
                if (request.superseded) return true;
                return await this._applyChargingChanges(values);
            });
            this._pendingHomeyModeRequest = request;
            return result;
        }

        return this._enqueue(async () => this._applyChargingChanges(values));
    }

    async _applyChargingChanges(values) {
        const changes = {
            modeChanged: values.target_power_mode !== undefined,
            powerChanged: values.target_power !== undefined,
            chargingChanged: values.evcharger_charging !== undefined,
            mode: values.target_power_mode
            ?? this.device.getCapabilityValue('target_power_mode')
            ?? CONSTANTS.TARGET_POWER_MODES.HOMEY,
            power: values.target_power
            ?? this.device.getCapabilityValue('target_power')
            ?? 0,
            charging: values.evcharger_charging
            ?? this.device.getCapabilityValue('evcharger_charging')
            ?? true
        };

        if (changes.modeChanged) {
            await this._writeMode(changes.mode);
        }

        if (changes.mode !== CONSTANTS.TARGET_POWER_MODES.HOMEY) {
            return await this._applyV2COwnedChanges(changes);
        }

        return await this._applyHomeyOwnedChanges(changes);
    }

    async _applyV2COwnedChanges({ modeChanged, chargingChanged, charging }) {
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

    async _applyHomeyOwnedChanges(changes) {
        if (changes.chargingChanged && !changes.powerChanged && !changes.modeChanged) {
            return changes.charging
                ? await this._resumeFromManualIntent()
                : await this._pauseFromManualIntent();
        }

        const numericPower = Number(changes.power);
        if (Number.isFinite(numericPower) && numericPower === 0) {
            // A changed zero target (including Homey's combined mode/power/charging batch) is
            // Homey-owned idle. A standalone charging capability change is manual intent.
            return await this._applyHomeyZeroTarget(changes);
        }

        const validPositivePower = Number.isFinite(numericPower) && numericPower > 0;
        if (validPositivePower && changes.chargingChanged && !changes.charging) {
            return await this._pauseFromManualIntent();
        }

        const canStart = validPositivePower && this._hasEnoughPower(numericPower);
        if (!canStart) {
            return await this._applyUnachievableHomeyTarget(changes);
        }

        const intensity = this._calculateIntensity(numericPower);
        await this._writeIntensity(intensity);

        if (changes.chargingChanged) {
            await this._setPauseProvenance(false);
            await this._writePaused(!changes.charging);
            await this._updateChargingCapability(!changes.charging);
        }

        return true;
    }

    async _applyHomeyZeroTarget({ powerChanged, modeChanged, chargingChanged }) {
        if (powerChanged || modeChanged) {
            await this._writePaused(true);
            await this._updateChargingCapability(true);
            await this._setPauseProvenance(true);
        } else if (chargingChanged) {
            await this._pauseFromManualIntent();
        }
        return true;
    }

    async _applyUnachievableHomeyTarget({ powerChanged, chargingChanged, charging }) {
        if (chargingChanged && !charging) {
            return await this._pauseFromManualIntent();
        }

        if (powerChanged || chargingChanged) {
            // Invalid, negative, or sub-minimum desired power cannot start a charger.
            // If it was already running, pause it rather than over-requesting its minimum.
            await this._writePaused(true);
            await this._updateChargingCapability(true);
        }
        return true;
    }

    async _pauseFromManualIntent() {
        await this._setPauseProvenance(false);
        await this._writePaused(true);
        await this._updateChargingCapability(true);
        return true;
    }

    async _resumeFromManualIntent() {
        await this._setPauseProvenance(false);
        await this._writePaused(false);
        await this._updateChargingCapability(false);
        return true;
    }

    async _writeMode(mode) {
        if (mode === CONSTANTS.TARGET_POWER_MODES.HOMEY) {
            await this.device.v2cApi.setDynamic('0');
            return;
        }

        const v2cMode = CONSTANTS.TARGET_MODE_TO_V2C[mode];
        if (!v2cMode) throw new Error(`Unknown target_power_mode: ${mode}`);
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
            throw new Error(`Intensity must be between ${CONSTANTS.DEVICE.INTENSITY.MIN} and ${CONSTANTS.DEVICE.INTENSITY.MAX} A`);
        }
        await this.device.v2cApi.setIntensity(value);
        return true;
    }

    async _writePaused(paused) {
        const pendingPublication = this.device._productionDataRequest;
        await this.device.v2cApi.setParameter('Paused', paused ? '1' : '0');
        if (pendingPublication) {
            try {
                await pendingPublication;
            } catch {
                // The acknowledged Paused write remains valid when the old poll fails.
            }
        }
    }

    async _updateChargingCapability(paused) {
        if (typeof this.device.setCapabilityValue === 'function') {
            await this.device.setCapabilityValue('evcharger_charging', !paused);
        }

        const chargeState = typeof this.device.getInternalChargeState === 'function'
            ? this.device.getInternalChargeState()
            : this.device._lastChargeState;
        const isConnected = chargeState === CONSTANTS.CHARGE_STATES.CONNECTED ||
            chargeState === CONSTANTS.CHARGE_STATES.CHARGING;
        if (!isConnected || this.device.getCapabilityValue('alarm_generic') === true) return;

        const nativeState = this.device.getCapabilityValue('evcharger_charging_state');
        if (paused) {
            await this.device.setCapabilityValue(
                'evcharger_charging_state',
                CONSTANTS.EVCHARGER_STATES.PLUGGED_IN_PAUSED
            );
        } else if (nativeState === CONSTANTS.EVCHARGER_STATES.PLUGGED_IN_PAUSED) {
            // Resuming confirms permission only; measured telemetry must confirm active charging.
            await this.device.setCapabilityValue(
                'evcharger_charging_state',
                CONSTANTS.EVCHARGER_STATES.PLUGGED_IN
            );
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
