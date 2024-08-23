'use strict';

const { Driver } = require('homey');
const { v2cAPI } = require('./api');

class MyDriver extends Driver {

    async onInit() {
        this.log('MyDriver has been initialized');
        this.registerFlowCards();
    }

    registerFlowCards() {
        this._registerTriggerFlowCards();
        this._registerActionFlowCards();
        this._registerConditionFlowCards();
    }

    _registerTriggerFlowCards() {
        this.homey.flow.getDeviceTriggerCard('car-connected');
        this.homey.flow.getDeviceTriggerCard('car-start-charging');
        this.homey.flow.getDeviceTriggerCard('car-disconnected');
    }

    _registerActionFlowCards() {
        this._registerActionCard('set_paused', 'Paused');
        this._registerActionCard('set_locked', 'Locked');
        this._registerActionCard('set_intensity', 'Intensity');
        this._registerActionCard('set_dynamic', 'Dynamic');
        this._registerActionCard('set_min_intensity', 'MinIntensity');
        this._registerActionCard('set_max_intensity', 'MaxIntensity');
    }

    _registerConditionFlowCards() {
        this._registerConditionCard('car-connected-condition', 'measure_charge_state', "1");
        this._registerConditionCard('car-is-charging', 'measure_charge_state', "2");
        this._registerPowerConditionCard('power-greater-than', '>');
        this._registerPowerConditionCard('power-less-than', '<');
    }

    _registerActionCard(cardId, setting) {
        this.homey.flow.getActionCard(cardId).registerRunListener(async (args, state) => {
            let value = args[setting.toLowerCase()];
            if (value === undefined) {
                value = args[setting];
            }
            this.log(`Running action card ${cardId} with setting ${setting} and value ${value}`);
            return this.setWallboxSetting(setting, value);
        });
    }

    _registerConditionCard(cardId, capability, expectedValue) {
        this.homey.flow.getConditionCard(cardId).registerRunListener(async (args, state) => {
            const device = state.device;
            const currentValue = await device.getCapabilityValue(capability);
            this.log(`Running condition card ${cardId} with capability ${capability}. Expected value: ${expectedValue}, Current value: ${currentValue}`);
            return currentValue === expectedValue;
        });
    }

    _registerPowerConditionCard(cardId, operator) {
        this.homey.flow.getConditionCard(cardId).registerRunListener(async (args, state) => {
            const device = state.device;
            const currentPower = await device.getCapabilityValue('measure_charge_power');
            this.log(`Running power condition card ${cardId}. Current power: ${currentPower}, Threshold: ${args.power}, Operator: ${operator}`);
            return operator === '>' ? currentPower > args.power : currentPower < args.power;
        });
    }

    async setWallboxSetting(setting, value) {
        try {
            const ip = this.settingsData.ip || this.defaultIp;
            const v2cApi = new v2cAPI(ip);
            this.log(`Setting Wallbox ${setting} to ${value} via API`);
            await v2cApi.setParameter(setting, value);
            this.log(`Successfully set ${setting} to ${value}`);
            return true;
        } catch (error) {
            this.log(`Failed to set ${setting} to ${value}: ${error.message}`);
            throw new Error(`Failed to set ${setting}`);
        }
    }

    onPair(session) {
        this.log("onPair() called");
        this.settingsData = { ip: "" };

        session.setHandler("list_devices", async () => {
            this.log("list_devices handler called");
            return await this.onPairListDevices();
        });

        session.setHandler("check", async (data) => {
            this.log("check handler called with data:", data);
            return await this.onCheck(data);
        });

        session.setHandler("settingsChanged", async (data) => {
            this.log("settingsChanged handler called with data:", data);
            this.settingsData = data;
            this.log("Updated settingsData:", this.settingsData);
        });
    }

    async onPairListDevices() {
        this.log("onPairListDevices called");

        try {
            const v2cApi = new v2cAPI(this.settingsData.ip);
            const baseSession = await v2cApi.getData();
            this.log("Data received from API:", baseSession);
            const deviceData = await v2cApi.processData(baseSession);
            this.log("Processed device data:", deviceData);

            const deviceName = baseSession.ID;
            const deviceMac = baseSession.IP;

            if (deviceName && deviceMac) {
                this.log(`Device found: Name - ${deviceName}, MAC - ${deviceMac}`);
                return [{ name: deviceName, data: { id: deviceMac } }];
            } else {
                this.log("No valid device data found.");
                return [];
            }
        } catch (error) {
            this.log("Error fetching or processing device data:", error);
            throw error;
        }
    }

    async onCheck(data) {
        this.log("onCheck called with data:", data);
        const v2cApi = new v2cAPI(data.ip);

        try {
            const isConnected = await v2cApi.initializeSession();
            this.log(`Connection status: ${isConnected ? "OK" : "Error"}`);
            return isConnected
                ? this.homey.__("pair.v2cwallbox.connection_ok")
                : this.homey.__("pair.v2cwallbox.connection_error");
        } catch (error) {
            this.log("Error during onCheck:", error);
            return `${this.homey.__("pair.v2cwallbox.connection_error")}: ${error.message}`;
        }
    }
}

module.exports = MyDriver;