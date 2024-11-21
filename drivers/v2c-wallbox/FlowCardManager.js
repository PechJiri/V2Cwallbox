'use strict';

const Homey = require('homey');
const PowerCalculator = require('../../lib/power_calculator');

class FlowCardManager {
    constructor(homey, device) {
        this.homey = homey;
        this.device = device;
        this.logger = null;
        
        // Reference na flow karty
        this._flowCards = {
            triggers: new Map(),
            conditions: new Map(),
            actions: new Map()
        };

        if (this.logger) {
            PowerCalculator.setLogger(this.logger);
        }

        // Definice základních triggerů
        this._basicTriggers = [
            {
                id: 'car-connected',
                capability: 'measure_charge_state',
                comparison: (state) => state === "1"
            },
            {
                id: 'car-disconnected',
                capability: 'measure_charge_state',
                comparison: (state) => state === "0"
            },
            {
                id: 'car-start-charging',
                capability: 'measure_charge_state',
                comparison: (state) => state === "2"
            },
            {
                id: 'slave_error_changed',
                capability: 'measure_slave_error'
            }
        ];

        // Definice základních podmínek
        this._basicConditions = [
            {
                id: 'car-connected-condition',
                capability: 'measure_charge_state',
                comparison: (state) => state === "1"
            },
            {
                id: 'car-is-charging',
                capability: 'measure_charge_state',
                comparison: (state) => state === "2"
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
            // Registrace základních podmínek
            for (const condition of this._basicConditions) {
                const card = this.homey.flow.getConditionCard(condition.id);
                
                // Odregistrujeme starý listener pokud existuje
                if (card.listenerCount('run') > 0) {
                    card.removeAllListeners('run');
                }

                card.registerRunListener(async (args, state) => {
                    const currentValue = await this.device.getCapabilityValue(condition.capability);
                    if (args.value !== undefined) {
                        return condition.comparison(currentValue, args.value);
                    }
                    return condition.comparison(currentValue);
                });

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

            // Definice základních akcí
            const basicActions = [
                {
                    id: 'set_paused',
                    handler: async (args) => {
                        // Převod hodnoty dropdown na boolean
                        const paused = args.paused === '1'; // Dropdown hodnota je '1' pro Pause, '0' pro Resume.
                
                        // API volání k zařízení
                        await this.device.v2cApi.setParameter('Paused', paused ? '1' : '0');
                
                        // Synchronizace capability measure_paused
                        await this.device.setCapabilityValue('measure_paused', paused);
                
                        // Logování
                        if (this.logger) {
                            this.logger.debug('Capability measure_paused nastavena', { paused });
                        }
                
                        return true; // Vrací úspěšný výsledek Flow kartě
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
                        await this.device.v2cApi.setIntensity(args.intensity);
                        return true;
                    }
                },
                {
                    id: 'set_dynamic',
                    handler: async (args) => {
                        await this.device.v2cApi.setDynamic(args.dynamic);
                        return true;
                    }
                },
                {
                    id: 'set_min_intensity',
                    handler: async (args) => {
                        await this.device.v2cApi.setMinIntensity(args.MinIntensity);
                        return true;
                    }
                },
                {
                    id: 'set_max_intensity',
                    handler: async (args) => {
                        await this.device.v2cApi.setMaxIntensity(args.MaxIntensity);
                        return true;
                    }
                },
                {
                    id: 'set_dynamic_power_mode',
                    handler: async (args) => {
                        await this.device.v2cApi.setDynamicPowerMode(args.DynamicPowerMode);
                        return true;
                    }
                },
                {
                    id: 'set_power',
                    handler: async (args) => {
                        const { power, phase_mode, voltage, voltage_type, maxAmps } = args;
                
                        // Výpočet proudu
                        const calculatedCurrent = PowerCalculator.calculateCurrent(power, phase_mode, voltage, voltage_type, maxAmps);
                
                        // Nastavení parametru Intensity na zařízení
                        await this.device.v2cApi.setParameter('Intensity', calculatedCurrent);
                
                        // Logování
                        if (this.logger) {
                            this.logger.debug('Výpočet proudu a nastavení Intensity', {
                                power,
                                phase_mode,
                                voltage,
                                voltage_type,
                                maxAmps,
                                calculated_current: calculatedCurrent
                            });
                        }
                
                        // Vrácení tokenu
                        return { calculated_current: calculatedCurrent };
                    }
                }                                
            ];

            // Registrace všech základních akcí
            for (const action of basicActions) {
                const card = this.homey.flow.getActionCard(action.id);
                
                // Odregistrace starého listeneru pokud existuje
                if (card.listenerCount('run') > 0) {
                    card.removeAllListeners('run');
                }
                
                card.registerRunListener(async (args) => {
                    try {
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