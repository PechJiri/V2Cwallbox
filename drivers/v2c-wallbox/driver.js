'use strict';

const { Driver } = require('homey');
const Logger = require('../../lib/Logger');
const { v2cAPI } = require('./api');

class V2CWallboxDriver extends Driver {
    /**
     * onInit je volána když je driver inicializován
     */
    async onInit() {
        // Inicializace loggeru pro driver
        this.logger = new Logger(this.homey, 'V2C-Driver');
        this.logger.setEnabled(true); // Driver logger je vždy zapnutý pro zachycení párovacích procesů
        this.logger.log('V2CWallboxDriver se inicializuje');
    }

    /**
     * onPair je volána když uživatel začne párování nového zařízení
     */
    async onPair(session) {
        this.logger.debug("Začíná párovací proces");
        this.settingsData = { ip: "" };

        session.setHandler("list_devices", async () => {
            this.logger.debug("Handler list_devices volán");
            return await this.onPairListDevices();
        });

        session.setHandler("check", async (data) => {
            this.logger.debug("Handler check volán", { data });
            return await this.onCheck(data);
        });

        session.setHandler("settingsChanged", async (data) => {
            this.logger.debug("Handler settingsChanged volán", { data });
            this.settingsData = data;
            this.logger.debug("Aktualizovaná nastavení", { settingsData: this.settingsData });
        });
    }

    /**
     * onPairListDevices vrací seznam dostupných zařízení
     */
    async onPairListDevices() {
        this.logger.debug("Spuštěno hledání zařízení");

        try {
            const v2cApi = new v2cAPI(this.homey, this.settingsData.ip);
            const baseSession = await v2cApi.getData();
            this.logger.debug("Data přijata z API", { baseSession });

            const deviceData = await v2cApi.processData(baseSession);
            this.logger.debug("Zpracovaná data zařízení", { deviceData });

            const deviceName = baseSession.ID;
            const deviceMac = baseSession.IP;

            if (deviceName && deviceMac) {
                this.logger.log('Nalezeno zařízení', { 
                    name: deviceName, 
                    mac: deviceMac 
                });

                return [{
                    name: deviceName,
                    data: { id: deviceMac },
                    capabilities: [
                        'measure_charge_state',
                        'measure_charge_power',
                        'measure_voltage_installation',
                        'measure_charge_energy',
                        'measure_slave_error',
                        'measure_charge_time',
                        'measure_paused',
                        'measure_locked',
                        'measure_intensity',
                        'measure_dynamic',
                        'measure_monthly_energy',
                        'measure_yearly_energy',
                        'car_connected'
                    ]
                }];
            } else {
                this.logger.warn("Nebyla nalezena platná data zařízení");
                return [];
            }
        } catch (error) {
            this.logger.error("Chyba při hledání nebo zpracování dat zařízení", error);
            throw error;
        }
    }

    /**
     * onCheck kontroluje dostupnost zařízení
     */
    async onCheck(data) {
        this.logger.debug("Kontrola připojení", { data });
        const v2cApi = new v2cAPI(this.homey, data.ip);

        try {
            const isConnected = await v2cApi.initializeSession();
            const status = isConnected 
                ? "pair.v2cwallbox.connection_ok"
                : "pair.v2cwallbox.connection_error";

            this.logger.log('Výsledek kontroly připojení', { 
                isConnected, 
                status 
            });

            return this.homey.__(status);
        } catch (error) {
            this.logger.error("Chyba při kontrole připojení", error);
            return `${this.homey.__("pair.v2cwallbox.connection_error")}: ${error.message}`;
        }
    }

    /**
     * onUninit je volána když je driver odinstalován
     */
    async onUninit() {
        this.logger.log('V2CWallboxDriver je odinstalováván');

        // Vyčistíme historii logů před odinstalací
        this.logger.clearHistory();
    }
}

module.exports = V2CWallboxDriver;