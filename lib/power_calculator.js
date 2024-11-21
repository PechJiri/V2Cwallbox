'use strict';


class PowerCalculator {
    static logger = null;

    static setLogger(logger) {
        PowerCalculator.logger = logger;
    }
    
    static calculateCurrent(power, phaseMode, voltage, voltageType, maxAmps) {
        try {
            if (PowerCalculator.logger) {
                PowerCalculator.logger.debug('Začátek výpočtu proudu', {
                    vstup: {
                        power,
                        phaseMode,
                        voltage,
                        voltageType,
                        maxAmps
                    }
                });
            }

            // Zajistíme kladnou hodnotu výkonu
            power = Math.abs(power);
            
            // Účiník (power factor) předpokládáme 1
            const PF = 1;
            
            let current = 0;
            
            if(phaseMode === '1') {
                // Jednofázový výpočet
                current = power / (PF * voltage);
                if (PowerCalculator.logger) {
                    PowerCalculator.logger.debug('Jednofázový výpočet', {
                        power,
                        PF,
                        voltage,
                        výsledek: current
                    });
                }
            } else {
                // Třífázový výpočet
                if(voltageType === 'line_to_line') {
                    // Napětí mezi linkami
                    current = power / (Math.sqrt(3) * PF * voltage);
                    if (PowerCalculator.logger) {
                        PowerCalculator.logger.debug('Třífázový výpočet (line-to-line)', {
                            power,
                            PF,
                            voltage,
                            sqrt3: Math.sqrt(3),
                            výsledek: current
                        });
                    }
                } else {
                    // Vedení na neutrální napětí
                    current = power / (3 * PF * voltage);
                    if (PowerCalculator.logger) {
                        PowerCalculator.logger.debug('Třífázový výpočet (line-to-neutral)', {
                            power,
                            PF,
                            voltage,
                            výsledek: current
                        });
                    }
                }
            }
            
            // Zaokrouhlení na celá čísla
            const roundedCurrent = Math.round(current);
            
            // Omezení dle maxAmps
            const maxLimit = maxAmps || 32;
            const finalCurrent = Math.max(6, Math.min(maxLimit, roundedCurrent));

            if (PowerCalculator.logger) {
                PowerCalculator.logger.debug('Finální úprava proudu', {
                    původníProud: current,
                    zaokrouhlenýProud: roundedCurrent,
                    limitováníProud: finalCurrent,
                    minLimit: 6,
                    maxLimit
                });
            }
            
            return finalCurrent;

        } catch (error) {
            if (PowerCalculator.logger) {
                PowerCalculator.logger.error('Chyba při výpočtu proudu', error, {
                    vstupníHodnoty: {
                        power,
                        phaseMode,
                        voltage,
                        voltageType,
                        maxAmps
                    }
                });
            }
            throw error;
        }
    }
}

module.exports = PowerCalculator;