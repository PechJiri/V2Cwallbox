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
        this.transitionQueue = Promise.resolve();
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
        const storedTransaction = await this.device.getStoreValue('energySettlementTransaction');
        const hasStoredTransaction = storedTransaction !== undefined && storedTransaction !== null;
        const hasValidPendingEnergy = Number.isFinite(storedPendingEnergy) &&
            storedPendingEnergy >= 0;

        if (hasStoredTransaction) {
            this.pendingSessionEnergy = storedPendingEnergy;
            await this.resumeSettlementTransaction(storedTransaction);
        } else {
            this.pendingSessionEnergy = hasValidPendingEnergy ? storedPendingEnergy : 0;

            if (!hasValidPendingEnergy && storedPendingEnergy !== undefined) {
                await this.setStoreValue('pendingSessionEnergy', 0);
            }
        }

        // Lifetime cannot be reconstructed from resetting period counters.
        // Preserve only a valid stored total; otherwise start from zero.
        if (!this.lifetimeData || !Number.isFinite(this.lifetimeData.energy) || this.lifetimeData.energy < 0) {
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
        return (this.lifetimeData && Number.isFinite(this.lifetimeData.energy) && this.lifetimeData.energy >= 0)
            ? this.lifetimeData.energy : 0;
    }

    async processEnergyData(deviceData, previousState, currentState) {
        return await this._enqueueTransition(() =>
            this.processEnergyTransition(deviceData, previousState, currentState));
    }

    async _enqueueTransition(operation) {
        const transition = this.transitionQueue.then(operation);
        this.transitionQueue = transition.catch(() => {});
        return await transition;
    }

    async processEnergyTransition(deviceData, previousState, currentState) {
        try {
            await this.resumeSettlementTransaction();

            if (currentState === CONSTANTS.CHARGE_STATES.DISCONNECTED) {
                const { currentEnergy, lastKnownEnergy } = await this.getEnergyValues(deviceData);
                if (this.pendingSessionEnergy > 0 &&
                    this.isValidEnergy(currentEnergy) &&
                    !this.isExcessiveEnergyChange(currentEnergy, lastKnownEnergy)) {
                    await this.rememberPendingSessionEnergy(currentEnergy);
                }

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
        const energyToSettle = this.pendingSessionEnergy;

        if (energyToSettle > 0) {
            await this.updateEnergyStatistics(energyToSettle);
        } else {
            await this.setStoreValue('pendingSessionEnergy', 0);
            this.pendingSessionEnergy = 0;
        }

        return 0;
    }
    
    async updateEnergyStatistics(energyToAdd) {
        try {
            const transaction = await this.createSettlementTransaction(energyToAdd);
            await this.setStoreValue('energySettlementTransaction', transaction);
            await this.applySettlementTransaction(transaction);

            this.logger.debug('Aktualizace energetických statistik', {
                přidanáEnergie: energyToAdd,
                měsíčníCelkem: transaction.targets.monthlyData.energy,
                ročníCelkem: transaction.targets.yearlyData.energy,
                lifetimeCelkem: transaction.targets.lifetimeData.energy,
                měsíc: transaction.targets.monthlyData.month,
                rok: transaction.targets.yearlyData.year
            });
        } catch (error) {
            this.logger.error('Chyba při aktualizaci statistik', error);
            throw error;
        }
    }

    async createSettlementTransaction(energyToAdd) {
        if (!Number.isFinite(energyToAdd) || energyToAdd <= 0) {
            throw new Error('Neplatná hodnota energie pro settlement');
        }

        const currentDate = new Date();
        const currentMonth = currentDate.getMonth() + 1;
        const currentYear = currentDate.getFullYear();

        let monthlyData = await this.getStoreValue('monthlyEnergyData') || {
            month: currentMonth,
            energy: 0
        };

        if (monthlyData.month !== currentMonth ||
            !Number.isFinite(monthlyData.energy) || monthlyData.energy < 0) {
            this.logger.debug('Reset měsíčních statistik', {
                starýMěsíc: monthlyData.month,
                novýMěsíc: currentMonth
            });
            monthlyData = {
                month: currentMonth,
                energy: 0
            };
        }

        let yearlyData = await this.getStoreValue('yearlyEnergyData') || {
            year: currentYear,
            energy: 0
        };

        if (yearlyData.year !== currentYear ||
            !Number.isFinite(yearlyData.energy) || yearlyData.energy < 0) {
            this.logger.debug('Reset ročních statistik', {
                starýRok: yearlyData.year,
                novýRok: currentYear
            });
            yearlyData = {
                year: currentYear,
                energy: 0
            };
        }

        const storedLifetimeData = await this.getStoreValue('lifetimeEnergyData');
        const lifetimeData = storedLifetimeData &&
            Number.isFinite(storedLifetimeData.energy) &&
            storedLifetimeData.energy >= 0
            ? {
                ...storedLifetimeData,
                since: typeof storedLifetimeData.since === 'string'
                    ? storedLifetimeData.since
                    : currentDate.toISOString()
            }
            : {
                energy: this.getLifetimeEnergy(),
                since: this.lifetimeData?.since || currentDate.toISOString()
            };

        const transaction = {
            version: 2,
            sessionEnergy: energyToAdd,
            createdAt: currentDate.toISOString(),
            baselines: {
                monthlyData: {
                    month: monthlyData.month,
                    energy: monthlyData.energy
                },
                yearlyData: {
                    year: yearlyData.year,
                    energy: yearlyData.energy
                },
                lifetimeData: {
                    energy: lifetimeData.energy,
                    since: lifetimeData.since
                }
            },
            targets: {
                monthlyData: {
                    ...monthlyData,
                    energy: monthlyData.energy + energyToAdd
                },
                yearlyData: {
                    ...yearlyData,
                    energy: yearlyData.energy + energyToAdd
                },
                lifetimeData: {
                    ...lifetimeData,
                    energy: lifetimeData.energy + energyToAdd
                }
            }
        };

        if (!this.isValidSettlementTransaction(transaction)) {
            throw new Error('Nelze vytvořit platnou settlement transakci');
        }

        return transaction;
    }

    isValidSettlementTransaction(transaction) {
        if (!transaction || transaction.version !== 2 ||
            !Number.isFinite(transaction.sessionEnergy) || transaction.sessionEnergy <= 0 ||
            typeof transaction.createdAt !== 'string' ||
            Number.isNaN(Date.parse(transaction.createdAt)) ||
            !transaction.baselines || !transaction.targets) {
            return false;
        }

        const createdAt = new Date(transaction.createdAt);
        const transactionMonth = createdAt.getMonth() + 1;
        const transactionYear = createdAt.getFullYear();
        const {
            monthlyData: monthlyBaseline,
            yearlyData: yearlyBaseline,
            lifetimeData: lifetimeBaseline
        } = transaction.baselines;
        const { monthlyData, yearlyData, lifetimeData } = transaction.targets;
        const pendingMatches = this.pendingSessionEnergy === 0 ||
            this.areEnergyValuesEqual(this.pendingSessionEnergy, transaction.sessionEnergy);

        return pendingMatches &&
            monthlyBaseline && monthlyData &&
            monthlyBaseline.month === transactionMonth && monthlyData.month === transactionMonth &&
            Number.isFinite(monthlyBaseline.energy) && monthlyBaseline.energy >= 0 &&
            this.areEnergyValuesEqual(
                monthlyData.energy,
                monthlyBaseline.energy + transaction.sessionEnergy
            ) &&
            yearlyBaseline && yearlyData &&
            yearlyBaseline.year === transactionYear && yearlyData.year === transactionYear &&
            Number.isFinite(yearlyBaseline.energy) && yearlyBaseline.energy >= 0 &&
            this.areEnergyValuesEqual(
                yearlyData.energy,
                yearlyBaseline.energy + transaction.sessionEnergy
            ) &&
            lifetimeBaseline && lifetimeData &&
            Number.isFinite(lifetimeBaseline.energy) && lifetimeBaseline.energy >= 0 &&
            this.areEnergyValuesEqual(
                lifetimeData.energy,
                lifetimeBaseline.energy + transaction.sessionEnergy
            ) &&
            typeof lifetimeBaseline.since === 'string' &&
            !Number.isNaN(Date.parse(lifetimeBaseline.since)) &&
            lifetimeData.since === lifetimeBaseline.since;
    }

    areEnergyValuesEqual(actual, expected) {
        if (!Number.isFinite(actual) || !Number.isFinite(expected)) {
            return false;
        }

        const tolerance = 1e-9 * Math.max(1, Math.abs(actual), Math.abs(expected));
        return Math.abs(actual - expected) <= tolerance;
    }

    async resumeSettlementTransaction(storedTransaction) {
        const transaction = arguments.length > 0
            ? storedTransaction
            : await this.getStoreValue('energySettlementTransaction');
        if (transaction === undefined || transaction === null) {
            return false;
        }

        if (!this.isValidSettlementTransaction(transaction)) {
            this.logger.error('Neplatná settlement transakce vyžaduje zásah uživatele');
            throw new Error('Neplatná settlement transakce');
        }

        await this.applySettlementTransaction(transaction);
        return true;
    }

    async applySettlementTransaction(transaction) {
        const { monthlyData, yearlyData, lifetimeData } = transaction.targets;

        await this.setStoreValue('monthlyEnergyData', monthlyData);
        await this.setStoreValue('yearlyEnergyData', yearlyData);
        await this.setStoreValue('lifetimeEnergyData', lifetimeData);
        await this.setCapabilityValue('measure_monthly_energy', monthlyData.energy);
        await this.setCapabilityValue('measure_yearly_energy', yearlyData.energy);
        await this.setCapabilityValue('meter_power', lifetimeData.energy);
        await this.setStoreValue('pendingSessionEnergy', 0);

        this.pendingSessionEnergy = 0;
        this.monthlyData = monthlyData;
        this.yearlyData = yearlyData;
        this.lifetimeData = lifetimeData;

        await this.setStoreValue('energySettlementTransaction', null);
    }

    async resetMonthlyEnergy() {
        return await this._enqueueTransition(async () => {
            await this.resumeSettlementTransaction();
            return await this._resetMonthlyEnergyValue();
        });
    }

    async _resetMonthlyEnergyValue() {
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
        return await this._enqueueTransition(async () => {
            await this.resumeSettlementTransaction();
            return await this._resetYearlyEnergyValue();
        });
    }

    async _resetYearlyEnergyValue() {
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
        return await this._enqueueTransition(async () => {
            await this.resumeSettlementTransaction();
            return await this._setMonthlyEnergyValue(value);
        });
    }

    async _setMonthlyEnergyValue(value) {
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
        return await this._enqueueTransition(async () => {
            await this.resumeSettlementTransaction();
            return await this._setYearlyEnergyValue(value);
        });
    }

    async _setYearlyEnergyValue(value) {
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

    async setMonthlyAndYearlyEnergy(value) {
        return await this._enqueueTransition(async () => {
            await this.resumeSettlementTransaction();
            const monthlyResult = await this._setMonthlyEnergyValue(value);
            const yearlyResult = await this._setYearlyEnergyValue(value);
            return monthlyResult && yearlyResult;
        });
    }

    async setLifetimeEnergy(value) {
        if (!Number.isFinite(value) || value < 0) {
            this.logger.warn('Neplatná hodnota celoživotní energie', { value });
            return false;
        }

        return await this._enqueueTransition(async () => {
            try {
                await this.resumeSettlementTransaction();
                return await this._setLifetimeEnergyValue(value);
            } catch (error) {
                this.logger.error('Chyba při obnově settlementu před opravou lifetime energie', error);
                return false;
            }
        });
    }

    async _setLifetimeEnergyValue(value) {
        try {
            const now = new Date().toISOString();
            const lifetimeData = {
                energy: value,
                since: this.lifetimeData?.since || now,
                lastSet: now
            };

            await this.setStoreValue('lifetimeEnergyData', lifetimeData);
            await this.setCapabilityValue('meter_power', value);
            this.lifetimeData = lifetimeData;

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
        return await this._enqueueTransition(async () => {
            await this.resumeSettlementTransaction();
            return await this._resetMonthlyAndYearlyDataIfNeededValue();
        });
    }

    async _resetMonthlyAndYearlyDataIfNeededValue() {
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
