'use strict';

/**
 * Konstanty pro V2C Wallbox aplikaci
 * @module Constants
 */
module.exports = {
    // Capabilities
    DEVICE_CAPABILITIES: [
        'measure_charge_state',
        'measure_charge_power',
        'measure_voltage_installation', 
        'measure_charge_energy',
        'measure_slave_error',
        'measure_charge_time',
        'measure_paused',
        'measure_locked',
        'measure_intensity',
        'measure_dynamic',
        'car_connected',
        'measure_yearly_energy',
        'measure_monthly_energy',
        'measure_house_power',
        'measure_fv_power',
        'measure_battery_power',
        'min_intensity',
        'max_intensity',
        'firmware_version',
        'signal_status',
        'timer_state',
        'measure_power',
        'meter_power',
        "set_intensity"
    ],
    
    // API konfigurace
    API: {
        TIMEOUT: 4500,                    // Timeout pro API požadavky v ms
        MAX_CONSECUTIVE_ERRORS: 20,       // Maximální počet po sobě jdoucích chyb
        ENDPOINTS: {
            REALTIME: '/RealTimeData',    // Endpoint pro real-time data
            WRITE: '/write'               // Endpoint pro zápis parametrů
        }
    },

    // Konstanty pro intervaly (v milisekundách)
    INTERVALS: {
        MIN: 5000,            // Minimální povolený interval (5s)
        CHARGING: 5000,       // Stav 2 - aktivní nabíjení (5s)
        CONNECTED: 10000,     // Stav 1 - auto připojeno (10s)
        DISCONNECTED: 30000,  // Stav 0 - auto odpojeno (30s)
    },

    // Limity a omezení zařízení
    DEVICE: {
        INTENSITY: {
            MIN: 6,                       // Minimální povolená intenzita nabíjení v A
            MAX: 32                       // Maximální povolená intenzita nabíjení v A
        },
        VOLTAGE: {
            MIN: 110,                     // Minimální povolené napětí v V
            MAX: 400                      // Maximální povolené napětí v V
        },
        POWER: {
            MIN: -22000,                  // Minimální povolený výkon ve W
            MAX: 22000                    // Maximální povolený výkon ve W
        },
        MAX_ENERGY_DELTA: 100,           // Maximální povolená změna energie mezi měřeními v kWh
        MIN_UPDATE_INTERVAL: 5            // Minimální interval aktualizace v sekundách
    },

    // Stavy nabíjení
    CHARGE_STATES: {
        DISCONNECTED: '0',               // Auto není připojeno
        CONNECTED: '1',                  // Auto je připojeno
        CHARGING: '2'                    // Probíhá nabíjení
    },

    // Stavy signálu
    SIGNAL_STATES: {
        LOW: '1',                        // Slabý signál
        MEDIUM: '2',                     // Střední signál
        GOOD: '3'                        // Dobrý signál
    },

    // Módy dynamického výkonu
    DYNAMIC_POWER_MODES: {
        DISABLED: 'disabled',            // Dynamický výkon vypnut
        TIMED_ENABLED: '0',              // Časovaný výkon zapnut
        TIMED_DISABLED: '1',             // Časovaný výkon vypnut
        FV_EXCLUSIVE: '2',               // Výhradně FV mód
        FV_MIN_POWER: '3',              // FV + minimální výkon
        GRID_FV: '4',                    // Síť + FV
        WITHOUT_CHARGE: '5'              // Bez nabíjení
    },

    // Typy zaokrouhlování pro výpočty
    ROUNDING_TYPES: {
        MATH: 'math',                    // Matematické zaokrouhlení
        FLOOR: 'floor',                  // Zaokrouhlení dolů
        CEIL: 'ceil'                     // Zaokrouhlení nahoru
    },

    // Chybové kódy slave zařízení
    SLAVE_ERRORS: {
        NO_ERROR: '00',                  // Bez chyby
        COMMUNICATION: '01',             // Chyba komunikace
        READING: '02',                   // Chyba čtení
        SLAVE: '03',                     // Chyba slave zařízení
        WAITING_WIFI: '04',              // Čekání na WiFi inverter
        WAITING_COMM: '05',              // Čekání na komunikaci
        WRONG_IP: '06',                  // Špatná IP adresa
        SLAVE_NOT_FOUND: '07',           // Slave nenalezen
        WRONG_SLAVE: '08',               // Špatný slave
        NO_RESPONSE: '09',               // Žádná odpověď
        CLAMP_NOT_CONNECTED: '10'        // Svorka není připojena
    }
};