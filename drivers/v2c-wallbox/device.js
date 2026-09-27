'use strict';

const { Device } = require('homey');
const { v2cAPI } = require('./api');
const FlowCardManager = require('./FlowCardManager');
const PowerCalculator = require('../../lib/power_calculator');
const ChargerControl = require('../../lib/ChargerControl');
const DataValidator = require('../../lib/DataValidator');
const Logger = require('../../lib/Logger');
const EnergyManager = require('../../lib/EnergyManager');
const CONSTANTS = require('../../lib/constants');
const { validateWallboxIP } = require('../../lib/ip_validator');

const INSTALLATION_VOLTAGE_MIGRATION_VERSION = 1;
const INSTALLATION_VOLTAGE_MIGRATION_KEY = 'installationVoltageSettingMigrationVersion';
const INSTALLATION_VOLTAGE_NOTIFICATION_KEY = 'installationVoltageMigrationNotificationSent';
const PHASE_CAPABILITY_TITLES_MIGRATION_VERSION = 1;
const PHASE_CAPABILITY_TITLES_MIGRATION_KEY = 'phaseCapabilityTitlesMigrationVersion';
const PHASE_CAPABILITY_TITLES = Object.freeze({
    'measure_current.l1': { en: 'Current L1', cs: 'Proud L1' },
    'measure_current.l2': { en: 'Current L2', cs: 'Proud L2' },
    'measure_current.l3': { en: 'Current L3', cs: 'Proud L3' },
    'measure_voltage.l1': { en: 'Voltage L1', cs: 'Napětí L1' },
    'measure_voltage.l2': { en: 'Voltage L2', cs: 'Napětí L2' },
    'measure_voltage.l3': { en: 'Voltage L3', cs: 'Napětí L3' }
});

class MyDevice extends Device {
    _isProcessing = false;
    dataFetchInterval = null;
    _currentInterval = CONSTANTS.INTERVALS.DISCONNECTED;
    _consecutivePollErrors = 0;
    _productionDataRequest = null;
    _forcedProductionDataRequest = null;
    _lastSuccessfulUpdate = null;
    _statusStale = true;
    // Internal V2C state cache, including documented primary faults. The custom raw-state
    // capability preserves values that the native Homey EV state enum cannot represent.
    _lastChargeState = CONSTANTS.CHARGE_STATES.DISCONNECTED;

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

            // Úklid orphaned capabilities z neúspěšných migrací v pre-release buildech
            await this._cleanupOrphanedCapabilities();

            // Diagnostika - loguje aktuální capabilities na zařízení
            this.logger.debug('Aktuální capabilities na zařízení po úklidu', {
                caps: this.getCapabilities()
            });
    
            // Inicializace proměnných pro cache
            this.lastResponse = null;
            this.lastResponseTime = null;
    
            // Inicializace FlowCardManageru
            this.logger.debug('Inicializace FlowCardManageru');
            this.flowCardManager = new FlowCardManager(this.homey, this);
            this.flowCardManager.setLogger(this.logger);
            await this.flowCardManager.initialize();
    
            this.powerCalculator = PowerCalculator;

            // System capabilities must exist before EnergyManager seeds meter_power.
            await this.initializeCapabilities();

            // Capability options are stored on paired devices, so apply the distinct phase
            // labels once for users upgrading from the first per-phase telemetry release.
            await this.initializePhaseCapabilityTitles();

            // Existing paired devices do not reliably receive a newly introduced setting value.
            // Seed it locally from their previous voltage_type and last known voltage telemetry.
            await this.initializeInstallationVoltageSetting();

            this.energyManager = new EnergyManager(this, this.logger);
            await this.energyManager.initialize();
    
            this.dataValidator = new DataValidator(this.logger);
    
            // Kontrola a validace IP adresy — povolujeme jen privátní rozsahy
            const ip = this.getSetting('v2c_ip');
            if (!ip) {
                this.logger.error('IP adresa není nastavena');
                await this.setCapabilityValue('measure_connection_error', true);
                return this.setUnavailable('V2C IP address is not configured');
            }

            const ipCheck = validateWallboxIP(ip);
            if (!ipCheck.valid) {
                this.logger.error('Neplatná IP adresa v settings', { ip, reason: ipCheck.reason });
                await this.setCapabilityValue('measure_connection_error', true);
                return this.setUnavailable('Invalid IP — only private network addresses allowed');
            }
    
            // Inicializace API
            try {
                this.logger.debug('Inicializace V2C API', { ip });
                this.v2cApi = new v2cAPI(this.homey, ip);
                this.v2cApi.setLoggingEnabled(this.getSetting('enable_logging') || false);
            } catch (error) {
                this.logger.error('Chyba při inicializaci V2C API', error);
                await this.setCapabilityValue('measure_connection_error', true);
                return this.setUnavailable('V2C API initialization failed');
            }
    
            // Zúžení rozsahu systémové capability target_power podle phase_mode settingu
            // (widest range je v driver.compose.json, zde ji konkretizujeme dle instalace).
            await this._applyCapabilityOptionsForPhaseMode();

            // Registrace listeneru pro změnu A (manuální ovládání V2C Intensity)
            this.registerSetIntensityListener()

            // Registrace listenerů pro target_power + target_power_mode + evcharger_charging (Homey Energy).
            // Všechny tři jsou zpracovány jedním multi-callback listenerem dle doporučení docs,
            // protože systémová flow karta "Set target power" je přepíná najednou.
            this.registerTargetPowerListeners();

            // Registrace listeneru pro systémovou capability locked
            this.registerLockedListener();

            // Spuštění intervalu pro aktualizaci dat
            this.startDataFetchInterval();
    
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

    async _cleanupOrphanedCapabilities() {
        // Pokud některý z předchozích pre-release buildů přidal capability, kterou jsme pak
        // odstranili z manifestu, zůstává na zařízení a může rozbít UI v mobilní appce.
        // Projdeme aktuální capabilities na zařízení a odstraníme ty, které nejsou očekávané.
        const expected = new Set([
            ...CONSTANTS.DEVICE_CAPABILITIES,
            'measure_connection_error'
        ]);

        const currentCaps = this.getCapabilities();
        for (const cap of currentCaps) {
            if (expected.has(cap)) continue;

            this.logger.debug(`Odebírám orphaned capability: ${cap}`);
            try {
                await this.removeCapability(cap);
            } catch (error) {
                this.logger.warn(`Nepodařilo se odebrat capability ${cap}`, {
                    error: error.message
                });
            }
        }
    }

    async initializeCapabilities() {
        const failed = [];
        for (const capability of CONSTANTS.DEVICE_CAPABILITIES) {
            if (this.hasCapability(capability)) continue;

            this.logger.debug(`Přidávání capability: ${capability}`);
            try {
                await this.addCapability(capability);
            } catch (error) {
                // Některé capabilities nemusí být dostupné na starším firmware.
                // Nechceme, aby selhala celá inicializace - zalogujeme a pokračujeme.
                failed.push({ capability, error: error.message });
                this.logger.warn(`Capability ${capability} se nepodařilo přidat, pokračuji`, {
                    error: error.message
                });
            }
        }

        this.logger.debug('Inicializace capabilities dokončena', {
            totalCapabilities: CONSTANTS.DEVICE_CAPABILITIES.length,
            failedCount: failed.length,
            failed
        });
    }

    async initializeInstallationVoltageSetting() {
        try {
            const migratedVersion = await this.getStoreValue(INSTALLATION_VOLTAGE_MIGRATION_KEY);
            if (migratedVersion >= INSTALLATION_VOLTAGE_MIGRATION_VERSION) {
                return;
            }

            const rawMeasuredVoltage = this.getCapabilityValue('measure_voltage_installation');
            const measuredVoltage = rawMeasuredVoltage === null || rawMeasuredVoltage === undefined ||
                rawMeasuredVoltage === '' ? null : Number(rawMeasuredVoltage);
            const configuredVoltageType = this.getSetting('voltage_type');
            const voltageType = configuredVoltageType === 'line_to_line' || configuredVoltageType === 'line_to_neutral'
                ? configuredVoltageType
                : Number.isFinite(measuredVoltage) && measuredVoltage >= 300
                    ? 'line_to_line'
                    : 'line_to_neutral';

            const lineToLine = voltageType === 'line_to_line';
            const candidates = lineToLine
                ? CONSTANTS.DEVICE.INSTALLATION_VOLTAGE.LINE_TO_LINE_VALUES
                : CONSTANTS.DEVICE.INSTALLATION_VOLTAGE.VALUES.filter(
                    (value) => !CONSTANTS.DEVICE.INSTALLATION_VOLTAGE.LINE_TO_LINE_VALUES.includes(value)
                );
            const fallbackVoltage = lineToLine ? 400 : 230;
            const telemetryMatchesType = Number.isFinite(measuredVoltage) &&
                (lineToLine ? measuredVoltage >= 300 && measuredVoltage <= 500
                    : measuredVoltage >= 180 && measuredVoltage < 300);
            const installationVoltage = telemetryMatchesType
                ? candidates.reduce((nearest, candidate) =>
                    Math.abs(candidate - measuredVoltage) < Math.abs(nearest - measuredVoltage)
                        ? candidate
                        : nearest)
                : fallbackVoltage;

            // This is deliberately local-only: Device#setSettings() does not invoke onSettings(),
            // so migration cannot accidentally write VoltageInstallation to the wallbox.
            await this.setSettings({ installation_voltage: String(installationVoltage) });
            await this.setStoreValue(
                INSTALLATION_VOLTAGE_MIGRATION_KEY,
                INSTALLATION_VOLTAGE_MIGRATION_VERSION
            );

            this.logger.debug('Installation voltage setting migrated', {
                voltageType,
                measuredVoltage,
                installationVoltage
            });
        } catch (error) {
            this.logger.warn('Installation voltage setting migration failed', {
                error: error.message
            });
            await this.notifyInstallationVoltageMigrationFailure();
        }
    }

    async initializePhaseCapabilityTitles() {
        try {
            const migratedVersion = await this.getStoreValue(PHASE_CAPABILITY_TITLES_MIGRATION_KEY);
            if (migratedVersion >= PHASE_CAPABILITY_TITLES_MIGRATION_VERSION) {
                return;
            }

            for (const [capability, title] of Object.entries(PHASE_CAPABILITY_TITLES)) {
                await this.setCapabilityOptions(capability, { title });
            }

            await this.setStoreValue(
                PHASE_CAPABILITY_TITLES_MIGRATION_KEY,
                PHASE_CAPABILITY_TITLES_MIGRATION_VERSION
            );
            this.logger.debug('Per-phase capability titles migrated');
        } catch (error) {
            // Cosmetic migration: keep the device operational and retry on the next init.
            this.logger.warn('Per-phase capability title migration failed', {
                error: error.message
            });
        }
    }

    async notifyInstallationVoltageMigrationFailure() {
        try {
            if (await this.getStoreValue(INSTALLATION_VOLTAGE_NOTIFICATION_KEY)) {
                return;
            }

            // Claim notification delivery before creating it. If Homey stops after creation but
            // before the final marker write, the durable "sending" value still prevents spam.
            await this.setStoreValue(INSTALLATION_VOLTAGE_NOTIFICATION_KEY, 'sending');
            let notificationCreated = false;
            try {
                await this.homey.notifications.createNotification({
                    excerpt: `V2C Wallbox: Please open Advanced Settings for ${this.getName()} and verify Installation Voltage.`
                });
                notificationCreated = true;
                await this.setStoreValue(INSTALLATION_VOLTAGE_NOTIFICATION_KEY, true);
            } catch (error) {
                if (!notificationCreated) {
                    try {
                        await this.setStoreValue(INSTALLATION_VOLTAGE_NOTIFICATION_KEY, false);
                    } catch (clearError) {
                        this.logger.warn('Could not release installation voltage notification marker', {
                            error: clearError.message
                        });
                    }
                }
                throw error;
            }
        } catch (error) {
            this.logger.warn('Could not create installation voltage migration notification', {
                error: error.message
            });
        }
    }

    registerSetIntensityListener() {
        this.registerCapabilityListener('set_intensity', async (value) => {
            const intensity = parseInt(value, 10);

            // Validace
            if (intensity < 6 || intensity > 32) {
                throw new Error('Intensity must be between 6 and 32 A');
            }

            // API volání
            await this.v2cApi.setParameter('Intensity', intensity);

            return true;
        });
    }

    registerTargetPowerListeners() {
        // Multi-capability listener dle Homey Energy docs. Systémová flow karta
        // "Set target power" atomicky přepíná všechny tři capability:
        //   - target_power_mode → 'homey'
        //   - target_power → požadovaná hodnota
        //   - evcharger_charging → true (pro power>0) / false (pro 0)
        // Debounce 500 ms dle doporučení docs.
        this.registerMultipleCapabilityListener(
            ['target_power', 'target_power_mode', 'evcharger_charging'],
            async (values) => this.applyChargingChanges(values),
            500
        );
    }

    _getChargerControl() {
        if (!this.chargerControl) {
            this.chargerControl = new ChargerControl(this);
        }
        return this.chargerControl;
    }

    async setChargingPaused(paused) {
        return this._getChargerControl().setChargingPaused(paused);
    }

    async applyChargingChanges(values) {
        return this._getChargerControl().applyChargingChanges(values);
    }

    async setDynamicPowerMode(mode) {
        return this._getChargerControl().setDynamicPowerMode(mode);
    }

    async setIntensityLimit(kind, amps) {
        return this._getChargerControl().setIntensityLimit(kind, amps);
    }

    async setChargingIntensity(amps) {
        return this._getChargerControl().setChargingIntensity(amps);
    }

    getChargingVoltage() {
        const voltageType = this.getSetting('voltage_type') || 'line_to_neutral';
        const isMatchingVoltage = (value) => {
            const voltage = Number(value);
            if (!Number.isFinite(voltage)) return false;
            return voltageType === 'line_to_line'
                ? voltage >= 300 && voltage <= 500
                : voltage >= 180 && voltage < 300;
        };

        const measuredVoltage = this.getCapabilityValue('measure_voltage_installation');
        if (isMatchingVoltage(measuredVoltage)) return Number(measuredVoltage);

        const installationVoltage = this.getSetting('installation_voltage');
        if (isMatchingVoltage(installationVoltage)) return Number(installationVoltage);

        return voltageType === 'line_to_line' ? 400 : 230;
    }

    async _applyTargetPower(watts) {
        return this.applyChargingChanges({ target_power: watts });
    }

    _getPhaseModeVoltage(voltageType, voltageSettingsOverride) {
        if (voltageSettingsOverride) {
            const installationVoltage = Number(voltageSettingsOverride.installationVoltage);
            const isConfiguredLineToLine = CONSTANTS.DEVICE.INSTALLATION_VOLTAGE.LINE_TO_LINE_VALUES.includes(installationVoltage);
            const matchesVoltageType = Number.isFinite(installationVoltage)
                && (voltageType === 'line_to_line') === isConfiguredLineToLine;
            return matchesVoltageType
                ? installationVoltage
                : voltageType === 'line_to_line' ? 400 : 230;
        }

        return typeof this.getChargingVoltage === 'function' && typeof this.getCapabilityValue === 'function'
            ? this.getChargingVoltage()
            : voltageType === 'line_to_line' ? 400 : 230;
    }

    _getPhaseModeIntensityLimits() {
        const configuredMin = Number(this.getSetting('min_intensity')) || CONSTANTS.DEVICE.INTENSITY.MIN;
        const configuredMax = Number(this.getSetting('max_intensity')) || CONSTANTS.DEVICE.INTENSITY.MAX;
        const reportedMin = typeof this.getCapabilityValue === 'function'
            ? Number(this.getCapabilityValue('min_intensity')) || CONSTANTS.DEVICE.INTENSITY.MIN
            : CONSTANTS.DEVICE.INTENSITY.MIN;
        const reportedMax = typeof this.getCapabilityValue === 'function'
            ? Number(this.getCapabilityValue('max_intensity')) || CONSTANTS.DEVICE.INTENSITY.MAX
            : CONSTANTS.DEVICE.INTENSITY.MAX;
        const maxIntensity = Math.min(
            CONSTANTS.DEVICE.INTENSITY.MAX,
            Math.max(CONSTANTS.DEVICE.INTENSITY.MIN, configuredMax),
            Math.max(CONSTANTS.DEVICE.INTENSITY.MIN, reportedMax)
        );
        const minIntensity = Math.min(
            maxIntensity,
            Math.max(CONSTANTS.DEVICE.INTENSITY.MIN, configuredMin, reportedMin)
        );
        return { minIntensity, maxIntensity };
    }

    _getPhaseModeCapabilityOptions(phaseMode, voltageType, voltage, minIntensity, maxIntensity) {
        const phaseFactor = phaseMode === '1'
            ? 1
            : voltageType === 'line_to_line' ? Math.sqrt(3) : 3;
        const wattsPerAmp = voltage * phaseFactor;
        // The Homey target is an integer watt value and current commands floor the conversion.
        // Use a whole-watt amp step so the advertised maximum can still command the configured max.
        const step = Math.ceil(wattsPerAmp);
        const max = maxIntensity * step;
        const excludeMax = Math.ceil(minIntensity * wattsPerAmp);

        return {
            options: {
                min: 0,
                max,
                step,
                excludeMin: 0,
                excludeMax,
                decimals: 0
            },
            max,
            excludeMax,
            step
        };
    }

    async _applyCapabilityOptionsForPhaseMode(phaseModeOverride = null, voltageSettingsOverride = null) {
        // Keep the advertised range aligned with Homey's selected voltage/current calculation.
        const phaseMode = phaseModeOverride || this.getSetting('phase_mode') || '3';
        const voltageType = voltageSettingsOverride?.voltageType || this.getSetting('voltage_type') || 'line_to_neutral';
        const voltage = this._getPhaseModeVoltage(voltageType, voltageSettingsOverride);
        const { minIntensity, maxIntensity } = this._getPhaseModeIntensityLimits();
        const { options, max, excludeMax, step } = this._getPhaseModeCapabilityOptions(
            phaseMode,
            voltageType,
            voltage,
            minIntensity,
            maxIntensity
        );

        try {
            await this.setCapabilityOptions('target_power', options);
            this.logger.debug('target_power capability options aktualizovány', {
                phaseMode, max, excludeMax, step
            });
        } catch (error) {
            this.logger.warn('Nepodařilo se nastavit target_power capability options', {
                error: error.message
            });
        }
    }

    _mapPhaseModeToV2CChargeMode(phaseMode) {
        if (phaseMode === '1') return '0';
        if (phaseMode === '3') return '1';
        throw new Error('phase_mode must be "1" or "3"');
    }

    async _setV2CChargeModeForPhaseMode(phaseMode) {
        const chargeMode = this._mapPhaseModeToV2CChargeMode(phaseMode);
        await this.v2cApi.setParameter('ChargeMode', chargeMode);
    }

    async setInstallationPhaseMode(phaseMode) {
        if (phaseMode !== '1' && phaseMode !== '3') {
            throw new Error('phase_mode must be "1" or "3"');
        }

        await this.setSettings({ phase_mode: phaseMode });
        await this._setV2CChargeModeForPhaseMode(phaseMode);
        await this._applyCapabilityOptionsForPhaseMode(phaseMode);

        if (this.logger) {
            this.logger.debug('Installation phase mode updated from flow', { phaseMode });
        }

        await this.getProductionData();
        return true;
    }

    async setInstallationVoltage(voltage) {
        const parsedVoltage = Number(voltage);
        const { VALUES } = CONSTANTS.DEVICE.INSTALLATION_VOLTAGE;

        if (!Number.isInteger(parsedVoltage)) {
            throw new Error('Installation voltage must be an integer');
        }
        if (!VALUES.includes(parsedVoltage)) {
            throw new Error(`Installation voltage must be one of: ${VALUES.join(', ')} V`);
        }

        await this.v2cApi.setParameter('VoltageInstallation', parsedVoltage);

        if (this.logger) {
            this.logger.debug('Installation voltage updated', { voltage: parsedVoltage });
        }

        return true;
    }

    _mapV2CToTargetMode(dynamic, dynamicPowerMode) {
        if (!dynamic) {
            return CONSTANTS.TARGET_POWER_MODES.HOMEY;
        }
        const mapped = CONSTANTS.V2C_TO_TARGET_MODE[dynamicPowerMode];
        if (!mapped) {
            // Neznámý DynamicPowerMode — fallback na nejběžnější V2C profil (timed on)
            return CONSTANTS.TARGET_POWER_MODES.V2C_TIMED_ON;
        }
        return mapped;
    }

    _validatePhaseMode(measuredPower, intensity, voltage, phaseMode, voltageType, maxIntensity) {
        // Přeskočíme validaci při nestabilních stavech:
        //  - ramp-up fáze nabíjení (auta rozjíždějí 1f → 3f, chargePower postupně roste)
        //  - nízké hodnoty (šum / zaokrouhlovací chyby)
        if (intensity < CONSTANTS.DEVICE.INTENSITY.MIN || measuredPower < 3000 || voltage < 100) {
            return;
        }

        // V2C reportuje `intensity` jako požadovanou hodnotu, ale fakticky nabíjí maximálně na MaxIntensity cap.
        // Pro realistické srovnání s měřeným výkonem bereme capped hodnotu.
        const cappedIntensity = maxIntensity ? Math.min(intensity, maxIntensity) : intensity;
        const expected = PowerCalculator.calculatePower(cappedIntensity, phaseMode, voltage, voltageType);
        if (expected <= 0) return;

        const deviation = Math.abs(measuredPower - expected) / measuredPower;
        if (deviation > 0.4) {
            this.logger.warn('phase_mode / voltage_type setting pravděpodobně neodpovídá skutečné instalaci', {
                phase_mode: phaseMode,
                voltage_type: voltageType,
                measured_power: measuredPower,
                expected_power: expected,
                intensity: cappedIntensity,
                voltage,
                deviation: `${(deviation * 100).toFixed(0)}%`,
                hint: 'Zkontroluj nastavení "Installation Phase Count" a "Voltage Measurement Type"'
            });
        }
    }

    registerLockedListener() {
        this.registerCapabilityListener('locked', async (value) => {
            try {
                this.logger.debug('Změna locked', { novýStav: value });
                await this.v2cApi.setLocked(value ? '1' : '0');
                return true;
            } catch (error) {
                this.logger.error('Selhalo nastavení locked', error);
                throw new Error('Failed to set the lock state');
            }
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
                    stav: this._lastChargeState,
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
        const chargeState = this._lastChargeState;

        let baseInterval;
        switch(chargeState) {
            case CONSTANTS.CHARGE_STATES.CHARGING: // '2'
                baseInterval = CONSTANTS.INTERVALS.CHARGING;
                break;
            case CONSTANTS.CHARGE_STATES.CONNECTED: // '1'
                baseInterval = CONSTANTS.INTERVALS.CONNECTED;
                break;
            case CONSTANTS.CHARGE_STATES.DISCONNECTED: // '0'
            default:
                baseInterval = CONSTANTS.INTERVALS.DISCONNECTED;
        }

        // Exponential backoff při po sobě jdoucích chybách.
        // 5s → 15s → 45s → 135s → 300s (cap). Reset při první úspěšné odpovědi.
        if (this._consecutivePollErrors === 0) {
            return baseInterval;
        }
        const backoff = baseInterval * Math.pow(
            CONSTANTS.INTERVALS.BACKOFF_MULTIPLIER,
            this._consecutivePollErrors
        );
        return Math.min(backoff, CONSTANTS.INTERVALS.BACKOFF_MAX);
    }
    
    async getProductionData({ force = false, throwOnError = false } = {}) {
        if (force) {
            if (this._forcedProductionDataRequest) {
                return this._forcedProductionDataRequest;
            }

            const pendingRequest = this._productionDataRequest;
            const forcedRequest = this._refreshProductionDataAfter(pendingRequest, throwOnError);
            this._forcedProductionDataRequest = forcedRequest;
            forcedRequest.then(
                () => {
                    if (this._forcedProductionDataRequest === forcedRequest) {
                        this._forcedProductionDataRequest = null;
                    }
                },
                () => {
                    if (this._forcedProductionDataRequest === forcedRequest) {
                        this._forcedProductionDataRequest = null;
                    }
                }
            );
            return forcedRequest;
        }

        if (this._productionDataRequest) {
            return this._productionDataRequest;
        }
        return this._startProductionDataRequest({ throwOnError });
    }

    async _refreshProductionDataAfter(pendingRequest, throwOnError) {
        if (pendingRequest) {
            try {
                await pendingRequest;
            } catch (error) {
                // The forced refresh still needs a new sample if the older poll failed.
            }
        }
        return this._startProductionDataRequest({ force: true, throwOnError });
    }

    _startProductionDataRequest(options) {
        const request = this._fetchProductionData(options);
        this._productionDataRequest = request;
        request.then(
            () => {
                if (this._productionDataRequest === request) this._productionDataRequest = null;
            },
            () => {
                if (this._productionDataRequest === request) this._productionDataRequest = null;
            }
        );
        return request;
    }

    async _fetchProductionData({ force = false, throwOnError = false } = {}) {
        try {
            const now = Date.now();
            if (!force && this.lastResponse && this.lastResponseTime && (now - this.lastResponseTime < CONSTANTS.API.CACHE_TTL)) {
                this.logger.debug('Použita cache data');
                return this.dataValidator.validateAndProcessData(this.lastResponse);
            }
    
            await this.energyManager.resetMonthlyAndYearlyDataIfNeeded();
    
            try {
                await this._fetchAndProcessProductionData();
            } catch (error) {
                await this._handleProductionDataError(error, throwOnError);
            }
        } catch (error) {
            this.logger.error('Kritická chyba při zpracování dat', error);
            if (throwOnError) {
                throw error;
            }
        }
    }

    async _fetchAndProcessProductionData() {
        const baseSession = await this.v2cApi.getData();
        const deviceData = this.dataValidator.validateAndProcessData(baseSession);
        if (!deviceData) {
            throw new Error('Invalid telemetry data returned by API.');
        }

        // Úspěšný fetch — reset error counteru a backoffu
        if (this._consecutivePollErrors > 0) {
            this.logger.debug('Polling error counter reset', {
                předchozí: this._consecutivePollErrors
            });
            this._consecutivePollErrors = 0;
        }

        const previousState = await this.getStoreValue('previousChargeState') || CONSTANTS.CHARGE_STATES.DISCONNECTED;
        const currentState = deviceData.chargeState;
        const chargeEnergy = await this.energyManager.processEnergyData(deviceData, previousState, currentState);

        await this.updateCapabilities(deviceData, currentState, chargeEnergy);
        await this.handleStateChanges(currentState, previousState, deviceData);

        const hadError = await this.getCapabilityValue('measure_connection_error');
        if (hadError) {
            await this.setCapabilityValue('measure_connection_error', false);
            await this.flowCardManager.triggerConnectionStateChanged('ok');
        }

        const successfulAt = Date.now();
        this.lastResponse = baseSession;
        this.lastResponseTime = successfulAt;
        this._lastSuccessfulUpdate = successfulAt;
        this._statusStale = false;

        if (!this.getAvailable()) {
            await this.setAvailable();
        }
    }

    async _handleProductionDataError(error, throwOnError) {
        // Increment error counteru pro exponential backoff pollingu
        this._consecutivePollErrors++;
        this._statusStale = true;

        const hadError = await this.getCapabilityValue('measure_connection_error');
        if (error.message === 'API_MAX_ERRORS_EXCEEDED') {
            if (!hadError) {
                this.logger.error('API není dostupné po více pokusech', {
                    errorCount: this.v2cApi.getErrorCount(),
                    maxErrors: this.v2cApi._maxConsecutiveErrors,
                    pollBackoffCount: this._consecutivePollErrors
                });
            }
        } else {
            this.logger.debug('Dočasná chyba API', {
                error: error.message,
                errorCount: this.v2cApi.getErrorCount(),
                pollBackoffCount: this._consecutivePollErrors,
                isInErrorState: this.v2cApi.isInErrorState()
            });

            if (this.lastResponse) {
                this.logger.debug('Použita poslední známá data kvůli chybě API');
            }
        }
        if (!hadError) {
            await this.setCapabilityValue('measure_connection_error', true);
            await this.flowCardManager.triggerConnectionStateChanged('error');
        }
        if (throwOnError) {
            throw error;
        }
    }

    async updateCapabilities(deviceData, currentState, chargeEnergy) {
        try {
            const hasPrimaryFault = Object.prototype.hasOwnProperty.call(
                CONSTANTS.CHARGE_STATE_FAULT_DESCRIPTIONS,
                currentState
            );

            // Lifetime energie pro Homey Energy tab (monotónní, nikdy neklesá při odpojení)
            const lifetimeEnergy = this.energyManager.getLifetimeEnergy();

            // Pomocník — setCapabilityValue jen pokud capability existuje (kvůli postupné migraci)
            const safeSet = (cap, val) => this.hasCapability(cap)
                ? this.setCapabilityValue(cap, val)
                : Promise.resolve();
            const safeSetNullable = (cap, val) => {
                if (!this.hasCapability(cap)) return Promise.resolve();
                if (val === null || val === undefined ||
                    (typeof val === 'number' && !Number.isFinite(val))) {
                    return typeof this.unsetCapabilityValue === 'function'
                        ? this.unsetCapabilityValue(cap)
                        : this.setCapabilityValue(cap, null);
                }
                return this.setCapabilityValue(cap, val);
            };

            // Remove a stale voltage reading before asking getChargingVoltage() for its
            // configured nominal fallback.
            await safeSetNullable('measure_voltage_installation', deviceData.voltageInstallation);
            const chargingVoltage = Number.isFinite(deviceData.voltageInstallation)
                ? deviceData.voltageInstallation
                : this.getChargingVoltage();

            // Homey systémové target_power* — mapování z V2C Dynamic + DynamicPowerMode
            const targetMode = this._mapV2CToTargetMode(deviceData.dynamic, deviceData.dynamicPowerMode);
            const phaseMode = this.getSetting('phase_mode') || '3';
            const voltageType = this.getSetting('voltage_type') || 'line_to_neutral';
            const measuredTargetPowerW = PowerCalculator.calculatePower(
                deviceData.intensity,
                phaseMode,
                chargingVoltage,
                voltageType
            );
            const storedHomeyTarget = typeof this.getCapabilityValue === 'function'
                ? this.getCapabilityValue('target_power')
                : undefined;
            const targetPowerW = targetMode === CONSTANTS.TARGET_POWER_MODES.HOMEY &&
                storedHomeyTarget !== undefined && storedHomeyTarget !== null &&
                Number.isFinite(Number(storedHomeyTarget))
                ? Number(storedHomeyTarget)
                : measuredTargetPowerW;

            // Fuzzy validace phase_mode settingu proti skutečně měřenému výkonu
            this._validatePhaseMode(deviceData.chargePower, deviceData.intensity, chargingVoltage, phaseMode, voltageType, deviceData.maxIntensity);

            const importedChargePower = Number.isFinite(deviceData.chargePower)
                ? Math.max(0, deviceData.chargePower)
                : 0;
            const evChargerState = this._mapEvChargerState(currentState, deviceData.paused);

            await Promise.all([
                this.setCapabilityValue('measure_charge_power', deviceData.chargePower),
                this.setCapabilityValue('measure_power', importedChargePower),
                safeSetNullable('measure_current.l1', deviceData.intensityL1),
                safeSetNullable('measure_current.l2', deviceData.intensityL2),
                safeSetNullable('measure_current.l3', deviceData.intensityL3),
                safeSetNullable('measure_voltage.l1', deviceData.voltageL1),
                safeSetNullable('measure_voltage.l2', deviceData.voltageL2),
                safeSetNullable('measure_voltage.l3', deviceData.voltageL3),
                safeSetNullable('measure_slave_error', deviceData.slaveError),
                safeSetNullable('measure_charge_state', currentState),
                safeSet('alarm_generic', hasPrimaryFault),
                this.setCapabilityValue('measure_charge_time', Math.floor(deviceData.chargeTime / 60)),
                safeSetNullable('locked', deviceData.locked),
                this.setCapabilityValue('measure_intensity', deviceData.intensity),
                safeSet('target_power_mode', targetMode),
                safeSet('target_power', targetPowerW),
                this.setCapabilityValue('measure_charge_energy', chargeEnergy),
                this.setCapabilityValue('meter_power', lifetimeEnergy),
                // evcharger_charging = user intent (inverzní k V2C Paused flagu); nahrazuje bývalé measure_paused
                safeSetNullable('evcharger_charging', deviceData.paused === null
                    ? null
                    : !deviceData.paused),
                evChargerState === null ? Promise.resolve() : safeSet('evcharger_charging_state', evChargerState),
                safeSetNullable('measure_house_power', deviceData.housePower),
                safeSetNullable('measure_fv_power', deviceData.fvPower),
                safeSetNullable('measure_battery_power', deviceData.batteryPower),
                this.setCapabilityValue('min_intensity', deviceData.minIntensity),
                this.setCapabilityValue('max_intensity', deviceData.maxIntensity),
                safeSetNullable('firmware_version', deviceData.firmwareVersion),
                safeSetNullable('signal_status', deviceData.signalStatus),
                safeSetNullable('timer_state', deviceData.timer_state),
                this.setCapabilityValue('set_intensity', deviceData.intensity.toString())
            ]);

            // Commit internal charge state only after the full sample publishes. It also drives
            // freshness fault metadata, polling cadence, and the existing Flow state helpers.
            this._lastChargeState = currentState;
    
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
    
    // Veřejné API pro FlowCardManager — interní V2C chargeState ('0'/'1'/'2')
    // již není exponován jako Homey capability, flow handlery ho čtou odtud
    getInternalChargeState() {
        return this._lastChargeState || CONSTANTS.CHARGE_STATES.DISCONNECTED;
    }

    getFaultDescriptor() {
        const description = CONSTANTS.CHARGE_STATE_FAULT_DESCRIPTIONS[this._lastChargeState];
        if (!description) return null;

        return {
            state: Number(this._lastChargeState),
            description
        };
    }

    async getStatusMetadata() {
        return {
            lastUpdated: Number.isFinite(this._lastSuccessfulUpdate)
                ? this._lastSuccessfulUpdate
                : null,
            stale: this._statusStale !== false,
            connectionError: Boolean(await this.getCapabilityValue('measure_connection_error')),
            fault: this.getFaultDescriptor()
        };
    }

    _mapEvChargerState(chargeState, paused) {
        switch (chargeState) {
            case CONSTANTS.CHARGE_STATES.CHARGING:
                return CONSTANTS.EVCHARGER_STATES.PLUGGED_IN_CHARGING;
            case CONSTANTS.CHARGE_STATES.CONNECTED:
                if (paused === null || paused === undefined) return null;
                return paused
                    ? CONSTANTS.EVCHARGER_STATES.PLUGGED_IN_PAUSED
                    : CONSTANTS.EVCHARGER_STATES.PLUGGED_IN;
            case CONSTANTS.CHARGE_STATES.DISCONNECTED:
                return CONSTANTS.EVCHARGER_STATES.PLUGGED_OUT;
            default:
                return null;
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

    async setMonthlyAndYearlyEnergy(value) {
        return await this.energyManager.setMonthlyAndYearlyEnergy(value);
    }

    async setLifetimeEnergy(value) {
        return await this.energyManager.setLifetimeEnergy(value);
    }

    async handleStateChanges(currentState, previousState, deviceData) {
        await this.setStoreValue('previousChargeState', currentState);
    
        if (currentState !== previousState) {
            await this._handleStateChangeTriggers(currentState, previousState);
        }
    
        const previousSlaveError = await this.getStoreValue('previousSlaveError');
        if (deviceData.slaveError !== null && deviceData.slaveError !== undefined &&
            deviceData.slaveError !== previousSlaveError) {
            await this.flowCardManager.triggerSlaveErrorChanged(deviceData.slaveError);
            await this.setStoreValue('previousSlaveError', deviceData.slaveError);
        }
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

    _getInstallationVoltageType(installationVoltage) {
        return CONSTANTS.DEVICE.INSTALLATION_VOLTAGE.LINE_TO_LINE_VALUES.includes(Number(installationVoltage))
            ? 'line_to_line'
            : 'line_to_neutral';
    }

    _configureApiForSettings(newSettings, changedKeys) {
        if (!changedKeys.includes('v2c_ip')) return;

        const ipCheck = validateWallboxIP(newSettings.v2c_ip);
        if (!ipCheck.valid) {
            throw new Error(`Invalid IP address (${ipCheck.reason}) - only private network IPv4 addresses are allowed`);
        }
        this.v2cApi = new v2cAPI(this.homey, newSettings.v2c_ip);
    }

    async _applyIntensitySetting(key, newSettings) {
        if (newSettings[key] < CONSTANTS.DEVICE.INTENSITY.MIN ||
            newSettings[key] > CONSTANTS.DEVICE.INTENSITY.MAX) {
            throw new Error(`Intensity must be between ${CONSTANTS.DEVICE.INTENSITY.MIN} and ${CONSTANTS.DEVICE.INTENSITY.MAX} A`);
        }

        await this.setIntensityLimit(key === 'min_intensity' ? 'min' : 'max', newSettings[key]);
        this.homey.settings.set(key, newSettings[key]);
        return false;
    }

    async _applyDynamicPowerModeSetting(key, newSettings) {
        await this.setDynamicPowerMode(newSettings.dynamic_power_mode);
        this.homey.settings.set(key, newSettings[key]);
        return false;
    }

    async _applyPhaseModeSetting(key, newSettings) {
        if (newSettings.phase_mode !== '1' && newSettings.phase_mode !== '3') {
            throw new Error('phase_mode must be "1" or "3"');
        }

        await this._setV2CChargeModeForPhaseMode(newSettings.phase_mode);
        this.homey.settings.set(key, newSettings[key]);
        return false;
    }

    async _applyInstallationVoltageSetting(key, newSettings) {
        await this.setInstallationVoltage(newSettings.installation_voltage);
        const voltageType = this._getInstallationVoltageType(newSettings.installation_voltage);
        await this.setSettings({ voltage_type: voltageType });
        this.homey.settings.set(key, newSettings[key]);
        return true;
    }

    _applySettingChange(key, newSettings) {
        let clearResponseCache = false;

        switch (key) {
            case 'min_intensity':
            case 'max_intensity':
                return this._applyIntensitySetting(key, newSettings);
            case 'dynamic_power_mode':
                return this._applyDynamicPowerModeSetting(key, newSettings);
            case 'phase_mode':
                return this._applyPhaseModeSetting(key, newSettings);
            case 'voltage_type':
                if (newSettings.voltage_type !== 'line_to_neutral' && newSettings.voltage_type !== 'line_to_line') {
                    throw new Error('voltage_type must be "line_to_neutral" or "line_to_line"');
                }
                clearResponseCache = true;
                this.logger.debug('voltage_type změněn', { nový: newSettings.voltage_type });
                break;
            case 'installation_voltage':
                return this._applyInstallationVoltageSetting(key, newSettings);
            case 'v2c_ip':
                break;
            case 'enable_logging':
                this.logger.setEnabled(newSettings.enable_logging);
                this.v2cApi.setLoggingEnabled(newSettings.enable_logging);
                break;
        }

        this.homey.settings.set(key, newSettings[key]);
        return clearResponseCache;
    }

    _shouldRefreshCapabilityOptionsForSettings(changedKeys) {
        return changedKeys.some((key) => ['phase_mode', 'voltage_type', 'installation_voltage'].includes(key));
    }

    async _refreshCapabilityOptionsForSettings(newSettings, changedKeys) {
        const voltageSettingsOverride = changedKeys.includes('installation_voltage') || changedKeys.includes('voltage_type')
            ? {
                voltageType: changedKeys.includes('installation_voltage')
                    ? this._getInstallationVoltageType(newSettings.installation_voltage)
                    : newSettings.voltage_type,
                installationVoltage: newSettings.installation_voltage
            }
            : null;
        await this._applyCapabilityOptionsForPhaseMode(newSettings.phase_mode, voltageSettingsOverride);
    }

    async onSettings({ oldSettings, newSettings, changedKeys }) {
        this.logger.debug('Změna nastavení zařízení', {
            oldSettings,
            newSettings,
            changedKeys
        });

        try {
            let clearResponseCache = false;
            this._configureApiForSettings(newSettings, changedKeys);

            for (const key of changedKeys) {
                const settingUpdate = this._applySettingChange(key, newSettings);
                // Keep synchronous setting writes synchronous between changed keys.
                const shouldClearResponseCache = settingUpdate && typeof settingUpdate.then === 'function'
                    ? await settingUpdate
                    : settingUpdate;
                if (shouldClearResponseCache) clearResponseCache = true;
            }

            if (this._shouldRefreshCapabilityOptionsForSettings(changedKeys)) {
                await this._refreshCapabilityOptionsForSettings(newSettings, changedKeys);
            }

            if (clearResponseCache) {
                this.lastResponse = null;
                this.lastResponseTime = null;
            }
            if (changedKeys.includes('installation_voltage')) {
                await this.getProductionData({ throwOnError: true });
            } else {
                await this.getProductionData();
            }
        } catch (error) {
            this.logger.error('Chyba při ukládání nastavení', error);
            throw error;
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
            await this.unsetStoreValue('lifetimeEnergyData');
    
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
