'use strict';

class PowerCalculator {
    static logger = null;
    
    // Typy zaokrouhlování
    static ROUNDING_TYPES = {
        MATH: 'math',
        FLOOR: 'floor', 
        CEIL: 'ceil'
    };

    static setLogger(logger) {
        PowerCalculator.logger = logger;
    }
    
    static roundValue(value, roundingType = PowerCalculator.ROUNDING_TYPES.MATH) {
        switch(roundingType) {
            case PowerCalculator.ROUNDING_TYPES.FLOOR:
                return Math.floor(value);
            case PowerCalculator.ROUNDING_TYPES.CEIL:
                return Math.ceil(value);
            case PowerCalculator.ROUNDING_TYPES.MATH:
            default:
                return Math.round(value);
        }
    }

    static calculateCurrent(power, phaseMode, voltage, voltageType, maxAmps, roundingType = PowerCalculator.ROUNDING_TYPES.MATH) {
        try {
            if (PowerCalculator.logger) {
                PowerCalculator.logger.debug('Začátek výpočtu proudu', {
                    vstup: {
                        power,
                        phaseMode,
                        voltage,
                        voltageType,
                        maxAmps,
                        roundingType
                    }
                });
            }

            power = Math.abs(power);
            const PF = 1;
            let current = 0;
            
            if(phaseMode === '1') {
                current = power / (PF * voltage);
                if (PowerCalculator.logger) {
                    PowerCalculator.logger.debug('Jednofázový výpočet', {
                        power, PF, voltage, výsledek: current
                    });
                }
            } else {
                if(voltageType === 'line_to_line') {
                    current = power / (Math.sqrt(3) * PF * voltage);
                    if (PowerCalculator.logger) {
                        PowerCalculator.logger.debug('Třífázový výpočet (line-to-line)', {
                            power, PF, voltage, sqrt3: Math.sqrt(3), výsledek: current
                        });
                    }
                } else {
                    current = power / (3 * PF * voltage);
                    if (PowerCalculator.logger) {
                        PowerCalculator.logger.debug('Třífázový výpočet (line-to-neutral)', {
                            power, PF, voltage, výsledek: current
                        });
                    }
                }
            }
            
            const roundedCurrent = this.roundValue(current, roundingType);
            const maxLimit = maxAmps || 32;
            const finalCurrent = Math.max(6, Math.min(maxLimit, roundedCurrent));

            if (PowerCalculator.logger) {
                PowerCalculator.logger.debug('Finální úprava proudu', {
                    původníProud: current,
                    zaokrouhlenýProud: roundedCurrent,
                    limitováníProud: finalCurrent,
                    typZaokrouhlení: roundingType,
                    minLimit: 6,
                    maxLimit
                });
            }
            
            return finalCurrent;

        } catch (error) {
            if (PowerCalculator.logger) {
                PowerCalculator.logger.error('Chyba při výpočtu proudu', error, {
                    vstupníHodnoty: { power, phaseMode, voltage, voltageType, maxAmps, roundingType }
                });
            }
            throw error;
        }
    }

    static calculateCurrentWithoutMINrounding(power, phaseMode, voltage, voltageType, maxAmps, roundingType = PowerCalculator.ROUNDING_TYPES.MATH) {
        try {
            if (PowerCalculator.logger) {
                PowerCalculator.logger.debug('Začátek výpočtu proudu bez minimálního zaokrouhlování', {
                    vstup: { power, phaseMode, voltage, voltageType, maxAmps, roundingType }
                });
            }
    
            power = Math.abs(power);
            const PF = 1;
            let current = 0;
    
            if (phaseMode === '1') {
                current = power / (PF * voltage);
                if (PowerCalculator.logger) {
                    PowerCalculator.logger.debug('Jednofázový výpočet bez minimálního zaokrouhlování', {
                        power, PF, voltage, výsledek: current
                    });
                }
            } else {
                if (voltageType === 'line_to_line') {
                    current = power / (Math.sqrt(3) * PF * voltage);
                    if (PowerCalculator.logger) {
                        PowerCalculator.logger.debug('Třífázový výpočet (line-to-line) bez minimálního zaokrouhlování', {
                            power, PF, voltage, sqrt3: Math.sqrt(3), výsledek: current
                        });
                    }
                } else {
                    current = power / (3 * PF * voltage);
                    if (PowerCalculator.logger) {
                        PowerCalculator.logger.debug('Třífázový výpočet (line-to-neutral) bez minimálního zaokrouhlování', {
                            power, PF, voltage, výsledek: current
                        });
                    }
                }
            }
    
            const roundedCurrent = this.roundValue(current, roundingType);
            const maxLimit = maxAmps || 32;
            const finalCurrent = Math.min(maxLimit, roundedCurrent);
    
            if (PowerCalculator.logger) {
                PowerCalculator.logger.debug('Finální úprava proudu bez minimálního zaokrouhlování', {
                    původníProud: current,
                    zaokrouhlenýProud: roundedCurrent,
                    limitováníProud: finalCurrent,
                    typZaokrouhlení: roundingType,
                    maxLimit
                });
            }
    
            return finalCurrent;
    
        } catch (error) {
            if (PowerCalculator.logger) {
                PowerCalculator.logger.error('Chyba při výpočtu proudu bez minimálního zaokrouhlování', error, {
                    vstupníHodnoty: { power, phaseMode, voltage, voltageType, maxAmps, roundingType }
                });
            }
            throw error;
        }
    }       
}

module.exports = PowerCalculator;