'use strict';

const { Driver } = require('homey');
const Logger = require('../../lib/Logger');
const { v2cAPI } = require('./api');
const CONSTANTS = require('../../lib/constants');
const { validateWallboxIP } = require('../../lib/ip_validator');

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

        // Validace IP adresy — povolujeme jen privátní / loopback rozsahy
        // (ochrana proti SSRF přes Homey na veřejné cíle nebo jiné lokální sítě)
        const ipCheck = validateWallboxIP(this.settingsData.ip);
        if (!ipCheck.valid) {
            this.logger.warn('Neplatná IP adresa při párování', {
                ip: this.settingsData.ip,
                reason: ipCheck.reason
            });
            throw new Error(this.homey.__('pair.v2cwallbox.invalid_ip') || 'Invalid IP address — only private network IPv4 addresses are allowed');
        }

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
                    capabilities: CONSTANTS.DEVICE_CAPABILITIES,
                    settings: {
                        v2c_ip: this.settingsData.ip,
                        update_interval: CONSTANTS.DEVICE.MIN_UPDATE_INTERVAL,
                        enable_logging: true,
                        min_intensity: CONSTANTS.DEVICE.INTENSITY.MIN,
                        max_intensity: CONSTANTS.DEVICE.INTENSITY.MAX
                    }
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
     * onRepair je volána když uživatel spustí Repair flow na existujícím zařízení.
     * Umožňuje změnit IP adresu (např. po přestěhování wallboxu do jiné sítě)
     * a re-validovat připojení bez ztráty historie, settings a device ID.
     */
    async onRepair(session, device) {
        this.logger.debug('Začíná repair proces', { deviceId: device.getData().id });

        session.setHandler('getDeviceIP', async () => {
            return device.getSetting('v2c_ip') || '';
        });

        session.setHandler('check', async (data) => {
            return await this.onCheck(data);
        });

        session.setHandler('save_ip', async (data) => {
            const ipCheck = validateWallboxIP(data.ip);
            if (!ipCheck.valid) {
                this.logger.warn('Neplatná IP při repair', { ip: data.ip, reason: ipCheck.reason });
                throw new Error(this.homey.__('pair.v2cwallbox.invalid_ip') || 'Invalid IP address');
            }

            const v2cApi = new v2cAPI(this.homey, data.ip);
            try {
                await v2cApi.initializeSession();
            } catch (error) {
                this.logger.error('Repair: nepodařilo se ověřit připojení', error);
                throw new Error(this.homey.__('pair.v2cwallbox.connection_error') || 'Cannot connect to wallbox');
            }

            // setSettings spustí device.onSettings(), který vytvoří nový v2cAPI client s novou IP.
            await device.setSettings({ v2c_ip: data.ip });
            this.logger.log('Repair: IP adresa úspěšně aktualizována', { newIp: data.ip });
            return true;
        });
    }

    /**
     * onCheck kontroluje dostupnost zařízení
     */
    async onCheck(data) {
        this.logger.debug("Kontrola připojení", { data });

        const ipCheck = validateWallboxIP(data.ip);
        if (!ipCheck.valid) {
            this.logger.warn('Neplatná IP v onCheck', { ip: data.ip, reason: ipCheck.reason });
            return this.homey.__('pair.v2cwallbox.invalid_ip') || 'Invalid IP address';
        }

        const v2cApi = new v2cAPI(this.homey, data.ip);

        try {
            const isConnected = await v2cApi.initializeSession();
            
            if (isConnected) {
                // Pokud je připojení úspěšné, získáme i další údaje
                const deviceData = await v2cApi.getData();
                this.logger.debug("Získána dodatečná data zařízení", deviceData);
                
                // Kontrola verze firmware
                if (deviceData.FirmwareVersion) {
                    this.logger.debug("Detekována verze firmware", {
                        version: deviceData.FirmwareVersion
                    });
                }
            }

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