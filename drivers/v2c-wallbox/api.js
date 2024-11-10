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
            
            const chargeStateMap = {
                0: "0", // EV not connected
                1: "1", // EV connected
                2: "2", // Charging
                3: "3", // Standby or unknown state
                4: "0"  // Unknown or not charging
            };
    
            const slaveErrorMap = {
                0: "00",
                1: "01",
                2: "02",
                3: "03",
                4: "04",
                5: "05",
                6: "06",
                7: "07",
                8: "08",
                9: "09",
                10: "10"
            };
    
            // Ensure all numeric values are properly converted
            const processedData = {
                chargeState: chargeStateMap[data.ChargeState] || "0",
                chargePower: Number(data.ChargePower) || 0,
                voltageInstallation: Number(data.VoltageInstallation) || 0,
                // Convert ChargeEnergy to a number and ensure it's not NaN
                chargeEnergy: Number(data.ChargeEnergy) || 0,
                slaveError: slaveErrorMap[data.SlaveError] || "00",
                chargeTime: Number(data.ChargeTime) || 0,
                paused: Boolean(data.Paused),
                measure_locked: Boolean(data.Locked),
                intensity: Number(data.Intensity) || 0,
                dynamic: Boolean(data.Dynamic)
            };
    
            console.log('Processed data:', processedData);
            console.log('Charge Energy value:', processedData.chargeEnergy);
    
            const isValidDeviceData = processedData.chargeState !== "0" || 
                                      processedData.voltageInstallation !== 0 || 
                                      processedData.chargePower !== 0;
    
            if (!isValidDeviceData) {
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