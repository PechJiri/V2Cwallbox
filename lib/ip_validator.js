'use strict';

/**
 * Validator IPv4 adres s kontrolou privátních rozsahů.
 *
 * Motivace: v2c_ip setting a pair-flow bere IP od uživatele a posílá tam HTTP
 * požadavky. Bez validace by mohl uživatel (nebo ukradnutý nastavovací
 * interface) nastavit veřejnou IP a použít Homey jako SSRF proxy na cíle
 * v lokální síti jiných uživatelů — nebo naopak na externí zdroje.
 * Povolujeme jen privátní / loopback / link-local adresy.
 */

const PRIVATE_RANGES = [
    // 10.0.0.0/8
    (parts) => parts[0] === 10,
    // 172.16.0.0/12
    (parts) => parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31,
    // 192.168.0.0/16
    (parts) => parts[0] === 192 && parts[1] === 168,
    // 169.254.0.0/16 — link-local (APIPA)
    (parts) => parts[0] === 169 && parts[1] === 254,
    // 127.0.0.0/8 — loopback
    (parts) => parts[0] === 127
];

function parseIPv4(ip) {
    if (typeof ip !== 'string') return null;
    const trimmed = ip.trim();
    const parts = trimmed.split('.');
    if (parts.length !== 4) return null;

    const nums = [];
    for (const p of parts) {
        if (!/^\d{1,3}$/.test(p)) return null;
        const n = parseInt(p, 10);
        if (n < 0 || n > 255) return null;
        nums.push(n);
    }
    return nums;
}

function isValidIPv4(ip) {
    return parseIPv4(ip) !== null;
}

function isPrivateIPv4(ip) {
    const parts = parseIPv4(ip);
    if (!parts) return false;
    return PRIVATE_RANGES.some(check => check(parts));
}

/**
 * Hlavní validátor pro settings / pair flow. Vrací { valid, reason }.
 */
function validateWallboxIP(ip) {
    if (!ip || typeof ip !== 'string' || ip.trim() === '') {
        return { valid: false, reason: 'empty' };
    }
    if (!isValidIPv4(ip)) {
        return { valid: false, reason: 'invalid_format' };
    }
    if (!isPrivateIPv4(ip)) {
        return { valid: false, reason: 'not_private' };
    }
    return { valid: true };
}

module.exports = { isValidIPv4, isPrivateIPv4, validateWallboxIP };
