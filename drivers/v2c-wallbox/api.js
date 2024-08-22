const fetch = require('node-fetch');

class v2cAPI {
    constructor(ip) {
        this.ip = ip;
    }

    // Initialize the session (if needed)
    async initializeSession() {
        try {
            const url = `http://${this.ip}/RealTimeData`;
            console.log(`Initializing session with URL: ${url}`);

            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            console.log('Session initialized, data received:', data);
            return true;  // Assuming initialization is successful
        } catch (error) {
            console.error('Failed to initialize session:', error);
            throw error;
        }
    }

    // Fetch real-time data from the V2C wallbox
    async getData() {
        try {
            const url = `http://${this.ip}/RealTimeData`;
            console.log(`Fetching data from URL: ${url}`);

            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            return data;
        } catch (error) {
            console.error('Failed to fetch data:', error);
            throw error;
        }
    }

    // Process the data to extract only the relevant fields
    async processData(data) {
        try {
            const processedData = {
                chargeState: data.ChargeState,
                chargePower: data.ChargePower,
                voltageInstallation: data.VoltageInstallation,
                chargeEnergy: data.ChargeEnergy,
                slaveError: data.SlaveError,
                chargeTime: data.ChargeTime,
                paused: data.Paused,
                measure_locked: data.Locked,  // Zde nahrazujete 'locked' za 'measure_locked'
                intensity: data.Intensity,
                dynamic: data.Dynamic
            };

            console.log('Processed Data:', processedData);
            return processedData;
        } catch (error) {
            console.error('Failed to process data:', error);
            throw error;
        }
    }

    // Set a parameter on the wallbox
    async setParameter(parameter, value) {
        try {
            const url = `http://${this.ip}/write/${parameter}=${value}`;
            console.log(`Sending request to set ${parameter}: ${url}`);

            const response = await fetch(url, { method: 'GET' });

            if (!response.ok) {
                throw new Error(`Failed to set ${parameter}: ${response.statusText}`);
            }

            console.log(`${parameter} successfully set to ${value}`);
            return true;
        } catch (error) {
            console.error(`Error setting ${parameter}:`, error);
            throw error;
        }
    }

    // Specific methods for each parameter
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
}

module.exports = { v2cAPI };