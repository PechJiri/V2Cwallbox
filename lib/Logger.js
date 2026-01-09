'use strict';

class Logger {
    constructor(homey, context) {
        this.homey = homey;
        this.context = context;
        this.enabled = false;
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

    log(message, data = {}) {
        if (this.enabled) {
            this.homey.log(this.formatLog('info', message, data));
        }
    }

    error(message, error, data = {}) {
        this.homey.error(this.formatLog('error', message, {
            error: error?.message,
            stack: error?.stack,
            ...this.sanitizeData(data)
        }));
    }

    debug(message, data = {}) {
        if (this.enabled) {
            this.homey.log(this.formatLog('debug', message, data));
        }
    }

    warn(message, data = {}) {
        if (this.enabled) {
            this.homey.log(this.formatLog('warning', message, data));
        }
    }
}

module.exports = Logger;