'use strict';

const { Driver } = require('homey');  // Ujistěte se, že cesta je správná
const { v2cAPI } = require('./api');

class MyDriver extends Driver {

    /**
     * onInit is called when the driver is initialized.
     */
    async onInit() {
        this.log('MyDriver has been initialized');
    }

    /**
     * onPair is called during the device pairing process.
     * This method sets up handlers for various pairing events.
     */
    onPair(session) {
        this.log("onPair() called");
        this.settingsData = {
            "ip": ""
        };

        session.setHandler("list_devices", async () => {
            this.log("list_devices handler called");
            try {
                return await this.onPairListDevices(session);
            } catch (error) {
                this.log("Error in list_devices handler:", error);
                throw error;
            }
        });

        session.setHandler("check", async (data) => {
            this.log("check handler called with data:", data);
            try {
                return await this.onCheck(data);
            } catch (error) {
                this.log("Error in check handler:", error);
                throw error;
            }
        });

        session.setHandler("settingsChanged", async (data) => {
            this.log("settingsChanged handler called with data:", data);
            this.settingsData = data;
            this.log("Updated settingsData:", this.settingsData);
        });
    }

    async onPairListDevices(session) {
        this.log("onPairListDevices called");
        
        let devices = [];
        let v2cApi = new v2cAPI(this.settingsData.ip);
        
        this.log("Fetching data from IP:", this.settingsData.ip);
        
        try {
            let baseSession = await v2cApi.getData();
            this.log("Received base session data:", baseSession);
            
            const deviceData = await v2cApi.processData(baseSession);
            this.log("Processed device data:", deviceData);
            
            const deviceName = baseSession.ID;  // Use ID as the device name
            const deviceMac = baseSession.IP;   // Use IP as the device MAC (just an example)

            // If device name is found, add it to the devices list
            if (deviceName && deviceMac) {
                devices.push({
                    name: deviceName,
                    data: {
                        id: deviceMac
                    }
                });
            }

            this.log("Found devices:", devices);
            return devices;

        } catch (error) {
            this.log("Error fetching or processing device data:", error);
            throw error;
        }
    }

    async onCheck(data) {
        this.log("onCheck called with data:", data);
        let v2cApi = new v2cAPI(data.ip);

        try {
            if (await v2cApi.initializeSession()) {
                return this.homey.__("pair.v2cwallbox.connection_ok");
            } else {
                return this.homey.__("pair.v2cwallbox.connection_error");
            }
        } catch (error) {
            this.log("Error during onCheck:", error);
            return this.homey.__("pair.v2cwallbox.connection_error") + ': ' + error.message;
        }
    }
}

module.exports = MyDriver;