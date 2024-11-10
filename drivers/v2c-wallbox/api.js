'use strict';

const fetch = require('node-fetch');

class v2cAPI {
    constructor(ip) {
        this.ip = ip;
    }

    async initializeSession() {
        try {
            const url = `http://${this.ip}/RealTimeData`;
            console.log(`Initializing session with URL: ${url}`);

            const response = await fetch(url);
            const responseData = await response.json();
            console.log('Response from session initialization:', responseData);

            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }

            console.log('Session initialized, data received:', responseData);
            return true;
        } catch (error) {
            console.error('Failed to initialize session:', error);
            throw error;
        }
    }

    async getData() {
        try {
            const url = `http://${this.ip}/RealTimeData`;
            console.log(`Fetching data from URL: ${url}`);

            const response = await fetch(url);
            const data = await response.json();
            console.log('Response from getData:', data);

            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }

            return data;
        } catch (error) {
            console.error('Failed to fetch data:', error);
            throw error;
        }
    }

    processData(data) {
        try {
            console.log('Raw data received:', data);
            
            // Konverze ChargeState - pouze stav 4 mapujeme na 0, jinak použijeme původní hodnotu
            let chargeState = String(data.ChargeState);
            if (data.ChargeState === 4 || data.ChargeState === undefined) {
                chargeState = "0";
            }
    
            // Základní zpracování dat s použitím nullish coalescing
            const processedData = {
                chargeState,
                chargePower: data.ChargePower ?? 0,
                voltageInstallation: data.VoltageInstallation ?? 0,
                chargeEnergy: data.ChargeEnergy ?? 0,
                // Slave Error - potřebujeme dvojciferný formát dle capability
                slaveError: String(data.SlaveError ?? 0).padStart(2, '0'),
                chargeTime: data.ChargeTime ?? 0,
                // Boolean hodnoty
                paused: Boolean(data.Paused),
                measure_locked: Boolean(data.Locked),
                intensity: data.Intensity ?? 0,
                dynamic: Boolean(data.Dynamic)
            };
    
            console.log('Processed data:', processedData);
    
            // Validace dat - zjednodušená podmínka
            if (data.ChargeState === undefined && 
                !data.VoltageInstallation && 
                !data.ChargePower) {
                console.log("No valid device data found.");
                return null;
            }
    
            return processedData;
        } catch (error) {
            console.error('Failed to process data:', error);
            throw error;
        }
    }

    async setParameter(parameter, value) {
        try {
            const url = `http://${this.ip}/write/${parameter}=${value}`;
            console.log(`Sending request to set ${parameter}: ${url}`);

            const response = await fetch(url, { method: 'GET' });
            const responseData = await response.text();
            console.log(`Response from setting ${parameter}:`, responseData);

            if (!response.ok) {
                throw new Error(`Failed to set ${parameter}: ${response.statusText}`);
            }

            console.log(`${parameter} successfully set to ${value}`);
            return responseData;
        } catch (error) {
            console.error(`Error setting ${parameter}:`, error);
            throw error;
        }
    }

    async setPaused(paused) {
        return this.setParameter('Paused', paused);
    }

    async setLocked(locked) {
        return this.setParameter('Locked', locked);
    }

    async setIntensity(intensity) {
        return this.setParameter('Intensity', intensity);
    }

    async setDynamic(dynamic) {
        return this.setParameter('Dynamic', dynamic);
    }

    async setMinIntensity(minIntensity) {
        return this.setParameter('MinIntensity', minIntensity);
    }

    async setMaxIntensity(maxIntensity) {
        return this.setParameter('MaxIntensity', maxIntensity);
    }

    async setDynamicPowerMode(dynamicPowerMode) {
        console.log(`Setting DynamicPowerMode to ${dynamicPowerMode}`);
        return this.setParameter('DynamicPowerMode', dynamicPowerMode);
    }
}

module.exports = { v2cAPI };