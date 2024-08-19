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
}

module.exports = { v2cAPI };