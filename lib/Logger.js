"use strict";

const CONSTANTS = require('./constants');

class Logger {
    constructor(homey, context) {
        this.homey = homey;
        this.context = context;
        this.enabled = false;

        // Konfigurace cache a rate limitingu
        this.logQueue = new Map();
        this.rateLimit = CONSTANTS.LOGGER.RATE_LIMIT;

        // Konfigurace historie logů
        this.maxLogSize = CONSTANTS.LOGGER.MAX_LOG_SIZE;
        this.logHistory = [];
        this.rotationInterval = CONSTANTS.LOGGER.ROTATION_INTERVAL;
        this.logRetentionPeriod = CONSTANTS.LOGGER.RETENTION_PERIOD;
        this.lastRotation = Date.now();

        // Inicializace flush intervalu a rotace
        this.flushInterval = setInterval(() => this.flushLogs(), 5000);
        this.setupAutoRotation();
    }

    setupAutoRotation() {
        setInterval(() => {
            const now = Date.now();
            if (now - this.lastRotation >= this.rotationInterval) {
                this.rotateLogs();
                this.lastRotation = now;
            }
        }, 5 * 60 * 1000); // Kontrola každých 5 minut
    }

    sanitizeData(data, depth = 0) {
        // Přidáme maximální hloubku rekurze
        const MAX_DEPTH = 3;
        if (depth > MAX_DEPTH) return '[Max Depth Exceeded]';
        
        if (!data || typeof data !== 'object') return data;
        if (Array.isArray(data)) {
            return data.map(item => this.sanitizeData(item, depth + 1));
        }

        const clean = {};
        try {
            for (const [key, value] of Object.entries(data)) {
                // Vynechání Homey instance a dalších problematických objektů
                if (value && typeof value === 'object') {
                    if (value.constructor && 
                        (value.constructor.name === 'Homey' || 
                         value.constructor.name === 'MyApp' ||
                         value.constructor.name === 'Device')) {
                        clean[key] = `[${value.constructor.name}]`;
                        continue;
                    }

                    // Kontrola cyklických referencí - pokud nelze převést na JSON
                    try {
                        JSON.stringify(value);
                        clean[key] = this.sanitizeData(value, depth + 1);
                    } catch (e) {
                        clean[key] = '[Circular Reference]';
                    }
                } else {
                    clean[key] = value;
                }
            }
        } catch (error) {
            return '[Error Sanitizing Data]';
        }

        return clean;
    }

    createLogKey(type, message, data = {}) {
        try {
            const cleanData = this.sanitizeData(data, 0);
            const dataStr = JSON.stringify(cleanData);
            return `${type}-${message}-${dataStr}`.substring(0, 100);
        } catch (error) {
            return `${type}-${message}-[Data Error]`;
        }
    }

    shouldLog(key, type) {
        if (!this.enabled && type !== 'error') return false;

        const now = Date.now();
        const lastLog = this.logQueue.get(key);

        if (lastLog) {
            const timeSinceLastLog = now - lastLog.timestamp;
            // Pokud je to error, logujeme vždy
            if (type === 'error') return true;
            // Pro ostatní typy aplikujeme rate limiting
            return timeSinceLastLog >= this.rateLimit;
        }

        return true;
    }

    addToQueue(type, message, data = {}, error = null) {
        const key = this.createLogKey(type, message, data);
        const now = Date.now();

        if (this.logQueue.has(key)) {
            const existing = this.logQueue.get(key);
            existing.count++;
            existing.lastOccurrence = now;
            if (error) existing.errors.push(error);
        } else {
            this.logQueue.set(key, {
                timestamp: now,
                lastOccurrence: now,
                type,
                message,
                data,
                count: 1,
                errors: error ? [error] : []
            });
        }
    }

    async flushLogs() {
        const now = Date.now();

        for (const [key, logEntry] of this.logQueue.entries()) {
            // Pokud je log starší než rate limit, zpracujeme ho
            if (now - logEntry.lastOccurrence >= this.rateLimit) {
                this.processLogEntry(logEntry);
                this.logQueue.delete(key);
            }
        }
    }

    processLogEntry(logEntry) {
        try {
            const cleanData = this.sanitizeData(logEntry.data);
            const logData = {
                context: this.context,
                type: logEntry.type,
                message: logEntry.message,
                ...cleanData
            };

            if (logEntry.errors?.length > 0) {
                logData.errors = logEntry.errors.map(e => ({
                    message: e?.message,
                    stack: e?.stack
                }));
            }

            this.addToHistory(logEntry.type, logEntry.message, logData);

            const logMethod = logEntry.type === 'error' ? 'error' : 'log';
            const countSuffix = logEntry.count > 1 ? ` (${logEntry.count}x)` : '';

            this.homey[logMethod](JSON.stringify({
                ...logData,
                message: `${logEntry.message}${countSuffix}`
            }));
        } catch (error) {
            this.homey.error('Chyba při zpracování logu:', error);
        }
    }

    addToHistory(type, message, data = {}) {
        const logEntry = {
            timestamp: Date.now(),
            type,
            context: this.context,
            message,
            data
        };

        this.logHistory.push(logEntry);

        // Kontrola velikosti historie
        if (this.logHistory.length > this.maxLogSize) {
            this.rotateLogs();
        }

        return logEntry;
    }

    rotateLogs() {
        try {
            const cutoff = Date.now() - this.logRetentionPeriod;
            this.logHistory = this.logHistory.filter(log => log.timestamp >= cutoff);

            this.debug('Provedena rotace logů', {
                novýPočetZáznamů: this.logHistory.length,
                časRotace: new Date().toISOString()
            });
        } catch (error) {
            this.homey.error('Chyba při rotaci logů:', error);
        }
    }

    setEnabled(enabled) {
        this.enabled = enabled;
        this.log(`Logování ${enabled ? 'zapnuto' : 'vypnuto'}`);
    }

    log(message, data = {}) {
        const key = this.createLogKey('info', message, data);
        if (!this.shouldLog(key, 'info')) return;
        this.addToQueue('info', message, data);
    }

    error(message, error, data = {}) {
        const key = this.createLogKey('error', message, data);
        this.addToQueue('error', message, data, error);
        const logEntry = this.logQueue.get(key);
        if (logEntry) {
            this.processLogEntry(logEntry);
            this.logQueue.delete(key);
        }
    }

    debug(message, data = {}) {
        const key = this.createLogKey('debug', message, data);
        if (!this.shouldLog(key, 'debug')) return;
        this.addToQueue('debug', message, data);
    }

    warn(message, data = {}) {
        const key = this.createLogKey('warning', message, data);
        if (!this.shouldLog(key, 'warning')) return;
        this.addToQueue('warning', message, data);
    }

    getLogHistory() {
        return [...this.logHistory];
    }

    clearHistory() {
        const count = this.logHistory.length;
        this.logHistory = [];
        this.homey.log(`Historie logů vyčištěna (${count} záznamů)`);
    }

    getLogStats() {
        const stats = {
            total: this.logHistory.length,
            queueSize: this.logQueue.size,
            byType: {},
            oldestLog: this.logHistory[0]?.timestamp,
            newestLog: this.logHistory[this.logHistory.length - 1]?.timestamp,
            lastRotation: new Date(this.lastRotation).toISOString(),
            enabled: this.enabled,
            rateLimitMs: this.rateLimit,
            maxLogSize: this.maxLogSize
        };

        this.logHistory.forEach(log => {
            stats.byType[log.type] = (stats.byType[log.type] || 0) + 1;
        });

        return stats;
    }

    destroy() {
        if (this.flushInterval) {
            clearInterval(this.flushInterval);
        }
        this.logQueue.clear();
        this.logHistory = [];
    }
}

module.exports = Logger;