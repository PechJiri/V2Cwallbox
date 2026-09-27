/* PR #3 telemetry contract. Shared by the widget, offline preview and tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.V2CCore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const own = (o, key) => Object.prototype.hasOwnProperty.call(o, key);
  const wallboxModes = new Set(['v2c_timed_on', 'v2c_timed_off', 'v2c_fv_exclusive',
    'v2c_fv_min', 'v2c_grid_fv', 'v2c_no_charge']);
  function metric(value) {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (typeof value === 'string' && !value.trim()) return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  function empty(state) {
    return { state, power: null, energy: null, owner: null, quality: 'unknown',
      action: ['loading', 'selection'].includes(state) ? null : 'refresh',
      presence: null, paused: null, physicalCharging: null, faultCode: null };
  }
  function selectedDeviceId(settings) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Invalid wallbox selection');
    // Null is supported only by the PR3 backend's unambiguous single-device fallback.
    if (!own(settings, 'device_id') || settings.device_id === null) return null;
    let value = settings.device_id;
    // Homey's documented autocomplete value is an object. Retain PR3's string format too.
    if (value && typeof value === 'object' && !Array.isArray(value)) value = own(value, 'id') ? value.id : null;
    if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid wallbox selection');
    return value; // Do not transform a pairing key or substitute a Homey device UUID.
  }
  function normalizeStatus(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return empty('unknown');
    if (raw.connectionError === true) return empty('offline');
    if (raw.connectionError !== false) return empty('unknown');
    const watts = metric(raw.chargePower), timestamp = metric(raw.lastUpdated);
    const fresh = raw.stale === false && timestamp !== null && timestamp > 0 && raw.confirmed !== false;
    const owner = fresh ? (raw.targetPowerMode === 'homey' ? 'homey' : wallboxModes.has(raw.targetPowerMode) ? 'wallbox' : null) : null;
    const paused = typeof raw.paused === 'boolean' ? raw.paused : null;
    const physical = watts === null ? null : typeof raw.physicalCharging === 'boolean' ? raw.physicalCharging : watts > 0;
    const consistentPower = watts !== null && physical === (watts > 0);
    let presence = null;
    if (own(raw, 'evState')) {
      if (raw.evState === 'plugged_out') presence = 'idle';
      if (['plugged_in', 'plugged_in_paused', 'plugged_in_charging'].includes(raw.evState)) presence = 'connected';
      // null / unsupported / discharging must not fall through to lossy chargeState='0'/'2'.
    } else {
      const legacy = raw.chargeState == null ? '' : String(raw.chargeState);
      presence = legacy === '0' ? 'idle' : ['1', '2'].includes(legacy) ? 'connected' : null;
    }
    const m = { ...empty('unknown'), power: watts === null ? null : watts / 1000,
      energy: metric(raw.chargeEnergy), paused, presence, physicalCharging: physical, owner,
      quality: fresh ? 'fresh' : 'last-known', lastUpdated: timestamp,
      locked: raw.locked === true, timerActive: raw.timerActive === true };
    const unknownModel = () => { m.owner = null; return m; };
    if (raw.fault && (typeof raw.fault === 'string' || typeof raw.fault === 'object')) {
      m.state = 'fault';
      m.faultCode = [4, 5, 6].includes(Number(raw.fault.state)) ? String(raw.fault.state) : null;
      m.faultDescription = typeof raw.fault === 'string' ? raw.fault : (raw.fault.description || raw.fault.message || '');
      return m;
    }
    if (!fresh) {
      m.state = 'stale';
      // Fixed Stop remains possible without relying on a potentially stale GET.
      m.action = presence === 'connected' && paused === false ? 'pause' : 'refresh';
      return m;
    }
    if (!presence) return unknownModel();
    if (presence === 'idle') { m.state = 'waiting'; m.action = null; return m; }
    if (paused === null) return unknownModel();
    if (paused) { m.state = 'paused'; m.action = 'resume'; return m; }
    if (!consistentPower) return unknownModel();
    m.state = physical ? 'charging' : 'ready';
    m.action = 'pause';
    return m;
  }
  function formatMetric(n, locale) {
    if (n === null || !Number.isFinite(n)) return '—';
    return new Intl.NumberFormat(locale || 'en', { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false }).format(n);
  }
  function commandFor(action, model) {
    if (action === 'refresh') return null;
    if (!['pause', 'resume'].includes(action)) throw new Error('Unknown action');
    const permittedStates = action === 'pause' ? ['ready', 'charging', 'paused', 'stale'] : ['ready', 'charging', 'paused'];
    if (!model || !permittedStates.includes(model.state) || model.presence !== 'connected' || typeof model.paused !== 'boolean') throw new Error('Control unavailable');
    const desired = action === 'pause';
    return model.paused === desired ? null : { paused: desired };
  }
  function commandConfirmed(raw, desiredPaused) {
    if (!raw || raw.confirmed !== true || raw.paused !== desiredPaused) return false;
    const m = normalizeStatus(raw);
    if (m.quality !== 'fresh' || !['waiting', 'ready', 'charging', 'paused'].includes(m.state)) return false;
    // A fresh sample alone is not proof of the requested effect. Resume confirms
    // permission only; a real positive reading is still required for the animation.
    return desiredPaused ? m.power === 0 && m.physicalCharging === false : true;
  }
  return Object.freeze({ normalizeStatus, formatMetric, commandFor, commandConfirmed, selectedDeviceId, empty });
});
