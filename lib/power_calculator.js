'use strict';

class PowerCalculator {
    
    static calculateCurrent(power, phaseMode, voltage, voltageType, maxAmps) {
        // Zajistíme kladnou hodnotu výkonu
        power = Math.abs(power);
        
        // Účiník (power factor) předpokládáme 1
        const PF = 1;
        
        let current = 0;
        
        if(phaseMode === '1') {
            // Jednofázový výpočet
            current = power / (PF * voltage);
        } else {
            // Třífázový výpočet
            if(voltageType === 'line_to_line') {
                // Napětí mezi linkami
                current = power / (Math.sqrt(3) * PF * voltage);
            } else {
                // Vedení na neutrální napětí
                current = power / (3 * PF * voltage); 
            }
        }
        
        // Zaokrouhlení na celá čísla a omezení dle maxAmps (při defaultním nastavení na 32)
        current = Math.round(current);
        current = Math.max(6, Math.min(maxAmps || 32, current));
        
        return current;
    }
}

module.exports = PowerCalculator;
