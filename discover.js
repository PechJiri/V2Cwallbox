/* eslint-disable no-console */
/* eslint-disable indent */
/* eslint-disable strict */
const axios = require('axios');

(async () => {
    // Funkce pro provádění požadavků na API V2C Wallbox
    async function axiosFetch(ip, endpoint, _timeout = 3000) {
        const url = `http://${ip}${endpoint}`;
        console.log(`Requesting ${url} with timeout ${_timeout}`);
        try {
            const resp = await axios.get(url, { timeout: _timeout });
            return resp.data;
        } catch (error) {
            console.log(`Error at endpoint ${endpoint}`);
            return false;
        }
    }

    // Příklad IP adresy Wallboxu, změňte na skutečnou IP
    const ipAddress = '192.168.10.41';
    
    // Příklad použití pro načtení aktuálních dat z Wallboxu
    const res = await axiosFetch(ipAddress, '/RealTimeData');
    if (res) {
        // Zpracování a zobrazení důležitých informací
        console.log('Charge State:', res.ChargeState);
        console.log('Charge Power:', res.ChargePower, 'W');
        console.log('Voltage Installation:', res.VoltageInstallation, 'V');
        
        // Další zpracování může být přidáno zde
    } else {
        console.log('Failed to fetch data from Wallbox!');
    }
})();