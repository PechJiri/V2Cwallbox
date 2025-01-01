'use strict';

const Homey = require('homey');
const PowerCalculator = require('../../lib/power_calculator');
const CONSTANTS = require('../../lib/constants');

class FlowCardManager {
    constructor(homey, device) {
        this.homey = homey;
        this.device = device;
        this.logger = null;
        
        this._flowCards = {
            triggers: new Map(),
            conditions: new Map(),
            actions: new Map()
        };

        if (this.logger) {
            PowerCalculator.setLogger(this.logger);
        }

        // Definice základních triggerů s použitím konstant
        this._basicTriggers = [
            {
                id: 'car-connected',
                capability: 'measure_charge_state',
                comparison: (state) => state === CONSTANTS.CHARGE_STATES.CONNECTED
            },
            {
                id: 'car-disconnected',
                capability: 'measure_charge_state',
                comparison: (state) => state === CONSTANTS.CHARGE_STATES.DISCONNECTED
            },
            {
                id: 'car-start-charging',
                capability: 'measure_charge_state',
                comparison: (state) => state === CONSTANTS.CHARGE_STATES.CHARGING
            },
            {
                id: 'slave_error_changed',
                capability: 'measure_slave_error'
            },
            {
                id: 'connection_state_changed',
                capability: 'measure_connection_error',
                hasArgs: true,
                comparison: (state, args) => {
                    const hasError = args.connection_state === 'error';
                    return state === hasError;
                }
            }
        ];

        // Definice základních podmínek s použitím konstant
        this._basicConditions = [
            {
                id: 'car-connected-condition',
                capability: 'measure_charge_state',
                comparison: (state) => state === CONSTANTS.CHARGE_STATES.CONNECTED
            },
            {
                id: 'car-is-charging',
                capability: 'measure_charge_state',
                comparison: (state) => state === CONSTANTS.CHARGE_STATES.CHARGING
            },
            {
                id: 'charging-is-paused',
                capability: 'measure_paused',
                comparison: (state) => state === true
            },
            {
                id: 'charging-is-not-paused',
                capability: 'measure_paused',
                comparison: (state) => state === false
            },
            {
                id: 'power-greater-than',
                capability: 'measure_charge_power',
                comparison: (current, value) => current > value
            },
            {
                id: 'power-less-than',
                capability: 'measure_charge_power',
                comparison: (current, value) => current < value
            },
            {
                id: 'is_connection_error',
                capability: 'measure_connection_error',
                comparison: (state) => state === true
            },
            {
                id: 'compare_calculated_current',
                comparison: (args) => {
                    const inputCurrent = parseInt(args.current_input);
                    const targetCurrent = parseInt(args.current);
                    
                    if (inputCurrent < CONSTANTS.DEVICE.INTENSITY.MIN || 
                        inputCurrent > CONSTANTS.DEVICE.INTENSITY.MAX || 
                        targetCurrent < CONSTANTS.DEVICE.INTENSITY.MIN || 
                        targetCurrent > CONSTANTS.DEVICE.INTENSITY.MAX) {
                        return false;
                    }
                    
                    switch(args.operator) {
                        case 'greater':
                            return inputCurrent > targetCurrent;
                        case 'less':
                            return inputCurrent < targetCurrent;
                        case 'equals':
                            return inputCurrent === targetCurrent;
                        case 'greater_equals':
                            return inputCurrent >= targetCurrent;
                        case 'less_equals':
                            return inputCurrent <= targetCurrent;
                        default:
                            return false;
                    }
                }
            }
        ];
    }

    setLogger(logger) {
        this.logger = logger;
        if (this.logger) this.logger.debug('Logger nastaven pro FlowCardManager');
    }

    async initialize() {
        try {
            if (this.logger) {
                this.logger.log('Initializing Flow cards...');
            }
    
            await this._initializeTriggers();
            await this._initializeConditions();
            await this._initializeActions();
    
            // Logování registrovaných karet
            if (this.logger) {
                this.logger.debug('Registered cards', {
                    triggers: Array.from(this._flowCards.triggers.keys()),
                    conditions: Array.from(this._flowCards.conditions.keys()),
                    actions: Array.from(this._flowCards.actions.keys())
                });
            }
        } catch (error) {
            if (this.logger) {
                this.logger.error('Error during Flow card initialization', error);
            }
            throw error;
        }
    }

    async _initializeTriggers() {
        try {
            // Registrace základních triggerů
            for (const trigger of this._basicTriggers) {
                const card = this.homey.flow.getDeviceTriggerCard(trigger.id);
                
                // Odregistrace starého listeneru pokud existuje
                if (card.listenerCount('run') > 0) {
                    card.removeAllListeners('run');
                }
    
                // Pokud má trigger argumenty, registrujeme runListener
                if (trigger.hasArgs) {
                    card.registerRunListener(async (args, state) => {
                        const currentValue = await this.device.getCapabilityValue(trigger.capability);
                        return trigger.comparison(currentValue, args);
                    });
                }
    
                this._flowCards.triggers.set(trigger.id, card);
                
                if (this.logger) {
                    this.logger.debug(`Registrován trigger: ${trigger.id}`);
                }
            }
        } catch (error) {
            if (this.logger) {
                this.logger.error('Chyba při inicializaci triggerů:', error);
            }
            throw error;
        }
    }

    async _initializeConditions() {
        try {
            for (const condition of this._basicConditions) {
                const card = this.homey.flow.getConditionCard(condition.id);
                
                if (card.listenerCount('run') > 0) {
                    card.removeAllListeners('run');
                }
     
                // Speciální handler pro compare_calculated_current
                if (condition.id === 'compare_calculated_current') {
                    card.registerRunListener(async (args) => {
                        return condition.comparison(args);
                    });
                } else {
                    // Původní handler pro ostatní podmínky
                    card.registerRunListener(async (args, state) => {
                        const currentValue = await this.device.getCapabilityValue(condition.capability);
                        if (args.value !== undefined) {
                            return condition.comparison(currentValue, args.value);
                        }
                        return condition.comparison(currentValue); 
                    });
                }
     
                this._flowCards.conditions.set(condition.id, card);
                
                if (this.logger) {
                    this.logger.debug(`Registrována podmínka: ${condition.id}`);
                }
            }
        } catch (error) {
            if (this.logger) {
                this.logger.error('Chyba při inicializaci podmínek:', error);
            }
            throw error;
        }
     }

     async _initializeActions() {
        try {
            if (this.logger) {
                this.logger.debug('Inicializace actions...');
            }

            const basicActions = [
                {
                    id: 'set_paused',
                    handler: async (args) => {
                        const paused = args.paused === '1';
                        await this.device.v2cApi.setParameter('Paused', paused ? '1' : '0');
                        await this.device.setCapabilityValue('measure_paused', paused);
                        if (this.logger) {
                            this.logger.debug('Capability measure_paused nastavena', { paused });
                        }
                        return true;
                    }
                },
                {
                    id: 'set_locked',
                    handler: async (args) => {
                        await this.device.v2cApi.setLocked(args.locked);
                        return true;
                    }
                },
                {
                    id: 'set_intensity',
                    handler: async (args) => {
                        if (args.intensity < CONSTANTS.DEVICE.INTENSITY.MIN || 
                            args.intensity > CONSTANTS.DEVICE.INTENSITY.MAX) {
                            throw new Error(`Intensity musí být mezi ${CONSTANTS.DEVICE.INTENSITY.MIN} a ${CONSTANTS.DEVICE.INTENSITY.MAX} A`);
                        }
                        await this.device.v2cApi.setIntensity(args.intensity);
                        return true;
                    }
                },
                {
                    id: 'set_dynamic',
                    handler: async (args) => {
                        const dynamic = args.dynamic;
                        const currentSettings = this.device.getSettings();
    
                        if (dynamic === '0') {
                            await this.device.setSettings({
                                dynamic_power_mode: CONSTANTS.DYNAMIC_POWER_MODES.DISABLED
                            });
                        } else {
                            const mode = currentSettings.dynamic_power_mode === CONSTANTS.DYNAMIC_POWER_MODES.DISABLED 
                                ? CONSTANTS.DYNAMIC_POWER_MODES.TIMED_ENABLED
                                : currentSettings.dynamic_power_mode;
                            
                            await this.device.setSettings({
                                dynamic_power_mode: mode
                            });
                        }
                        return true;
                    }
                },
                {
                    id: 'set_dynamic_power_mode',
                    handler: async (args) => {
                        const mode = args.DynamicPowerMode;
                        
                        await this.device.setSettings({
                            dynamic_power_mode: mode
                        });
                        return true;
                    }
                },
                {
                    id: 'set_min_intensity',
                    handler: async (args) => {
                        await this.device.setSettings({
                            min_intensity: args.MinIntensity
                        });
                        return true;
                    }
                },
                {
                    id: 'set_max_intensity',
                    handler: async (args) => {
                        await this.device.setSettings({
                            max_intensity: args.MaxIntensity
                        });
                        return true;
                    }
                },
                {
                    id: 'set_power',
                    handler: async (args) => {
                        const { power, phase_mode, voltage, voltage_type, maxAmps, rounding = 'math' } = args;
                        const calculatedCurrent = PowerCalculator.calculateCurrent(
                            power, phase_mode, voltage, voltage_type, maxAmps, rounding
                        );
                        
                        await this.device.v2cApi.setParameter('Intensity', calculatedCurrent);
                        
                        if (this.logger) {
                            this.logger.debug('Výpočet proudu a nastavení Intensity', {
                                power, phase_mode, voltage, voltage_type, maxAmps, rounding,
                                calculated_current: calculatedCurrent
                            });
                        }
                        
                        return { calculated_current: calculatedCurrent };
                    }
                },
                {
                    id: 'calculate_power_with_buffer',
                    handler: async (args) => {
                        const { power, buffer_power, phase_mode, voltage, voltage_type, maxAmps, rounding = 'math' } = args;
                        
                        let current = PowerCalculator.calculateCurrentWithoutMINrounding(
                            power,
                            phase_mode,
                            voltage,
                            voltage_type,
                            maxAmps,
                            rounding
                        );
                
                        if (current < 6 && buffer_power > 0) {
                            const totalPower = Math.abs(power) + buffer_power;
                            current = PowerCalculator.calculateCurrentWithoutMINrounding(
                                totalPower,
                                phase_mode,
                                voltage,
                                voltage_type,
                                maxAmps,
                                rounding
                            );
                        }
                
                        current = Math.min(maxAmps, current);
                        
                        if (this.logger) {
                            this.logger.debug('Výpočet proudu s bufferem', {
                                power,
                                buffer_power,
                                phase_mode,
                                voltage,
                                voltage_type,
                                maxAmps,
                                rounding,
                                vypočtenýProud: current
                            });
                        }
                
                        return {
                            calculated_current: current
                        };
                    }
                },
                {
                    id: 'set_energy_counter',
                    handler: async (args) => {
                        const energy = parseFloat(args.energy);
                        if (isNaN(energy)) {
                            throw new Error('Neplatná hodnota energie');
                        }
                        
                        switch(args.counter_type) {
                            case 'monthly':
                                return await args.device.setMonthlyEnergy(energy);
                            case 'yearly':
                                return await args.device.setYearlyEnergy(energy);
                            case 'both':
                                await args.device.setMonthlyEnergy(energy);
                                await args.device.setYearlyEnergy(energy);
                                return true;
                            default:
                                throw new Error('Neplatný typ počítadla');
                        }
                    }
                }
            ];
    
            // Registrace všech základních akcí
            for (const action of basicActions) {
                const card = this.homey.flow.getActionCard(action.id);
                
                if (card.listenerCount('run') > 0) {
                    card.removeAllListeners('run');
                }
                
                card.registerRunListener(async (args) => {
                    try {
                        if (this.logger) {
                            this.logger.debug(`Spouštím akci ${action.id}`, { 
                                actionArgs: this._sanitizeActionArgs(args) 
                            });
                        }
                        return await action.handler(args);
                    } catch (error) {
                        if (this.logger) {
                            this.logger.error(`Chyba v akci ${action.id}:`, error);
                        }
                        throw error;
                    }
                });
    
                this._flowCards.actions.set(action.id, card);
                
                if (this.logger) {
                    this.logger.debug(`Registrována akce: ${action.id}`);
                }
            }
    
        } catch (error) {
            if (this.logger) {
                this.logger.error('Chyba při inicializaci akcí:', error);
            }
            throw error;
        }
    }

    // Veřejné metody pro triggery
    async triggerCarConnected(tokens = {}, state = {}) {
        await this._triggerCard('car-connected', tokens, state);
    }

    async triggerCarDisconnected(tokens = {}, state = {}) {
        await this._triggerCard('car-disconnected', tokens, state);
    }

    async triggerCarStartCharging(tokens = {}, state = {}) {
        await this._triggerCard('car-start-charging', tokens, state);
    }

    async triggerSlaveErrorChanged(errorDescription) {
        await this._triggerCard('slave_error_changed', { error_description: errorDescription });
    }

    async triggerConnectionStateChanged(hasError) {
        await this._triggerCard('connection_state_changed', {}, { 
            newState: hasError
        });
    }

    async _triggerCard(cardId, tokens = {}, state = {}) {
        try {
            const card = this._flowCards.triggers.get(cardId);
            if (!card) {
                throw new Error(`Trigger card ${cardId} not found`);
            }
            await card.trigger(this.device, tokens, state);
            if (this.logger) {
                this.logger.debug(`Triggered ${cardId}`, { tokens, state });
            }
        } catch (error) {
            if (this.logger) {
                this.logger.error(`Error triggering ${cardId}:`, error);
            }
        }
    }

    _sanitizeActionArgs(args) {
        if (!args) return null;
        
        // Vytvoříme nový objekt pouze s důležitými vlastnostmi
        const sanitized = {};
        
        if (args.device && args.device.id) {
            sanitized.deviceId = args.device.id;
        }
        
        // Přidáme všechny ostatní parametry kromě device
        Object.keys(args).forEach(key => {
            if (key !== 'device') {
                sanitized[key] = args[key];
            }
        });
        
        return sanitized;
    }

    destroy() {
        try {
            this._flowCards.triggers.clear();
            this._flowCards.conditions.clear();
            this._flowCards.actions.clear();
            if (this.logger) this.logger.log('FlowCardManager cleaned up successfully');
        } catch (error) {
            if (this.logger) this.logger.error('Failed to cleanup FlowCardManager:', error);
        }
    }
}

module.exports = FlowCardManager;