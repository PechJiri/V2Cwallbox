'use strict';

const CONSTANTS = require('./constants');

class PowerCalculator {
    static logger = null;

    static setLogger(logger) {
        PowerCalculator.logger = logger;
    }
    
    static roundValue(value, roundingType = CONSTANTS.ROUNDING_TYPES.MATH) {
        switch(roundingType) {
            case CONSTANTS.ROUNDING_TYPES.FLOOR:
                return Math.floor(value);
            case CONSTANTS.ROUNDING_TYPES.CEIL:
                return Math.ceil(value);
            case CONSTANTS.ROUNDING_TYPES.MATH:
            default:
                return Math.round(value);
        }
    }

    static calculateCurrent(power, phaseMode, voltage, voltageType, maxAmps, roundingType = CONSTANTS.ROUNDING_TYPES.MATH) {
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
            const maxLimit = maxAmps || CONSTANTS.DEVICE.INTENSITY.MAX;
            const finalCurrent = Math.max(
                CONSTANTS.DEVICE.INTENSITY.MIN, 
                Math.min(maxLimit, roundedCurrent)
            );

            if (PowerCalculator.logger) {
                PowerCalculator.logger.debug('Finální úprava proudu', {
                    původníProud: current,
                    zaokrouhlenýProud: roundedCurrent,
                    limitováníProud: finalCurrent,
                    typZaokrouhlení: roundingType,
                    minLimit: CONSTANTS.DEVICE.INTENSITY.MIN,
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

    // Inverzní funkce k calculateCurrent — počítá výkon (W) z proudu (A), fází a napětí.
    // Používá se pro zpětnou projekci aktuální V2C Intensity do systémové capability target_power.
    static calculatePower(amps, phaseMode, voltage, voltageType = 'line_to_neutral') {
        try {
            const PF = 1;
            const safeAmps = Math.max(0, amps || 0);
            const safeVoltage = voltage || 230;
            let power = 0;

            if (phaseMode === '1') {
                power = safeAmps * PF * safeVoltage;
            } else if (voltageType === 'line_to_line') {
                power = Math.sqrt(3) * safeAmps * PF * safeVoltage;
            } else {
                power = 3 * safeAmps * PF * safeVoltage;
            }

            const rounded = Math.round(power);

            if (PowerCalculator.logger) {
                PowerCalculator.logger.debug('Výpočet výkonu z proudu', {
                    amps: safeAmps, phaseMode, voltage: safeVoltage, voltageType, výsledek: rounded
                });
            }

            return rounded;
        } catch (error) {
            if (PowerCalculator.logger) {
                PowerCalculator.logger.error('Chyba při výpočtu výkonu', error, {
                    vstupníHodnoty: { amps, phaseMode, voltage, voltageType }
                });
            }
            throw error;
        }
    }

    static calculateCurrentWithoutMINrounding(power, phaseMode, voltage, voltageType, maxAmps, roundingType = CONSTANTS.ROUNDING_TYPES.MATH) {
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
            const maxLimit = maxAmps || CONSTANTS.DEVICE.INTENSITY.MAX;
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