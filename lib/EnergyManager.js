'use strict';

const CONSTANTS = require('./constants');

class EnergyManager {
    constructor(device, logger) {
        this.device = device;
        this.logger = logger;
        this.monthlyData = null;
        this.yearlyData = null;
        this.lifetimeData = null;
        this.pendingSessionEnergy = 0;
        this.settlementQueue = Promise.resolve();
    }

    // Pomocné metody pro přístup k device zůstávají stejné
    async getStoreValue(key) {
        return await this.device.getStoreValue(key);
    }

    async setStoreValue(key, value) {
        return await this.device.setStoreValue(key, value);
    }

    async setCapabilityValue(key, value) {
        return await this.device.setCapabilityValue(key, value);
    }

    async getCapabilityValue(key) {
        return await this.device.getCapabilityValue(key);
    }

    async initialize() {
        this.monthlyData = await this.device.getStoreValue('monthlyEnergyData');
        this.yearlyData = await this.device.getStoreValue('yearlyEnergyData');
        this.lifetimeData = await this.device.getStoreValue('lifetimeEnergyData');
        const storedPendingEnergy = await this.device.getStoreValue('pendingSessionEnergy');
        const hasValidPendingEnergy = Number.isFinite(storedPendingEnergy) &&
            storedPendingEnergy >= 0 &&
            storedPendingEnergy <= CONSTANTS.DEVICE.MAX_ENERGY_DELTA;
        this.pendingSessionEnergy = hasValidPendingEnergy ? storedPendingEnergy : 0;

        if (!hasValidPendingEnergy && storedPendingEnergy !== undefined) {
            await this.setStoreValue('pendingSessionEnergy', 0);
        }

        // Lifetime cannot be reconstructed from resetting period counters.
        // Preserve only a valid stored total; otherwise start from zero.
        if (!this.lifetimeData || !Number.isFinite(this.lifetimeData.energy)) {
            this.lifetimeData = {
                energy: 0,
                since: new Date().toISOString(),
                seeded: false
            };

            await this.setStoreValue('lifetimeEnergyData', this.lifetimeData);

            if (this.logger) {
                this.logger.debug('Inicializace lifetime čítače', { seed: 0 });
            }
        }

        await this.setCapabilityValue('meter_power', this.getLifetimeEnergy());
    }

    getLifetimeEnergy() {
        return (this.lifetimeData && Number.isFinite(this.lifetimeData.energy))
            ? this.lifetimeData.energy : 0;
    }

    async processEnergyData(deviceData, previousState, currentState) {
        try {
            if (currentState === CONSTANTS.CHARGE_STATES.DISCONNECTED) {
                return await this.settleDisconnectedSession();
            }

            const { currentEnergy, lastKnownEnergy } = await this.getEnergyValues(deviceData);
            
            // Validace a kontroly
            if (!this.isValidEnergy(currentEnergy)) {
                return lastKnownEnergy;
            }
    
            // Kontrola nadměrné změny
            if (this.isExcessiveEnergyChange(currentEnergy, lastKnownEnergy)) {
                return lastKnownEnergy;
            }

            if (currentState === CONSTANTS.CHARGE_STATES.CHARGING ||
                currentState === CONSTANTS.CHARGE_STATES.CONNECTED) {
                await this.rememberPendingSessionEnergy(currentEnergy);
                return currentEnergy;
            }
    
            return lastKnownEnergy;
        } catch (error) {
            this.logger.error('Chyba při zpracování dat o energii', error);
            throw error;
        }
    }
    
    async getEnergyValues(deviceData) {
        return {
            currentEnergy: deviceData.chargeEnergy,
            lastKnownEnergy: await this.getCapabilityValue('measure_charge_energy') || 0
        };
    }
    
    isValidEnergy(energy) {
        if (!Number.isFinite(energy) || energy < 0) {
            this.logger.warn('Neplatná hodnota energie', { energy });
            return false;
        }
        return true;
    }
    
    isExcessiveEnergyChange(currentEnergy, lastKnownEnergy) {
        const energyDelta = Math.abs(currentEnergy - lastKnownEnergy);
        if (energyDelta > CONSTANTS.DEVICE.MAX_ENERGY_DELTA) {
            this.logger.warn('Detekována nadměrná změna energie', {
                lastKnownEnergy,
                currentEnergy,
                delta: energyDelta,
                maxDelta: CONSTANTS.DEVICE.MAX_ENERGY_DELTA
            });
            return true;
        }
        return false;
    }

    async rememberPendingSessionEnergy(currentEnergy) {
        if (currentEnergy <= this.pendingSessionEnergy) {
            return;
        }

        this.pendingSessionEnergy = currentEnergy;
        await this.setStoreValue('pendingSessionEnergy', currentEnergy);
    }

    async settleDisconnectedSession() {
        const settlement = this.settlementQueue.then(async () => {
            const energyToSettle = this.pendingSessionEnergy;

            this.pendingSessionEnergy = 0;
            await this.setStoreValue('pendingSessionEnergy', 0);

            if (energyToSettle > 0) {
                await this.updateEnergyStatistics(energyToSettle);
            }

            return 0;
        });

        this.settlementQueue = settlement.catch(() => {});
        return await settlement;
    }
    
    async updateEnergyStatistics(energyToAdd) {
        try {
            const currentDate = new Date();
            const currentMonth = currentDate.getMonth() + 1;
            const currentYear = currentDate.getFullYear();
    
            // Měsíční statistiky
            let monthlyData = await this.getStoreValue('monthlyEnergyData') || {
                month: currentMonth,
                energy: 0
            };
    
            // Reset při novém měsíci
            if (monthlyData.month !== currentMonth) {
                this.logger.debug('Reset měsíčních statistik', {
                    starýMěsíc: monthlyData.month,
                    novýMěsíc: currentMonth
                });
                monthlyData = {
                    month: currentMonth,
                    energy: 0
                };
            }
    
            // Roční statistiky
            let yearlyData = await this.getStoreValue('yearlyEnergyData') || {
                year: currentYear,
                energy: 0
            };
    
            // Reset při novém roce
            if (yearlyData.year !== currentYear) {
                this.logger.debug('Reset ročních statistik', {
                    starýRok: yearlyData.year,
                    novýRok: currentYear
                });
                yearlyData = {
                    year: currentYear,
                    energy: 0
                };
            }
    
            // Přičtení energie
            monthlyData.energy += energyToAdd;
            yearlyData.energy += energyToAdd;

            // Lifetime čítač (pro meter_power.charged — monotónní, nikdy neklesá)
            if (!this.lifetimeData || typeof this.lifetimeData.energy !== 'number') {
                this.lifetimeData = { energy: 0, since: new Date().toISOString() };
            }
            this.lifetimeData.energy += energyToAdd;

            // Uložení všech hodnot
            await Promise.all([
                this.setStoreValue('monthlyEnergyData', monthlyData),
                this.setStoreValue('yearlyEnergyData', yearlyData),
                this.setStoreValue('lifetimeEnergyData', this.lifetimeData),
                this.setCapabilityValue('measure_monthly_energy', monthlyData.energy),
                this.setCapabilityValue('measure_yearly_energy', yearlyData.energy),
                this.setCapabilityValue('meter_power', this.lifetimeData.energy)
            ]);

            this.logger.debug('Aktualizace energetických statistik', {
                přidanáEnergie: energyToAdd,
                měsíčníCelkem: monthlyData.energy,
                ročníCelkem: yearlyData.energy,
                lifetimeCelkem: this.lifetimeData.energy,
                měsíc: currentMonth,
                rok: currentYear
            });
    
        } catch (error) {
            this.logger.error('Chyba při aktualizaci statistik', error);
            throw error;
        }
    }

    async resetMonthlyEnergy() {
        try {
            const currentMonth = new Date().getMonth() + 1;
            const monthlyData = await this.getStoreValue('monthlyEnergyData');
            
            if (monthlyData) {
                await this.setStoreValue('lastMonthEnergy', monthlyData.energy);
            }

            const newMonthlyData = {
                month: currentMonth,
                energy: 0,
                lastReset: new Date().toISOString()
            };

            await this.setStoreValue('monthlyEnergyData', newMonthlyData);
            await this.setCapabilityValue('measure_monthly_energy', 0);

            this.logger.debug('Manuální reset měsíční energie', { newMonthlyData });
            return true;
        } catch (error) {
            this.logger.error('Chyba při resetu měsíční energie', error);
            return false;
        }
    }

    async resetYearlyEnergy() {
        try {
            const currentYear = new Date().getFullYear();
            const yearlyData = await this.getStoreValue('yearlyEnergyData');
            
            if (yearlyData) {
                await this.setStoreValue('lastYearEnergy', yearlyData.energy);
            }

            const newYearlyData = {
                year: currentYear,
                energy: 0,
                lastReset: new Date().toISOString()
            };

            await this.setStoreValue('yearlyEnergyData', newYearlyData);
            await this.setCapabilityValue('measure_yearly_energy', 0);

            this.logger.debug('Manuální reset roční energie', { newYearlyData });
            return true;
        } catch (error) {
            this.logger.error('Chyba při resetu roční energie', error);
            return false;
        }
    }
    
    async setMonthlyEnergy(value) {
        try {
            const currentDate = new Date();
            const currentMonth = currentDate.getMonth() + 1;
            
            const monthlyData = {
                month: currentMonth,
                energy: value,
                lastSet: new Date().toISOString()
            };
    
            await this.setStoreValue('monthlyEnergyData', monthlyData);
            await this.setCapabilityValue('measure_monthly_energy', value);
    
            this.logger.debug('Nastavena nová hodnota měsíční energie', { 
                novéData: monthlyData 
            });
            return true;
        } catch (error) {
            this.logger.error('Chyba při nastavování měsíční energie', error);
            return false;
        }
    }
    
    async setYearlyEnergy(value) {
        try {
            const currentDate = new Date();
            const currentYear = currentDate.getFullYear();
            
            const yearlyData = {
                year: currentYear,
                energy: value,
                lastSet: new Date().toISOString()
            };
    
            await this.setStoreValue('yearlyEnergyData', yearlyData);
            await this.setCapabilityValue('measure_yearly_energy', value);
    
            this.logger.debug('Nastavena nová hodnota roční energie', { 
                novéData: yearlyData 
            });
            return true;
        } catch (error) {
            this.logger.error('Chyba při nastavování roční energie', error);
            return false;
        }
    }

    async setLifetimeEnergy(value) {
        if (!Number.isFinite(value) || value < 0) {
            this.logger.warn('Neplatná hodnota celoživotní energie', { value });
            return false;
        }

        try {
            const now = new Date().toISOString();
            this.lifetimeData = {
                energy: value,
                since: this.lifetimeData?.since || now,
                lastSet: now
            };

            await this.setStoreValue('lifetimeEnergyData', this.lifetimeData);
            await this.setCapabilityValue('meter_power', value);

            this.logger.debug('Nastavena nová hodnota celoživotní energie', {
                nováData: this.lifetimeData
            });
            return true;
        } catch (error) {
            this.logger.error('Chyba při nastavování celoživotní energie', error);
            return false;
        }
    }

    async resetMonthlyAndYearlyDataIfNeeded() {
        try {
            const currentDate = new Date();
            const currentYear = currentDate.getFullYear();
            const currentMonth = currentDate.getMonth() + 1;
    
            // Získání současných dat s validací
            let monthlyData = await this.getStoreValue('monthlyEnergyData') || {
                month: currentMonth,
                energy: 0
            };
            
            let yearlyData = await this.getStoreValue('yearlyEnergyData') || {
                year: currentYear,
                energy: 0
            };
    
            // Validace hodnot
            if (typeof monthlyData.energy !== 'number' || isNaN(monthlyData.energy)) {
                this.logger.warn('Neplatná hodnota měsíční energie', { monthlyData });
                monthlyData.energy = 0;
            }
            
            if (typeof yearlyData.energy !== 'number' || isNaN(yearlyData.energy)) {
                this.logger.warn('Neplatná hodnota roční energie', { yearlyData });
                yearlyData.energy = 0;
            }
    
            // Reset měsíčních dat
            if (monthlyData.month !== currentMonth) {
                this.logger.debug('Reset měsíčních dat', {
                    starýMěsíc: monthlyData.month,
                    novýMěsíc: currentMonth,
                    předchozíHodnota: monthlyData.energy
                });
                
                const lastMonthEnergy = monthlyData.energy;
                monthlyData = { 
                    month: currentMonth, 
                    energy: 0, 
                    lastReset: new Date().toISOString() 
                };
                
                await this.setStoreValue('lastMonthEnergy', lastMonthEnergy);
                await this.setStoreValue('monthlyEnergyData', monthlyData);
                await this.setCapabilityValue('measure_monthly_energy', 0);
            }
    
            // Reset ročních dat
            if (yearlyData.year !== currentYear) {
                this.logger.debug('Reset ročních dat', {
                    starýRok: yearlyData.year,
                    novýRok: currentYear,
                    předchozíHodnota: yearlyData.energy
                });
                
                const lastYearEnergy = yearlyData.energy;
                yearlyData = { 
                    year: currentYear, 
                    energy: 0, 
                    lastReset: new Date().toISOString() 
                };
                
                await this.setStoreValue('lastYearEnergy', lastYearEnergy);
                await this.setStoreValue('yearlyEnergyData', yearlyData);
                await this.setCapabilityValue('measure_yearly_energy', 0);
            }
    
            this.logger.debug('Aktuální statistiky', {
                monthly: monthlyData,
                yearly: yearlyData,
                currentMonth,
                currentYear
            });
    
        } catch (error) {
            this.logger.error('Chyba při resetu měsíčních/ročních dat', error);
            throw error;
        }
    }
}
module.exports = EnergyManager;
