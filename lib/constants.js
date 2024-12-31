'use strict';

/**
 * Konstanty pro V2C Wallbox aplikaci
 * @module Constants
 */
module.exports = {
    // API konfigurace
    API: {
        TIMEOUT: 5000,                    // Timeout pro API požadavky v ms
        MAX_CONSECUTIVE_ERRORS: 20,       // Maximální počet po sobě jdoucích chyb
        DEFAULT_UPDATE_INTERVAL: 5000,    // Výchozí interval aktualizace v ms
        ENDPOINTS: {
            REALTIME: '/RealTimeData',    // Endpoint pro real-time data
            WRITE: '/write'               // Endpoint pro zápis parametrů
        }
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
    },

    // Logger konfigurace
    LOGGER: {
        MAX_LOG_SIZE: 1000,              // Maximální počet logů v historii
        RATE_LIMIT: 1000,                // Rate limit pro stejné logy v ms
        ROTATION_INTERVAL: 24 * 60 * 60 * 1000,  // Interval rotace logů (24h)
        RETENTION_PERIOD: 7 * 24 * 60 * 60 * 1000  // Doba uchování logů (7 dní)
    }
};