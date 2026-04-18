'use strict';

// Velikost kruhového bufferu historie v paměti.
// Drží posledních N záznamů pro diagnostiku bez tlaku na paměť.
const HISTORY_CAP = 500;

class Logger {
    constructor(homey, context) {
        this.homey = homey;
        this.context = context;
        this.enabled = false;
        this.history = [];
    }

    setEnabled(enabled) {
        this.enabled = enabled;
        this.log(`Logování ${enabled ? 'zapnuto' : 'vypnuto'}`);
    }

    sanitizeData(data) {
        if (!data || typeof data !== 'object') return data;

        const clean = {};
        try {
            for (const [key, value] of Object.entries(data)) {
                // Vynechání Homey instance a dalších problémových objektů
                if (value && typeof value === 'object') {
                    if (value.constructor &&
                        (value.constructor.name === 'Homey' ||
                         value.constructor.name === 'MyApp' ||
                         value.constructor.name === 'Device')) {
                        clean[key] = `[${value.constructor.name}]`;
                        continue;
                    }
                }
                clean[key] = value;
            }
        } catch (error) {
            return '[Error Sanitizing Data]';
        }
        return clean;
    }

    formatLog(type, message, data = {}) {
        return {
            type,
            message,
            ...this.sanitizeData(data),
            timestamp: new Date().toISOString(),
            context: this.context
        };
    }

    _pushHistory(entry) {
        this.history.push(entry);
        // Ring buffer - odstřihneme nejstarší při překročení limitu
        if (this.history.length > HISTORY_CAP) {
            this.history.splice(0, this.history.length - HISTORY_CAP);
        }
    }

    log(message, data = {}) {
        const entry = this.formatLog('info', message, data);
        this._pushHistory(entry);
        if (this.enabled) {
            this.homey.log(entry);
        }
    }

    error(message, error, data = {}) {
        const entry = this.formatLog('error', message, {
            error: error?.message,
            stack: error?.stack,
            ...this.sanitizeData(data)
        });
        this._pushHistory(entry);
        // Chyby logujeme vždy bez ohledu na enabled flag
        this.homey.error(entry);
    }

    debug(message, data = {}) {
        const entry = this.formatLog('debug', message, data);
        this._pushHistory(entry);
        if (this.enabled) {
            this.homey.log(entry);
        }
    }

    warn(message, data = {}) {
        const entry = this.formatLog('warning', message, data);
        this._pushHistory(entry);
        if (this.enabled) {
            this.homey.log(entry);
        }
    }

    getHistory() {
        return this.history.slice();
    }

    clearHistory() {
        this.history = [];
    }
}

module.exports = Logger;
